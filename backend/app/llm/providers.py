"""Concrete LLM providers: Anthropic Claude, OpenAI GPT, Google Gemini."""
import asyncio
import hashlib
import logging

log = logging.getLogger(__name__)

# Reused Gemini explicit-cache handles: (model, system-hash) -> (cache, expires)
_gemini_caches: dict = {}

from app.config import get_settings
from app.llm.base import LLMProvider, LLMResponse


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self, model=None):
        s = get_settings()
        self._key, self._model = s.anthropic_api_key, model or s.anthropic_model
        self._client = None
        if self._key:
            from anthropic import AsyncAnthropic
            self._client = AsyncAnthropic(api_key=self._key)

    def available(self) -> bool:
        return self._client is not None

    async def complete(self, system, prompt, max_tokens=1024, temperature=0.3, cache=False):
        # When caching is on, mark the (stable) system prompt as an ephemeral
        # cache breakpoint so repeated calls reuse it (cheaper input tokens,
        # lower latency). Anthropic caches a prefix only if it is long enough;
        # if it is too short this is simply a no-op.
        sys_param = system
        if cache and system:
            sys_param = [{"type": "text", "text": system,
                          "cache_control": {"type": "ephemeral"}}]
        msg = await self._client.messages.create(
            model=self._model, max_tokens=max_tokens, temperature=temperature,
            system=sys_param, messages=[{"role": "user", "content": prompt}],
        )
        u = msg.usage
        usage = {"input_tokens": u.input_tokens, "output_tokens": u.output_tokens}
        for f in ("cache_creation_input_tokens", "cache_read_input_tokens"):
            v = getattr(u, f, None)
            if v is not None:
                usage[f] = v
        return LLMResponse(
            text=msg.content[0].text, provider=self.name, model=self._model, usage=usage,
        )


class OpenAIProvider(LLMProvider):
    name = "openai"

    def __init__(self, model=None):
        s = get_settings()
        self._key, self._model = s.openai_api_key, model or s.openai_model
        self._client = None
        if self._key:
            from openai import AsyncOpenAI
            self._client = AsyncOpenAI(api_key=self._key)

    def available(self) -> bool:
        return self._client is not None

    async def complete(self, system, prompt, max_tokens=1024, temperature=0.3, cache=False):
        kwargs = dict(
            model=self._model, max_tokens=max_tokens, temperature=temperature,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": prompt}],
        )
        if cache and system:
            # OpenAI caches prompts over ~1024 tokens automatically; a stable
            # cache key routes identical system prefixes to the same cache for
            # higher hit rates. Sent via extra_body so older SDKs don't choke.
            key = "sys-" + hashlib.sha256(system.encode("utf-8")).hexdigest()[:32]
            kwargs["extra_body"] = {"prompt_cache_key": key}
        resp = await self._client.chat.completions.create(**kwargs)
        usage = dict(resp.usage) if resp.usage else {}
        try:
            cached = resp.usage.prompt_tokens_details.cached_tokens
            if cached is not None:
                usage["cached_input_tokens"] = cached
        except Exception:
            pass
        return LLMResponse(
            text=resp.choices[0].message.content, provider=self.name, model=self._model,
            usage=usage,
        )


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self, model=None):
        s = get_settings()
        self._key, self._model_name = s.google_api_key, model or s.gemini_model
        self._model = None
        if self._key:
            import google.generativeai as genai
            genai.configure(api_key=self._key)
            self._genai = genai

    def available(self) -> bool:
        return bool(self._key)

    async def complete(self, system, prompt, max_tokens=1024, temperature=0.3, cache=False):
        gen_cfg = {"max_output_tokens": max_tokens, "temperature": temperature}
        if cache and system:
            # Explicit context caching of the (stable) system instruction. Falls
            # back to a normal call if the prefix is too short to cache or the
            # SDK/model doesn't support it. 2.5 models also cache implicitly.
            try:
                model = await asyncio.to_thread(self._cached_model, system)
                resp = await asyncio.to_thread(
                    model.generate_content, prompt, generation_config=gen_cfg)
                return self._wrap(resp)
            except Exception as e:
                log.warning("Gemini cache unavailable (%s); sending uncached",
                            (str(e).splitlines() or [""])[0][:120])
        model = self._genai.GenerativeModel(self._model_name, system_instruction=system)
        resp = await asyncio.to_thread(
            model.generate_content, prompt, generation_config=gen_cfg)
        return self._wrap(resp)

    def _model_path(self):
        m = self._model_name
        return m if m.startswith("models/") else "models/" + m

    def _cached_model(self, system):
        import datetime
        key = (self._model_name, hashlib.sha256(system.encode("utf-8")).hexdigest())
        now = datetime.datetime.utcnow()
        ent = _gemini_caches.get(key)
        if ent and ent[1] > now:
            cc = ent[0]
        else:
            cc = self._genai.caching.CachedContent.create(
                model=self._model_path(), system_instruction=system,
                ttl=datetime.timedelta(minutes=10))
            _gemini_caches[key] = (cc, now + datetime.timedelta(minutes=9))
        return self._genai.GenerativeModel.from_cached_content(cached_content=cc)

    def _wrap(self, resp):
        usage = {}
        um = getattr(resp, "usage_metadata", None)
        if um is not None:
            for src, dst in (("prompt_token_count", "input_tokens"),
                             ("candidates_token_count", "output_tokens"),
                             ("cached_content_token_count", "cached_input_tokens")):
                v = getattr(um, src, None)
                if v is not None:
                    usage[dst] = v
        return LLMResponse(text=resp.text, provider=self.name, model=self._model_name,
                           usage=usage)


class MockProvider(LLMProvider):
    """Used when no API key is configured, so the app still boots for dev/demo."""
    name = "mock"

    def available(self) -> bool:
        return True

    async def complete(self, system, prompt, max_tokens=1024, temperature=0.3, cache=False):
        return LLMResponse(
            text="[No LLM API key configured. Add ANTHROPIC_API_KEY, OPENAI_API_KEY "
                 "or GOOGLE_API_KEY to backend/.env to enable AI responses.]",
            provider=self.name, model="mock",
        )
