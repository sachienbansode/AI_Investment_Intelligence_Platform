#!/usr/bin/env python3
"""One-time, RESUMABLE backfill of daily EOD OHLCV for NSE stocks (thin CLI over
app.services.prices). Universe = the `instruments` table (import the full NSE
list in Admin -> Instruments first for full coverage). Safe to re-run.

    cd backend && source .venv/bin/activate
    python scripts/backfill_prices.py --years 3
    python scripts/backfill_prices.py --symbols RELIANCE,TCS --years 1   # test
"""
import argparse
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.database import init_db  # noqa: E402
from app.services import prices  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=int, default=3)
    ap.add_argument("--symbols", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--concurrency", type=int, default=8)
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    init_db()
    syms = [s.strip() for s in a.symbols.split(",") if s.strip()] or None
    res = asyncio.run(prices.run_backfill(
        years=a.years, symbols=syms, force=a.force,
        concurrency=a.concurrency, limit=a.limit))
    logging.info("DONE ok=%s fail=%s rows=%s", res.get("ok"), res.get("fail"), res.get("rows"))


if __name__ == "__main__":
    main()
