"""One-time backfill: recompute the fundamental / earnings / institutional pillars
for EVERY stored stock_scores row (all symbols, all days) using each row's OWN
captured `fundamentals` JSON (pe, eps, pb, dividend_yield, market_cap, volume, ...).

Why this exists: those three pillars used to be hardcoded to 50. The fix computes
them from fundamentals going forward, but historical rows still show 50. This
script repairs history honestly - it uses the data that was captured on each day,
not today's live prices - so past composites become meaningful too.

It ONLY overwrites fundamental/earnings/institutional and the composite; the other
pillars (technical, valuation, momentum, news_sentiment, risk) are left exactly as
originally stored (some, like risk, depend on intraday high/low that wasn't saved).

Idempotent: safe to re-run. Rows whose fundamentals JSON is empty are left as-is.

Run from the backend dir with the venv active:

    # laptop
    cd D:\\broking-ai-bot\\backend
    .venv\\Scripts\\python.exe scripts\\backfill_pillars.py            # apply
    .venv\\Scripts\\python.exe scripts\\backfill_pillars.py --dry-run  # preview only

    # AWS
    cd /home/ubuntu/AI_Investment_Intelligence_Platform/AI_Investment_Intelligence_Platform/backend
    source .venv/bin/activate
    python scripts/backfill_pillars.py            # apply
    python scripts/backfill_pillars.py --dry-run  # preview only
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.data.base import Quote  # noqa: E402
from app.db.database import SessionLocal, StockScore, init_db  # noqa: E402
from app.services import scoring  # noqa: E402
from app.services.app_settings import get_setting  # noqa: E402


def _quote_from_row(r: StockScore) -> Quote:
    """Reconstruct a minimal Quote from the row's stored fundamentals so the
    pillar functions can recompute exactly as they would have on that day."""
    f = r.fundamentals or {}
    return Quote(
        symbol=r.symbol,
        last_price=r.last_price if r.last_price is not None else f.get("last_price"),
        change_pct=f.get("change_pct"),
        week52_high=f.get("week52_high"), week52_low=f.get("week52_low"),
        volume=f.get("volume"),
        pe=r.pe if r.pe is not None else f.get("pe"),
        eps=f.get("eps"), pb=f.get("pb"),
        dividend_yield=f.get("dividend_yield"), beta=f.get("beta"), roe=f.get("roe"),
        market_cap=r.market_cap if r.market_cap is not None else f.get("market_cap"),
    )


def main(dry_run: bool = False) -> None:
    init_db()
    weights = get_setting("scoring_weights")
    db = SessionLocal()
    changed = skipped = 0
    dates = set()
    try:
        rows = db.query(StockScore).all()
        total = len(rows)
        for r in rows:
            f = r.fundamentals or {}
            # Nothing to recompute from -> leave untouched (stays neutral).
            if not any(f.get(k) is not None for k in
                       ("eps", "pb", "dividend_yield", "roe", "market_cap", "volume")):
                skipped += 1
                continue
            q = _quote_from_row(r)
            pillars = dict(r.pillar_scores or {})
            before = (pillars.get("fundamental"), pillars.get("earnings"),
                      pillars.get("institutional"), r.composite_score)
            pillars["fundamental"] = scoring.fundamental_score(q)
            pillars["earnings"] = scoring.earnings_score(q)
            pillars["institutional"] = scoring.institutional_score(q)
            new_comp = scoring.composite(pillars, weights)
            after = (pillars["fundamental"], pillars["earnings"],
                     pillars["institutional"], new_comp)
            if after == before:
                skipped += 1
                continue
            if not dry_run:
                r.pillar_scores = pillars
                r.composite_score = new_comp
            changed += 1
            dates.add(r.score_date)
        if not dry_run:
            db.commit()
    finally:
        db.close()
    mode = "DRY-RUN (no writes)" if dry_run else "APPLIED"
    print(f"{mode}: {changed} row(s) updated, {skipped} unchanged, {total} total, "
          f"across {len(dates)} score date(s).")


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
