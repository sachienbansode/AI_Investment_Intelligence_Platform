# AI Investment Intelligence Platform

Implementation of the BRD: conversational AI assistant, agentic stock scoring,
market news intelligence, portfolio intelligence, and public APIs for an Indian
broking & trading application.

> All AI outputs are informational only — not investment advice. Outputs are
> AI-generated and must be reviewed and approved before business or regulatory use.

## Architecture (per BRD)

```
Web/Mobile App → FastAPI (API Gateway) → AI Orchestration (LLM Router)
              → Agent Framework (8-agent daily pipeline) → Data Layer
Data: NSE/BSE adapters · Broker APIs (Kite/SmartAPI/Upstox) · RSS news · SQLite
LLMs: Anthropic Claude · OpenAI GPT · Google Gemini (auto-failover)
```

## Quick start

### Backend
```bash
cd backend
python -m venv .venv && .venv\Scripts\activate    # Windows
pip install -r requirements.txt
copy .env.example .env                             # then add your API keys
uvicorn app.main:app --reload --port 8000
```
API docs: http://localhost:8000/docs

### Frontend
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173 (proxies `/api` to the backend).

### First run
1. `GET /api/v1/health` — shows active LLM + data providers.
2. `POST /api/v1/admin/run-scoring` — triggers the 8-agent pipeline (also runs daily at 07:00).
3. `GET /api/v1/news?refresh=true` — pulls and AI-summarizes market news.

## Authentication

Email + password with JWT (12h tokens, bcrypt hashing). **Self-registration is
disabled.** Create the initial admin with `python scripts/create_admin.py`
(interactive — credentials are never stored in files); admins create further
users from the Admin → Users tab. All AI/portfolio/watchlist APIs require a
Bearer token; chat history is stored per user. Admins additionally get
`/api/v1/admin/*`: audit browser, LLM usage stats, score review (maker-checker),
and user management. Set a strong `JWT_SECRET` in production. To integrate your
trading app's SSO later, replace `get_current_user` in `backend/app/core/auth.py`.

## Database — PostgreSQL on AWS RDS

Default is SQLite for dev. For your AWS RDS Postgres:

1. Run `db/init_postgres.sql` against your RDS instance as the master user
   (edit the `broking_app` role password in the script first). It creates the
   `broking_ai` database, a least-privilege app role, and all 4 tables.
2. In `backend/.env` set:
   ```
   DATABASE_URL=postgresql+psycopg2://broking_app:YOUR_PASSWORD@your-rds-endpoint.rds.amazonaws.com:5432/broking_ai?sslmode=require
   ```
3. Ensure the RDS security group allows inbound 5432 from your server/IP.
4. Create the admin: `python scripts/create_admin.py` (interactive).
5. Start the backend.

## The 5 BRD APIs

| API | Endpoint |
|---|---|
| Ask AI | `POST /api/v1/ask` |
| Stock Score | `GET /api/v1/score/{symbol}`, `GET /api/v1/scores` |
| News Summary | `GET /api/v1/news` |
| Portfolio Analysis | `POST /api/v1/portfolio/analyze` |
| Watchlist Insights | `POST /api/v1/watchlist/insights` |

## Scoring weights (BRD)

Fundamental 30% · Technical 15% · Valuation 15% · Momentum 10% · Earnings 10% ·
News Sentiment 10% · Institutional 5% · Risk 5%. Pillars without a connected data
feed default to neutral (50) — see "Extending" below.

## DB-configurable platform

- **Instruments master** (`instruments` table) — seeded with NIFTY50 on first boot;
  add/disable scripts and include/exclude them from daily scoring via Admin → Instruments.
- **App settings** (`app_settings` table) — scoring weights, daily scoring hour, news
  refresh interval, assistant memory/tokens, editable via Admin → Settings
  (schedule changes apply after restart).
- **Watchlist** — per-user persistent watchlist (Watchlist tab).
- **Agents dashboard** (admin) — live view of the 8-bot pipeline: which agents are
  running, what each did (quotes fetched, news collected, scores published),
  scheduled jobs with next run times, and run history.

## Daily agent workflow (BRD)

Market Data → Financial Data → News → Sentiment → Scoring → Explainability →
Quality (validation gate) → Publishing. Implemented in `backend/app/agents/pipeline.py`,
scheduled via APScheduler.

## Compliance features

- AI disclaimer on every AI-generated payload (`app/core/compliance.py`)
- Structured audit log of every LLM call, agent run, and analysis (`audit.log`)
- Quality agent gates scores before publishing (maker-checker pattern)
- Assistant system prompt forbids buy/sell recommendations and price targets
- No automated trade execution (out of scope per BRD)

## Configuration

See `backend/.env.example`. Getting broker/data API accounts:
**docs/ACCOUNT_SETUP_GUIDE.md**.

## Contributing / AI assistants

Project conventions and compliance rules live in **ashika.md** — read it before
making changes.

## Tests

```bash
cd backend && pytest
```

## Extending toward production

- Connect fundamentals/earnings/institutional-holdings feeds (pillars currently neutral)
  in `app/agents/pipeline.py` (`financial_data_agent`)
- Swap SQLite → PostgreSQL (`DATABASE_URL`), add Redis caching for quotes
- Add authentication/consent management at the API gateway
- Vector store (pgvector/Qdrant) for full RAG over broker research & filings
- Phase 3 (BRD): voice AI, WhatsApp AI, expanded multilingual support
