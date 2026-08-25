"""Daily EOD price history service (stock_prices table).

One place for: the resumable backfill (CLI + Admin button + daily job all call
this), progress state, the daily incremental update, and the read helpers the
public charts use. Source is Yahoo (works from EC2; NSE blocks datacenter IPs).
Data is delayed / EOD and informational only — not exchange-licensed real-time.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging
import threading

import httpx
from sqlalchemy import delete as sa_delete
from sqlalchemy import func

from app.db.database import Instrument, SessionLocal, StockPrice

log = logging.getLogger(__name__)
_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/"

# Live progress for the Admin panel / status endpoint.
STATE: dict = {"running": False, "ok": 0, "fail": 0, "rows": 0, "done": 0,
               "total": 0, "last": "", "started": None, "finished": None,
               "mode": "", "years": 3, "failed_symbols": []}


# ---- fetch + write ----------------------------------------------------------

async def fetch_history(client, symbol: str, rng: str) -> list[dict]:
    """Daily OHLCV for one symbol from Yahoo. Tries .NS then .BO, retries on 429."""
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
                    rows.append({
                        "symbol": symbol,
                        "price_date": dt.datetime.utcfromtimestamp(t).date(),
                        "open": o[i] if i < len(o) else None,
                        "high": h[i] if i < len(h) else None,
                        "low": l[i] if i < len(l) else None,
                        "close": cl,
                        "volume": int(v[i]) if i < len(v) and v[i] is not None else None,
                        "source": "yahoo"})
                if rows:
                    return rows
                break
            except Exception as e:
                log.debug("%s%s attempt %d failed: %s", symbol, suffix, attempt, e)
                await asyncio.sleep(1.0)
    return []


def _replace_symbol(db, symbol: str, rows: list[dict]) -> None:
    db.execute(sa_delete(StockPrice).where(StockPrice.symbol == symbol))
    db.bulk_insert_mappings(StockPrice, rows)
    db.commit()


def _upsert_recent(db, symbol: str, rows: list[dict]) -> None:
    if not rows:
        return
    dates = [r["price_date"] for r in rows]
    db.execute(sa_delete(StockPrice).where(
        StockPrice.symbol == symbol, StockPrice.price_date.in_(dates)))
    db.bulk_insert_mappings(StockPrice, rows)
    db.commit()


def _insert_missing(db, symbol: str, rows: list[dict]) -> int:
    """Insert ONLY the dates we don't already have for this symbol (true
    incremental - no rewrite of existing rows). Returns rows added."""
    if not rows:
        return 0
    dates = [r["price_date"] for r in rows]
    have = {d for (d,) in db.query(StockPrice.price_date).filter(
        StockPrice.symbol == symbol, StockPrice.price_date.in_(dates)).all()}
    new = [r for r in rows if r["price_date"] not in have]
    if new:
        db.bulk_insert_mappings(StockPrice, new)
        db.commit()
    return len(new)


def _already_current(db, symbol: str, days: int = 5) -> bool:
    last = (db.query(StockPrice.price_date).filter_by(symbol=symbol)
            .order_by(StockPrice.price_date.desc()).first())
    return bool(last) and (dt.date.today() - last[0]).days <= days


def _universe(db, symbols: list[str] | None) -> list[str]:
    if symbols:
        return [s.strip().upper() for s in symbols if s and s.strip()]
    rows = db.query(Instrument.symbol).filter(Instrument.is_active.is_(True)).all()
    return [r[0].upper() for r in rows if r[0]]


# ---- backfill (full history) ------------------------------------------------

async def run_backfill(years: int = 3, symbols: list[str] | None = None,
                       force: bool = False, concurrency: int = 8,
                       limit: int = 0) -> dict:
    rng = f"{years}y"
    db = SessionLocal()
    try:
        syms = _universe(db, symbols)
        if limit:
            syms = syms[:limit]
        todo = syms if force else [s for s in syms if not _already_current(db, s)]
        STATE.update({"running": True, "ok": 0, "fail": 0, "rows": 0, "done": 0,
                      "total": len(todo), "last": "", "mode": "backfill", "failed_symbols": [],
                      "years": years, "started": dt.datetime.utcnow().isoformat(),
                      "finished": None})
        log.info("price backfill: universe=%d to_fetch=%d range=%s", len(syms), len(todo), rng)
        async with httpx.AsyncClient(timeout=25, headers=_HEADERS) as client:
            for i in range(0, len(todo), concurrency):
                chunk = todo[i:i + concurrency]
                results = await asyncio.gather(*[fetch_history(client, s, rng) for s in chunk])
                for s, rows in zip(chunk, results):
                    if rows:
                        try:
                            _replace_symbol(db, s, rows)
                            STATE["ok"] += 1
                            STATE["rows"] += len(rows)
                        except Exception as e:
                            db.rollback()
                            STATE["fail"] += 1
                            log.warning("write %s failed: %s", s, e)
                    else:
                        STATE["fail"] += 1
                        if len(STATE["failed_symbols"]) < 400: STATE["failed_symbols"].append(s)
                    STATE["done"] += 1
                    STATE["last"] = s
                await asyncio.sleep(0.4)
        return dict(STATE)
    finally:
        STATE["running"] = False
        STATE["finished"] = dt.datetime.utcnow().isoformat()
        db.close()


def start_backfill_bg(years: int = 3, force: bool = False) -> bool:
    """Launch the backfill in a background thread (own event loop). False if busy."""
    if STATE.get("running"):
        return False
    def _worker():
        try:
            asyncio.run(run_backfill(years=years, force=force))
        except Exception as e:
            log.warning("background backfill crashed: %s", e)
            STATE["running"] = False
    threading.Thread(target=_worker, daemon=True).start()
    return True


# ---- daily incremental (scheduler) ------------------------------------------

async def daily_update(concurrency: int = 8) -> dict:
    """INCREMENTAL refresh: skip symbols already up to date, and for the rest add
    ONLY the missing recent dates. Run after close (cheap; no rewrites)."""
    db = SessionLocal()
    try:
        syms = _universe(db, None)
        todo = [s for s in syms if not _already_current(db, s, days=3)]
        STATE.update({"running": True, "ok": 0, "fail": 0, "rows": 0, "done": 0,
                      "total": len(todo), "last": "", "mode": "incremental", "failed_symbols": [],
                      "started": dt.datetime.utcnow().isoformat(), "finished": None})
        log.info("price incremental: universe=%d stale=%d", len(syms), len(todo))
        async with httpx.AsyncClient(timeout=25, headers=_HEADERS) as client:
            for i in range(0, len(todo), concurrency):
                chunk = todo[i:i + concurrency]
                results = await asyncio.gather(*[fetch_history(client, s, "1mo") for s in chunk])
                for s, rows in zip(chunk, results):
                    if rows:
                        try:
                            added = _insert_missing(db, s, rows)
                            STATE["ok"] += 1
                            STATE["rows"] += added
                        except Exception:
                            db.rollback()
                            STATE["fail"] += 1
                    else:
                        STATE["fail"] += 1
                        if len(STATE["failed_symbols"]) < 400: STATE["failed_symbols"].append(s)
                    STATE["done"] += 1
                    STATE["last"] = s
                await asyncio.sleep(0.3)
        return dict(STATE)
    finally:
        STATE["running"] = False
        STATE["finished"] = dt.datetime.utcnow().isoformat()
        db.close()


# ---- read helpers (public charts) -------------------------------------------

_RANGE_DAYS = {"1M": 31, "3M": 93, "6M": 186, "1Y": 372, "3Y": 1115, "5Y": 1860, "MAX": 100000}


def get_series(symbol: str, range_: str = "1Y") -> dict:
    """Daily close (+ OHLCV) series for one symbol from the DB, within range."""
    symbol = (symbol or "").strip().upper()
    days = _RANGE_DAYS.get((range_ or "1Y").upper(), 372)
    cutoff = dt.date.today() - dt.timedelta(days=days)
    db = SessionLocal()
    try:
        rows = (db.query(StockPrice)
                .filter(StockPrice.symbol == symbol, StockPrice.price_date >= cutoff)
                .order_by(StockPrice.price_date.asc()).all())
        pts = [{"d": r.price_date.isoformat(), "o": r.open, "h": r.high,
                "l": r.low, "c": r.close, "v": r.volume} for r in rows]
        return {"symbol": symbol, "range": (range_ or "1Y").upper(),
                "points": pts, "delayed": True}
    finally:
        db.close()


def summary() -> dict:
    db = SessionLocal()
    try:
        total = db.query(func.count()).select_from(StockPrice).scalar() or 0
        nsyms = db.query(func.count(func.distinct(StockPrice.symbol))).scalar() or 0
        days = db.query(func.count(func.distinct(StockPrice.price_date))).scalar() or 0
        lo, hi = db.query(func.min(StockPrice.price_date),
                          func.max(StockPrice.price_date)).first()
        return {"rows": int(total), "symbols": int(nsyms), "days": int(days),
                "from": lo.isoformat() if lo else None,
                "to": hi.isoformat() if hi else None}
    finally:
        db.close()


def search_symbols(q: str, limit: int = 10) -> list[dict]:
    q = (q or "").strip()
    if not q:
        return []
    like = f"%{q}%"
    db = SessionLocal()
    try:
        rows = (db.query(Instrument.symbol, Instrument.name)
                .filter(Instrument.is_active.is_(True))
                .filter((Instrument.symbol.ilike(like)) | (Instrument.name.ilike(like)))
                .order_by(Instrument.symbol.asc()).limit(min(max(limit, 1), 25)).all())
        return [{"symbol": s, "name": n or ""} for s, n in rows]
    finally:
        db.close()
