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

    async def get_indices(self) -> list[dict]:
        """NSE indices + key BSE indices (SENSEX, BANKEX via Yahoo)."""
        import asyncio
        nse_task = self._nse.get_indices()
        yahoo = self._providers[-1]  # YahooProvider is always last
        bse_tasks = [yahoo.get_index("^BSESN", "SENSEX (BSE)"),
                     yahoo.get_index("BSE-BANK.BO", "BANKEX (BSE)")]
        nse, *bse = await asyncio.gather(nse_task, *bse_tasks)
        return (nse or []) + [b for b in bse if b]


_agg: MarketDataAggregator | None = None


def get_market_data() -> MarketDataAggregator:
    global _agg
    if _agg is None:
        _agg = MarketDataAggregator()
    return _agg
