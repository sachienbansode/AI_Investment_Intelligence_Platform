"""Multi-LLM router: tries providers in configured order with automatic
failover, and logs every call to the audit trail (model governance)."""
import logging

from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import get_settings
from app.core.compliance import audit_log
from app.llm.base import LLMResponse
from app.llm.providers import AnthropicProvider, GeminiProvider, MockProvider, OpenAIProvider

log = logging.getLogger(__name__)

_REGISTRY = {"anthropic": AnthropicProvider, "openai": OpenAIProvider, "gemini": GeminiProvider}


class LLMRouter:
    def __init__(self):
        self._providers = []
        for name in get_settings().provider_order:
            cls = _REGISTRY.get(name)
            if not cls:
                continue
            try:
                p = cls()
                if p.available():
                    self._providers.append(p)
            except Exception as e:  # SDK missing / bad key — skip, don't crash
                log.warning("Provider %s unavailable: %s", name, e)
        if not self._providers:
            self._providers = [MockProvider()]
        log.info("LLM providers active: %s", [p.name for p in self._providers])

    @property
    def active_providers(self) -> list[str]:
        return [p.name for p in self._providers]

    async def complete(self, system: str, prompt: str, *, task: str = "general",
                       max_tokens: int = 1024, temperature: float = 0.3,
                       exclude: str | None = None) -> LLMResponse:
        """Complete with failover. `exclude` deprioritises a provider (used by
        the independent AI checker so it reviews with a different model than the
        one that wrote the rationale, when more than one provider is configured)."""
        providers = self._providers
        if exclude and any(p.name != exclude for p in providers):
            providers = ([p for p in providers if p.name != exclude]
                         + [p for p in providers if p.name == exclude])
        last_err = None
        for provider in providers:
            try:
                resp = await self._call(provider, system, prompt, max_tokens, temperature)
                audit_log("llm_call", task=task, provider=provider.name,
                          model=resp.model, usage=resp.usage)
                return resp
            except Exception as e:
                last_err = e
                log.warning("Provider %s failed (%s); failing over", provider.name, e)
                audit_log("llm_failover", task=task, provider=provider.name, error=str(e))
        raise RuntimeError(f"All LLM providers failed. Last error: {last_err}")

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(min=1, max=4), reraise=True)
    async def _call(self, provider, system, prompt, max_tokens, temperature):
        return await provider.complete(system, prompt, max_tokens=max_tokens,
                                       temperature=temperature)


_router: LLMRouter | None = None


def get_llm_router() -> LLMRouter:
    global _router
    if _router is None:
        _router = LLMRouter()
    return _router
