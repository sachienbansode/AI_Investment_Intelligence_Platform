"""Safe, read-only SQL access for the AI assistant.

The assistant may need to read data that the pre-built context doesn't cover.
This module lets the LLM propose SELECT queries which we execute against a
STRICT, compliance-bounded view of the database:

  * SELECT-only (no INSERT/UPDATE/DELETE/DDL, single statement).
  * Table WHITELIST: only the analytical/market tables plus the CURRENT user's
    own watchlist/portfolio. Everything sensitive (users, roles, app_settings,
    pipeline_runs, research_*, chat_*, user_activity, device_tokens, system
    catalogs) is BLOCKED - so user accounts, app/admin configuration and
    scoring-methodology internals can never be read.
  * Per-user data (watchlist/portfolio) is exposed ONLY as the virtual tables
    `my_watchlist` / `my_portfolio`, which are rewritten to subqueries hard-
    filtered to the logged-in user_id. One user can never read another's rows.
  * Read-only transaction, statement timeout, row + size caps.

Nothing here is authoritative advice; results are factual data the model then
explains under the usual compliance guardrails.
"""
import datetime as _dt
import decimal
import json
import logging
import re
import time

from sqlalchemy import text

from app.db.database import _is_sqlite, engine

log = logging.getLogger(__name__)

# Virtual, already-user-scoped tables the model may reference.
USER_VIEWS = {"my_watchlist", "my_portfolio"}

# Tables NEVER queryable — PII, auth, config, methodology, raw per-user rows.
# (Denylist model: everything else in the app DB is auto-discovered and allowed,
# so new analytics tables are picked up automatically; sensitive ones never are.)
SENSITIVE = {
    "users", "roles", "app_settings", "partner_keys", "data_sources",
    "chat_messages", "chat_feedback", "chat_shares", "setting_changes",
    "settingchange", "email_logs", "email_log", "invite_codes", "invitecode",
    "device_tokens", "devicetoken", "user_activity", "research_chunks",
    # raw per-user tables -> only reachable via the user views below
    "watchlist_items", "portfolios",
    "sqlite_master", "sqlite_temp_master", "information_schema", "pg_catalog",
    "pg_class", "pg_tables", "pg_user", "pg_shadow", "pg_authid", "pg_settings",
}
BLOCKED_TABLES = SENSITIVE           # kept for defense-in-depth checks below

# Semantic hints appended to the introspected columns for known analytics tables.
_HINTS = {
    "stock_scores": "DAILY history: many rows per symbol, one per score_date (text "
    "'YYYY-MM-DD'). composite_score 0-100. quality_status in (approved,pending,rejected). "
    "`fundamentals` JSON (eps,pb,dividend_yield,beta,roe,change_pct,volume,week52_high,"
    "week52_low). For today/latest use score_date=(SELECT MAX(score_date) FROM stock_scores).",
    "instruments": "one row per script; `indices` is a JSON list of membership tags.",
    "news_items": "impacted_stocks/impacted_sectors are JSON lists; sentiment is text.",
    "theme_tags": "screener theme tags: theme, symbol, co_code, company_name, sector.",
    "pipeline_runs": "scoring-pipeline run history.",
}

# Fallback schema doc if live introspection is unavailable.
_FALLBACK_DOC = """READ-ONLY SQL ACCESS - you may query ONLY these tables:
- instruments(symbol, name, sector, is_active, in_scoring_universe, indices)
- stock_scores(symbol, score_date, composite_score, quality_status, pe, market_cap,
    last_price, explanation, pillar_scores, fundamentals, created_at)
- news_items(title, link, source, published, summary_short, summary_detailed,
    impacted_stocks, impacted_sectors, sentiment, created_at)
- my_watchlist(symbol, created_at)  -- the CURRENT user's watchlist only.
- my_portfolio(holdings, created_at, updated_at)  -- the CURRENT user's holdings only.
RULES: ONE SELECT, no writes/DDL/semicolons, portable, always LIMIT."""

_cache = {"t": 0.0, "allowed": set(), "doc": ""}


