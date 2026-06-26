"""Backfill instrument sectors from a classification mapping (DB-stored result).

Sources (keyed by NSE symbol):
  - default: NSE broad-universe index CSVs (Total Market / Microcap 250 /
    Smallcap 250 / Midcap 150 / NIFTY 500), each carrying an "Industry" column.
  - a one-time local mapping CSV you supply.

All results are written to the DB (instruments.sector); nothing is stored in
code. Only blank sectors are filled unless --overwrite is given.

Usage (run from the backend dir with the venv active):

    # laptop
    cd D:\\broking-ai-bot\\backend
    .venv\\Scripts\\python.exe scripts\\backfill_sectors_from_mapping.py
    .venv\\Scripts\\python.exe scripts\\backfill_sectors_from_mapping.py mymap.csv
    .venv\\Scripts\\python.exe scripts\\backfill_sectors_from_mapping.py --template blanks.csv

    # AWS
    cd /home/ubuntu/AI_Investment_Intelligence_Platform/AI_Investment_Intelligence_Platform/backend
    source .venv/bin/activate
    python scripts/backfill_sectors_from_mapping.py
"""
import argparse
import asyncio
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.database import init_db  # noqa: E402
from app.services import sector_map as sm  # noqa: E402


async def run(args) -> None:
    init_db()

    if args.template:
        rows = sm.blank_sector_symbols()
        with open(args.template, "w", newline="", encoding="utf-8") as f:
            w = csv.writer(f)
            w.writerow(["symbol", "name", "sector"])
            for r in rows:
                w.writerow([r["symbol"], r["name"], ""])
        print(f"Wrote {len(rows)} blank-sector scripts to {args.template}. "
              f"Fill the 'sector' column and re-run with that file.")
        return

    if args.mapping_file:
        mapping = sm.load_mapping_csv(args.mapping_file)
        print(f"Loaded {len(mapping)} symbol→sector rows from {args.mapping_file}.")
    else:
        print("Fetching NSE broad-universe classification lists…")
        mapping = await sm.fetch_nse_sector_map()
        print(f"Built {len(mapping)} symbol→sector rows from NSE index CSVs.")

    if not mapping:
        print("No mapping rows available — nothing to apply.")
        return

    res = sm.apply_sector_map(mapping, overwrite=args.overwrite)
    print(f"Done. matched={res['matched']} updated={res['updated']} "
          f"blank_before={res['blank_before']} blank_after={res['blank_after']}.")


def main():
    ap = argparse.ArgumentParser(description="Backfill instrument sectors from a mapping.")
    ap.add_argument("mapping_file", nargs="?", help="Optional local CSV (symbol/ISIN + sector/industry).")
    ap.add_argument("--overwrite", action="store_true", help="Replace existing sectors too.")
    ap.add_argument("--template", metavar="OUT.csv", help="Write blank-sector scripts to a CSV and exit.")
    asyncio.run(run(ap.parse_args()))


if __name__ == "__main__":
    main()
