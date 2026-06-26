# CLAUDE.md — AI Investment Intelligence Platform

> **Read this first.** This is the authoritative project-context document for Claude
> (Cowork / Claude Code) resuming or taking over this project in a new session or account.
> It supersedes the older `HANDOFF.md` (pre-v0.3) where they disagree. Also skim
> `SESSION_HANDOFF.md` (latest deltas + open items), `niytri.md` (conventions &
> compliance), `README.md` (run guide) and `DEPLOY_AWS.md`.

## 1. What this is

A SEBI-compliant **AI investment intelligence platform** for an Indian broking firm
(NIYTRI), built to the BRD in `AI_Investment_Intelligence_Platform_BRD.docx`.
Owner: **Ashish (Ashish@niytri.com)**. Vendor branding: **NIYTRI Technologies**.
Status: feature-complete pilot. App runs on AWS EC2 (systemd + nginx + HTTPS), PostgreSQL
on AWS RDS. Domain: **dev-invest.niytri.com** (IP 15.207.97.16).

It is an **information / analytics** product, NOT an advice engine. Every AI surface is
wrapped in compliance guardrails: no buy/sell/hold calls, no price targets, no
personalised advice; scoring methodology is confidential; outputs are non-authoritative
and subject to maker-checker review.

## 2. Stack & architecture (decided — do not change without asking Ashish)

- **Backend**: Python **FastAPI** (`backend/app`), SQLAlchemy ORM, APScheduler (IST jobs
  with catch-up). Entry: `app/main.py`. API prefix `/api/v1`. ~60 endpoints across
  `api/routes.py` (core), `api/admin_routes.py` (admin), `api/auth_routes.py` (login/me).
- **Frontend**: **React + Vite** (`frontend/src`), no UI framework — custom design system
  in `src/styles.css` (dark/light theme, sidebar shell, responsive). Helpers: `src/api.js`
  (all HTTP calls), `src/md.js` (safe markdown), `src/fmt.js` (IST formatting).
  Built with `npm run build` → static `dist/` served by nginx from `/var/www/broking-ai`.
- **DB**: **PostgreSQL on AWS RDS** (`db/init_postgres.sql` fresh; `db/upgrade_v2..v5.sql`
  incremental). SQLite fallback for dev. `init_db()` in `app/db/database.py` runs idempotent
  Postgres auto-heal `ALTER`s on boot (added columns like `stock_scores.ai_review`,
  roles, portfolios) so deploys don't need manual migrations. **Tables**: users, roles,
  instruments, app_settings, watchlist_items, portfolios, pipeline_runs, stock_scores,
  news_items, research_documents, research_chunks, chat_messages.
- **LLMs**: Anthropic + OpenAI + Gemini via failover/round-robin router (`app/llm/router.py`).
  Mock provider when no keys. Order/strategy/model/enabled all admin-configurable (see §5).
- **Market data**: broker APIs (Kite/SmartAPI/Upstox) → NSE public → **Yahoo** fallback
  (`app/data/aggregator.py`). ⚠️ NSE quote API **403-blocks datacenter IPs** (works on
  office/home networks, fails on EC2) — Yahoo covers EC2. BSE indices (SENSEX, BANKEX)
  and all global indices come via Yahoo. News via RSS (`app/data/rss_news.py`).
- **RAG**: broker-research store (`app/services/research.py`, `app/llm/embeddings.py`) —
  admins upload PDFs/text in Admin → Research; chunks embedded (OpenAI embeddings, hashed
  fallback) and retrieved to ground the assistant. Cited as reference material only.

## 3. Repo layout

```
backend/app/
  main.py            FastAPI app, scheduler, init_db
  config.py          env settings (pydantic-settings)
  api/               routes.py, admin_routes.py, auth_routes.py
  agents/pipeline.py 8-agent daily scoring pipeline + live snapshot
  core/              auth.py (JWT, RBAC), compliance.py (AI_DISCLAIMER, audit_log)
  data/              aggregator, nse, yahoo, brokers, rss_news, base
  db/database.py     SQLAlchemy models + init_db auto-heal + seeds
  llm/               router, providers, base, embeddings
  models/schemas.py  pydantic request/response models
  services/          assistant, scoring, rescore, news_intel, portfolio,
                     portfolio_pdf, research, app_settings
frontend/src/
  App.jsx            shell, nav (RBAC pages), ticker, theme, branding
  api.js             every backend call
  components/        Dashboard, Assistant, Scores, News, Watchlist, Portfolio,
                     Agents, Admin, RunAudit, About, Login, Pager
db/                  init_postgres.sql, upgrade_v2..v5.sql, create_admin.sql
deploy/              setup-ec2-no-docker.sh, broking-backend.service,
                     nginx-broking.conf, Caddyfile, redeploy.sh, deploy-from-laptop.sh
.github/workflows/   ci.yml (lint/build check)
presentation/        investor PPTX + briefing DOCX (v1.1, NIYTRI branding)
```

