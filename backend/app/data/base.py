"""Market-data provider interface. All adapters return a normalized Quote."""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class Quote:
    symbol: str
    last_price: float | None = None
    change_pct: float | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    prev_close: float | None = None
    volume: float | None = None
    week52_high: float | None = None
    week52_low: float | None = None
    pe: float | None = None
    eps: float | None = None
    pb: float | None = None
    dividend_yield: float | None = None
    beta: float | None = None
    roe: float | None = None
    market_cap: float | None = None
    sector: str | None = None
    source: str = ""
    extra: dict = field(default_factory=dict)


class MarketDataProvider(ABC):
    name: str = "base"

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    async def get_quote(self, symbol: str) -> Quote | None: ...


def quote_fundamentals(q) -> dict | None:
    """Compact dict of a quote's stored fundamentals (drops None values)."""
    if not q:
        return None
    d = {"pe": q.pe, "market_cap": q.market_cap, "last_price": q.last_price,
         "change_pct": q.change_pct, "week52_high": q.week52_high,
         "week52_low": q.week52_low, "eps": q.eps, "pb": q.pb,
         "dividend_yield": q.dividend_yield, "beta": q.beta, "roe": q.roe,
         "volume": q.volume, "source": q.source}
    return {k: v for k, v in d.items() if v is not None} or None
