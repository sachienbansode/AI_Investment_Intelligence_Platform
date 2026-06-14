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
    sector: str | None = None
    source: str = ""
    extra: dict = field(default_factory=dict)


class MarketDataProvider(ABC):
    name: str = "base"

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    async def get_quote(self, symbol: str) -> Quote | None: ...
