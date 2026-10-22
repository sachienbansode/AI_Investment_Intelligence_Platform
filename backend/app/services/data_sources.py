"""Admin-registered external data sources (SQL DB or REST API) for the screener.

Admins add a source in Admin -> Data Sources (a database connection URL, or a REST
API base URL + auth). We introspect its schema (tables/columns for a DB) and store
it so the LLM can be 'trained' on it (the schema is fed into the screener prompt).
Queries are STRICTLY read-only (SELECT/WITH only, single statement, row + time caps)
so a connected source can never be written to.
"""
from __future__ import annotations

import datetime as _dt
import decimal
import logging
import re

from sqlalchemy import create_engine, inspect, text

from app.db.database import DataSource, SessionLocal

log = logging.getLogger(__name__)

_engines: dict = {}   # source_id -> (url, engine)

_FORBIDDEN = re.compile(
    r"\b(insert|update|delete|drop|alter|create|truncate|grant|revoke|attach|detach|"
    r"pragma|vacuum|reindex|replace|merge|call|do|copy|lock|load_extension|pg_sleep|"
    r"pg_read_file|pg_ls_dir|dblink|lo_import|lo_export|set_config)\b", re.IGNORECASE)
_SELECT_ONLY = re.compile(r"^\s*(select|with)\b", re.IGNORECASE)


# ---- helpers ---------------------------------------------------------------

def get_source(source_id: int):
    db = SessionLocal()
    try:
        return db.get(DataSource, source_id)
    finally:
        db.close()


def enabled_sources():
    db = SessionLocal()
    try:
        return db.query(DataSource).filter_by(enabled=True).all()
    finally:
        db.close()


def _jsonable(v):
    if isinstance(v, (_dt.date, _dt.datetime)):
        return v.isoformat()
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (bytes, bytearray)):
        return "<binary>"
    return v


def _db_schema(src) -> str:
    """Optional non-default schema to read (e.g. CMOTS lives in the 'cmots' schema)."""
    return ((src.config or {}).get("db_schema") or "").strip()


def _db_engine(src):
    cfg = src.config or {}
    url = cfg.get("url", "")
    if not url:
        raise ValueError("No database URL configured for this source.")
    schema = _db_schema(src)
    key = f"{url}|{schema}"
    cached = _engines.get(src.id)
    if cached and cached[0] == key:
        return cached[1]
    connect_args = {}
    if url.startswith("postgres"):
        connect_args["connect_timeout"] = 10
        if schema:
            # resolve unqualified table names against this schema (then public)
            connect_args["options"] = f"-c search_path={schema},public"
    eng = create_engine(url, pool_pre_ping=True, pool_recycle=1800,
                        connect_args=connect_args)
    _engines[src.id] = (key, eng)
    return eng


# ---- connect / introspect / query (DB) -------------------------------------

def test_connection(src) -> dict:
    try:
        if src.kind == "api":
            import httpx
            base = (src.config or {}).get("base_url", "")
            r = httpx.get(base, headers=_api_headers(src), timeout=10)
            return {"ok": r.status_code < 500, "status": r.status_code}
        eng = _db_engine(src)
        with eng.connect() as c:
            c.execute(text("SELECT 1"))
        return {"ok": True, "dialect": eng.dialect.name}
    except Exception as ex:
        return {"ok": False, "error": str(ex)[:400]}


def introspect(src, max_tables: int = 300, max_cols: int = 120) -> dict:
    """Read the source's schema and persist it on the DataSource row."""
    if src.kind == "api":
        schema = _introspect_api(src)
    else:
        eng = _db_engine(src)
        insp = inspect(eng)
        sch = _db_schema(src) or None
        tables = []
        names = list(insp.get_table_names(schema=sch))
        try:
            names += list(insp.get_view_names(schema=sch))
        except Exception:
            pass
        for t in names[:max_tables]:
            try:
                cols = [{"name": c["name"], "type": str(c.get("type"))[:40]}
                        for c in insp.get_columns(t, schema=sch)[:max_cols]]
                tables.append({"table": t, "columns": cols})
            except Exception:
                continue
        schema = {"dialect": eng.dialect.name, "schema": sch, "tables": tables,
                  "table_count": len(tables)}
    db = SessionLocal()
    try:
        row = db.get(DataSource, src.id)
        row.schema_json = schema
        db.commit()
    finally:
        db.close()
    return schema


