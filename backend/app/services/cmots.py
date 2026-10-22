"""CMOTS-backed analytics: fundamentals snapshot + risk metrics (volatility, Beta).

Reads the read-only CMOTS data source (registered as "CMOTS" in data_sources) using
the SELECT-only run_sql guard. Column mappings are the introspected CMOTS schema
(see areas/ashika-scope memory): join key `co_code`; companymaster maps co_code<->
nsesymbol; price_change holds daily OHLCV; fundamentalttm + *ratios hold fundamentals.

All failures degrade gracefully to None/{} so the rest of the app is never blocked
when CMOTS is unreachable or a symbol is missing.
"""
from __future__ import annotations

import logging
import math
import statistics
import time

from app.services import data_sources as ds

log = logging.getLogger(__name__)

_TRADING_DAYS = 252
_cache: dict = {}            # simple TTL cache
_cocode: dict = {"t": 0.0, "map": {}}   # nsesymbol(upper) -> {co_code, sector, mcaptype}


def _src():
    """The enabled CMOTS data source, or None."""
    try:
        for s in ds.enabled_sources():
            if (s.name or "").upper() == "CMOTS":
                return s
    except Exception as e:
        log.warning("cmots _src failed: %s", e)
    return None


def available() -> bool:
    return _src() is not None


def _q(sql: str, max_rows: int = 1000, timeout_s: int = 20):
    src = _src()
    if not src:
        return []
    try:
        return ds.run_sql(src, sql, max_rows=max_rows, timeout_s=timeout_s).get("rows", [])
    except Exception as e:
        log.warning("cmots query failed: %s | sql=%s", e, sql[:160])
        return []


# ---- company map -----------------------------------------------------------

def cocode_map(max_age: int = 3600) -> dict:
    """nsesymbol(UPPER) -> {co_code, sector, mcaptype, name}. Cached."""
    if _cocode["map"] and (time.time() - _cocode["t"]) < max_age:
        return _cocode["map"]
    rows = _q("SELECT co_code, nsesymbol, sectorname, mcaptype, companyname "
              "FROM companymaster WHERE nsesymbol IS NOT NULL AND nsesymbol <> ''",
              max_rows=12000)
    m = {}
    for r in rows:
        sym = str(r.get("nsesymbol") or "").strip().upper()
        if not sym:
            continue
        m[sym] = {"co_code": r.get("co_code"), "sector": r.get("sectorname"),
                  "mcaptype": r.get("mcaptype"), "name": r.get("companyname")}
    if m:
        _cocode["map"] = m
        _cocode["t"] = time.time()
    return m or _cocode["map"]


def cocode_for(symbol: str):
    info = cocode_map().get(str(symbol or "").strip().upper())
    return info.get("co_code") if info else None


# ---- prices / risk ---------------------------------------------------------

def daily_closes(co_code, days: int = 500) -> list:
    """[(date_str, close), ...] oldest->newest for a co_code, from price_change."""
    try:
        cc = int(co_code)
    except (TypeError, ValueError):
        return []
    rows = _q(f"SELECT upd_date, close FROM price_change WHERE co_code = {cc} "
              f"AND close IS NOT NULL ORDER BY upd_date DESC LIMIT {int(days)}",
              max_rows=int(days) + 10)
    out = []
    for r in rows:
        d, c = r.get("upd_date"), r.get("close")
        if d is None or c is None:
            continue
        try:
            out.append((str(d)[:10], float(c)))
        except (TypeError, ValueError):
            continue
    out.reverse()   # oldest -> newest
    return out


def _returns(closes: list) -> dict:
    """date -> daily simple return, from [(date, close)] oldest->newest."""
    r = {}
    for i in range(1, len(closes)):
        p0, p1 = closes[i - 1][1], closes[i][1]
        if p0 and p0 > 0:
            r[closes[i][0]] = p1 / p0 - 1.0
    return r


