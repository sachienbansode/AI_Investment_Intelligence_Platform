"""NSE India public website adapter (quotes, indices).

Note: NSE's public endpoints are rate-limited and intended for browser use.
Fine for development; for production use a licensed feed (see broker
adapters and docs/ACCOUNT_SETUP_GUIDE.md).
"""
import asyncio
import logging

import httpx

from app.data.base import MarketDataProvider, Quote

log = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                   "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"),
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.nseindia.com/",
}
_BASE = "https://www.nseindia.com"


class NSEProvider(MarketDataProvider):
    name = "nse"

    def __init__(self):
        self._client: httpx.AsyncClient | None = None
        self._lock = asyncio.Lock()

    def available(self) -> bool:
        return True

    async def _client_with_cookies(self) -> httpx.AsyncClient:
        async with self._lock:
            if self._client is None:
                self._client = httpx.AsyncClient(headers=_HEADERS, timeout=15, follow_redirects=True)
                # Hitting the homepage first sets the cookies NSE's API requires
                try:
                    await self._client.get(_BASE)
                except Exception as e:
                    log.warning("NSE cookie bootstrap failed: %s", e)
            return self._client

    async def get_quote(self, symbol: str) -> Quote | None:
        try:
            client = await self._client_with_cookies()
            url = f"{_BASE}/api/quote-equity"
            params = {"symbol": symbol.upper()}
            headers = {"Referer": f"{_BASE}/get-quotes/equity?symbol={symbol.upper()}"}
            r = await client.get(url, params=params, headers=headers)
            if r.status_code in (401, 403):
                # cookies expired / blocked: re-bootstrap via the quote page and retry once
                await client.get(headers["Referer"])
                await asyncio.sleep(0.5)
                r = await client.get(url, params=params, headers=headers)
            r.raise_for_status()
            d = r.json()
            price = d.get("priceInfo", {})
            info = d.get("info", {})
            meta = d.get("metadata", {})
            week = price.get("weekHighLow", {})
            return Quote(
                symbol=symbol.upper(),
                last_price=price.get("lastPrice"),
                change_pct=price.get("pChange"),
                open=price.get("open"),
                high=price.get("intraDayHighLow", {}).get("max"),
                low=price.get("intraDayHighLow", {}).get("min"),
                prev_close=price.get("previousClose"),
                week52_high=week.get("max"),
                week52_low=week.get("min"),
                pe=_to_float(meta.get("pdSymbolPe")),
                sector=info.get("industry"),
                volume=d.get("preOpenMarket", {}).get("totalTradedVolume"),
                source="nse",
            )
        except Exception as e:
            log.warning("NSE quote failed for %s: %s", symbol, e)
            return None

    async def get_sector(self, symbol: str) -> str | None:
        q = await self.get_quote(symbol)
        return q.sector if q and q.sector else None

    async def get_indices(self) -> list[dict]:
        try:
            client = await self._client_with_cookies()
            r = await client.get(f"{_BASE}/api/allIndices")
            r.raise_for_status()
            keep = {"NIFTY 50", "NIFTY BANK", "NIFTY IT", "NIFTY MIDCAP 100", "INDIA VIX"}
            return [
                {"index": i["index"], "last": i.get("last"), "pct_change": i.get("percentChange")}
                for i in r.json().get("data", []) if i.get("index") in keep
            ]
        except Exception as e:
            log.warning("NSE indices failed: %s", e)
            return []


def _to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