def run_sql(src, sql: str, max_rows: int = 200, timeout_s: int = 20) -> dict:
    """Execute a single read-only SELECT/WITH against the source. Bounded + timed."""
    sql = (sql or "").strip().rstrip(";")
    if not sql:
        raise ValueError("Empty query.")
    if not _SELECT_ONLY.match(sql):
        raise ValueError("Only SELECT / WITH queries are allowed.")
    if ";" in sql:
        raise ValueError("Only a single statement is allowed.")
    if _FORBIDDEN.search(sql):
        raise ValueError("Query contains a forbidden keyword.")
    if not re.search(r"\blimit\b", sql, re.IGNORECASE):
        sql = f"{sql}\nLIMIT {int(max_rows)}"
    eng = _db_engine(src)
    with eng.connect() as c:
        try:
            if eng.dialect.name == "postgresql":
                c.execute(text(f"SET LOCAL statement_timeout = {int(timeout_s) * 1000}"))
                sch = _db_schema(src)
                if sch:
                    c.execute(text(f"SET LOCAL search_path = {sch}, public"))
        except Exception:
            pass
        res = c.execute(text(sql))
        cols = list(res.keys())
        rows = [{cols[i]: _jsonable(v) for i, v in enumerate(r)}
                for r in res.fetchmany(int(max_rows))]
    return {"columns": cols, "rows": rows, "row_count": len(rows)}


# ---- API sources (basic) ---------------------------------------------------

def _api_headers(src) -> dict:
    cfg = src.config or {}
    h = dict(cfg.get("headers") or {})
    at = cfg.get("auth_type")
    av = cfg.get("auth_value") or ""
    if at == "bearer" and av:
        h["Authorization"] = f"Bearer {av}"
    elif at == "header" and av and cfg.get("auth_header"):
        h[cfg["auth_header"]] = av
    return h


def _introspect_api(src) -> dict:
    import httpx
    cfg = src.config or {}
    base = cfg.get("base_url", "")
    sample_path = cfg.get("sample_path", "")
    url = base.rstrip("/") + "/" + sample_path.lstrip("/") if sample_path else base
    try:
        r = httpx.get(url, headers=_api_headers(src), timeout=12)
        data = r.json()
        sample = data[0] if isinstance(data, list) and data else data
        fields = sorted(list(sample.keys())) if isinstance(sample, dict) else []
        return {"kind": "api", "base_url": base, "sample_path": sample_path, "fields": fields}
    except Exception as ex:
        return {"kind": "api", "base_url": base, "error": str(ex)[:300], "fields": []}


# ---- schema prompt ("training" the LLM) ------------------------------------

def schema_text(sources, max_tables: int = 60, max_cols: int = 40) -> str:
    parts = []
    for s in sources:
        sc = s.schema_json or {}
        if (s.name or "").upper() == "CMOTS":
            # Prepend the curated CMOTS guide so the LLM knows each table's purpose
            # and the co_code join key even before/if full columns are introspected.
            parts.append(cmots_catalog_text())
            if not (sc.get("tables")):
                parts.append(f"# SOURCE {s.id} \"{s.name}\" (CMOTS DB — columns introspected on connect)")
                continue
        if s.kind == "api":
            parts.append(f"# SOURCE {s.id} \"{s.name}\" (REST API @ {sc.get('base_url','')})")
            if sc.get("fields"):
                parts.append("  fields: " + ", ".join(sc["fields"][:60]))
            continue
        parts.append(f"# SOURCE {s.id} \"{s.name}\" ({sc.get('dialect','db')})")
        for t in (sc.get("tables") or [])[:max_tables]:
            cols = ", ".join(f"{c['name']}:{c['type']}" for c in t.get("columns", [])[:max_cols])
            parts.append(f"  {t['table']}({cols})")
    return "\n".join(parts) or "(no data sources connected)"


