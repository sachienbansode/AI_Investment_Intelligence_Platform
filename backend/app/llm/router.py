"""Multi-LLM router with admin-configurable provider order, per-provider model,
and failover or round-robin strategy. Every call is audit-logged (governance)."""
import asyncio
import logging

from app.config import get_settings
from app.core.compliance import audit_log
from app.llm.base import LLMResponse
from app.llm.providers import (AnthropicProvider, GeminiProvider, GroqProvider,
                                MockProvider, OpenAIProvider)

log = logging.getLogger(__name__)

_REGISTRY = {"anthropic": AnthropicProvider, "openai": OpenAIProvider,
             "gemini": GeminiProvider, "groq": GroqProvider}

# Error signatures that are worth retrying on the SAME provider. Everything else
# (quota / rate-limit / auth / invalid model) fails over to the next provider.
_TRANSIENT = ("timeout", "timed out", "connection", "connect", "temporarily",
              "overloaded", "503", "502", "504", "reset by peer", "read error")


def _is_transient(e: Exception) -> bool:
    m = str(e).lower()
    if any(k in m for k in ("quota", "rate limit", "rate_limit", "429",
                            "insufficient", "unauthorized", "401", "403",
                            "invalid api key", "authentication", "not found",
                            "404", "model")):
        return False
    return any(k in m for k in _TRANSIENT)


class LLMRouter:
    def __init__(self):
        self._clients = {}   # (name, model) -> provider instance (lazily built)
        self._rr = 0

    def _provider(self, name, model):
        key = (name, model)
        p = self._clients.get(key)
        if p is None:
            cls = _REGISTRY.get(name)
            if not cls:
                return None
            try:
                p = cls(model=model)
            except Exception as e:
                log.warning("Provider %s unavailable: %s", name, e)
                return None
            self._clients[key] = p
        return p

    def _config(self):
        from app.services.app_settings import get_setting
        order = get_setting("llm_provider_order") or get_settings().provider_order
        models = get_setting("llm_models") or {}
        strategy = get_setting("llm_strategy") or "failover"
        enabled = get_setting("llm_enabled") or {}
        # Configured order first, then EVERY other registered provider appended,
        # so any provider that has a valid key is always tried as automatic
        # failover (auto-switch to Anthropic/Gemini when, say, OpenAI's key is
        # missing or failing). Providers explicitly disabled by an admin are
        # still excluded. Keyless providers get filtered later by available().
        candidates = list(order) + [n for n in _REGISTRY if n not in order]
        candidates = [n for n in candidates if enabled.get(n, True)]
        return (candidates or order), models, strategy

    def _ordered(self, rotate=True):
        order, models, strategy = self._config()
        provs = []
        for name in order:
            p = self._provider(name, models.get(name))
            if p and p.available():
                provs.append(p)
        if not provs:
            return [MockProvider()]
        if rotate and strategy == "round_robin" and len(provs) > 1:
            self._rr = (self._rr + 1) % len(provs)
            provs = provs[self._rr:] + provs[:self._rr]
        return provs

    @property
    def active_providers(self) -> list[str]:
        return [p.name for p in self._ordered(rotate=False)]

    async def complete(self, system: str, prompt: str, *, task: str = "general",
                       max_tokens: int = 1024, temperature: float = 0.3,
                       exclude: str | None = None) -> LLMResponse:
        from app.services.app_settings import get_setting
        cache = bool(get_setting("prompt_caching_enabled"))
        providers = self._ordered()
        if exclude and any(p.name != exclude for p in providers):
            providers = ([p for p in providers if p.name != exclude]
                         + [p for p in providers if p.name == exclude])
        errors = []
        for provider in providers:
            try:
                resp = await self._call(provider, system, prompt, max_tokens, temperature, cache)
                audit_log("llm_call", task=task, provider=provider.name,
                          model=resp.model, usage=resp.usage)
                global _last_used
                _last_used = {"provider": provider.name, "model": resp.model, "task": task}
                return resp
            except Exception as e:
                msg = (str(e).splitlines() or [""])[0][:180]
                errors.append(f"{provider.name} -> {msg}")
                log.warning("Provider %s failed (%s); failing over", provider.name, e)
                audit_log("llm_failover", task=task, provider=provider.name, error=str(e))
        tried = ", ".join(p.name for p in providers) or "none configured"
        # Report EVERY provider's failure so the real cause is visible (not just
        # the last one). e.g. anthropic auth error vs openai quota.
        raise RuntimeError("All LLM providers failed. Tried: " + tried + ". "
                           + " | ".join(errors))

    async def _call(self, provider, system, prompt, max_tokens, temperature, cache=False):
        # Retry the SAME provider only for genuinely transient errors (network /
        # timeout / 5xx / overloaded). For quota, rate-limit or auth errors there is
        # no point retrying the same provider - reraise at once so complete() fails
        # over to the NEXT provider immediately.
        last = None
        for attempt in range(2):
            try:
                return await provider.complete(system, prompt, max_tokens=max_tokens,
                                               temperature=temperature, cache=cache)
            except Exception as e:
                last = e
                if not _is_transient(e):
                    raise
                await asyncio.sleep(1.0 * (attempt + 1))
        raise last


_router: LLMRouter | None = None
_last_used: dict | None = None   # provider+model of the most recent successful call


def get_llm_router() -> LLMRouter:
    global _router
    if _router is None:
        _router = LLMRouter()
    return _router


def last_used() -> dict | None:
    """Provider+model that actually answered the most recent successful LLM call."""
    return _last_used
