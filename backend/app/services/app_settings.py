"""DB-backed application settings (Admin-editable), with safe defaults.

Settings live in the app_settings table as JSON values. Unknown keys are
rejected so the Admin UI can't break the app.
"""
import time

from app.db.database import AppSetting, SessionLocal

DEFAULTS: dict = {
    # BRD weights — must sum to 1.0
    "scoring_weights": {
        "fundamental": 0.30, "technical": 0.15, "valuation": 0.15,
        "momentum": 0.10, "earnings": 0.10, "news_sentiment": 0.10,
        "institutional": 0.05, "risk": 0.05,
    },
    "daily_scoring_hour": 7,          # 0-23 IST server time (restart to apply)
    # Maker-checker: when True, the pipeline publishes scores as 'pending' and a
    # human admin must approve each before it reaches users/the assistant.
    "strict_maker_checker": False,
    # Independent AI checker: a second LLM (different provider when available)
    # reviews every rationale for compliance + factual consistency before the
    # Quality Agent decides. Flagged items are rejected (or held pending).
    "ai_checker_enabled": True,
    "news_refresh_minutes": 30,       # scheduler interval (restart to apply)
    "max_news_items": 15,             # items per news refresh
    "assistant_history_messages": 6,  # prior messages given to the LLM
    "assistant_max_tokens": 900,
    # LLM pricing for INR billing estimates (USD per 1 MILLION tokens) —
    # update to your negotiated rates; estimates only, verify against invoices
    "llm_pricing": {
        "anthropic": {"input_usd_per_mtok": 3.0, "output_usd_per_mtok": 15.0},
        "openai": {"input_usd_per_mtok": 2.5, "output_usd_per_mtok": 10.0},
        "gemini": {"input_usd_per_mtok": 1.25, "output_usd_per_mtok": 5.0},
        "usd_inr": 84.0,
    },
    # Editable persona/behaviour prompt (compliance guardrails are appended
    # automatically in code and cannot be removed via settings)
    "assistant_system_prompt": (
        "You are the AI investment assistant inside an Indian broking app. "
        "You help customers understand markets, stocks, the platform's AI scores, "
        "news and their portfolios using the CONTEXT provided. Be warm, precise "
        "and confident. Keep answers SHORT and conclusive — lead with the answer, "
        "then at most 3-5 supporting bullets. Bold key numbers and symbols."
    ),
}

_cache: dict = {}
_cache_at: float = 0.0
_TTL = 30  # seconds


def all_settings() -> dict:
    global _cache, _cache_at
    if time.time() - _cache_at > _TTL:
        merged = dict(DEFAULTS)
        db = SessionLocal()
        try:
            for row in db.query(AppSetting).all():
                if row.key in DEFAULTS:
                    merged[row.key] = row.value
        finally:
            db.close()
        _cache, _cache_at = merged, time.time()
    return _cache


def get_setting(key: str):
    return all_settings().get(key, DEFAULTS.get(key))


def set_setting(key: str, value) -> None:
    global _cache_at
    if key not in DEFAULTS:
        raise KeyError(f"Unknown setting '{key}'. Allowed: {sorted(DEFAULTS)}")
    _validate(key, value)
    db = SessionLocal()
    try:
        row = db.get(AppSetting, key)
        if row:
            row.value = value
        else:
            db.add(AppSetting(key=key, value=value))
        db.commit()
    finally:
        db.close()
    _cache_at = 0.0  # invalidate cache


def _validate(key: str, value) -> None:
    if key == "scoring_weights":
        if not isinstance(value, dict) or set(value) != set(DEFAULTS["scoring_weights"]):
            raise ValueError("scoring_weights must contain exactly the 8 pillar keys")
        total = sum(float(v) for v in value.values())
        if abs(total - 1.0) > 0.001:
            raise ValueError(f"scoring_weights must sum to 1.0 (got {total:.3f})")
    elif key == "daily_scoring_hour":
        if not (isinstance(value, int) and 0 <= value <= 23):
            raise ValueError("daily_scoring_hour must be 0-23")
    elif key in ("strict_maker_checker", "ai_checker_enabled"):
        if not isinstance(value, bool):
            raise ValueError(f"{key} must be true or false")
    elif key in ("news_refresh_minutes", "max_news_items",
                 "assistant_history_messages", "assistant_max_tokens"):
        if not (isinstance(value, int) and value > 0):
            raise ValueError(f"{key} must be a positive integer")
    elif key == "assistant_system_prompt":
        if not (isinstance(value, str) and 20 <= len(value) <= 4000):
            raise ValueError("assistant_system_prompt must be a string of 20-4000 chars")
    elif key == "llm_pricing":
        if not (isinstance(value, dict) and "usd_inr" in value):
            raise ValueError("llm_pricing must be a dict including usd_inr")
        for k, v in value.items():
            if k == "usd_inr":
                if not (isinstance(v, (int, float)) and v > 0):
                    raise ValueError("usd_inr must be a positive number")
            elif not (isinstance(v, dict)
                      and all(isinstance(v.get(f), (int, float)) and v.get(f) >= 0
                              for f in ("input_usd_per_mtok", "output_usd_per_mtok"))):
                raise ValueError(f"llm_pricing.{k} needs input/output_usd_per_mtok numbers")