# ---- CMOTS ------------------------------------------------------------------
# CMOTS (Capital Market) standard DB. Curated catalog of the tables we care about,
# grouped by purpose, so the screener LLM is "trained" on what each table holds and
# the portfolio/research modules know where to read. Join key across company tables
# is typically `co_code` (a.k.a. fincode); companymaster maps co_code <-> symbol.
CMOTS_CATALOG = {
    # company master / profile
    "companymaster": ("company", "Company master: co_code, symbol/BSE-NSE code, name, sector, industry"),
    "companyprofile": ("company", "Company profile / business description"),
    "companyhistory": ("company", "Company listing history & identifiers"),
    "fundamentalttm": ("fundamentals", "Trailing-twelve-month fundamentals per company"),
    # financial statements
    "balancesheet": ("fundamentals", "Annual balance sheet line items per co_code/year"),
    "proftandloss": ("fundamentals", "Profit & loss (income statement) per co_code/year"),
    "quarterlyresults": ("fundamentals", "Quarterly results per co_code/quarter"),
    "cashflow": ("fundamentals", "Cash flow statement per co_code/year"),
    "yearly": ("fundamentals", "Yearly consolidated financials"),
    "half": ("fundamentals", "Half-yearly financials"),
    # ratios
    "valuationratios": ("ratios", "Valuation ratios (P/E, P/B, EV/EBITDA, etc.)"),
    "performanceratios": ("ratios", "Performance ratios (ROE, ROCE, ROA, etc.)"),
    "marginratios": ("ratios", "Margin ratios (gross/operating/net margin)"),
    "efficiencyratios": ("ratios", "Efficiency / turnover ratios"),
    "financialstabilityratios": ("ratios", "Leverage / solvency ratios (D/E, interest cover)"),
    "technicalindicatorratios": ("technicals", "Technical indicator values (RSI, MACD, etc.)"),
    # technicals / price-derived
    "sma": ("technicals", "Simple moving averages per symbol"),
    "supportandresistance": ("technicals", "Support & resistance levels"),
    "pivotclassic": ("technicals", "Classic pivot points"),
    "pivotfibonacci": ("technicals", "Fibonacci pivot points"),
    "putcallratio": ("technicals", "Put/Call ratio (derivatives sentiment)"),
    "deliverablevolume": ("technicals", "Deliverable volume / quantity per symbol/day"),
    "price_change": ("prices", "Price change series (daily close / % change) per symbol"),
    # ownership
    "shareholdingpatterndetailed": ("ownership", "Detailed shareholding pattern (promoter/FII/DII/public)"),
    "fii": ("ownership", "FII flow data"),
    "companywisemfholding": ("ownership", "Mutual-fund holding per company"),
    # corporate actions
    "boardmeetings": ("corp_actions", "Board meeting dates & purpose"),
    "dividendcocodewise": ("corp_actions", "Dividend history per co_code"),
    "bonuscocodewise": ("corp_actions", "Bonus issue history per co_code"),
    "splitscocodewise": ("corp_actions", "Stock split history per co_code"),
    "rightscocodewise": ("corp_actions", "Rights issue history per co_code"),
    "bookclosure": ("corp_actions", "Book closure / record dates"),
    "announcement": ("corp_actions", "Corporate announcements"),
    "bulkblockdeal": ("corp_actions", "Bulk & block deals"),
    # sector / market
    "sectorhistorical": ("sector", "Historical sector index/performance series"),
    # IPO
    "ipomaster": ("ipo", "IPO master"),
    "ipofinancials": ("ipo", "IPO financials"),
    "iporiskdetails": ("ipo", "IPO risk details"),
    "ipostrengthdetails": ("ipo", "IPO strength details"),
    "subscriptionstatus": ("ipo", "IPO subscription status"),
}

