# NIYTRI Open Partner API — Integration Guide

**Version 1.0** · Base path: `/api/partner/v1`

The Open Partner API gives approved partners and mobile integrations programmatic,
read-mostly access to NIYTRI's investment-intelligence platform: AI stock scores,
the instrument master, AI-summarised market news, the conversational assistant, and
stateless portfolio analysis.

> **Compliance.** Every response is AI-generated and **informational only — not
> investment advice**, a research report, or a recommendation to buy or sell. No
> buy/sell/hold calls or price targets are returned. The scoring methodology is
> confidential. Partners must surface the `disclaimer` field to end users and must
> not present outputs as advice. Markets carry risk; consult a SEBI-registered
> investment adviser.

---

## 1. Base URL

| Environment | Base URL |
|-------------|----------|
| Production  | `https://dev-invest.niytri.com/api/partner/v1` |

All requests are HTTPS. Request and response bodies are JSON (`Content-Type: application/json`).

## 2. Authentication

Each partner is issued an **API key** by a NIYTRI administrator (Admin → Partner API).
The key is shown **once** at creation and stored by NIYTRI only as a hash — store it
securely (e.g. a secrets manager); it cannot be retrieved later. If lost or leaked,
ask an admin to revoke it and issue a new one.

Send the key on every request as a Bearer token:

```
Authorization: Bearer niy_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

A header alias is also accepted: `X-API-Key: niy_live_...`.

Keys are **server-to-server credentials** — never embed them in a browser, mobile
binary, or public repository. Route partner calls through your backend.

### Check your key

```
GET /me
```

```json
{
  "name": "Acme Securities",
  "key_prefix": "niy_live_ab12cd",
  "scopes": ["scores", "news", "ask", "portfolio"],
  "rate_limit_per_min": 60,
  "call_count": 1284
}
```

## 3. Scopes

A key is granted a subset of scopes; calling an endpoint outside your scopes returns
`403`.

| Scope | Grants access to |
|-------|------------------|
| `scores` | `GET /instruments`, `GET /scores`, `GET /scores/{symbol}` |
| `news` | `GET /news` |
| `ask` | `POST /ask` |
| `portfolio` | `POST /portfolio/analyze` |

## 4. Rate limits

Each key has a per-minute request limit (default **60/min**, configurable per key).
Exceeding it returns `429 Too Many Requests` with a `Retry-After` header (seconds).
Implement exponential backoff and cache responses where practical (scores update at
most a few times per day).

## 5. Endpoints

### 5.1 `GET /instruments` · scope `scores`

The active instrument master.

```bash
curl -H "Authorization: Bearer $NIYTRI_KEY" \
  https://dev-invest.niytri.com/api/partner/v1/instruments
```

```json
{ "instruments": [ { "symbol": "RELIANCE", "name": "Reliance Industries", "sector": "Energy" } ] }
```

### 5.2 `GET /scores` · scope `scores`

Latest published NIYTRI scores (composite 0–100) for the most recent run.

Query params: `score_date` (optional `YYYY-MM-DD`; defaults to latest), `limit`
(default 500, max 1000).

```bash
curl -H "Authorization: Bearer $NIYTRI_KEY" \
  "https://dev-invest.niytri.com/api/partner/v1/scores?limit=5"
```

```json
{
  "score_date": "2026-06-30",
  "count": 5,
  "scores": [
    {
      "symbol": "CANFINHOME", "composite_score": 60.9, "quality_status": "approved",
      "sector": "Financial Services", "pe": 14.2, "market_cap": 81000000000,
      "last_price": 905.3,
      "pillar_scores": { "fundamental": 64, "technical": 58, "valuation": 70, "momentum": 55, "earnings": 60, "news_sentiment": 52, "institutional": 50, "risk": 61 }
    }
  ],
  "disclaimer": "AI-generated ... not investment advice."
}
```

### 5.3 `GET /scores/{symbol}` · scope `scores`

Latest score for a single symbol (NSE symbol, case-insensitive).

```bash
curl -H "Authorization: Bearer $NIYTRI_KEY" \
  https://dev-invest.niytri.com/api/partner/v1/scores/INFY
```

```json
{
  "symbol": "INFY", "score_date": "2026-06-30", "composite_score": 58.2,
  "pillar_scores": { "fundamental": 62, "technical": 55, "valuation": 60, "momentum": 54, "earnings": 57, "news_sentiment": 56, "institutional": 53, "risk": 59 },
  "explanation": "Strong fundamentals, neutral valuation ...",
  "quality_status": "approved",
  "disclaimer": "AI-generated ... not investment advice."
}
```

Returns `404` if the symbol has no score yet.

### 5.4 `GET /news` · scope `news`

Latest AI-summarised market news. Query param: `limit` (default 20, max 100).

```bash
curl -H "Authorization: Bearer $NIYTRI_KEY" \
  "https://dev-invest.niytri.com/api/partner/v1/news?limit=10"
