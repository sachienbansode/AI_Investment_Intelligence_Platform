"""Market-data aggregator: prefers licensed broker feeds when configured,
falls back to NSE public data. Single entry point for all agents/services."""
import logging

from app.config import get_settings
from app.data.base import Quote
from app.data.brokers import KiteProvider, SmartAPIProvider, UpstoxProvider
from app.data.nse import NSEProvider
from app.data.yahoo import YahooProvider

log = logging.getLogger(__name__)


class MarketDataAggregator:
    def __init__(self):
        s = get_settings()
        self._nse = NSEProvider()
        self._yahoo = YahooProvider()
        brokers = [p for p in (KiteProvider(), SmartAPIProvider(), UpstoxProvider())
                   if p.available()]
        explicit = s.allow_unlicensed_market_data   # None | True | False
        prod = s.environment.lower() in ("production", "prod")
        if explicit is True:
            use_fb = True
        elif explicit is False:
            use_fb = False
        else:
            # Auto: on in dev; in production, drop the unlicensed feeds ONLY when a
            # licensed broker feed exists - never leave the app with zero data.
            use_fb = (not prod) or (not brokers)
        self._allow_fallback = use_fb
        providers = list(brokers)
        if use_fb:
            providers += [self._nse, self._yahoo]
        self._providers = providers
        if not providers:
            log.error("No market-data provider available: unlicensed fallbacks explicitly "
                      "disabled and no broker configured. Quotes will be empty. Set "
                      "ALLOW_UNLICENSED_MARKET_DATA=true or configure a broker.")
        elif use_fb and prod and not brokers:
            log.warning("Using UNLICENSED fallbacks (NSE/Yahoo) in production because no "
                        "licensed broker feed is configured. Configure a broker, or set "
                        "ALLOW_UNLICENSED_MARKET_DATA=false to disable.")
        log.info("Market data providers active: %s", [p.name for p in self._providers])

    @property
    def active_providers(self) -> list[str]:
        return [p.name for p in self._providers]

    async def get_quote(self, symbol: str) -> Quote | None:
        for p in self._providers:
            q = await p.get_quote(symbol)
            if q and q.last_price is not None:
                return q
        return None

    async def get_quotes(self, symbols, into=None):
        """Fetch many symbols efficiently: use any provider that supports batch
        (Yahoo), then fall back to per-symbol for whatever is still missing
        (broker/NSE or Yahoo gaps). `into` is filled live for progress."""
        import asyncio
        out = into if into is not None else {}
        symbols = [s.upper() for s in symbols]
        for p in self._providers:
            remaining = [s for s in symbols if s not in out]
            if not remaining:
                break
            if hasattr(p, "get_quotes_batch"):
                try:
                    await p.get_quotes_batch(remaining, into=out)
                except Exception as e:
                    log.warning("Batch quotes via %s failed: %s", p.name, e)
        remaining = [s for s in symbols if s not in out]
        if remaining:
            sem = asyncio.Semaphore(8)

            async def _one(s):
                async with sem:
                    q = await self.get_quote(s)
                    if q and q.last_price is not None:
                        out[s] = q
            await asyncio.gather(*(_one(s) for s in remaining))
        return out

    # Global indices shown when admin enables global markets (labelled "(GL)")
    _GLOBAL = [("^GSPC", "S&P 500 (GL)"), ("^IXIC", "NASDAQ (GL)"),
               ("^DJI", "DOW JONES (GL)"), ("^FTSE", "FTSE 100 (GL)"),
               ("^N225", "NIKKEI 225 (GL)"), ("^HSI", "HANG SENG (GL)")]

    async def get_indices(self) -> list[dict]:
        """NSE indices + key BSE indices, plus global indices when enabled."""
        import asyncio

        from app.services.app_settings import get_setting
        if not self._allow_fallback:
            return []   # unlicensed index sources disabled; wire a licensed feed
        yahoo = self._yahoo
        tasks = [self._nse.get_indices(),
                 yahoo.get_index("^BSESN", "SENSEX (BSE)"),
                 yahoo.get_index("BSE-BANK.BO", "BANKEX (BSE)")]
        n_bse = 2
        try:
            show_global = bool(get_setting("global_markets_enabled"))
        except Exception:
            show_global = False
        if show_global:
            tasks += [yahoo.get_index(sym, lbl) for sym, lbl in self._GLOBAL]
        results = await asyncio.gather(*tasks)
        nse = results[0] or []
        rest = [r for r in results[1:] if r]
        return nse + rest


_agg: MarketDataAggregator | None = None


def get_market_data() -> MarketDataAggregator:
    global _agg
    if _agg is None:
        _agg = MarketDataAggregator()
    return _agg
