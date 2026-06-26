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
import time as _time

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


# Admin-editable NSE-symbol -> Yahoo-ticker overrides (DB-backed, cached 60s).
# Use when a script's Yahoo ticker differs from "<SYMBOL>.NS" (renames, BSE-only).
_alias_cache = {"at": 0.0, "map": {}}


def _aliases() -> dict:
    now = _time.time()
    if now - _alias_cache["at"] > 60:
        try:
            from app.services.app_settings import get_setting
            m = get_setting("yahoo_symbol_aliases") or {}
            _alias_cache["map"] = {str(k).upper(): str(v).strip()
                                   for k, v in m.items() if str(v).strip()}
        except Exception:
            pass
        _alias_cache["at"] = now
    return _alias_cache["map"]


def _ysym(symbol: str, suffix: str = ".NS") -> str:
    """Resolve the primary Yahoo ticker for an NSE symbol (honours aliases)."""
    sym = symbol.upper()
    alias = _aliases().get(sym)
    if alias:
        return alias if "." in alias else alias + suffix
    return sym + suffix


def _candidates(symbol: str) -> list:
    """Yahoo tickers to try, in order: alias/.NS, then BSE .BO as a fallback so
    NIFTY names Yahoo doesn't serve on .NS still resolve."""
    sym = symbol.upper()
    alias = _aliases().get(sym)
    if alias and "." in alias:
        return [alias]
    base = alias or sym
    return [base + ".NS", base + ".BO"]


