# Account Setup Guide — Market Data & Broker APIs

Step-by-step instructions to obtain API credentials. These accounts require your
organization's KYC/registration, so they must be created by you (or your IT/compliance
team) — but each takes only 15–30 minutes. After getting keys, paste them into
`backend/.env` (copy from `.env.example`) and restart the backend.

> Compliance note: as a SEBI-regulated broker, use exchange-licensed feeds for any
> customer-facing production data. The free NSE-website adapter included in this repo
> is for development/demo only. Confirm data redistribution rights with NSE/BSE for
> your usage tier.

---

## 1. Zerodha Kite Connect (recommended for licensed real-time quotes)

1. Open a Zerodha account if you don't have one: https://zerodha.com (your firm may instead use a corporate/partner arrangement).
2. Go to https://developers.kite.trade and sign in with your Zerodha credentials.
3. Click **Create new app** → choose type **Connect**.
   - App name: `Ashika AI Intelligence` (any name)
   - Redirect URL: `http://localhost:8000/callback` (for dev)
4. Pay the monthly API subscription (check current pricing on the portal).
5. You receive an **API key** and **API secret**.
6. Generate a daily **access token**: complete the login flow once per day
   (`kiteconnect` SDK: `kite.login_url()` → exchange `request_token` for `access_token`).
7. Set in `.env`: `KITE_API_KEY`, `KITE_ACCESS_TOKEN`.

Docs: https://kite.trade/docs/connect/v3/

## 2. Angel One SmartAPI (free tier available)

1. Open https://smartapi.angelone.in and click **Sign Up** (needs an Angel One trading account — open at https://www.angelone.in if needed).
2. After signup, go to **My Apps → Create an App** → choose **Market Feeds / Trading**.
   - Redirect URL: `http://localhost:8000/callback`
3. You receive an **API key** instantly.
4. Generate a session: login via SmartAPI using client ID + PIN + TOTP
   (enable TOTP at https://smartapi.angelone.in/enable-totp) to get a **JWT access token**.
5. Set in `.env`: `SMARTAPI_KEY`, `SMARTAPI_CLIENT_ID`, `SMARTAPI_ACCESS_TOKEN`.

Docs: https://smartapi.angelone.in/docs

## 3. Upstox API

1. Open an Upstox account: https://upstox.com.
2. Go to https://account.upstox.com/developer/apps → **New App**.
   - Redirect URL: `http://localhost:8000/callback`
3. Note the **API key** and **secret**; check current pricing/free-tier terms.
4. Complete the OAuth login flow once to obtain an **access token** (valid for the day).
5. Set in `.env`: `UPSTOX_ACCESS_TOKEN`.

Docs: https://upstox.com/developer/api-documentation

## 4. NSE / BSE official data (production licensing)

For production-grade licensed data (the BRD targets 100k+ concurrent users):

- **NSE Data & Analytics** (formerly DotEx): https://www.nseindia.com/market-data — apply
  as a data vendor/redistributor; real-time, snapshot, and EOD products.
- **BSE Data licensing**: https://www.bseindia.com — Market data products via BSE's
  data dissemination arm.
- Alternatively, authorized vendors: TrueData, Global Datafeeds (NimbleData), Refinitiv,
  Bloomberg — faster onboarding than direct exchange agreements.

Your compliance team should review the exchange data agreements (display vs.
non-display usage, redistribution to app users, delayed vs. real-time tiers).

## 5. LLM API keys

| Provider | Console | Env var |
|---|---|---|
| Anthropic Claude | https://console.anthropic.com → API Keys | `ANTHROPIC_API_KEY` |
| OpenAI GPT | https://platform.openai.com/api-keys | `OPENAI_API_KEY` |
| Google Gemini | https://aistudio.google.com/apikey | `GOOGLE_API_KEY` |

Set at least one. The router tries them in `LLM_PROVIDER_ORDER` and fails over
automatically. For data-residency requirements, all three offer enterprise/VPC options
(AWS Bedrock for Claude, Azure OpenAI, Google Vertex AI) — the provider classes in
`backend/app/llm/providers.py` can be pointed at those endpoints later.

---

*This document is AI-generated and must be reviewed and approved before business or
regulatory use.*
