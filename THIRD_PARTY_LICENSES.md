# Third-Party Licenses & Data-Source Notice

> **Not legal advice.** This is an engineering inventory for due-diligence. Have
> counsel and your exchange/market-data team confirm before commercial launch.
> Versions below are indicative (latest resolved at audit time); license terms are
> stable across the pinned ranges in `requirements.txt` / `package.json`.

Generated with `pip-licenses` (backend) and `license-checker` (frontend).
See **Regenerating this report** at the end.

## Summary

All bundled software dependencies use **permissive** licenses (MIT, BSD, Apache-2.0,
0BSD, Unlicense). **No GPL/AGPL/copyleft** in the runtime — nothing forces source
disclosure or royalties for commercial or free distribution. The only non-permissive
item is `psycopg2-binary` (**LGPL**), which is used as a dynamically-linked driver and
imposes no obligation on application code.

The material commercial-use considerations are **data sources**, not the libraries —
see the Data-source notice below.

## Backend (Python — runtime)

| Package | License |
|---|---|
| fastapi | MIT |
| uvicorn[standard] | BSD-3-Clause |
| pydantic | MIT |
| pydantic-settings | MIT |
| SQLAlchemy | MIT |
| httpx | BSD-3-Clause |
| feedparser | BSD |
| APScheduler | MIT |
| python-dotenv | BSD-3-Clause |
| tenacity | Apache-2.0 |
| PyJWT | MIT |
| bcrypt | Apache-2.0 |
| email-validator | The Unlicense (public domain) |
| psycopg2-binary | **LGPL** (dynamically linked driver — no app-code obligation) |
| openpyxl | MIT |
| python-multipart | Apache-2.0 |
| pypdf | BSD-3-Clause |
| reportlab | BSD (open-source ReportLab Toolkit; *not* the paid "ReportLab PLUS") |
| anthropic | MIT |
| openai | Apache-2.0 |
| google-generativeai | Apache-2.0 |
| kiteconnect | MIT |

### Backend (dev/test only — not shipped at runtime)
| Package | License |
|---|---|
| pytest | MIT |
| pytest-asyncio | Apache-2.0 / MIT |

## Frontend (JavaScript — production dependencies)

| Package | License |
|---|---|
| react, react-dom, scheduler | MIT |
| loose-envify, js-tokens | MIT |
| @capacitor/core, app, status-bar, splash-screen, haptics, push-notifications | MIT |
| tslib | 0BSD |

(`ai-investment-intelligence-web` shows as "UNLICENSED" — that is this project's own
private package marker, intentional; it is not a third-party dependency.)

### Frontend (dev/build only)
| Package | License |
|---|---|
| vite, @vitejs/plugin-react | MIT |
| @capacitor/cli, @capacitor/ios, @capacitor/android | MIT |

## Fonts & icons
- UI uses **system fonts** (Segoe UI / Inter / system-ui as fallbacks) — none bundled.
- App icon is a project-authored SVG; currency/score glyphs are Unicode. No proprietary
  icon font is shipped.

## Data-source notice (the real commercial-use items)

These concern **data rights**, separate from software licenses, and apply whether the
app is free or paid:

- **Yahoo Finance adapter** (`app/data/yahoo.py`) — *development/demo only, not
  exchange-licensed*. Yahoo's terms prohibit commercial/business redistribution.
- **NSE public endpoints** (`app/data/nse.py`) — unofficial; commercial/public display
  of exchange quotes requires an exchange/vendor **data license**.
- **Index names & values** — "NIFTY", "SENSEX", "BANKEX" are trademarks of
  NSE Indices Ltd / BSE (Asia Index); commercial/public display of index data &
  constituents typically needs a licence from the index owner.
- **News (RSS)** — linking headlines to the source is generally fine; reproducing
  full article text is not.
- **LLM providers** (Anthropic / OpenAI / Google) — commercial use is permitted under
  the paid API terms; follow their usage policies and keep the AI-output disclaimers.

**Production guardrail.** The unlicensed fallbacks (NSE public + Yahoo) are disabled
automatically when `ENVIRONMENT=production` (or via `ALLOW_UNLICENSED_MARKET_DATA=false`).
In that mode the app serves market data **only** from configured, licensed broker feeds
(Kite / SmartAPI / Upstox). See `app/data/aggregator.py` and `app/config.py`.

## Regenerating this report

Backend (from `backend/`, venv active):
```
pip install pip-licenses
pip-licenses --format=markdown --with-urls --output-file=../THIRD_PARTY_LICENSES_backend.md
```

Frontend (from `frontend/`):
```
npx license-checker --production --summary
npx license-checker --production --csv --columns name,version,licenses,repository
```
