"""Delayed price history (charts). Provider-abstracted so a licensed real-time
feed can be dropped in later without touching callers.

Default provider: Yahoo v8 chart (≈15-min delayed, EOD/intraday bars). Returns a
normalized {points:[{t, c}], currency, delayed, source}. NEVER presented as
real-time; the UI labels it "delayed".
"""
import logging
import time

log = logging.getLogger(__name__)

# range key -> (Yahoo range, Yahoo interval)
_RANGES = {
    "1D": ("1d", "5m"), "1W": ("5d", "30m"), "1M": ("1mo", "1d"),
    "6M": ("6mo", "1d"), "1Y": ("1y", "1d"), "5Y": ("5y", "1wk"),
}
_cache: dict = {}          # (symbol,range) -> (ts, payload)
_TTL = 120                 # seconds (delayed data; light caching)


def ranges() -> list[str]:
    return list(_RANGES.keys())


async def get_price_history(symbol: str, rng: str = "1M") -> dict:
    rng = (rng or "1M").upper()
    if rng not in _RANGES:
        rng = "1M"
    key = (symbol.upper(), rng)
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < _TTL:
        return hit[1]
    yrange, yinterval = _RANGES[rng]
    payload = await _yahoo_chart(symbol, yrange, yinterval, rng)
    if payload.get("points"):
        _cache[key] = (now, payload)
    return payload


async def _yahoo_chart(symbol: str, yrange: str, yinterval: str, rng: str) -> dict:
    import httpx
    sym = symbol.upper()
    ysym = sym if sym.endswith((".NS", ".BO")) else sym + ".NS"
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}"
    out = {"symbol": sym, "range": rng, "points": [], "currency": "INR",
           "delayed": True, "source": "yahoo"}
    try:
        async with httpx.AsyncClient(timeout=10,
                headers={"User-Agent": "Mozilla/5.0"}) as client:
            r = await client.get(url, params={"range": yrange, "interval": yinterval,
                                              "includePrePost": "false"})
            r.raise_for_status()
            res = (r.json().get("chart", {}).get("result") or [None])[0]
    except Exception as e:
        log.warning("price history fetch failed for %s: %s", sym, e)
        return out
    if not res:
        return out
    meta = res.get("meta", {}) or {}
    out["currency"] = meta.get("currency") or "INR"
    out["prev_close"] = meta.get("chartPreviousClose") or meta.get("previousClose")
    out["last"] = meta.get("regularMarketPrice")
    ts = res.get("timestamp") or []
    closes = (((res.get("indicators", {}) or {}).get("quote") or [{}])[0]).get("close") or []
    pts = [{"t": int(t), "c": round(c, 2)} for t, c in zip(ts, closes) if c is not None]
    out["points"] = pts
    return out