## 4. Features built (current — through v0.5)

1. **AI Assistant** (`services/assistant.py`) — per-user chat history (DB), multilingual,
   grounded in live quotes + approved AI scores + 3-day news + RAG research. Gives a full
   **score distribution** (avg/min/max + bands 65+/50-64/<50 + TOP_10 & BOTTOM_10) so
   "stocks below 50" type questions are answered correctly. **Dynamic confidence** from
   grounding signals. **Compare two stocks** panel (`compare_stocks()` + `GET /compare`):
   side-by-side metrics + advice-free AI summary. Persona prompt editable in Admin;
   `GUARDRAILS` appended in code and cannot be removed via settings. Provider hidden in
   the chat UI but recorded in DB.
2. **Agentic scoring** (`agents/pipeline.py`) — 8 stages: Market Data → Financial → News →
   Sentiment → Scoring → Explainability → Quality → Publishing. Parallel within stages.
   Weights in `services/scoring.py`, admin-overridable. Universe = instruments table
   (NIFTY50 seeded; NIFTY500 importable in Admin → Instruments). Per-script on-demand
   rescore with delta + pillar drivers (`services/rescore.py`).
3. **Maker-checker** — Quality Agent auto-validates; **strict mode** (`strict_maker_checker`)
   holds scores as *pending* for human approval in Admin → Score review. Optional
   **independent AI checker** (`ai_checker_enabled`): a second LLM reviews each rationale.
4. **News intelligence** — RSS collection, LLM short/detailed summaries, impacted
   stocks/sectors, sentiment. Paginated (10/page). 3-day window for assistant context.
5. **Portfolio intelligence** (`services/portfolio.py`) — health score with transparent
   deductions, HHI concentration, sector exposure, Red/Amber/Green status + headline,
   approximate P&L. CSV/XLSX upload with matched/unmatched validation + confirm;
   per-user persistence (auto-restores AND re-runs last analysis on load); downloadable
   template (all NIFTY500 + current LTP). **PDF export** (`services/portfolio_pdf.py`,
   reportlab) → `POST /portfolio/report.pdf`.
6. **Watchlist** — per-user, price + AI score.
7. **Dashboard** — KPIs, **sector strength heatmap** (avg score per sector, RAG-coloured),
   7/30-day score trend, top gainers/decliners, top scores, news, watchlist strip.
   Clicking a script opens it in Stock Scores.
8. **Stock Scores** — sortable table (by script / change), "change" shown as number AND %.
9. **Agents page** (admin) — live pipeline status, schedules + next runs (IST), run
   history. Run Scoring + Refresh News live here (background, with status notes).
10. **Admin** — Users, **RBAC roles** (page-level access; seeded "User" role), Instruments,
    Score review, Settings (weights, prompt, maker-checker, **LLM routing incl.
    enable/disable per provider**, **global markets toggle**, **branding/logo upload**),
    Research (RAG), Chat audit, Pipeline runs export (XLSX), LLM usage, llm-test.
11. **Global markets** (admin toggle `global_markets_enabled`) — adds global indices
    (S&P500/Nasdaq/Dow/FTSE/Nikkei/HangSeng via Yahoo, labelled "(GL)", shown in a GLOBAL
    ticker row) and global news (CNBC/Yahoo/Investing) on next refresh.
12. **Branding** — admin uploads a logo (stored as base64 data URI in `app_settings`,
    public `GET /branding`); used as app logo + favicon. Default is the ₹ icon.

## 5. App settings (DB-backed, admin-editable)

`services/app_settings.py` holds a `DEFAULTS` dict + validation; unknown keys rejected.
Stored in `app_settings` table as JSON, 30s cache. Key ones: `scoring_weights` (8 pillars,
sum=1.0), `daily_scoring_hour`, `strict_maker_checker`, `ai_checker_enabled`,
`news_refresh_minutes`, `max_news_items`, `assistant_history_messages`,
`assistant_max_tokens`, `assistant_system_prompt`, `brand_logo`, `llm_provider_order`,
`llm_strategy` (failover|round_robin), `llm_models`, **`llm_enabled`** (per-provider on/off),
**`global_markets_enabled`**, `llm_pricing`. Adding a setting = add to DEFAULTS + a
`_validate` branch; it then appears via `GET /admin/settings` and is saved via
`PUT /admin/settings`.

## 6. Environment (`backend/.env`, never committed — see `.gitignore`)

