"""Score-crossing alerts (in-app feed).

After each daily scoring run we compare every user's FOLLOWED scripts (watchlist +
saved portfolio) against the previous scoring day and raise an alert when a
script's AI score:
  * crosses a band boundary  -> band_up / band_down   (weak <45, neutral 45-64, strong 65+)
  * moves by >= alert_score_jump points in the same band -> jump / drop

Each alert carries a short, factual, ADVICE-FREE message naming the biggest pillar
drivers of the move. Generation is idempotent (one row per user/symbol/date/kind).
"""
import logging

from app.core.compliance import audit_log
from app.db.database import (Alert, Portfolio, SessionLocal, StockScore,
                             WatchlistItem, utcnow)
from app.services.app_settings import get_setting
from app.services.rescore import pillar_drivers

log = logging.getLogger(__name__)

BAND_LABEL = {"strong": "Strong (65+)", "neutral": "Neutral (45-64)", "weak": "Weak (<45)"}


def band_of(score) -> str:
    if score is None:
        return ""
    return "strong" if score >= 65 else "neutral" if score >= 45 else "weak"


def _followed_symbols() -> dict[int, dict[str, str]]:
    """user_id -> {symbol: source} across watchlist + saved portfolio."""
    out: dict[int, dict[str, str]] = {}
    db = SessionLocal()
    try:
        for w in db.query(WatchlistItem).all():
            out.setdefault(w.user_id, {}).setdefault(w.symbol.upper(), "watchlist")
        for p in db.query(Portfolio).all():
            for h in (p.holdings or []):
                sym = str((h or {}).get("symbol") or "").upper()
                if sym:
                    out.setdefault(p.user_id, {}).setdefault(sym, "portfolio")
    finally:
        db.close()
    return out


def _score_maps(db):
    """Return (latest_date, prev_date, latest{sym:row}, prev{sym:row}). Only
    non-rejected published scores are considered."""
    dates = [d[0] for d in (db.query(StockScore.score_date).distinct()
             .order_by(StockScore.score_date.desc()).limit(2).all())]
    if len(dates) < 2:
        return (dates[0] if dates else None), None, {}, {}
    latest, prev = dates[0], dates[1]

    def _rows(d):
        return {r.symbol.upper(): r for r in
                db.query(StockScore).filter(StockScore.score_date == d,
                                            StockScore.quality_status != "rejected").all()}
    return latest, prev, _rows(latest), _rows(prev)


def _message(sym, kind, frm, to, delta, from_band, to_band, drivers) -> str:
    drv = (" Key drivers: " + ", ".join(drivers) + ".") if drivers else ""
    d = f"{'+' if delta >= 0 else ''}{delta}"
    if kind in ("band_up", "band_down"):
        verb = "rose into" if kind == "band_up" else "slipped into"
        return (f"{sym} {verb} the {BAND_LABEL.get(to_band, to_band)} band "
                f"(score {frm} → {to}, {d}).{drv} Informational only, not advice.")
    verb = "jumped" if kind == "jump" else "dropped"
    return (f"{sym} {verb} {abs(delta)} points (score {frm} → {to}) within the "
            f"{BAND_LABEL.get(to_band, to_band)} band.{drv} Informational only, not advice.")


def generate_alerts(score_date: str | None = None) -> int:
    """Create alerts for the latest run (vs the previous day). Returns count created."""
    if not bool(get_setting("alerts_enabled")):
        return 0
    bands_on = bool(get_setting("alert_bands_enabled"))
    jumps_on = bool(get_setting("alert_jumps_enabled"))
    try:
        jump_min = float(get_setting("alert_score_jump") or 5)
    except Exception:
        jump_min = 5.0
    followed = _followed_symbols()
    if not followed:
        return 0

    db = SessionLocal()
    created = 0
    try:
        latest, prev, lmap, pmap = _score_maps(db)
        if not latest or not prev:
            return 0
        for user_id, syms in followed.items():
            for sym, source in syms.items():
                lr, pr = lmap.get(sym), pmap.get(sym)
                if not lr or not pr:
                    continue
                to, frm = lr.composite_score, pr.composite_score
                if to is None or frm is None:
                    continue
                delta = round(to - frm, 1)
                fb, tb = band_of(frm), band_of(to)
                kind = None
                if bands_on and fb != tb:
                    kind = "band_up" if to > frm else "band_down"
                elif jumps_on and abs(delta) >= jump_min:
                    kind = "jump" if delta > 0 else "drop"
                if not kind:
                    continue
                # idempotent: skip if this alert already exists
                exists = (db.query(Alert.id).filter_by(
                    user_id=user_id, symbol=sym, score_date=latest, kind=kind).first())
                if exists:
                    continue
                drivers = pillar_drivers(lr.pillar_scores or {}, pr.pillar_scores or {})
                db.add(Alert(
                    user_id=user_id, symbol=sym, score_date=latest, kind=kind,
                    from_score=frm, to_score=to, delta=delta,
                    from_band=fb, to_band=tb, source=source,
                    message=_message(sym, kind, frm, to, delta, fb, tb, drivers)))
                created += 1
        db.commit()
    finally:
        db.close()
    audit_log("alerts_generated", date=latest, created=created)
    return created


def list_alerts(user_id: int, limit: int = 30, offset: int = 0,
                unread_only: bool = False) -> dict:
    db = SessionLocal()
    try:
        q = db.query(Alert).filter_by(user_id=user_id)
        if unread_only:
            q = q.filter_by(is_read=False)
        total = q.count()
        unread = db.query(Alert).filter_by(user_id=user_id, is_read=False).count()
        rows = (q.order_by(Alert.created_at.desc(), Alert.id.desc())
                .offset(offset).limit(min(limit, 100)).all())
        items = [{
            "id": r.id, "symbol": r.symbol, "kind": r.kind, "score_date": r.score_date,
            "from_score": r.from_score, "to_score": r.to_score, "delta": r.delta,
            "from_band": r.from_band, "to_band": r.to_band, "source": r.source,
            "message": r.message, "is_read": r.is_read,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in rows]
        return {"items": items, "total": total, "unread": unread}
    finally:
        db.close()


def unread_count(user_id: int) -> int:
    db = SessionLocal()
    try:
        return db.query(Alert).filter_by(user_id=user_id, is_read=False).count()
    finally:
        db.close()


def mark_read(user_id: int, ids: list[int] | None = None, all_: bool = False) -> int:
    db = SessionLocal()
    try:
        q = db.query(Alert).filter_by(user_id=user_id, is_read=False)
        if not all_:
            if not ids:
                return 0
            q = q.filter(Alert.id.in_(ids))
        n = q.update({Alert.is_read: True}, synchronize_session=False)
        db.commit()
        return n
    finally:
        db.close()
