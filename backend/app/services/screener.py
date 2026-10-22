"""Ask Ashika - Screeners.

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


def _pick_sources(source_id):
    sources = ds.enabled_sources()
    db_sources = [s for s in sources if s.kind == "db" and s.schema_json]
    if source_id:
        chosen = [s for s in db_sources if s.id == source_id]
        if chosen:
            return chosen
    return db_sources


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
        "metrics and a sensible ORDER BY. If the data needed isn't in the schema, return an "
        "empty sql and say what's missing. Respond with STRICT JSON only: "
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
    if not sql:
        return {"summary": spec.get("assumptions") or "I couldn't build a screen for that from the "
                "connected data.", "rows": [], "columns": [], "sql": "", "source": src.name}
    try:
        res = ds.run_sql(src, sql, max_rows=max_rows)
    except Exception as e:
        return {"error": "The screen query failed: " + str(e)[:200], "sql": sql,
                "rows": [], "columns": [], "source": src.name}

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