`anthropic_api_key`, `openai_api_key`, `google_api_key`, `llm_provider_order`,
`*_model`, broker keys (`kite_*`, `smartapi_*`, `upstox_*`), `database_url`
(SQLAlchemy URL `postgresql+psycopg2://...`), `jwt_secret`, `environment`,
`cors_origins`, `daily_scoring_hour`, `embedding_model`.
⚠️ `database_url` is a SQLAlchemy URL — **psql can't parse the `+psycopg2`**; strip it
or use pgAdmin for raw SQL.

## 7. Deploy (AWS EC2, no Docker)

Bare uvicorn on 127.0.0.1:8000 behind nginx (static `dist/` + `/api` proxy), HTTPS via
certbot. Repo cloned under `/home/ubuntu/AI_Investment_Intelligence_Platform/...`.
**Always give full `cd` paths for BOTH laptop and AWS** (Ashish's standing rule).
PowerShell on the laptop does NOT support `&&` — use separate lines.

```
# laptop
cd D:\broking-ai-bot
git add -A
git commit -m "..."
git push

# AWS
cd /home/ubuntu/AI_Investment_Intelligence_Platform/AI_Investment_Intelligence_Platform
git pull
# backend changed:
cd backend && source .venv/bin/activate && pip install -r requirements.txt   # only if deps changed
sudo systemctl restart broking-backend
# frontend changed:
cd ../frontend && npm run build && sudo cp -r dist/* /var/www/broking-ai/
```
First-time clone needs `sudo chown -R ubuntu:ubuntu` (was cloned as root). Log to
`~/backend.log` (not /tmp). `npm install` before first build (vite not global).

## 8. ⚠️ CRITICAL working conventions (learn from prior pain)

- **The Edit/Write tools TRUNCATE large files** on this mounted folder (~5.6 KB cut, and
  multibyte glyphs like ▲ ₹ get corrupted). This has repeatedly broken `routes.py`,
  `App.jsx`, `styles.css`, `Admin.jsx`. **For any file bigger than a few KB, edit via the
  bash shell** (python heredoc / `sed`), author in `/tmp` and `cp` to the mount, then
  verify with `py_compile` / esbuild parse. Use `String.fromCharCode(0x20B9)` etc. for
  glyphs in JSX, never literal multibyte characters. If a large file gets truncated,
  restore with `git show HEAD:path > path` and re-apply via bash.
- **Validating the frontend build in the sandbox**: `npm run build` FAILS in the Linux
  sandbox because `node_modules` was installed on Windows (rollup/esbuild native binary
  mismatch). This is NOT a code error. To check JSX syntax, install esbuild in /tmp
  (`cd /tmp && npm i esbuild`) and pipe files: `esbuild --loader=jsx --format=esm < file`.
  The real `vite build` runs on the laptop / AWS.
- **Compliance is non-negotiable**: keep `GUARDRAILS` in `assistant.py`; keep the
  `AI_DISCLAIMER` and the "AI-generated... not investment advice" footer; every generated
  business doc should carry "This output is AI-generated and must be reviewed before
  business use." Never add buy/sell/hold logic or price targets.
- **Path mapping (bash sandbox vs Windows)**: `D:\broking-ai-bot` ⇄
  `/sessions/<id>/mnt/broking-ai-bot`. Use absolute paths; each bash call is independent.
- Keep IST (Asia/Kolkata) for all timestamps.

## 9. Version history (recent)

- **v0.3** — AWS deploy package (systemd+nginx+certbot), strict maker-checker, AI checker,
  broker-research RAG, RBAC, git/CI/HTTPS, responsive + theme toggle.
- **v0.4** — assistant score-distribution + dynamic confidence + 3-day news, LLM
  enable/disable, saved portfolio analysis, global-markets toggle.
- **v0.5** — sector heatmap, compare-two-stocks, portfolio PDF export (reportlab).

- **v0.6** — assistant replies now LEAD with a highlighted "Bottom line"
  callout (md.js blockquote + `.md .callout`), key data bolded. **Hard
  server-side session enforcement**: 15-min access token (only credential
  the API accepts) + 60-min sliding refresh token (`POST /auth/refresh`,
  rotated, carries original-login `lia`) + 12-hour absolute cap; constants in
  `core/auth.py` (`ACCESS_TTL_MINUTES`/`IDLE_TTL_MINUTES`/`MAX_SESSION_HOURS`).
  Frontend silently refreshes only while active and stores both tokens in
  sessionStorage. Deploy logs everyone out once. See `SESSION_HANDOFF.md`.

## 10. Suggested next steps (not yet built)

Alerts when a watchlist stock's AI score crosses a threshold; scheduled email/PDF
portfolio digests; broker-feed live integration (replace Yahoo on EC2); deeper sector
analytics; per-user notification preferences.