def _introspect():
    from sqlalchemy import inspect as _sqinsp
    names = []
    cols_by = {}
    try:
        insp = _sqinsp(engine)
        for t in insp.get_table_names():
            if t.lower() in SENSITIVE:
                continue
            names.append(t)
            try:
                cols_by[t] = [c["name"] for c in insp.get_columns(t)]
            except Exception:
                cols_by[t] = []
    except Exception as e:
        log.warning("db_query introspect failed: %s", e)
    allowed = {n.lower() for n in names} | USER_VIEWS
    lines = ["READ-ONLY SQL ACCESS - you may query ONLY these tables (any other is rejected):"]
    for t in sorted(names):
        cols = ", ".join(cols_by.get(t, []))
        hint = ("  -- " + _HINTS[t.lower()]) if t.lower() in _HINTS else ""
        lines.append(f"- {t}({cols}){hint}")
    lines.append("- my_watchlist(symbol, created_at)  -- the CURRENT user's watchlist only.")
    lines.append("- my_portfolio(holdings, created_at, updated_at)  -- the CURRENT user's "
                 "holdings only; `holdings` is a JSON array of {symbol,quantity,avg_price,sector}.")
    lines.append("RULES: write ONE standard SQL SELECT (WITH/JOIN/GROUP BY/ORDER BY/LIMIT/"
                 "aggregates OK). No writes, DDL, semicolons or other tables. Portable across "
                 "SQLite and PostgreSQL. Always add a sensible LIMIT.")
    return allowed, "\n".join(lines)


def table_columns() -> dict:
    """{table: [columns]} for every non-sensitive app table (for schema hints)."""
    from sqlalchemy import inspect as _sqinsp
    out = {}
    try:
        insp = _sqinsp(engine)
        for t in insp.get_table_names():
            if t.lower() in SENSITIVE:
                continue
            try:
                out[t] = [c["name"] for c in insp.get_columns(t)]
            except Exception:
                out[t] = []
    except Exception as e:
        log.warning("table_columns failed: %s", e)
    return out


def refresh_schema():
    """Re-introspect the app DB and rebuild the allow-set + schema doc. Nightly + lazy.
    Merges any stored semantic hints (schema_hints) into the doc so the planner knows
    what new tables/columns mean, not just their names."""
    allowed, doc = _introspect()
    if allowed:
        try:
            from app.services.schema_hints import get_hints
            hints = get_hints("app")
            if hints:
                extra = [("  [%s] %s" % (t, d)) for t, d in sorted(hints.items())
                         if t not in _HINTS]
                if extra:
                    doc = doc + "\nTABLE NOTES:\n" + "\n".join(extra)
        except Exception:
            pass
        _cache.update(t=time.time(), allowed=allowed, doc=doc)
    return {"count": len(allowed - USER_VIEWS), "tables": sorted(allowed - USER_VIEWS)}


def _ensure(max_age=3600):
    if not _cache["allowed"] or (time.time() - _cache["t"]) > max_age:
        try:
            refresh_schema()
        except Exception:
            pass


def allowed_tables():
    _ensure()
    return _cache["allowed"] or (USER_VIEWS | {"stock_scores", "instruments", "news_items"})


def schema_doc():
    _ensure()
    return _cache["doc"] or _FALLBACK_DOC

# Forbidden tokens (writes, DDL, multi-statement, dangerous functions).
_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|attach|"
    r"detach|pragma|vacuum|reindex|replace|merge|into|call|do|copy|lock|"
    r"load_extension|pg_sleep|pg_read_file|pg_ls_dir|dblink|current_setting|"
    r"set_config|lo_import|lo_export)\b", re.IGNORECASE)

_TABLE_REF = re.compile(r"\b(?:from|join)\s+([a-zA-Z_][a-zA-Z0-9_\.]*)", re.IGNORECASE)
_MAX_LEN = 2000

# words that can legally follow a table reference (so they are NOT an alias)
_NOT_ALIAS = (
    "where|on|using|join|inner|left|right|full|cross|natural|group|order|limit|"
    "having|window|union|except|intersect|and|or|for|offset|fetch|as")

