"""Multiple named watchlists per user.

A user has a default "My Watchlist" and may create more. A symbol can appear in
several lists (uniqueness is enforced per list, in code). Alerts and the assistant
use the UNION of all a user's lists, so a stock followed in any list still gets
alerts and grounding.
"""
from __future__ import annotations

from sqlalchemy import func

from app.db.database import (Instrument, SessionLocal, Watchlist, WatchlistItem,
                             utcnow)

MAX_LISTS = 20
MAX_NAME = 40


def _ensure_default(db, user_id) -> int:
    wl = db.query(Watchlist).filter_by(user_id=user_id).order_by(Watchlist.id).first()
    if not wl:
        wl = Watchlist(user_id=user_id, name="My Watchlist")
        db.add(wl)
        db.flush()
    return wl.id


def lists_for(user_id) -> list[dict]:
    db = SessionLocal()
    try:
        _ensure_default(db, user_id)
        db.commit()
        lists = db.query(Watchlist).filter_by(user_id=user_id).order_by(Watchlist.id).all()
        rows = (db.query(WatchlistItem.watchlist_id, func.count(WatchlistItem.id))
                .filter_by(user_id=user_id).group_by(WatchlistItem.watchlist_id).all())
        counts = {w: c for w, c in rows}
        return [{"id": l.id, "name": l.name, "count": counts.get(l.id, 0),
                 "created_at": str(l.created_at)} for l in lists]
    finally:
        db.close()


def create(user_id, name: str) -> dict:
    name = (name or "").strip()[:MAX_NAME] or "Untitled"
    db = SessionLocal()
    try:
        if db.query(Watchlist).filter_by(user_id=user_id).count() >= MAX_LISTS:
            raise ValueError(f"You can have at most {MAX_LISTS} watchlists.")
        wl = Watchlist(user_id=user_id, name=name)
        db.add(wl)
        db.commit()
        return {"id": wl.id, "name": wl.name, "count": 0}
    finally:
        db.close()


def rename(user_id, list_id, name: str) -> bool:
    name = (name or "").strip()[:MAX_NAME]
    if not name:
        raise ValueError("Name cannot be empty.")
    db = SessionLocal()
    try:
        wl = db.query(Watchlist).filter_by(id=list_id, user_id=user_id).first()
        if not wl:
            return False
        wl.name = name
        wl.updated_at = utcnow()
        db.commit()
        return True
    finally:
        db.close()


def delete(user_id, list_id) -> bool:
    db = SessionLocal()
    try:
        if db.query(Watchlist).filter_by(user_id=user_id).count() <= 1:
            raise ValueError("You must keep at least one watchlist.")
        wl = db.query(Watchlist).filter_by(id=list_id, user_id=user_id).first()
        if not wl:
            return False
        db.query(WatchlistItem).filter_by(user_id=user_id, watchlist_id=list_id).delete()
        db.delete(wl)
        db.commit()
        return True
    finally:
        db.close()


def _resolve_list(db, user_id, list_id):
    if list_id is None:
        return _ensure_default(db, user_id)
    wl = db.query(Watchlist).filter_by(id=list_id, user_id=user_id).first()
    return wl.id if wl else _ensure_default(db, user_id)


def symbols_in(user_id, list_id=None) -> list[str]:
    db = SessionLocal()
    try:
        lid = _resolve_list(db, user_id, list_id)
        rows = (db.query(WatchlistItem.symbol).filter_by(user_id=user_id, watchlist_id=lid)
                .order_by(WatchlistItem.created_at).all())
        return [r[0] for r in rows]
    finally:
        db.close()


def all_symbols(user_id) -> list[str]:
    """Union of every list (for alerts / assistant grounding), de-duplicated."""
    db = SessionLocal()
    try:
        rows = db.query(WatchlistItem.symbol).filter_by(user_id=user_id).all()
        seen, out = set(), []
        for (s,) in rows:
            u = (s or "").upper()
            if u and u not in seen:
                seen.add(u)
                out.append(u)
        return out
    finally:
        db.close()


def membership(user_id) -> dict:
    """{symbol: [list_id, ...]} so the UI can show which lists hold a symbol."""
    db = SessionLocal()
    try:
        rows = db.query(WatchlistItem.symbol, WatchlistItem.watchlist_id).filter_by(user_id=user_id).all()
        out: dict = {}
        for sym, lid in rows:
            out.setdefault((sym or "").upper(), []).append(lid)
        return out
    finally:
        db.close()


def add(user_id, symbol, list_id=None) -> dict:
    symbol = (symbol or "").upper().strip()
    db = SessionLocal()
    try:
        if not db.query(Instrument).filter_by(symbol=symbol, is_active=True).first():
            raise LookupError(f"Unknown instrument {symbol}")
        lid = _resolve_list(db, user_id, list_id)
        exists = (db.query(WatchlistItem)
                  .filter_by(user_id=user_id, watchlist_id=lid, symbol=symbol).first())
        if exists:
            return {"added": symbol, "list_id": lid, "already": True}
        db.add(WatchlistItem(user_id=user_id, watchlist_id=lid, symbol=symbol))
        db.commit()
        return {"added": symbol, "list_id": lid}
    finally:
        db.close()


def remove(user_id, symbol, list_id=None) -> int:
    """Remove a symbol from a specific list, or from ALL lists when list_id is None."""
    symbol = (symbol or "").upper().strip()
    db = SessionLocal()
    try:
        q = db.query(WatchlistItem).filter_by(user_id=user_id, symbol=symbol)
        if list_id is not None:
            q = q.filter_by(watchlist_id=list_id)
        n = q.delete()
        db.commit()
        return n
    finally:
        db.close()
