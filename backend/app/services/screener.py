"""NIYTRI Screeners.

Turns a natural-language screening prompt into ONE read-only SQL SELECT over the
admin-connected market database(s) (see data_sources.py), runs it, and distils the
rows into a plain-English takeaway (the IOT / explanation layer). Also exposes
thematic keywords and dynamic prompt suggestions. Information only - no advice.
"""
from __future__ import annotations

import json
import logging
import re

from app.core.compliance import AI_DISCLAIMER
from app.llm.router import get_llm_router
from app.services import data_sources as ds

log = logging.getLogger(__name__)

# Thematic keyword -> expansion hints (sectors / synonyms) the LLM can use.
THEMES = {
    "BESS": ["battery energy storage", "grid storage", "cells"],
    "AI/ML": ["artificial intelligence", "machine learning", "data center", "GPU"],
    "Green Energy": ["renewable", "solar", "wind", "hydrogen"],
    "EV": ["electric vehicle", "auto ancillary", "battery", "charging"],
    "Drone Tech": ["UAV", "drone", "defence"],
    "Data Center": ["data center", "colocation", "hyperscale"],
    "E-commerce": ["online retail", "quick commerce", "logistics"],
    "Silicon Chips": ["semiconductor", "fab", "chip"],
    "Recycling": ["circular economy", "scrap", "waste management"],
    "Agri Tech": ["agriculture", "fertiliser", "farm"],
    "PSU": ["public sector undertaking", "government owned"],
    "Defence": ["defence", "ordnance", "aerospace"],
}

TRENDING_PROMPTS = [
    "Screen for energy stocks with improving margins amid rising oil prices",
    "Find IT companies with recent deal wins and a positive earnings outlook",
    "Identify manufacturing firms with strong order books and low debt",
    "Show the strongest-scoring stocks across different sectors",
    "Which sectors are benefiting from rising gold prices?",
]


def suggestions() -> dict:
    return {"themes": list(THEMES.keys()), "prompts": TRENDING_PROMPTS}


def _dedupe_rows(res: dict) -> dict:
    """Keep one row per company. Prefers a co_code / symbol / name key column; falls
    back to the whole-row signature. Preserves order."""
    rows = res.get("rows") or []
    cols = res.get("columns") or []
    if not rows:
        return res
    low = {c.lower(): c for c in cols}
    keycol = next((low[k] for k in ("co_code", "cocode", "nsesymbol", "symbol",
                                    "bsecode", "isin", "companyname", "name") if k in low), None)
    seen, out = set(), []
    for r in rows:
        if keycol is not None and r.get(keycol) not in (None, ""):
            sig = ("k", r.get(keycol))
        else:
            sig = ("r", tuple(sorted((str(k), str(v)) for k, v in r.items())))
        if sig in seen:
            continue
        seen.add(sig)
        out.append(r)
    res["rows"] = out
    res["row_count"] = len(out)
    return res


def _pick_sources(source_id):
    sources = ds.enabled_sources()
    db_sources = [s for s in sources if s.kind == "db" and s.schema_json]
    if source_id:
        chosen = [s for s in db_sources if s.id == source_id]
        if chosen:
            return chosen
    return db_sources


async def _thematic_fallback(prompt: str, theme_hint: str = "") -> str:
    """Qualitative shortlist when the structured DB can't answer: grounded in the
    NIYTRI-scored universe (real NSE symbols) + today's news. Information, not advice."""
    from app.db.database import Instrument, SessionLocal, StockScore
    db = SessionLocal()
    try:
        latest = (db.query(StockScore.score_date)
                  .order_by(StockScore.score_date.desc()).first())
        secmap = {r.symbol: (r.sector or "") for r in db.query(Instrument).all()}
        scored = []
        if latest:
            rows = (db.query(StockScore).filter_by(score_date=latest[0])
                    .order_by(StockScore.composite_score.desc()).all())
            for r in rows[:140]:
                scored.append({"symbol": r.symbol, "sector": secmap.get(r.symbol, ""),
                               "score": r.composite_score})
    finally:
        db.close()
    impacted = []
    try:
        from app.services import news_intel
        for n in news_intel.latest_news(limit=20):
            impacted += [str(s).upper() for s in (n.get("impacted_stocks") or [])]
    except Exception:
        impacted = []
    sys = (
        "You are a thematic stock-DISCOVERY assistant for Indian equities. From the NIYTRI "
        "universe below (real NSE symbols, each with our internal NIYTRI Score 0-100), shortlist "
        "the names most relevant to the user's theme/request. Use ONLY symbols from the list. "
        "Output: ONE bold takeaway line, then a markdown table with columns "
        "| Symbol | Sector | NIYTRI Score | Why relevant | (3-8 rows). Keep 'Why relevant' a short "
        "phrase tied to the theme. This is INFORMATION / discovery only — NOT investment advice, "
        "no price targets, no buy/sell calls." + theme_hint)
    usr = ("Request: " + prompt
           + "\nNIYTRI universe (JSON): " + json.dumps(scored[:140], default=str)[:6000]
           + (("\nIn today's news: " + ", ".join(sorted(set(impacted))[:20])) if impacted else ""))
    try:
        r = await get_llm_router().complete(sys, usr, task="screener_fallback",
                                            max_tokens=600, temperature=0.4)
        txt = (r.text or "").strip()
        if txt:
            return ("> **Note:** the connected market data couldn't screen this precisely, so "
                    "here's a qualitative shortlist from the **NIYTRI Score** universe and "
                    "today's news.\n\n" + txt)
    except Exception as e:
        log.warning("screener fallback failed: %s", e)
    return ""


