"""One-time backfill of instrument sectors.

Fills `instruments.sector` for every active script that currently has no
sector, using the market-data source (NSE industry / Yahoo assetProfile via the
aggregator). Safe to re-run: only blank sectors are touched.

Run from the backend dir with the venv active:

    # laptop
    cd D:\\broking-ai-bot\\backend
    .venv\\Scripts\\python.exe scripts\\backfill_sectors.py

    # AWS
    cd /home/ubuntu/AI_Investment_Intelligence_Platform/AI_Investment_Intelligence_Platform/backend
    source .venv/bin/activate
    python scripts/backfill_sectors.py
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data.aggregator import get_market_data  # noqa: E402
from app.db.database import Instrument, SessionLocal, init_db  # noqa: E402


async def main(batch: int = 100) -> None:
    init_db()
    db = SessionLocal()
    try:
        missing = [r.symbol for r in db.query(Instrument)
                   .filter(Instrument.is_active == True).all()  # noqa: E712
                   if not (r.sector or "").strip()]
    finally:
        db.close()

    total = len(missing)
    print(f"{total} active scripts missing a sector.")
    if not total:
        return

    md = get_market_data()
    resolved = 0
    for i in range(0, total, batch):
        chunk = missing[i:i + batch]
        sectors = await md.get_sectors(chunk)
        db = SessionLocal()
        try:
            for sym, sec in sectors.items():
                inst = db.query(Instrument).filter_by(symbol=sym).first()
                if inst and sec and not (inst.sector or "").strip():
                    inst.sector = sec
                    resolved += 1
            db.commit()
        finally:
            db.close()
        print(f"  processed {min(i + batch, total)}/{total} — resolved {resolved} so far")

    print(f"Done. Filled {resolved}/{total} sectors. "
          f"{total - resolved} remain blank (source had no sector).")


if __name__ == "__main__":
    asyncio.run(main())
