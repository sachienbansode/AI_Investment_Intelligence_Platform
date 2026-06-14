"""Concrete LLM providers: Anthropic Claude, OpenAI GPT, Google Gemini."""
import asyncio

from app.config import get_settings
from app.llm.base import LLMProvider, LLMResponse


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self):
        s = get_settings()
        self._key, self._model = s.anthropic_api_key, s.anthropic_model
        self._client = None
        if self._key:
            from anthropic import AsyncAnthropic
            self._client = AsyncAnthropic(api_key=self._key)

    def available(self) -> bool:
        return self._client is not None

    async def complete(self, system, prompt, max_tokens=1024, temperature=0.3):
        msg = await self._client.messages.create(
            model=self._model, max_tokens=max_tokens, temperature=temperature,
            system=system, messages=[{"role": "user", "content": prompt}],
        )
        return LLMResponse(
            text=msg.content[0].text, provider=self.name, model=self._model,
            usage={"input_tokens": msg.usage.input_tokens, "output_tokens": msg.usage.output_tokens},
        )


class OpenAIProvider(LLMProvider):
    name = "openai"

    def __init__(self):
        s = get_settings()
        self._key, self._model = s.openai_api_key, s.openai_model
        self._client = None
        if self._key:
            from openai import AsyncOpenAI
            self._client = AsyncOpenAI(api_key=self._key)

    def available(self) -> bool:
        return self._client is not None

    async def complete(self, system, prompt, max_tokens=1024, temperature=0.3):
        resp = await self._client.chat.completions.create(
            model=self._model, max_tokens=max_tokens, temperature=temperature,
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": prompt}],
        )
        return LLMResponse(
            text=resp.choices[0].message.content, provider=self.name, model=self._model,
            usage=dict(resp.usage) if resp.usage else {},
        )


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self):
        s = get_settings()
        self._key, self._model_name = s.google_api_key, s.gemini_model
        self._model = None
        if self._key:
            import google.generativeai as genai
            genai.configure(api_key=self._key)
            self._genai = genai

    def available(self) -> bool:
        return bool(self._key)

    async def complete(self, system, prompt, max_tokens=1024, temperature=0.3):
        model = self._genai.GenerativeModel(self._model_name, system_instruction=system)
        resp = await asyncio.to_thread(
            model.generate_content, prompt,
            generation_config={"max_output_tokens": max_tokens, "temperature": temperature},
        )
        return LLMResponse(text=resp.text, provider=self.name, model=self._model_name)


class MockProvider(LLMProvider):
    """Used when no API key is configured, so the app still boots for dev/demo."""
    name = "mock"

    def available(self) -> bool:
        return True

    async def complete(self, system, prompt, max_tokens=1024, temperature=0.3):
        return LLMResponse(
            text="[No LLM API key configured. Add ANTHROPIC_API_KEY, OPENAI_API_KEY "
                 "or GOOGLE_API_KEY to backend/.env to enable AI responses.]",
            provider=self.name, model="mock",
        )