_VIEW_SUBQ = {
    "my_watchlist": "SELECT symbol, created_at FROM watchlist_items WHERE user_id = :uid",
    "my_portfolio": "SELECT holdings, created_at, updated_at FROM portfolios WHERE user_id = :uid",
}

# Schema description handed to the model so it writes valid queries.
SCHEMA_DOC = """READ-ONLY SQL ACCESS - you may query ONLY these tables/columns (any other
table is forbidden and will be rejected):

- instruments(symbol, name, sector, is_active, in_scoring_universe, indices)
    one row per script. `indices` is a JSON list of membership tags
    (e.g. ["NIFTY50","NIFTY500","NSE"]).
- stock_scores(symbol, score_date, composite_score, quality_status, pe,
    market_cap, last_price, explanation, pillar_scores, fundamentals, created_at)
    DAILY history: many rows per symbol, one per score_date (text 'YYYY-MM-DD').
    composite_score is 0-100. quality_status in ('approved','pending','rejected').
    `fundamentals` is JSON (keys: eps, pb, dividend_yield, beta, roe, change_pct,
    volume, week52_high, week52_low). For "today/latest" filter
    score_date = (SELECT MAX(score_date) FROM stock_scores).
- news_items(title, link, source, published, summary_short, summary_detailed,
    impacted_stocks, impacted_sectors, sentiment, created_at)
    impacted_stocks/impacted_sectors are JSON lists; sentiment is text.
- my_watchlist(symbol, created_at)  -- the CURRENT user's watchlist only.
- my_portfolio(holdings, created_at, updated_at)  -- the CURRENT user's holdings
    only; `holdings` is a JSON array of {symbol, quantity, avg_price, sector}.

RULES: write ONE standard SQL SELECT (you may use WITH/JOIN/GROUP BY/ORDER BY/
LIMIT and aggregate functions). No writes, no DDL, no semicolons, no other
tables. Keep it portable (works on both SQLite and PostgreSQL): filter/group on
the scalar columns above; to inspect a JSON column just select it and read the
value from the result. Always add a sensible LIMIT."""


def validate_sql(query: str) -> str:
    """Return a cleaned query if it is a safe read-only SELECT, else raise ValueError."""
    if not query or not query.strip():
        raise ValueError("empty query")
    q = query.strip().rstrip(";").strip()
    # strip line/block comments (could hide forbidden tokens)
    q = re.sub(r"--[^\n]*", " ", q)
    q = re.sub(r"/\*.*?\*/", " ", q, flags=re.DOTALL)
    q = re.sub(r"\s+", " ", q).strip()
    if len(q) > _MAX_LEN:
        raise ValueError("query too long")
    if ";" in q:
        raise ValueError("multiple statements are not allowed")
    low = q.lower()
    if not (low.startswith("select") or low.startswith("with")):
        raise ValueError("only SELECT/WITH queries are allowed")
    if _FORBIDDEN.search(low):
        raise ValueError("query contains a forbidden keyword (read-only access only)")
    refs = {m.group(1).lower().split(".")[-1] for m in _TABLE_REF.finditer(low)}
    # WITH-clause CTE names are allowed; collect them so they don't trip the check.
    ctes = {m.group(1).lower() for m in
            re.finditer(r"(?:with|,)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+as\s*\(", low)}
    allowed = allowed_tables()
    bad = (refs - allowed) - ctes
    if bad:
        raise ValueError(
            "query references tables that are not allowed: " + ", ".join(sorted(bad))
            + ". Allowed: " + ", ".join(sorted(allowed)))
    if BLOCKED_TABLES & refs:
        raise ValueError("query references a blocked table")
    return q


