"""Theme-Tagging agent.

Periodically (and on demand) classifies NSE companies into the screener's thematic
buckets (BESS, Silicon Chips, EV, ...). For each theme the LLM names the relevant
companies from its market knowledge; each name is VALIDATED against CMOTS
(companymaster) and enriched with sector + the latest NIYTRI Score, then persisted to
theme_tags. The screener then answers those themes precisely/instantly from the table
instead of an on-the-fly LLM call. Information only — not advice.
"""
from __future__ import annotations

import json
import logging
import re

from app.db.database import Instrument, SessionLocal, StockScore, ThemeTag, utcnow
from app.llm.router import get_llm_router
from app.services.screener import THEMES

log = logging.getLogger(__name__)

_status = {"running": False, "last_run": None, "last_count": 0, "last_error": ""}


def status() -> dict:
    db = SessionLocal()
    try:
        total = db.query(ThemeTag).count()
    except Exception:
        total = 0
    finally:
        db.close()
    return {**_status, "total_tags": total}


async def _name_companies(theme: str, syns: list) -> list:
    """Ask the LLM for NSE companies relevant to one theme -> [{symbol, why}]."""
    sys = (
        "You identify NSE-listed Indian companies for an investment theme. Use your market "
        "knowledge; best-known pure-plays first. Output STRICT JSON ONLY: "
        '{"symbols":[{"symbol":"<NSE symbol>","why":"<short reason>"}]} with 5-15 entries. '
        "NSE trading symbols only, no exchange suffix, no commentary.")
    usr = f"Theme: {theme} (related: {', '.join(syns)}). List the relevant NSE companies."
    try:
        r = await get_llm_router().complete(sys, usr, task="theme_tag",
                                            max_tokens=500, temperature=0.2)
        m = re.search(r"\{.*\}", r.text, re.DOTALL)
        return (json.loads(m.group(0)).get("symbols") if m else []) or []
    except Exception as e:
        log.warning("theme naming failed for %s: %s", theme, e)
        return []


async def refresh_theme(theme: str, syns: list) -> int:
    """Rebuild tags for ONE theme. Returns number of validated tags written."""
    cands = await _name_companies(theme, syns)
    if not cands:
        return 0
    # validate + enrich against CMOTS companymaster + NIYTRI scores
    cmap = {}
    try:
        from app.services import cmots
        if cmots.available():
            cmap = cmots.cocode_map()
    except Exception:
        cmap = {}
    syms = [str(c.get("symbol", "")).upper().strip() for c in cands if c.get("symbol")]
    db = SessionLocal()
    try:
        instr = {i.symbol.upper(): (i.sector or "", i.name or "")
                 for i in db.query(Instrument).all()}
        score_syms = set()
        for s, _sc in (db.query(StockScore.symbol, StockScore.composite_score)
                       .filter(StockScore.symbol.in_(syms)).all()):
            score_syms.add(s.upper())
        rows = []
        for c in cands:
            sym = str(c.get("symbol", "")).upper().strip()
            if not sym:
                continue
            ci, inf = cmap.get(sym), instr.get(sym)
            if not ci and not inf:
                continue                           # keep it real — only names we have
            rows.append({
                "symbol": sym,
                "co_code": (ci.get("co_code") if ci else None),
                "company_name": (ci.get("name") if ci else (inf[1] if inf else sym)),
                "sector": (ci.get("sector") if ci else "") or (inf[0] if inf else ""),
                "why": (c.get("why") or "").strip()[:240],
            })
        # replace this theme's tags atomically
        db.query(ThemeTag).filter_by(theme=theme).delete(synchronize_session=False)
        seen = set()
        for r in rows:
            if r["symbol"] in seen:
                continue
            seen.add(r["symbol"])
            db.add(ThemeTag(theme=theme, **r))
        db.commit()
        return len(seen)
    finally:
        db.close()


async def refresh_all() -> dict:
    """Refresh every theme. Safe to call from the scheduler or an admin 'Run now'."""
    if _status["running"]:
        return {"ok": False, "error": "already running", **status()}
    _status["running"] = True
    _status["last_error"] = ""
    total = 0
    try:
        for theme, syns in THEMES.items():
            try:
                total += await refresh_theme(theme, syns)
            except Exception as e:
                log.warning("refresh_theme %s failed: %s", theme, e)
        _status["last_count"] = total
        _status["last_run"] = utcnow().isoformat()
        return {"ok": True, "count": total}
    except Exception as e:
        _status["last_error"] = str(e)[:200]
        return {"ok": False, "error": str(e)[:200]}
    finally:
        _status["running"] = False


def tags_for(theme: str) -> list:
    """Stored tags for a theme, enriched with the latest NIYTRI Score. [] if none."""
    db = SessionLocal()
    try:
        rows = db.query(ThemeTag).filter_by(theme=theme).all()
        if not rows:
            return []
        syms = [r.symbol for r in rows]
        score = {}
        for s, sc in (db.query(StockScore.symbol, StockScore.composite_score)
                      .filter(StockScore.symbol.in_(syms))
                      .order_by(StockScore.symbol, StockScore.score_date.desc()).all()):
            su = s.upper()
            if su not in score and sc is not None:
                score[su] = round(float(sc), 1)
        out = [{"symbol": r.symbol, "company": r.company_name, "sector": r.sector,
                "score": score.get(r.symbol.upper()), "why": r.why} for r in rows]
        out.sort(key=lambda r: (r["score"] is None, -(r["score"] or 0)))
        return out
    finally:
        db.close()


def match_theme(prompt: str):
    """Return the THEME key if the prompt clearly names one of our themes, else None."""
    p = (prompt or "").lower()
    for k in THEMES:
        if k.lower() in p:
            return k
    return None