def annualized_volatility(closes: list):
    rets = list(_returns(closes).values())
    if len(rets) < 20:
        return None
    try:
        return round(statistics.pstdev(rets) * math.sqrt(_TRADING_DAYS) * 100, 2)  # % p.a.
    except statistics.StatisticsError:
        return None


def beta(stock_closes: list, index_closes: list):
    """Beta of stock vs index (benchmark), aligned by date. None if too little overlap."""
    sr, mr = _returns(stock_closes), _returns(index_closes)
    dates = sorted(set(sr) & set(mr))
    if len(dates) < 30:
        return None
    s = [sr[d] for d in dates]
    m = [mr[d] for d in dates]
    mbar = sum(m) / len(m)
    var_m = sum((x - mbar) ** 2 for x in m)
    if var_m <= 0:
        return None
    sbar = sum(s) / len(s)
    cov = sum((s[i] - sbar) * (m[i] - mbar) for i in range(len(s)))
    return round(cov / var_m, 2)


async def _nifty_history(days: int = 500):
    """NIFTY 50 daily closes (Beta benchmark) via Yahoo ^NSEI. [] on failure."""
    key = "nifty_hist"
    hit = _cache.get(key)
    if hit and (time.time() - hit[0]) < 1800:
        return hit[1]
    try:
        from app.data.yahoo import YahooProvider
        rng = "2y" if days > 300 else "1y"
        hist = await YahooProvider().get_index_history("^NSEI", rng)
    except Exception as e:
        log.warning("nifty history failed: %s", e)
        hist = []
    if hist:
        _cache[key] = (time.time(), hist)
    return hist


async def risk_metrics(symbol: str, days: int = 500) -> dict:
    """{volatility_pct, beta, days, as_of} for a symbol, or {} if unavailable."""
    cc = cocode_for(symbol)
    if cc is None:
        return {}
    closes = daily_closes(cc, days)
    if len(closes) < 20:
        return {}
    vol = annualized_volatility(closes)
    idx = await _nifty_history(days)
    b = beta(closes, idx) if idx else None
    return {"volatility_pct": vol, "beta": b, "days": len(closes),
            "as_of": closes[-1][0] if closes else None,
            "benchmark": "NIFTY 50"}


# ---- fundamentals ----------------------------------------------------------

def _latest_by_yrc(table: str, cols: list, co_code) -> dict:
    """Latest-year row (max yrc) for a co_code from a *ratios table."""
    try:
        cc = int(co_code)
    except (TypeError, ValueError):
        return {}
    sel = ", ".join(["yrc"] + cols)
    rows = _q(f"SELECT {sel} FROM {table} WHERE co_code = {cc} "
              f"ORDER BY yrc DESC LIMIT 1", max_rows=1)
    return rows[0] if rows else {}


def fundamentals(symbol: str) -> dict:
    """Fundamentals snapshot for a symbol from fundamentalttm + latest ratios."""
    cc = cocode_for(symbol)
    if cc is None:
        return {}
    try:
        icc = int(cc)
    except (TypeError, ValueError):
        return {}
    out = {"co_code": cc}
    ttm = _q(f"SELECT pe_ttm, pb_ttm, eps_ttm, dividendyield, mcap, sectorpe, "
             f"pegratio, operatingprofitmargin, netprofitmargin FROM fundamentalttm "
             f"WHERE co_code = {icc} LIMIT 1", max_rows=1)
    if ttm:
        out.update({k: v for k, v in ttm[0].items() if v is not None})
    perf = _latest_by_yrc("performanceratios", ["roe", "roa"], icc)
    stab = _latest_by_yrc("financialstabilityratios",
                          ["totaldebt_equity", "currentratio", "interestcover"], icc)
    val = _latest_by_yrc("valuationratios", ["pe", "price_bookvalue", "ev_ebitda"], icc)
    for d in (perf, stab, val):
        out.update({k: v for k, v in d.items() if v is not None and k != "yrc"})
    return out