def _scope(q: str, user_id):
    """Rewrite my_watchlist/my_portfolio to user-filtered subqueries. The derived
    table is always given an alias (Postgres requires one), reusing any alias the
    model wrote so column references like `w.symbol` keep working."""
    needs_user = bool(re.search(r"\bmy_(watchlist|portfolio)\b", q, re.IGNORECASE))
    if needs_user and user_id is None:
        raise ValueError("watchlist/portfolio require a logged-in user")
    for view, subq in _VIEW_SUBQ.items():
        pat = re.compile(
            r"\b" + view + r"\b(?:\s+(?:as\s+)?(?!(?:" + _NOT_ALIAS +
            r")\b)([a-zA-Z_][a-zA-Z0-9_]*))?", re.IGNORECASE)

        def repl(m, _subq=subq, _view=view):
            alias = m.group(1) or _view
            return "(" + _subq + ") AS " + alias
        q = pat.sub(repl, q)
    return q, needs_user


def _scope_universe(q: str, syms) -> str:
    """Hard-enforce a stock-universe scope by rewriting every reference to
    stock_scores / instruments into a subquery filtered to `syms`. Applied in
    code (not trusted to the LLM), so counts/averages/joins are correct even if
    the planner omitted the filter. `syms` come from our own DB / constituent
    lists and are sanitised to [A-Z0-9&._-], so inlining them is injection-safe."""
    if not syms:
        return q
    vals = ",".join("'" + re.sub(r"[^A-Z0-9&._-]", "", str(x).upper()) + "'"
                    for x in sorted(syms) if str(x).strip())
    if not vals:
        return q
    for tbl in ("stock_scores", "instruments"):
        subq = "SELECT * FROM %s WHERE symbol IN (%s)" % (tbl, vals)
        pat = re.compile(r"\b" + tbl + r"\b(?:\s+(?:as\s+)?(?!(?:" + _NOT_ALIAS +
                         r")\b)([a-zA-Z_][a-zA-Z0-9_]*))?", re.IGNORECASE)

        def repl(m, _subq=subq, _tbl=tbl):
            alias = m.group(1) or _tbl
            return "(" + _subq + ") AS " + alias
        q = pat.sub(repl, q)
    return q


def _jsonable(v):
    if isinstance(v, (_dt.datetime, _dt.date)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (dict, list, str, int, float, bool)) or v is None:
        return v
    return str(v)


def run_query(query: str, user_id=None, max_rows: int = 200, universe_syms=None) -> dict:
    """Validate + execute one read-only query. Returns
    {sql, columns, rows, row_count, truncated} or {sql, error}. Never raises.
    When universe_syms is given, stock_scores/instruments are hard-filtered to it."""
    try:
        clean = validate_sql(query)
        scoped, _ = _scope(clean, user_id)
        scoped = _scope_universe(scoped, universe_syms)
    except Exception as e:
        return {"sql": query, "error": str(e)}
    conn = engine.connect()
    trans = conn.begin()
    try:
        if not _is_sqlite:
            conn.execute(text("SET TRANSACTION READ ONLY"))
            conn.execute(text("SET LOCAL statement_timeout = 6000"))
        res = conn.execute(text(scoped), {"uid": user_id})
        cols = list(res.keys())
        fetched = res.fetchmany(max_rows + 1)
        truncated = len(fetched) > max_rows
        rows = [[_jsonable(v) for v in row] for row in fetched[:max_rows]]
        out = {"sql": clean, "columns": cols, "rows": rows,
               "row_count": len(rows), "truncated": truncated}
        # cap serialized size so a wide/long result can't blow the context
        if len(json.dumps(out, default=str)) > 24000:
            out["rows"] = out["rows"][:50]
            out["truncated"] = True
            out["note"] = "result trimmed to 50 rows to fit context"
        return out
    except Exception as e:
        log.warning("read-only query failed: %s", e)
        return {"sql": clean, "error": (str(e).splitlines() or [""])[0][:200]}
    finally:
        trans.rollback()
        conn.close()


def run_many(queries, user_id=None, max_rows: int = 200, max_queries: int = 3) -> list:
    return [run_query(q, user_id=user_id, max_rows=max_rows)
            for q in list(queries)[:max_queries] if isinstance(q, str) and q.strip()]
SCHEMA_DOC = _FALLBACK_DOC  # backward-compat alias
