# PROJECT HANDOFF — AI Investment Intelligence Platform

> For Claude (or any developer) resuming this project in a new session/account.
> Read this + `ashika.md` (conventions & compliance rules) + `README.md` (run guide) first.

## What this is

A SEBI-compliant AI investment intelligence platform for Ashika Group (Indian broking),
built per the BRD in `AI_Investment_Intelligence_Platform_BRD.docx`. Owner: Sachin
(sachin.bansode@ashikagroup.com). Status: feature-complete pilot, running locally,
DB on AWS PostgreSQL.

## Stack & architecture (decided — do not change)

- **Backend**: Python FastAPI (`backend/`), SQLAlchemy, APScheduler. Python was
  questioned once and deliberately kept (AI ecosystem advantage; Node teams consume REST).
- **Frontend**: React + Vite (`frontend/`), no UI framework — custom design system in
  `src/styles.css` (dark theme, sidebar shell). Tiny safe-markdown renderer `src/md.js`,
  IST formatter `src/fmt.js` (format: DDMMMYYYY hh:mm:ss AM/PM, Asia/Kolkata everywhere).
- **DB**: PostgreSQL on AWS (`db/init_postgres.sql` fresh install; `db/upgrade_v2.sql`
  incremental; DB `broking_ai`, app role `broking_app`). SQLite fallback for dev.
  Tables: users, instruments, app_settings, watchlist_items, stock_scores, news_items,
  chat_messages, pipeline_runs.
- **LLMs**: Anthropic + OpenAI + Gemini with failover router (`app/llm/`), order via
  `LLM_PROVIDER_ORDER` in `.env`. Mock provider when no keys.
- **Market data**: broker APIs (Kite/SmartAPI/Upstox, keys in `.env`) → NSE public →
  Yahoo fallback (`app/data/`). NSE quote API 403-blocks datacenter IPs (works on
  office/home networks). BSE indices (SENSEX, BANKEX) come via Yahoo. News from RSS
  (ET, Moneycontrol, LiveMint, Business Standard).

## Features built (all working)

