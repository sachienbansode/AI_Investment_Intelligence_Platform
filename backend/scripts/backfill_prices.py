#!/usr/bin/env python3
"""One-time, RESUMABLE backfill of daily EOD OHLCV for NSE stocks from Yahoo.

Universe = every symbol in the `instruments` table (import the full NSE list in
Admin -> Instruments first for full coverage). Idempotent per symbol
(delete-then-insert), so it's safe to re-run; already up-to-date symbols are
skipped unless --force.

Run FROM the backend directory:
    cd backend
    source .venv/bin/activate        # prod
    python scripts/backfill_prices.py --years 3

Options:
    --years N        history depth (default 3)
    --symbols A,B,C  only these symbols (else the instruments table)
    --force          re-fetch even if a symbol is already current
    --concurrency N  parallel fetches per batch (default 8)
    --limit N        only the first N symbols (for a quick test)
"""
import argparse
import asyncio
import datetime as dt
import logging
import os
import sys

import httpx

# allow "python scripts/backfill_prices.py" from the backend dir
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import delete as sa_delete  # noqa: E402

from app.db.database import (Instrument, SessionLocal, StockPrice,  # noqa: E402
                             init_db)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("backfill")
HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/"


def universe(db, symbols_arg: str) -> list[str]:
    if symbols_arg:
        return [s.strip().upper() for s in symbols_arg.split(",") if s.strip()]
    rows = db.query(Instrument.symbol).filter(Instrument.is_active.is_(True)).all()
    return [r[0].upper() for r in rows if r[0]]


async def fetch_history(client, symbol: str, rng: str) -> list[dict]:
    """Fetch daily OHLCV for one symbol. Tries .NS then .BO. Retries on 429."""
    for suffix in (".NS", ".BO"):
        for attempt in range(2):
            try:
                r = await client.get(_BASE + symbol + suffix,
                                     params={"range": rng, "interval": "1d"})
                if r.status_code == 429:
                    await asyncio.sleep(2.0 * (attempt + 1))
                    continue
                r.raise_for_status()
                res = (r.json().get("chart", {}) or {}).get("result")
                if not res:
                    break
                res = res[0]
                ts = res.get("timestamp") or []
                q = ((res.get("indicators", {}) or {}).get("quote") or [{}])[0]
                o, h, l, c, v = (q.get(k) or [] for k in
                                 ("open", "high", "low", "close", "volume"))
                rows = []
                for i, t in enumerate(ts):
                    cl = c[i] if i < len(c) else None
                    if cl is None:
                        continue
                    d = dt.datetime.utcfromtimestamp(t).date()
                    rows.append({
                        "symbol": symbol, "price_date": d,
                        "open": o[i] if i < len(o) else None,
                        "high": h[i] if i < len(h) else None,
                        "low": l[i] if i < len(l) else None,
                        "close": cl,
                        "volume": int(v[i]) if i < len(v) and v[i] is not None else None,
                        "source": "yahoo"})
                if rows:
                    return rows
                break  # empty on this suffix -> try next suffix
            except Exception as e:
                log.debug("%s%s attempt %d failed: %s", symbol, suffix, attempt, e)
                await asyncio.sleep(1.0)
    return []


def already_current(db, symbol: str, days: int = 5) -> bool:
    last = (db.query(StockPrice.price_date).filter_by(symbol=symbol)
            .order_by(StockPrice.price_date.desc()).first())
    return bool(last) and (dt.date.today() - last[0]).days <= days


def write_symbol(db, symbol: str, rows: list[dict]) -> None:
    db.execute(sa_delete(StockPrice).where(StockPrice.symbol == symbol))
    db.bulk_insert_mappings(StockPrice, rows)
    db.commit()


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=3)
    ap.add_argument("--symbols", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    rng = f"{a.years}y"

    init_db()
    db = SessionLocal()
    syms = universe(db, a.symbols)
    if a.limit:
        syms = syms[:a.limit]
    todo = syms if a.force else [s for s in syms if not already_current(db, s)]
    log.info("universe=%d to_fetch=%d (skipped %d already-current) range=%s",
             len(syms), len(todo), len(syms) - len(todo), rng)

    ok = fail = total_rows = 0
    async with httpx.AsyncClient(timeout=25, headers=HEADERS) as client:
        for i in range(0, len(todo), a.concurrency):
            chunk = todo[i:i + a.concurrency]
            results = await asyncio.gather(*[fetch_history(client, s, rng) for s in chunk])
            for s, rows in zip(chunk, results):
                if rows:
                    try:
                        write_symbol(db, s, rows)
                        ok += 1
                        total_rows += len(rows)
                    except Exception as e:
                        db.rollback()
                        fail += 1
                        log.warning("write %s failed: %s", s, e)
                else:
                    fail += 1
                    log.warning("no data for %s", s)
            log.info("progress %d/%d  ok=%d fail=%d rows=%d",
                     min(i + a.concurrency, len(todo)), len(todo), ok, fail, total_rows)
            await asyncio.sleep(0.5)  # be gentle on Yahoo
    db.close()
    log.info("DONE ok=%d fail=%d total_rows=%d", ok, fail, total_rows)


if __name__ == "__main__":
    asyncio.run(main())