async def run_screen(prompt: str, source_id=None, max_rows: int = 50) -> dict:
    db_sources = _pick_sources(source_id)
    if not db_sources:
        return {"error": "No connected database source with a schema yet. An admin can add "
                "one in Admin → Data Sources and introspect it.", "rows": [], "columns": []}

    schema = ds.schema_text(db_sources)
    theme_hint = ""
    for k, syn in THEMES.items():
        if k.lower() in (prompt or "").lower():
            theme_hint = f"\nThe theme '{k}' maps to: {', '.join(syn)}."
            break

    plan_sys = (
        "You convert an investor's natural-language screening request into ONE read-only SQL "
        "SELECT over the connected market database(s) below. RULES: SELECT or WITH only; a "
        "SINGLE statement; ALWAYS include LIMIT " + str(max_rows) + "; use ONLY tables/columns "
        "present in the schema; include identifying columns (symbol/name) plus the filtered "
        "metrics and a sensible ORDER BY.\n"
        "CRITICAL QUALITY RULES:\n"
        "1. ONE ROW PER COMPANY. A company's co_code can repeat across rows (e.g. standalone vs "
        "consolidated). De-duplicate: use GROUP BY the company key or SELECT DISTINCT ON (co_code) "
        "... ORDER BY co_code, <recency col> — never return the same company twice.\n"
        "2. MATCH THEMES BY CLASSIFICATION, NOT COMPANY NAME. Interpret a theme/sector ONLY via "
        "sector/industry classification columns (e.g. sectorname, industry). NEVER filter on the "
        "company NAME containing a keyword — 'fab' in 'Texfab' is textiles, not semiconductor "
        "fabrication. Do NOT use companyname LIKE '%keyword%' for theme matching.\n"
        "3. If the connected data has no column that genuinely identifies the theme/metric asked "
        "for, return an EMPTY sql and say what's missing — do NOT force a loose name match.\n"
        "Respond with STRICT JSON only: "
        '{"source_id": <int>, "sql": "<sql or empty>", "assumptions": "<short>"}.' + theme_hint +
        "\n\nSCHEMA:\n" + schema)
    try:
        plan = await get_llm_router().complete(plan_sys, "Request: " + prompt,
                                               task="screener_plan", max_tokens=600, temperature=0.0)
        m = re.search(r"\{.*\}", plan.text, re.DOTALL)
        spec = json.loads(m.group(0)) if m else {}
    except Exception as e:
        return {"error": "Could not plan the screen: " + str(e)[:160], "rows": [], "columns": []}

    sql = (spec.get("sql") or "").strip()
    sid = spec.get("source_id")
    src = next((s for s in db_sources if s.id == sid), db_sources[0])

    def _fb_payload(summary):
        return {"summary": summary, "rows": [], "columns": [], "sql": "",
                "source": "NIYTRI analysis", "fallback": True,
                "assumptions": spec.get("assumptions", ""), "disclaimer": AI_DISCLAIMER}

    if not sql:
        fb = await _thematic_fallback(prompt, theme_hint)
        if fb:
            return _fb_payload(fb)
        return {"summary": spec.get("assumptions") or "I couldn't build a screen for that from the "
                "connected data.", "rows": [], "columns": [], "sql": "", "source": src.name}
    try:
        res = ds.run_sql(src, sql, max_rows=max_rows)
    except Exception as e:
        fb = await _thematic_fallback(prompt, theme_hint)
        if fb:
            return _fb_payload(fb)
        return {"error": "The screen query failed: " + str(e)[:200], "sql": sql,
                "rows": [], "columns": [], "source": src.name}

    # Safety-net de-duplication: one row per company even if the SQL returned dupes.
    res = _dedupe_rows(res)

    if not res.get("rows"):
        fb = await _thematic_fallback(prompt, theme_hint)
        if fb:
            return _fb_payload(fb)

    summary = ""
    try:
        summ_sys = (
            "You are a market-screening assistant for Indian equities. Given the user's request "
            "and the result rows, write a concise takeaway: open with ONE bold conclusion line, "
            "then 2-4 short bullets on WHY these names fit and WHAT to watch next. Use only the "
            "rows given — never invent tickers or numbers. Information only, NOT investment advice, "
            "no price targets, no buy/sell calls.")
        summ = await get_llm_router().complete(
            summ_sys, "Request: " + prompt + "\nResult rows (JSON): "
            + json.dumps(res["rows"][:30], default=str)[:4000],
            task="screener_summary", max_tokens=400, temperature=0.3)
        summary = summ.text.strip()
    except Exception:
        summary = f"Found {res['row_count']} matching stock(s)."

    return {"summary": summary, "columns": res["columns"], "rows": res["rows"],
            "sql": sql, "source": src.name, "assumptions": spec.get("assumptions", ""),
            "disclaimer": AI_DISCLAIMER}