1. **AI Assistant** — chat with history sidebar (per-user, DB), multilingual, grounded
   in live quotes + approved scores + news + TOP_AI_SCORES ranking (answers "top N
   stocks by your AI score" factually). Suggestion chips, markdown bubbles, typing dots.
   Persona prompt editable in Admin → Settings; compliance guardrails appended in code
   (`app/services/assistant.py::GUARDRAILS`) — no advice, methodology confidential,
   brand-professional tone, complaints → support.
2. **Agentic scoring** — 8-agent daily pipeline (`app/agents/pipeline.py`): Market Data
   → Financial → News → Sentiment → Scoring → Explainability → Quality → Publishing.
   Parallel inside stages (8 quote fetchers, 5 LLM writers). BRD weights in
   `app/services/scoring.py`, admin-overridable via settings. Universe = instruments
   table (NIFTY50 seeded; NIFTY500 importable via Admin → Instruments button).
   Bullet-point rationales. Per-script on-demand rescore with delta + pillar drivers
   (`app/services/rescore.py`).
3. **Maker-checker** — Quality Agent auto-validates (rule-based); admins override in
   Admin → Score review (full history, per-run summary chips, filters, attribution).
   Only approved scores reach users/assistant. Strict human-approval mode discussed,
   NOT yet built.
4. **News intelligence** — RSS collection, LLM short/detailed summaries, impacted
   stocks/sectors, sentiment tags.
5. **Portfolio intelligence** — health score with transparent deduction breakdown,
   HHI concentration, sector exposure (sector fallback from instruments master),
   bullet AI insights, instrument search datalist.
6. **Watchlist** — per-user persistent, price + AI score.
7. **Dashboard** (default page) — KPIs, 7/30-day score trend chart (CSS bars), top
   gainers/decliners by score delta, top scores, news, watchlist strip.
8. **Agents page** (admin) — live pipeline view: per-agent status cards with real-time
   progress bars ("237/506 quotes fetched"), schedule frequencies + next runs (IST),
   run history, collapsible "How the pipeline works" explainer (why sequential).
9. **Audit page** (admin) — persistent pipeline_runs with unique run IDs, search/filter,
   expandable per-agent detail, Excel export (openpyxl, 2 sheets).
10. **Admin** — Usage stats, LLM billing (MTD/today/month-estimate INR from audit log ×
    configurable `llm_pricing` setting; Gemini tokens not captured = ₹0), Audit log
    (immutable `audit.log`, every LLM call/login/decision), Score review, Users
    (admin-creates-users only, no self-registration; `scripts/create_admin.py` or
    `db/create_admin.sql` for first admin), Instruments (CRUD + NIFTY500 import +
    scoring-universe toggles), Integrations (public endpoints full, own keys masked),
    Settings (weights, schedule, news, assistant prompt — DB-backed `app_settings`).
11. **UI conventions** — tooltips on every column/metric, pagination 20/page everywhere,
    IST timestamps, NSE/BSE ticker on separate badged rows (NIFTY 50 & SENSEX
    emphasized), About page (feature cards — keep updated when adding features).

## Compliance (non-negotiable — see ashika.md)

AI disclaimer on every AI payload; no buy/sell/hold advice anywhere (system prompts
enforce); audit_log() on all LLM calls/decisions; quality gate before publishing;
scoring methodology internals (weights/formulas) confidential in UI and chatbot;
no automated trade execution.

## Environment (user's machine)

- Windows + PowerShell 5.1 (no `&&`; execution policy blocks scripts → use
  `npm.cmd`, `Set-ExecutionPolicy -Scope Process Bypass`, or `.venv\Scripts\python.exe`).
- Python 3.12 at `$env:LOCALAPPDATA\Programs\Python\Python312\python.exe` (`python`/`py`
  aliases broken — Store alias shadows). venv at `backend/.venv`.
- Run: backend `python -m uvicorn app.main:app --reload --port 8000` (venv active),
  frontend `npm.cmd run dev` → http://localhost:5173.
- `.env` holds all secrets (LLM keys, DATABASE_URL, JWT_SECRET) — NEVER move/share it;
  recreate from `.env.example` if needed. postgres:// URLs auto-normalized.

## Done in v0.3 (Jun 2026)

- **AWS deployment package** — `docker-compose.prod.yml` (backend + nginx frontend on
  :80), `frontend/Dockerfile` + `frontend/nginx.conf` (serves SPA, proxies /api),
  `deploy/aws-ec2-setup.sh` (one-shot EC2 bootstrap), `DEPLOY_AWS.md` runbook. Audit
  log path is now configurable (`AUDIT_LOG_PATH`) and persisted on a Docker volume.
- **Strict maker-checker mode** — `strict_maker_checker` setting (Admin → Settings).
  When ON, Quality Agent publishes scores as `pending`; only human approval in
  Score review promotes them to `approved` (and thus to users/assistant).
- **Independent AI checker** — `ai_checker_agent` runs between explainability and
  quality. A second LLM (different provider when 2+ configured; `exclude=` in the
  router) reviews each rationale for advice/methodology leakage/factual consistency.
  Verdict stored in `stock_scores.ai_review`, shown in Score review. Toggle:
  `ai_checker_enabled`. Checker errors fail safe (flag → human review).
- **Broker-research RAG** — `app/services/research.py` + `app/llm/embeddings.py`
  (OpenAI embeddings with a deterministic hashed fallback when no key). Tables
  `research_documents` / `research_chunks` (embedding stored as JSON; search compares
  only equal-dimension vectors). Admin → Research (RAG): upload PDF/txt/md or paste
  text. Retrieval wired into `assistant.ask()` as cited BROKER_RESEARCH context with a
  guardrail (report factually, never as advice). Postgres: run `db/upgrade_v3.sql`.

## Known gaps / agreed next steps

1. Fundamental (30%), Earnings (10%), Institutional (5%) pillars are neutral-50 —
   no data feed yet. **Highest-value next build** (corporate filings/earnings/FII-DII).
2. Licensed data feeds for production (see docs/ACCOUNT_SETUP_GUIDE.md); NSE/Yahoo are
   dev-grade. Broker API keys not yet configured.
3. RAG retrieval is a linear in-Python cosine scan over all chunks — fine for a pilot
   (hundreds–thousands of chunks). Move to pgvector / a vector DB for scale, and add
   re-indexing when switching embedding backends (old hashed vectors won't match new
   OpenAI vectors; dimensions are filtered, not auto-migrated).
4. Production hardening (TLS/ALB, Secrets Manager, RDS backups, monitoring) — see the
   "Going beyond the pilot" section in DEPLOY_AWS.md. Consent management, Phase 3
   (voice, WhatsApp) still pending.
5. LLM pricing defaults are placeholders — set real rates in `llm_pricing` setting.

## Quirks to remember

- A 500-script pipeline run takes minutes (quotes ~30s parallel; ~500 explanation LLM
  calls). Watch Agents tab. Daily run at hour set in settings (default 07:00 server time).
- Scores appear only after a pipeline run; new instruments are unscored until next run.
- `audit.log` rotates at 10MB ×10; LLM billing reads current month from it.
- First registered-in-DB admin created via script/SQL; admins create everyone else.