class YahooProvider(MarketDataProvider):
    name = "yahoo"

    def available(self):
        return True

    async def _quote_v7(self, client, symbol, ysym=None):
        """Full quote incl. trailing P/E and market cap (needs crumb+cookie)."""
        if not await _ensure_auth(client):
            return None
        ysym = ysym or _ysym(symbol)
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
        mcap = q.get("marketCap")
        # Fill any gaps (and add beta / ROE / market cap, which the v7 quote may
        # lack) from the richer quoteSummary modules — keeps fundamentals
        # near-complete for small-caps.
        if mcap is None or any(fund[k] is None for k in ("pe", "eps", "pb", "dividend_yield")):
            extra = await self._summary_fundamentals(client, ysym)
            for k, v in extra.items():
                if fund.get(k) is None and v is not None:
                    fund[k] = v
            if mcap is None and extra.get("market_cap") is not None:
                mcap = extra["market_cap"]
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
            market_cap=mcap,
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
            out["market_cap"] = raw(sd, "marketCap")
        except Exception as e:
            log.warning("Yahoo fundamentals fallback failed for %s: %s", ysym, e)
        return out

    async def _asset_profile_sector(self, client, ysym):
        """Sector (and industry) from Yahoo quoteSummary assetProfile module.
        Returns a sector string or None. Never raises."""
        try:
            r = await client.get(
                f"https://query1.finance.yahoo.com/v10/finance/quoteSummary/{ysym}",
                params={"modules": "assetProfile", "crumb": _crumb},
                headers={**_HEADERS, "Cookie": _cookie_hdr})
            if r.status_code in (401, 403):
                _reset_auth()
                return None
            r.raise_for_status()
            res = (r.json().get("quoteSummary", {}).get("result") or [])
            if not res:
                return None
            ap = res[0].get("assetProfile") or {}
            sector = (ap.get("sector") or ap.get("industry") or "").strip()
            return sector or None
        except Exception as e:
            log.warning("Yahoo assetProfile failed for %s: %s", ysym, e)
            return None

    async def get_sector(self, symbol):
        """Best-effort sector for one NSE symbol via Yahoo assetProfile."""
        try:
            async with httpx.AsyncClient(timeout=12, headers=_HEADERS) as client:
                if not await _ensure_auth(client):
                    return None
                return await self._asset_profile_sector(client, _ysym(symbol))
        except Exception as e:
            log.warning("Yahoo get_sector failed for %s: %s", symbol, e)
            return None

    async def get_sectors_batch(self, symbols, into=None, limit=8):
        """Resolve sectors for many symbols. assetProfile is per-symbol, so this
        gathers concurrently (capped) rather than truly batching. Writes into
        `into` (symbol -> sector) as each lands."""
        out = into if into is not None else {}
        try:
            async with httpx.AsyncClient(timeout=15, headers=_HEADERS) as client:
                if not await _ensure_auth(client):
                    return out
                sem = asyncio.Semaphore(limit)

                async def _one(s):
                    async with sem:
                        sec = await self._asset_profile_sector(client, _ysym(s))
                        if sec:
                            out[s.upper()] = sec

                await asyncio.gather(*(_one(s) for s in symbols))
        except Exception as e:
            log.warning("Yahoo get_sectors_batch failed: %s", e)
        return out

    async def _quote_chart(self, client, symbol, ysym=None):
        """No-auth fallback: price + 52-week range (no P/E or market cap)."""
        ysym = ysym or _ysym(symbol)
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
                # Try each candidate ticker (alias / .NS, then BSE .BO) so NIFTY
                # names Yahoo doesn't serve on .NS still resolve.
                for ysym in _candidates(symbol):
                    try:
                        q = await self._quote_v7(client, symbol, ysym)
                        if q and q.last_price is not None:
                            return q
                    except Exception as e:
                        log.warning("Yahoo v7 quote failed for %s (%s): %s", symbol, ysym, e)
                    try:
                        q = await self._quote_chart(client, symbol, ysym)
                        if q and q.last_price is not None:
                            return q
                    except Exception as e:
                        log.warning("Yahoo chart quote failed for %s (%s): %s", symbol, ysym, e)
                return None
        except Exception as e:
            log.warning("Yahoo quote failed for %s: %s", symbol, e)
            return None

    async def get_quotes_batch(self, symbols, into=None):
        """Fetch many quotes per request (Yahoo v7 accepts comma-separated
        symbols) - ~50 per call instead of one each, so 1800+ scripts become
        ~37 requests and Yahoo stops rate-limiting. Writes into `into` as each
        chunk lands (for live progress)."""
        out = into if into is not None else {}
        try:
            async with httpx.AsyncClient(timeout=20, headers=_HEADERS) as client:
                if not await _ensure_auth(client):
                    return out
                sem = asyncio.Semaphore(4)

                async def _chunk(chunk):
                    ysyms = ",".join(f"{s.upper()}.NS" for s in chunk)
                    async with sem:
                        try:
                            r = await client.get(
                                "https://query1.finance.yahoo.com/v7/finance/quote",
                                params={"symbols": ysyms, "crumb": _crumb},
                                headers={**_HEADERS, "Cookie": _cookie_hdr})
                            if r.status_code in (401, 403):
                                _reset_auth()
                                return
                            r.raise_for_status()
                            for q in r.json().get("quoteResponse", {}).get("result", []):
                                sym = (q.get("symbol") or "").upper()
                                if sym.endswith(".NS"):
                                    sym = sym[:-3]
                                last = q.get("regularMarketPrice")
                                if not sym or last is None:
                                    continue
                                chg = q.get("regularMarketChangePercent")
                                dy = q.get("trailingAnnualDividendYield")
                                out[sym] = Quote(
                                    symbol=sym, last_price=last,
                                    change_pct=round(chg, 2) if chg is not None else None,
                                    prev_close=q.get("regularMarketPreviousClose"),
                                    open=q.get("regularMarketOpen"),
                                    high=q.get("regularMarketDayHigh"),
                                    low=q.get("regularMarketDayLow"),
                                    week52_high=q.get("fiftyTwoWeekHigh"),
                                    week52_low=q.get("fiftyTwoWeekLow"),
                                    volume=q.get("regularMarketVolume"),
                                    pe=q.get("trailingPE"),
                                    eps=q.get("epsTrailingTwelveMonths"),
                                    pb=q.get("priceToBook"),
                                    dividend_yield=round(dy * 100, 2) if isinstance(dy, (int, float)) else None,
                                    market_cap=q.get("marketCap"), source="yahoo")
                        except Exception as e:
                            log.warning("Yahoo batch chunk failed: %s", e)

                chunks = [symbols[i:i + 50] for i in range(0, len(symbols), 50)]
                await asyncio.gather(*(_chunk(c) for c in chunks))
        except Exception as e:
            log.warning("Yahoo batch quotes failed: %s", e)
        return out

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
