"""Keep the instruments master's NIFTY 50 / NIFTY 500 membership current, so the
daily scoring pipeline always runs on a fresh, correct universe.

Tries NSE's official constituent CSVs first (with browser-like headers); if NSE
is unreachable (datacenter IPs are 403-blocked on EC2), falls back to the bundled
offline lists so the refresh still works. Adds new constituents, (re)tags current
members, and removes the tag from dropped constituents.
"""
from __future__ import annotations

import csv
import io
import logging

import httpx

from app.data.nifty500 import NIFTY500_SYMBOLS
from app.db.database import Instrument, SessionLocal

log = logging.getLogger(__name__)

_HDRS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    "Accept": "text/csv,application/csv,*/*",
    "Referer": "https://www.nseindia.com/",
    "Accept-Language": "en-US,en;q=0.9",
}
_URLS = {
    "NIFTY50": "https://nsearchives.nseindia.com/content/indices/ind_nifty50list.csv",
    "NIFTY500": "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv",
}


def _fetch_nse(tag: str) -> dict | None:
    try:
        r = httpx.get(_URLS[tag], headers=_HDRS, timeout=15, follow_redirects=True)
        r.raise_for_status()
        out = {}
        for row in csv.DictReader(io.StringIO(r.text)):
            sym = (row.get("Symbol") or row.get("SYMBOL") or "").strip().upper()
            series = (row.get(" SERIES") or row.get("SERIES") or "EQ").strip()
            if not sym or (series and series not in ("EQ", "BE", "")):
                continue
            out[sym] = {"name": (row.get("Company Name") or "").strip(),
                        "sector": (row.get("Industry") or "").strip()}
        if len(out) >= 40:            # sanity: a real index list
            return out
    except Exception as e:
        log.warning("NSE %s fetch failed, using bundled list: %s", tag, e)
    return None


def _bundled(tag: str) -> dict:
    if tag == "NIFTY500":
        return {s: {} for s in NIFTY500_SYMBOLS}
    from app.db.database import NIFTY50_SEED
    return {sym: {"name": n, "sector": s} for sym, n, s in NIFTY50_SEED}


def _members(tag: str) -> tuple[dict, str]:
    m = _fetch_nse(tag)
    return (m, "nse") if m else (_bundled(tag), "bundled")


def refresh_index(tag: str) -> dict:
    """Sync the instruments master for one index tag. Returns a summary."""
    members, source = _members(tag)
    memset = set(members)
    db = SessionLocal()
    added = tagged = untagged = 0
    try:
        existing = {i.symbol: i for i in db.query(Instrument).all()}
        for sym, meta in members.items():
            inst = existing.get(sym)
            if inst:
                tags = set(inst.indices or [])
                if tag not in tags:
                    tags.add(tag)
                    inst.indices = sorted(tags)
                    tagged += 1
                if meta.get("name") and not inst.name:
                    inst.name = meta["name"]
                if meta.get("sector") and not inst.sector:
                    inst.sector = meta["sector"]
                inst.is_active = True
            else:
                db.add(Instrument(symbol=sym, name=meta.get("name", ""),
                                  sector=meta.get("sector", ""), is_active=True,
                                  in_scoring_universe=True, indices=[tag]))
                added += 1
        # drop the tag from instruments no longer in this index
        for inst in db.query(Instrument).all():
            tags = set(inst.indices or [])
            if tag in tags and inst.symbol not in memset:
                tags.discard(tag)
                inst.indices = sorted(tags)
                untagged += 1
        db.commit()
    finally:
        db.close()
    log.info("universe refresh %s: source=%s members=%d added=%d tagged=%d untagged=%d",
             tag, source, len(members), added, tagged, untagged)
    return {"index": tag, "source": source, "members": len(members),
            "added": added, "tagged": tagged, "untagged": untagged}


def refresh_universe() -> dict:
    """Refresh both NIFTY 50 and NIFTY 500 masters. Run daily before scoring."""
    return {tag: refresh_index(tag) for tag in ("NIFTY50", "NIFTY500")}
