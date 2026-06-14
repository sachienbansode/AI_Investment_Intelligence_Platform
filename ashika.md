# ashika.md — Project Instructions

Working guide for the AI Investment Intelligence Platform (Ashika Group). Read this
before making changes; AI assistants and developers should follow these conventions.

## What this project is

Implementation of the BRD "AI Investment Intelligence Platform for Indian Broking &
Trading Application": AI assistant, agentic stock scoring, market news intelligence,
portfolio intelligence, and public APIs. See `README.md` for run instructions and
`docs/ACCOUNT_SETUP_GUIDE.md` for API account setup.

## Structure

```
backend/app/
  api/routes.py      → the 5 BRD APIs (/api/v1/*)
  agents/pipeline.py → 8-agent daily workflow (Market Data → … → Publishing)
  services/          → scoring (pure functions), assistant, portfolio, news_intel
  llm/               → provider abstraction + failover router (Claude/GPT/Gemini)
  data/              → market-data adapters (brokers > nse > yahoo fallback)
  core/compliance.py → AI disclaimer + audit logging
  core/auth.py       → JWT auth (swap get_current_user for SSO later)
  api/auth_routes.py → register/login/me (first user = admin)
  api/admin_routes.py→ audit browser, usage stats, score review, users
  db/database.py     → SQLAlchemy models (SQLite dev; Postgres via DATABASE_URL)
frontend/            → Vite + React web client
```

## Conventions

- Backend: Python 3.10+, FastAPI, async-first. New data sources implement
  `MarketDataProvider` (data/base.py); new LLMs implement `LLMProvider` (llm/base.py)
  and register in `llm/router.py`.
- Scoring weights live in `services/scoring.py` and must match the BRD
  (Fundamental 30, Technical 15, Valuation 15, Momentum 10, Earnings 10,
  News Sentiment 10, Institutional 5, Risk 5). Keep scoring functions pure and
  covered by `tests/test_scoring.py`.
- Config via `.env` only (see `.env.example`); never hard-code keys.
- Run tests with `cd backend && pytest` before committing.

## Compliance rules (do not remove)

- Every AI-generated payload must include the disclaimer from
  `core/compliance.py::AI_DISCLAIMER`.
- The assistant system prompt must keep its prohibition on buy/sell/hold
  recommendations, price targets, and personalized advice.
- All LLM calls, agent runs, and analyses must go through `audit_log()`.
- The Quality agent must gate scores before the Publishing agent stores them.
- No automated trade execution (out of scope per BRD).
- NSE/Yahoo public adapters are dev-only; production must use licensed feeds.
