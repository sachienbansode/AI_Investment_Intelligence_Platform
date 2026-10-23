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
    """Theme discovery when a precise structured screen isn't possible: the LLM names
    the NSE companies it knows for the theme, then we VALIDATE + enrich each against
    CMOTS (companymaster: real + sector) and our NIYTRI Scores. Table built in code so
    it's always clean. Information / discovery only — not advice."""
    # 1) LLM names candidate NSE companies for the theme (uses its market knowledge)
    namer_sys = (
        "You identify NSE-listed Indian companies relevant to an investment theme or request. "
        "Use your knowledge of the Indian market; put the best-known pure-plays first. Output "
        'STRICT JSON ONLY: {"symbols":[{"symbol":"<NSE trading symbol>","why":"<short reason>"}]} '
        "with 6-14 entries. NSE symbols only, no exchange suffix, no commentary." + theme_hint)
    try:
        r = await get_llm_router().complete(namer_sys, "Theme / request: " + prompt,
                                            task="screener_names", max_tokens=500, temperature=0.2)
        m = re.search(r"\{.*\}", r.text, re.DOTALL)
        cands = (json.loads(m.group(0)).get("symbols") if m else []) or []
    except Exception as e:
        log.warning("screener fallback namer failed: %s", e)
        cands = []
    if not cands:
        return ""

    # 2) validate + enrich against CMOTS companymaster + latest NIYTRI Scores
    cmap = {}
    try:
        from app.services import cmots
        if cmots.available():
            cmap = cmots.cocode_map()            # {SYMBOL: {co_code, sector, name}}
    except Exception:
        cmap = {}
    from app.db.database import Instrument, SessionLocal, StockScore
    syms = [str(c.get("symbol", "")).upper().strip() for c in cands if c.get("symbol")]
    db = SessionLocal()
    try:
        instr = {i.symbol.upper(): (i.sector or "", i.name or "")
                 for i in db.query(Instrument).all()}
        score_map = {}
        if syms:
            for s, sc in (db.query(StockScore.symbol, StockScore.composite_score)
                          .filter(StockScore.symbol.in_(syms))
                          .order_by(StockScore.symbol, StockScore.score_date.desc()).all()):
                su = s.upper()
                if su not in score_map and sc is not None:
                    score_map[su] = round(float(sc), 1)
    finally:
        db.close()

    rows = []
    for c in cands:
        sym = str(c.get("symbol", "")).upper().strip()
        if not sym:
            continue
        ci, inf = cmap.get(sym), instr.get(sym)
        if not ci and not inf:
            continue                              # keep it real — only names we actually have
        sector = (ci.get("sector") if ci else "") or (inf[0] if inf else "") or "—"
        name = (ci.get("name") if ci else "") or (inf[1] if inf else sym)
        rows.append({"symbol": sym, "name": name, "sector": sector,
                     "score": score_map.get(sym), "why": (c.get("why") or "").strip()})
    if not rows:
        return ""
    rows.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0)))

    # 3) build the table in code (clean — no LLM markdown artefacts)
    out = ["| Symbol | Company | Sector | NIYTRI Score | Why relevant |",
           "|---|---|---|--:|---|"]
    for r in rows[:12]:
        sc = r["score"] if r["score"] is not None else "—"
        out.append(f"| {r['symbol']} | {r['name']} | {r['sector']} | {sc} | {r['why']} |")
    n = min(len(rows), 12)
    note = (f"> **{n} theme-relevant {'name' if n == 1 else 'names'}** — identified from market "
            "knowledge and matched to our tracked data (NIYTRI Score shown where we rate the stock). "
            "No precise metric screen was possible for this theme on the connected data.")
    return note + "\n\n" + "\n".join(out)


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
                "assumptions": "theme match across our tracked universe",
                "disclaimer": AI_DISCLAIMER}

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
