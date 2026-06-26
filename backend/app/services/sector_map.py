"""Backfill instrument sectors from a classification mapping.

Two sources, both keyed by NSE symbol:

1. NSE broad-universe index CSVs (Total Market / Microcap 250 / Smallcap 250 /
   Midcap 150 / NIFTY 500). Each carries an "Industry" column and is served from
   nsearchives.nseindia.com — the same host the NIFTY50/500 imports already use
   (works from EC2, unlike the quote API). Together these cover ~1000+ scripts
   incl. the small/micro-cap long tail that Yahoo assetProfile often lacks.

2. A one-time local mapping CSV the operator supplies (flexible columns:
   symbol/ISIN + sector/industry).

Only BLANK instrument sectors are updated; existing sectors are left untouched.
"""
import csv
import io
import logging

import httpx

from app.core.compliance import audit_log
from app.db.database import Instrument, SessionLocal

log = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Referer": "https://www.nseindia.com/",
}

# Broad-universe NSE index lists that carry an "Industry" column. We try a few
# filename variants per index (NSE is inconsistent about the underscore) and use
# whichever resolves; failures are skipped so partial coverage still helps.
NSE_SECTOR_CSVS = [
    "https://nsearchives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv",
    "https://nsearchives.nseindia.com/content/indices/ind_niftytotalmarketlist.csv",
    "https://nsearchives.nseindia.com/content/indices/ind_niftymicrocap250_list.csv",
    "https://nsearchives.nseindia.com/content/indices/ind_niftymicrocap250list.csv",
    "https://nsearchives.nseindia.com/content/indices/ind_niftysmallcap250list.csv",
    "https://nsearchives.nseindia.com/content/indices/ind_niftymidcap150list.csv",
    "https://nsearchives.nseindia.com/content/indices/ind_nifty500list.csv",
]

_SYMBOL_KEYS = ("Symbol", "SYMBOL", "symbol", "Trading Symbol", "NSE Symbol")
_SECTOR_KEYS = ("Industry", "INDUSTRY", "industry", "Sector", "SECTOR", "sector",
                "Macro-Economic Sector", "Basic Industry")


def _pick(row: dict, keys) -> str:
    for k in keys:
        if k in row and (row[k] or "").strip():
            return row[k].strip()
    # case-insensitive fallback
    low = {k.lower().strip(): v for k, v in row.items()}
    for k in keys:
        v = low.get(k.lower().strip())
        if v and v.strip():
            return v.strip()
    return ""


def parse_sector_csv(text: str) -> dict:
    """Build {SYMBOL -> sector} from CSV text with flexible column names."""
    out = {}
    reader = csv.DictReader(io.StringIO(text))
    for row in reader:
        sym = _pick(row, _SYMBOL_KEYS).upper()
        sec = _pick(row, _SECTOR_KEYS)
        if sym and sec:
            out.setdefault(sym, sec)
    return out


def load_mapping_csv(path: str) -> dict:
    """Load a one-time local mapping file → {SYMBOL -> sector}."""
    with open(path, encoding="utf-8-sig") as f:
        return parse_sector_csv(f.read())


async def fetch_nse_sector_map() -> dict:
    """Download NSE broad-universe index CSVs and merge into {SYMBOL -> sector}.
    Tolerant: any URL that fails (403/404/timeout) is skipped."""
    mapping: dict = {}
    async with httpx.AsyncClient(timeout=45, follow_redirects=True) as client:
        for url in NSE_SECTOR_CSVS:
            try:
                r = await client.get(url, headers=_HEADERS)
                r.raise_for_status()
                got = parse_sector_csv(r.text)
                added = sum(1 for s in got if s not in mapping)
                for k, v in got.items():
                    mapping.setdefault(k, v)
                log.info("Sector map: %s → %d rows (+%d new)", url.rsplit("/", 1)[-1], len(got), added)
            except Exception as e:
                log.warning("Sector map: skipped %s (%s)", url.rsplit("/", 1)[-1], str(e)[:80])
    return mapping


def apply_sector_map(mapping: dict, overwrite: bool = False) -> dict:
    """Update instruments.sector from {SYMBOL -> sector}. By default only fills
    blank sectors; set overwrite=True to replace existing values too.
    Returns {updated, blank_before, blank_after, matched}."""
    norm = {k.upper(): v for k, v in mapping.items() if k and v}
    db = SessionLocal()
    updated = matched = 0
    blank_before = blank_after = 0
    try:
        for inst in db.query(Instrument).all():
            has_sector = bool((inst.sector or "").strip())
            if not has_sector:
                blank_before += 1
            new = norm.get((inst.symbol or "").upper())
            if new:
                matched += 1
                if overwrite or not has_sector:
                    if (inst.sector or "") != new:
                        inst.sector = new
                        updated += 1
            if not bool((inst.sector or "").strip()):
                blank_after += 1
        db.commit()
    finally:
        db.close()
    result = {"updated": updated, "matched": matched,
              "blank_before": blank_before, "blank_after": blank_after,
              "map_size": len(norm)}
    audit_log("sector_map_applied", **result, overwrite=overwrite)
    return result


def blank_sector_symbols() -> list[dict]:
    """Active instruments that still have no sector (for a fill-in template)."""
    db = SessionLocal()
    try:
        return [{"symbol": r.symbol, "name": r.name or "", "sector": ""}
                for r in db.query(Instrument).filter_by(is_active=True).order_by(Instrument.symbol)
                if not (r.sector or "").strip()]
    finally:
        db.close()