```

```json
{
  "count": 10,
  "items": [
    {
      "title": "...", "link": "https://...", "source": "...", "published": "...",
      "summary_short": "...", "summary_detailed": "...",
      "impacted_stocks": ["KPIL"], "impacted_sectors": ["Capital Goods"],
      "sentiment": "positive"
    }
  ],
  "disclaimer": "AI-generated ... not investment advice."
}
```

### 5.5 `POST /ask` · scope `ask`

The conversational assistant — grounded in live quotes, scores and news, and
**advice-free** (SEBI guardrails enforced server-side). Higher cost per call; cache
and rate-limit accordingly.

Request:

```json
{ "question": "How does CANFINHOME's score compare to its sector?", "session_id": "acme-user-42", "language": "en" }
```

```bash
curl -X POST -H "Authorization: Bearer $NIYTRI_KEY" -H "Content-Type: application/json" \
  -d '{"question":"Top stocks by score today?","language":"en"}' \
  https://dev-invest.niytri.com/api/partner/v1/ask
```

```json
{
  "answer": "> ...markdown answer...",
  "sources": [ { "type": "ai_scores_summary", "date": "2026-06-30" } ],
  "confidence": 0.78,
  "provider": "anthropic",
  "disclaimer": "AI-generated ... not investment advice."
}
```

`session_id` lets you keep short conversational context per end user; it is namespaced
to your key and never linked to a NIYTRI end-user account.

### 5.6 `POST /portfolio/analyze` · scope `portfolio`

Stateless portfolio analysis — you send holdings, we return health score, P&L,
diversification, concentration (HHI) and sector exposure. **No holdings are stored.**

Request (max 500 holdings):

```json
{ "holdings": [
  { "symbol": "INFY", "quantity": 100, "avg_price": 1450.0, "sector": "IT" },
  { "symbol": "HDFCBANK", "quantity": 50, "avg_price": 1600.0 }
] }
```

```bash
curl -X POST -H "Authorization: Bearer $NIYTRI_KEY" -H "Content-Type: application/json" \
  -d '{"holdings":[{"symbol":"INFY","quantity":100,"avg_price":1450}]}' \
  https://dev-invest.niytri.com/api/partner/v1/portfolio/analyze
```

```json
{
  "health_score": 75.4, "status": "green", "status_label": "Healthy",
  "headline": "1 holding(s) across 1 sector(s); high concentration ...",
  "pnl": { "invested": 145000, "current_value": 150000, "pnl": 5000, "pnl_pct": 3.45 },
  "deductions": [ { "reason": "Top holding INFY is 100% ...", "points": 80 } ],
  "diversification": { "num_holdings": 1, "num_sectors": 1, "effective_holdings": 1.0 },
  "concentration_risk": { "herfindahl_index": 1.0, "top_holding": "INFY", "top_holding_weight_pct": 100.0, "level": "high" },
  "sector_exposure": { "IT": 100.0 },
  "insights": "- ...factual observations...",
  "disclaimer": "AI-generated ... not investment advice."
}
```

### 5.7 `GET /health` · no auth

Liveness probe: `{ "status": "ok", "service": "niytri-partner-api", "version": "1.0" }`.

## 6. Errors

Standard HTTP status codes; the body is `{ "detail": "<message>" }`.

| Status | Meaning |
|-------:|---------|
| `400` | Bad request (e.g. empty holdings, unknown scope). |
| `401` | Missing, invalid or revoked API key. |
| `403` | Key authenticated but lacks the required scope. |
| `404` | Resource not found (e.g. no score for symbol). |
| `429` | Rate limit exceeded — honour `Retry-After`. |
| `502` | AI engine temporarily unavailable — retry with backoff. |

## 7. Python quick start

```python
import requests

BASE = "https://dev-invest.niytri.com/api/partner/v1"
HEADERS = {"Authorization": f"Bearer {NIYTRI_KEY}"}

# top 10 scores
r = requests.get(f"{BASE}/scores", params={"limit": 10}, headers=HEADERS, timeout=30)
r.raise_for_status()
for s in r.json()["scores"]:
    print(s["symbol"], s["composite_score"])

# portfolio analysis
holdings = {"holdings": [{"symbol": "INFY", "quantity": 100, "avg_price": 1450}]}
a = requests.post(f"{BASE}/portfolio/analyze", json=holdings, headers=HEADERS, timeout=60)
print(a.json()["health_score"], a.json()["headline"])
```

## 8. OpenAPI / interactive docs

A machine-readable OpenAPI 3 spec is served at `/openapi.json`; the interactive
Swagger UI is at `/docs` and ReDoc at `/redoc`. Partner endpoints are grouped under
the **partner** tag. Use the spec to generate typed client SDKs.

## 9. Versioning & support

The path is versioned (`/api/partner/v1`). Backwards-incompatible changes ship under a
new version; additive fields may appear without a version bump, so parse defensively.
For access, key rotation or issues, contact your NIYTRI account manager or
**customer support**; report formal grievances via SEBI's SCORES portal.

---

_This document and all API outputs are AI-generated where indicated and must be
reviewed before business or regulatory use. Informational only; not investment advice._
