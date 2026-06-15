"""Market-data aggregator: prefers licensed broker feeds when configured,
falls back to NSE public data. Single entry point for all agents/services."""
import logging

from app.data.base import Quote
from app.data.brokers import KiteProvider, SmartAPIProvider, UpstoxProvider
from app.data.nse import NSEProvider
from app.data.yahoo import YahooProvider

log = logging.getLogger(__name__)


class MarketDataAggregator:
    def __init__(self):
        self._nse = NSEProvider()
        brokers = [KiteProvider(), SmartAPIProvider(), UpstoxProvider()]
        self._providers = [p for p in brokers if p.available()] + [self._nse, YahooProvider()]
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

    # Global indices shown when admin enables global markets (labelled "(GL)")
    _GLOBAL = [("^GSPC", "S&P 500 (GL)"), ("^IXIC", "NASDAQ (GL)"),
               ("^DJI", "DOW JONES (GL)"), ("^FTSE", "FTSE 100 (GL)"),
               ("^N225", "NIKKEI 225 (GL)"), ("^HSI", "HANG SENG (GL)")]

    async def get_indices(self) -> list[dict]:
        """NSE indices + key BSE indices, plus global indices when enabled."""
        import asyncio

        from app.services.app_settings import get_setting
        yahoo = self._providers[-1]  # YahooProvider is always last
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
