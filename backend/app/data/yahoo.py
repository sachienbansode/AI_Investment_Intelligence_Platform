"""Yahoo Finance fallback adapter (development/demo only — not exchange-licensed).
Used only when broker APIs are not configured and NSE public endpoints are
unreachable (e.g. cloud/datacenter IPs). Maps NSE symbols to '<SYMBOL>.NS'.

Two fetch paths:
  - v7 quote (authenticated with a crumb+cookie) - price, day change, 52-week
    range, volume AND trailing P/E + market cap. Preferred.
  - v8 chart (no auth) - price/52w only; used as a fallback when the crumb
    handshake fails, so quotes never stop working (P/E/market cap just go null).
"""
import asyncio
import logging

import httpx

from app.data.base import MarketDataProvider, Quote

log = logging.getLogger(__name__)

_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}

# Cached Yahoo auth (crumb + cookie header). Fetched once, reused for all quotes.
_crumb = None
_cookie_hdr = None
_auth_lock = asyncio.Lock()


async def _ensure_auth(client):
    """Obtain a Yahoo cookie + crumb (required by the v7 quote API). Cached."""
    global _crumb, _cookie_hdr
    if _crumb and _cookie_hdr:
        return True
    async with _auth_lock:
        if _crumb and _cookie_hdr:
            return True
        try:
            seed = await client.get("https://fc.yahoo.com/", headers=_HEADERS)
            cookie_hdr = "; ".join(f"{k}={v}" for k, v in seed.cookies.items())
            if not cookie_hdr:
                return False
            cr = await client.get(
                "https://query1.finance.yahoo.com/v1/test/getcrumb",
                headers={**_HEADERS, "Cookie": cookie_hdr})
            crumb = (cr.text or "").strip()
            if crumb and "<" not in crumb and len(crumb) < 40:
                _crumb, _cookie_hdr = crumb, cookie_hdr
                return True
        except Exception as e:
            log.warning("Yahoo crumb handshake failed: %s", e)
        return False


def _reset_auth():
    global _crumb, _cookie_hdr
    _crumb = _cookie_hdr = None


class YahooProvider(MarketDataProvider):
    name = "yahoo"

    def available(self):
        return True

    async def _quote_v7(self, client, symbol):
        """Full quote incl. trailing P/E and market cap (needs crumb+cookie)."""
        if not await _ensure_auth(client):
            return None
        ysym = f"{symbol.upper()}.NS"
        r = await client.get(
            "https://query1.finance.yahoo.com/v7/finance/quote",
            params={"symbols": ysym, "crumb": _crumb},
            headers={**_HEADERS, "Cookie": _cookie_hdr})
        if r.status_code in (401, 403):
            _reset_auth()
            return None
        r.raise_for_status()
        res = r.json().get("quoteResponse", {}).get("result", [])
        if not res:
            return None
        q = res[0]
        last = q.get("regularMarketPrice")
        if last is None:
            return None
        chg = q.get("regularMarketChangePercent")
        return Quote(
            symbol=symbol.upper(),
            last_price=last,
            change_pct=round(chg, 2) if chg is not None else None,
            prev_close=q.get("regularMarketPreviousClose"),
            high=q.get("regularMarketDayHigh"),
            low=q.get("regularMarketDayLow"),
            week52_high=q.get("fiftyTwoWeekHigh"),
            week52_low=q.get("fiftyTwoWeekLow"),
            volume=q.get("regularMarketVolume"),
            pe=q.get("trailingPE"),
            market_cap=q.get("marketCap"),
            source="yahoo",
        )

    async def _quote_chart(self, client, symbol):
        """No-auth fallback: price + 52-week range (no P/E or market cap)."""
        ysym = f"{symbol.upper()}.NS"
        r = await client.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}",
            params={"range": "1d", "interval": "1d"})
        r.raise_for_status()
        result = r.json().get("chart", {}).get("result")
        if not result:
            return None
        meta = result[0].get("meta", {})
        last = meta.get("regularMarketPrice")
        prev = meta.get("chartPreviousClose") or meta.get("previousClose")
        return Quote(
            symbol=symbol.upper(),
            last_price=last,
            change_pct=round((last - prev) / prev * 100, 2) if last and prev else None,
            prev_close=prev,
            high=meta.get("regularMarketDayHigh"),
            low=meta.get("regularMarketDayLow"),
            week52_high=meta.get("fiftyTwoWeekHigh"),
            week52_low=meta.get("fiftyTwoWeekLow"),
            volume=meta.get("regularMarketVolume"),
            source="yahoo",
        )

    async def get_quote(self, symbol):
        try:
            async with httpx.AsyncClient(timeout=12, headers=_HEADERS) as client:
                try:
                    q = await self._quote_v7(client, symbol)
                    if q and q.last_price is not None:
                        return q
                except Exception as e:
                    log.warning("Yahoo v7 quote failed for %s (falling back): %s", symbol, e)
                return await self._quote_chart(client, symbol)
        except Exception as e:
            log.warning("Yahoo quote failed for %s: %s", symbol, e)
            return None

    async def get_index(self, ysymbol, label):
        """Index snapshot via Yahoo (used for BSE indices, e.g. ^BSESN = SENSEX)."""
        try:
            async with httpx.AsyncClient(timeout=10, headers=_HEADERS) as client:
                r = await client.get(
                    f"https://query1.finance.yahoo.com/v8/finance/chart/{ysymbol}",
                    params={"range": "1d", "interval": "1d"})
                r.raise_for_status()
            result = r.json().get("chart", {}).get("result")
            if not result:
                return None
            meta = result[0].get("meta", {})
            last = meta.get("regularMarketPrice")
            prev = meta.get("chartPreviousClose") or meta.get("previousClose")
            if last is None or not prev:
                return None
            return {"index": label, "last": round(last, 2),
                    "pct_change": round((last - prev) / prev * 100, 2)}
        except Exception as e:
            log.warning("Yahoo index failed for %s: %s", ysymbol, e)
            return None
