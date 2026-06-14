"""Yahoo Finance fallback adapter (development/demo only — not exchange-licensed).
Used only when broker APIs are not configured and NSE public endpoints are
unreachable (e.g. cloud/datacenter IPs). Maps NSE symbols to '<SYMBOL>.NS'.
"""
import logging

import httpx

from app.data.base import MarketDataProvider, Quote

log = logging.getLogger(__name__)

_HEADERS = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}


class YahooProvider(MarketDataProvider):
    name = "yahoo"

    def available(self) -> bool:
        return True

    async def get_quote(self, symbol: str) -> Quote | None:
        try:
            ysym = f"{symbol.upper()}.NS"
            async with httpx.AsyncClient(timeout=12, headers=_HEADERS) as client:
                r = await client.get(
                    f"https://query1.finance.yahoo.com/v8/finance/chart/{ysym}",
                    params={"range": "1d", "interval": "1d"},
                )
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
        except Exception as e:
            log.warning("Yahoo quote failed for %s: %s", symbol, e)
            return None

    async def get_index(self, ysymbol: str, label: str) -> dict | None:
        """Index snapshot via Yahoo (used for BSE indices, e.g. ^BSESN = SENSEX)."""
        try:
            async with httpx.AsyncClient(timeout=10, headers=_HEADERS) as client:
                r = await client.get(
                    f"https://query1.finance.yahoo.com/v8/finance/chart/{ysymbol}",
                    params={"range": "1d", "interval": "1d"},
                )
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
