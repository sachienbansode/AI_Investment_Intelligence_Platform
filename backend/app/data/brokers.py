"""Licensed broker market-data adapters: Zerodha Kite Connect, Angel One
SmartAPI, Upstox. Each activates only when its credentials are present in .env.
See docs/ACCOUNT_SETUP_GUIDE.md for how to obtain API keys.
"""
import asyncio
import logging

import httpx

from app.config import get_settings
from app.data.base import MarketDataProvider, Quote

log = logging.getLogger(__name__)


class KiteProvider(MarketDataProvider):
    """Zerodha Kite Connect (https://kite.trade). Real-time licensed quotes."""
    name = "kite"

    def __init__(self):
        s = get_settings()
        self._kite = None
        if s.kite_api_key and s.kite_access_token:
            try:
                from kiteconnect import KiteConnect
                self._kite = KiteConnect(api_key=s.kite_api_key)
                self._kite.set_access_token(s.kite_access_token)
            except Exception as e:
                log.warning("Kite init failed: %s", e)

    def available(self) -> bool:
        return self._kite is not None

    async def get_quote(self, symbol: str) -> Quote | None:
        try:
            key = f"NSE:{symbol.upper()}"
            data = await asyncio.to_thread(self._kite.quote, [key])
            q = data[key]
            ohlc = q.get("ohlc", {})
            prev = ohlc.get("close")
            last = q.get("last_price")
            return Quote(
                symbol=symbol.upper(), last_price=last,
                change_pct=round((last - prev) / prev * 100, 2) if last and prev else None,
                open=ohlc.get("open"), high=ohlc.get("high"), low=ohlc.get("low"),
                prev_close=prev, volume=q.get("volume"), source="kite",
            )
        except Exception as e:
            log.warning("Kite quote failed for %s: %s", symbol, e)
            return None

    async def get_quotes_batch(self, symbols, into=None):
        """Kite quote() accepts up to ~500 instruments per call. Chunked here so
        the full NSE universe is fetched in a handful of licensed requests."""
        out = into if into is not None else {}
        keys = [f"NSE:{s.upper()}" for s in symbols]
        for i in range(0, len(keys), 500):
            chunk = keys[i:i + 500]
            try:
                data = await asyncio.to_thread(self._kite.quote, chunk)
            except Exception as e:
                log.warning("Kite batch chunk failed: %s", e)
                continue
            for key, q in (data or {}).items():
                sym = key.split(":", 1)[-1].upper()
                ohlc = q.get("ohlc", {}) or {}
                prev, last = ohlc.get("close"), q.get("last_price")
                if last is None:
                    continue
                out[sym] = Quote(
                    symbol=sym, last_price=last,
                    change_pct=round((last - prev) / prev * 100, 2) if last and prev else None,
                    open=ohlc.get("open"), high=ohlc.get("high"), low=ohlc.get("low"),
                    prev_close=prev, volume=q.get("volume"), source="kite")
        return out


class UpstoxProvider(MarketDataProvider):
    """Upstox API v2 (https://upstox.com/developer). REST quotes."""
    name = "upstox"

    def __init__(self):
        self._token = get_settings().upstox_access_token

    def available(self) -> bool:
        return bool(self._token)

    async def get_quote(self, symbol: str) -> Quote | None:
        try:
            instrument = f"NSE_EQ|{symbol.upper()}"
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.get(
                    "https://api.upstox.com/v2/market-quote/quotes",
                    params={"instrument_key": instrument},
                    headers={"Authorization": f"Bearer {self._token}",
                             "Accept": "application/json"},
                )
                r.raise_for_status()
            data = next(iter(r.json().get("data", {}).values()), None)
            if not data:
                return None
            ohlc = data.get("ohlc", {})
            return Quote(
                symbol=symbol.upper(), last_price=data.get("last_price"),
                change_pct=data.get("net_change"),
                open=ohlc.get("open"), high=ohlc.get("high"), low=ohlc.get("low"),
                prev_close=ohlc.get("close"), volume=data.get("volume"), source="upstox",
            )
        except Exception as e:
            log.warning("Upstox quote failed for %s: %s", symbol, e)
            return None


class SmartAPIProvider(MarketDataProvider):
    """Angel One SmartAPI (https://smartapi.angelbroking.com). REST quotes."""
    name = "smartapi"

    def __init__(self):
        s = get_settings()
        self._key = s.smartapi_key
        self._token = s.smartapi_access_token

    def available(self) -> bool:
        return bool(self._key and self._token)

    async def get_quote(self, symbol: str) -> Quote | None:
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(
                    "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/",
                    json={"mode": "FULL",
                          "exchangeTokens": {"NSE": [symbol.upper()]}},
                    headers={
                        "Authorization": f"Bearer {self._token}",
                        "X-PrivateKey": self._key,
                        "Content-Type": "application/json",
                        "X-UserType": "USER", "X-SourceID": "WEB",
                    },
                )
                r.raise_for_status()
            fetched = r.json().get("data", {}).get("fetched", [])
            if not fetched:
                return None
            d = fetched[0]
            return Quote(
                symbol=symbol.upper(), last_price=d.get("ltp"),
                change_pct=d.get("percentChange"),
                open=d.get("open"), high=d.get("high"), low=d.get("low"),
                prev_close=d.get("close"), volume=d.get("tradeVolume"),
                week52_high=d.get("52WeekHigh"), week52_low=d.get("52WeekLow"),
                source="smartapi",
            )
        except Exception as e:
            log.warning("SmartAPI quote failed for %s: %s", symbol, e)
            return None

    async def get_quotes_batch(self, symbols, into=None):
        """SmartAPI quote (FULL mode) accepts up to ~50 tokens per request.
        NOTE: Angel One keys quotes by numeric instrument TOKEN, not trading
        symbol; once credentials are configured we load the instrument master
        and map symbol->token. Chunked at 50."""
        out = into if into is not None else {}
        url = ("https://apiconnect.angelone.in/rest/secure/angelbroking/"
               "market/v1/quote/")
        headers = {"Authorization": f"Bearer {self._token}", "X-PrivateKey": self._key,
                   "Content-Type": "application/json", "X-UserType": "USER",
                   "X-SourceID": "WEB"}
        async with httpx.AsyncClient(timeout=15) as client:
            for i in range(0, len(symbols), 50):
                chunk = [s.upper() for s in symbols[i:i + 50]]
                try:
                    r = await client.post(url, headers=headers,
                                          json={"mode": "FULL", "exchangeTokens": {"NSE": chunk}})
                    r.raise_for_status()
                    for d in r.json().get("data", {}).get("fetched", []):
                        sym = (d.get("tradingSymbol") or "").upper()
                        if sym.endswith("-EQ"):
                            sym = sym[:-3]
                        last = d.get("ltp")
                        if not sym or last is None:
                            continue
                        out[sym] = Quote(
                            symbol=sym, last_price=last, change_pct=d.get("percentChange"),
                            open=d.get("open"), high=d.get("high"), low=d.get("low"),
                            prev_close=d.get("close"), volume=d.get("tradeVolume"),
                            week52_high=d.get("52WeekHigh"), week52_low=d.get("52WeekLow"),
                            source="smartapi")
                except Exception as e:
                    log.warning("SmartAPI batch chunk failed: %s", e)
                    continue
        return out
