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
        dy = q.get("trailingAnnualDividendYield")
        fund = {
            "pe": q.get("trailingPE"),
            "eps": q.get("epsTrailingTwelveMonths"),
            "pb": q.get("priceToBook"),
            "dividend_yield": round(dy * 100, 2) if isinstance(dy, (int, float)) else None,
            "beta": None, "roe": None,
        }
        # Fill any gaps (and add beta / ROE, which the v7 quote lacks) from the
        # richer quoteSummary modules — keeps fundamentals near-complete.
        if any(fund[k] is None for k in ("pe", "eps", "pb", "dividend_yield")):
            extra = await self._summary_fundamentals(client, ysym)
            for k, v in extra.items():
                if fund.get(k) is None and v is not None:
                    fund[k] = v
        return Quote(
            symbol=symbol.upper(),
            last_price=last,
            change_pct=round(chg, 2) if chg is not None else None,
            prev_close=q.get("regularMarketPreviousClose"),
            open=q.get("regularMarketOpen"),
            high=q.get("regularMarketDayHigh"),
            low=q.get("regularMarketDayLow"),
            week52_high=q.get("fiftyTwoWeekHigh"),
            week52_low=q.get("fiftyTwoWeekLow"),
            volume=q.get("regularMarketVolume"),
            pe=fund["pe"],
            eps=fund["eps"],
            pb=fund["pb"],
            dividend_yield=fund["dividend_yield"],
            beta=fund["beta"],
            roe=fund["roe"],
            market_cap=q.get("marketCap"),
            source="yahoo",
        )

    async def _summary_fundamentals(self, client, ysym):
        """Richer fundamentals from Yahoo quoteSummary (summaryDetail,
        defaultKeyStatistics, financialData). Returns a dict; never raises."""
        out = {}
        try:
            r = await client.get(
                f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{ysym}",
                params={"modules": "summaryDetail,defaultKeyStatistics,financialData",
                        "crumb": _crumb},
                headers={**_HEADERS, "Cookie": _cookie_hdr})
            if r.status_code in (401, 403):
                _reset_auth()
                return out
            r.raise_for_status()
            res = (r.json().get("quoteSummary", {}).get("result") or [])
            if not res:
                return out
            node = res[0]
            sd = node.get("summaryDetail") or {}
            ks = node.get("defaultKeyStatistics") or {}
            fd = node.get("financialData") or {}

            def raw(d, k):
                v = d.get(k)
                if isinstance(v, dict):
                    v = v.get("raw")
                return v if isinstance(v, (int, float)) else None

            out["pe"] = raw(sd, "trailingPE") or raw(ks, "trailingPE")
            out["eps"] = raw(ks, "trailingEps")
            out["pb"] = raw(ks, "priceToBook") or raw(sd, "priceToBook")
            dyv = raw(sd, "dividendYield")
            if dyv is None:
                tay = raw(sd, "trailingAnnualDividendYield")
                dyv = tay * 100 if tay is not None else None
            else:
                dyv = dyv if dyv > 1 else dyv * 100   # Yahoo varies fraction/percent
            out["dividend_yield"] = round(dyv, 2) if dyv is not None else None
            out["beta"] = raw(sd, "beta") or raw(ks, "beta")
            roe = raw(fd, "returnOnEquity")
            out["roe"] = round(roe * 100, 2) if roe is not None else None
        except Exception as e:
            log.warning("Yahoo fundamentals fallback failed for %s: %s", ysym, e)
        return out

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
