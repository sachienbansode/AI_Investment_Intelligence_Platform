"""Application settings loaded from environment / .env."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # LLM providers
    anthropic_api_key: str = ""
    openai_api_key: str = ""
    google_api_key: str = ""
    llm_provider_order: str = "anthropic,openai,gemini"
    anthropic_model: str = "claude-sonnet-4-6"
    openai_model: str = "gpt-4o"
    gemini_model: str = "gemini-1.5-pro"

    # Broker APIs
    kite_api_key: str = ""
    kite_access_token: str = ""
    smartapi_key: str = ""
    smartapi_client_id: str = ""
    smartapi_access_token: str = ""
    upstox_access_token: str = ""

    # App
    database_url: str = "sqlite:///./broking_ai.db"
    jwt_secret: str = "dev-secret-change-in-production"
    environment: str = "development"
    scoring_universe: str = "RELIANCE,TCS,HDFCBANK,INFY,ICICIBANK"
    daily_scoring_hour: int = 7
    cors_origins: str = "http://localhost:5173,http://localhost:3000"
    # Where the immutable audit trail is written. In Docker, point this at a
    # mounted volume (e.g. /data/audit.log) so it survives container restarts.
    audit_log_path: str = "audit.log"
    # OpenAI embedding model for the broker-research RAG store. A deterministic
    # local fallback is used automatically when no OpenAI key is configured.
    embedding_model: str = "text-embedding-3-small"

    @property
    def provider_order(self) -> list[str]:
        return [p.strip() for p in self.llm_provider_order.split(",") if p.strip()]

    @property
    def universe(self) -> list[str]:
        return [s.strip().upper() for s in self.scoring_universe.split(",") if s.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
