# SESSION HANDOFF — AI Investment Intelligence Platform (NIYTRI)

> **Purpose.** A self-contained snapshot for resuming this project in a NEW chat
> (new session or account). Read `CLAUDE.md` first (authoritative project
> context, auto-loaded), then this file for the latest deltas and open items.
> **Last updated:** 2026-06-26. **Branch:** `main`. **Tip commit:** `d3dd156`.

---

## 1. What was just shipped (v0.6 — 2026-06-26)

### A. Assistant answers lead with a "Bottom line" callout
Every assistant reply now OPENS with the key conclusion in a highlighted box,
then a short explanation with important numbers in **bold**.

- `backend/app/services/assistant.py` — the `GUARDRAILS` FORMAT rule instructs
  the model to start with a markdown blockquote whose first line is `> ` (e.g.
  `> **Bottom line:** ...`), one or two sentences, key data bolded; then a blank
  line, then ≤3-5 bullets or 2-3 short sentences. No headings unless a detailed
  report is asked for.
- `frontend/src/md.js` — added blockquote rendering. IMPORTANT GOTCHA: the
  renderer HTML-escapes the whole string first, so a leading `>` becomes `&gt;`.
  The blockquote detector therefore matches `/^&gt;\s?/` (NOT `/^>/`). It groups
  consecutive quote lines into `<blockquote class="callout">…</blockquote>`,
  flushing on the next non-quote line and at EOF.
- `frontend/src/styles.css` — `.md .callout` (tinted bg, left accent border,
  rounded) + `.md .callout strong` (accent colour). Inserted just before
  `.md-gap`.
- Verified: `node` render test produces `<blockquote class="callout">…`; the
  8-case assistant eval suite still passes.

### B. Hard server-side session enforcement (short-lived JWT + silent refresh)
Replaces the previous client-only idle logout. Now enforced on the SERVER.

- `backend/app/core/auth.py`
  - `ACCESS_TTL_MINUTES = 15`, `IDLE_TTL_MINUTES = 60`, `MAX_SESSION_HOURS = 12`.
  - `create_access_token` (typ="access", 15m) is the ONLY credential the API
    accepts. `get_current_user` rejects any token with `typ == "refresh"`.
  - `create_refresh_token` (typ="refresh", 60m sliding) carries `lia` = original
    login epoch so the absolute cap survives rotation.
  - `issue_tokens(user, login_at=None)` → `{access_token, refresh_token,
    expires_in}`. `rotate_refresh(token)` validates (not idle-expired, under the
    12h cap, user active) and returns a freshly rotated pair; raises 401 when the
    session is dead. `create_token` kept as a backwards-compat alias.
- `backend/app/api/auth_routes.py`
  - `TokenResponse` now includes `refresh_token` + `expires_in`.
  - `POST /api/v1/auth/login` returns the pair via `issue_tokens`.
  - NEW `POST /api/v1/auth/refresh` (body `{refresh_token}`) → rotated pair; 401
    means re-login required.
- `frontend/src/api.js`
  - Stores BOTH tokens in `sessionStorage` (`token`, `refresh`).
  - `setSession(d)`, `clearSession()`, `getRefresh()`, `refreshSession()`
    exported. `http()` now: on a 401 (non-auth call) it tries ONE silent
    `refreshSession()` then retries the request once; if still 401 → `clearSession`
    + `onUnauthorized`. Concurrent 401s share one in-flight refresh.
- `frontend/src/App.jsx`
  - `boot()` validates the session via `api.me()` (auto-refreshes on 401).
  - The session effect refreshes the access token every ~10 min ONLY while the
    user is active; once idle ≥ 1h it stops refreshing and calls `expire()`
    (so the refresh token dies server-side too). `logout()` and idle-expire use
    `clearSession()`.
- `frontend/src/components/Login.jsx` — uses `setSession(r)` instead of
  `setToken`.
- Verified: backend `py_compile` + import OK; a token-lifecycle test confirmed
  (access accepted, refresh rejected as access, rotation preserves `lia`,
  idle/expired refresh → 401, over-cap → 401); all four JSX files parse via
  esbuild.

**Deploy impact:** the auth contract changed, so EVERY logged-in user is signed
out on deploy and must log in once. Changes are COMMITTED to `main` (d3dd156)
but the user deploys to AWS themselves.

---

## 2. Deploy (both backend AND frontend changed)

Laptop:
```
cd D:\broking-ai-bot
git pull
```

AWS:
```
cd /home/ubuntu/AI_Investment_Intelligence_Platform/AI_Investment_Intelligence_Platform
git checkout -- frontend/package-lock.json
git pull
sudo systemctl restart broking-backend
cd frontend && npm ci && npm run build && sudo cp -r dist/* /var/www/broking-ai/
```

---

## 3. ⚠️ Critical working convention reaffirmed this session

The **Edit/Write tools TRUNCATE large files on this mounted folder** (and can
insert NUL bytes). This session they silently truncated `api.js`, `md.js`,
`App.jsx`, `Login.jsx`, `styles.css`, and `auth_routes.py` — even though an
immediate `py_compile` right after one edit briefly passed. ALWAYS, for any file
more than a few KB:
1. Edit via the bash shell (python `.replace()` with unique anchors, or heredoc).
2. If a file is already truncated, restore it with `git show HEAD:path > path`
   and re-apply changes via bash.
3. Verify with `py_compile` (backend) and esbuild-via-stdin
   (`esbuild --loader=jsx --format=esm < file`, install esbuild in /tmp) — and
   `grep -aPc '\x00'` for NUL bytes — BEFORE trusting the result.
`vite build`/`npm ci` only run cleanly on the laptop/AWS, not the Linux sandbox
(native rollup/esbuild binary mismatch).

---

## 4. Open items / suggested next steps

- **Make the session constants admin-configurable** (currently hard-coded in
  `auth.py`): `ACCESS_TTL_MINUTES`, `IDLE_TTL_MINUTES`, `MAX_SESSION_HOURS`.
- **User-side ops** (still outstanding): raise Anthropic usage limit / add a
  Gemini key; run Admin → Import NIFTY 50 + NIFTY 500 to populate index tags;
  re-run scoring (now cheap with deterministic rationales) so fundamentals/LTP
  fill in.
- **Two NIFTY-50 symbols** show as "not scored" — user to hover the badge and
  send the symbols for a Yahoo-alias/seed fix.
- **Licensed market-data feed** (NIYTRI evaluating TrueData "Market Data API" vs
  Angel SmartAPI + Zerodha Kite). Once keys exist: build the SmartAPI
  symbol→token map, add daily token refresh, then set
  `ALLOW_UNLICENSED_MARKET_DATA=false`. EOD data is sufficient (scoring runs
  post-close). See `docs/ACCOUNT_SETUP_GUIDE.md`.
- **Parked:** BSE scope; commodities (MCX futures); finalize/test broker
  `get_quotes_batch` with live keys; gray-out individual gap-days in the Stock
  Scores date calendar (needs a date-picker lib).

---

## 5. Standing user preferences (do not forget)
- Deploy commands ALWAYS in SEPARATE code blocks for laptop vs AWS; give full
  `cd` paths for both. PowerShell on the laptop does NOT support `&&`.
- Be concise and direct. Firm/vendor brand is **NIYTRI**.
- Compliance is non-negotiable: no buy/sell/hold, no price targets, keep
  `GUARDRAILS`/disclaimers; outputs are AI-generated and must be reviewed.
- Keep IST (Asia/Kolkata) for all timestamps.
