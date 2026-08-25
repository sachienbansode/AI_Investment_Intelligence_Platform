"""NIYTRI Score value-add study (informational / hypothetical — NOT advice).

Using our REAL published scores (since scoring began) + the stored daily price
history, this measures the average FORWARD return after each score date, grouped
by score band. It answers, factually and non-predictively: "on the days we scored
a stock 65+, how did it move over the next N trading days, vs 50–64, vs <50?"

Caveats baked into the output: this is a short, early window; results are
hypothetical and informational; past performance is not indicative of future
results; nothing here is investment advice.
"""
from __future__ import annotations

import datetime as dt
import time as _time

from sqlalchemy import func

from app.db.database import SessionLocal, StockPrice, StockScore

_cache: dict = {}
_TTL = 300


def _band(v):
    return "strong" if v >= 65 else "neutral" if v >= 50 else "weak"


def _to_date(s):
    try:
        return dt.date.fromisoformat(str(s)[:10])
    except Exception:
        return None


def _load(horizon: int):
    db = SessionLocal()
    try:
        cal = [d for (d,) in db.query(StockPrice.price_date).distinct()
               .order_by(StockPrice.price_date.asc()).all()]
        idx = {d: i for i, d in enumerate(cal)}
        scores = db.query(StockScore.symbol, StockScore.score_date,
                          StockScore.composite_score).all()
        rows = []
        need = {}  # symbol -> set(dates)
        for sym, sd, comp in scores:
            d0 = _to_date(sd)
            if d0 is None or comp is None or d0 not in idx:
                continue
            j = idx[d0] + horizon
            if j >= len(cal):
                continue
            d1 = cal[j]
            rows.append((sym, d0, d1, float(comp)))
            need.setdefault(sym, set()).update((d0, d1))
        if not rows:
            return None, None
        # fetch the needed closes in one pass per symbol batch
        price = {}
        syms = list(need.keys())
        for i in range(0, len(syms), 200):
            batch = syms[i:i + 200]
            alldates = set()
            for s in batch:
                alldates |= need[s]
            q = (db.query(StockPrice.symbol, StockPrice.price_date, StockPrice.close)
                 .filter(StockPrice.symbol.in_(batch),
                         StockPrice.price_date.in_(list(alldates))).all())
            for s, d, c in q:
                price[(s, d)] = c
        return rows, price
    finally:
        db.close()


def summary(horizon: int = 10) -> dict:
    key = ("sum", horizon)
    hit = _cache.get(key)
    if hit and _time.time() - hit[0] < _TTL:
        return hit[1]
    rows, price = _load(horizon)
    out = {"available": False, "horizon_days": horizon,
           "note": "Informational back-study of real NIYTRI Scores — hypothetical, "
                   "not investment advice; past performance is not indicative."}
    if rows:
        agg = {"strong": [0.0, 0], "neutral": [0.0, 0], "weak": [0.0, 0]}
        allret = []
        lo = hi = rows[0][1]
        for sym, d0, d1, comp in rows:
            c0 = price.get((sym, d0)); c1 = price.get((sym, d1))
            if not c0 or not c1 or c0 <= 0:
                continue
            r = (c1 / c0 - 1) * 100.0
            b = _band(comp); agg[b][0] += r; agg[b][1] += 1; allret.append(r)
            lo = min(lo, d0); hi = max(hi, d0)
        if allret:
            def avg(b):
                return round(agg[b][0] / agg[b][1], 2) if agg[b][1] else None
            bands = {b: {"avg_return": avg(b), "samples": agg[b][1]} for b in agg}
            spread = (None if bands["strong"]["avg_return"] is None
                      or bands["weak"]["avg_return"] is None
                      else round(bands["strong"]["avg_return"] - bands["weak"]["avg_return"], 2))
            out.update({"available": True, "bands": bands, "spread": spread,
                        "samples": len(allret),
                        "market_avg": round(sum(allret) / len(allret), 2),
                        "from": lo.isoformat(), "to": hi.isoformat()})
    _cache[key] = (_time.time(), out)
    return out


def for_symbol(symbol: str, horizon: int = 10) -> dict:
    """Per-stock: score history + forward return per score date, and the move
    since it was first scored."""
    symbol = (symbol or "").strip().upper()
    db = SessionLocal()
    try:
        cal = [d for (d,) in db.query(StockPrice.price_date).distinct()
               .order_by(StockPrice.price_date.asc()).all()]
        idx = {d: i for i, d in enumerate(cal)}
        srows = (db.query(StockScore.score_date, StockScore.composite_score)
                 .filter(StockScore.symbol == symbol)
                 .order_by(StockScore.score_date.asc()).all())
        prows = {d: c for d, c in
                 db.query(StockPrice.price_date, StockPrice.close)
                 .filter(StockPrice.symbol == symbol).all()}
        pts = []
        for sd, comp in srows:
            d0 = _to_date(sd)
            if d0 is None or comp is None or d0 not in idx:
                continue
            c0 = prows.get(d0)
            fwd = None
            j = idx[d0] + horizon
            if c0 and j < len(cal):
                c1 = prows.get(cal[j])
                if c1 and c0 > 0:
                    fwd = round((c1 / c0 - 1) * 100.0, 2)
            pts.append({"date": d0.isoformat(), "score": round(float(comp), 1),
                        "close": c0, "fwd_return": fwd})
        since = None
        if pts:
            first = next((p for p in pts if p["close"]), None)
            lastc = prows.get(cal[-1]) if cal else None
            if first and first["close"] and lastc:
                since = {"from": first["date"], "score_then": first["score"],
                         "return_pct": round((lastc / first["close"] - 1) * 100.0, 2)}
        return {"symbol": symbol, "horizon_days": horizon, "points": pts,
                "since_first_scored": since,
                "note": "Hypothetical back-study — not advice; past performance is "
                        "not indicative of future results."}
    finally:
        db.close()
