"""Common interface every LLM provider implements."""
from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class LLMResponse:
    text: str
    provider: str
    model: str
    usage: dict = field(default_factory=dict)


class LLMProvider(ABC):
    name: str = "base"

    @abstractmethod
    def available(self) -> bool: ...

    @abstractmethod
    async def complete(self, system: str, prompt: str, max_tokens: int = 1024,
                       temperature: float = 0.3, cache: bool = False) -> LLMResponse: ...