# Categories the equity screener/portfolio modules should prefer (mutual-fund and
# scheme tables are excluded from equity screening by default).
CMOTS_EQUITY_CATS = {"company", "fundamentals", "ratios", "technicals", "prices",
                     "ownership", "corp_actions", "sector", "ipo"}


def cmots_catalog_text() -> str:
    """Human/LLM-readable CMOTS table guide, grouped by category."""
    by_cat: dict = {}
    for tbl, (cat, desc) in CMOTS_CATALOG.items():
        by_cat.setdefault(cat, []).append(f"{tbl} — {desc}")
    out = ["# CMOTS table guide (join key: co_code; companymaster maps co_code<->symbol/name)"]
    for cat in ("company", "fundamentals", "ratios", "technicals", "prices",
                "ownership", "corp_actions", "sector", "ipo"):
        if cat in by_cat:
            out.append(f"## {cat}")
            out.extend("  " + line for line in by_cat[cat])
    return "\n".join(out)


def ensure_cmots_source():
    """If settings.cmots_database_url is set, upsert a 'CMOTS' DB data source and try
    to introspect it (non-fatal if the DB isn't reachable yet). Idempotent; safe at boot."""
    try:
        from app.config import get_settings
        settings = get_settings()
    except Exception as e:
        log.warning("ensure_cmots_source: cannot load settings: %s", e)
        return
    url = (getattr(settings, "cmots_database_url", "") or "").strip()
    if not url:
        # assemble a SQLAlchemy URL from the split connection parts
        host = (getattr(settings, "cmots_db_host", "") or "").strip()
        name = (getattr(settings, "cmots_db_name", "") or "").strip()
        if host and name:
            from urllib.parse import quote_plus
            typ = (getattr(settings, "cmots_db_type", "") or "postgresql+psycopg2").strip()
            port = (str(getattr(settings, "cmots_db_port", "") or "")).strip()
            user = quote_plus((getattr(settings, "cmots_db_user", "") or "").strip())
            pwd = quote_plus(getattr(settings, "cmots_db_password", "") or "")
            auth = user + (f":{pwd}" if pwd else "")
            hostport = host + (f":{port}" if port else "")
            url = f"{typ}://{auth}@{hostport}/{name}"
    if not url:
        return
    schema = (getattr(settings, "cmots_db_schema", "") or "").strip()
    db = SessionLocal()
    try:
        src = db.query(DataSource).filter_by(name="CMOTS").first()
        note = ("CMOTS market & fundamentals DB (read-only). Auto-registered from "
                "CMOTS_DATABASE_URL. See cmots_catalog_text() for the table guide.")
        if src is None:
            src = DataSource(name="CMOTS", kind="db",
                             config={"url": url, "db_schema": schema},
                             enabled=True, note=note)
            db.add(src)
        else:
            cfg = dict(src.config or {})
            cfg["url"] = url            # keep URL in sync with env
            cfg["db_schema"] = schema
            src.config = cfg
            if not (src.note or "").strip():
                src.note = note
        db.commit()
        sid = src.id
    except Exception as e:
        log.warning("ensure_cmots_source upsert failed: %s", e)
        db.rollback()
        db.close()
        return
    finally:
        try:
            db.close()
        except Exception:
            pass
    # best-effort introspection (columns become available once the DB is reachable)
    try:
        introspect(get_source(sid))
        log.info("CMOTS data source introspected (id=%s)", sid)
    except Exception as e:
        log.warning("CMOTS introspect deferred (DB not reachable yet): %s", e)
