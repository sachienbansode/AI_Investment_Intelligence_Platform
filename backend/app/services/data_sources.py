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


def _db_engine(src):
    url = (src.config or {}).get("url", "")
    if not url:
        raise ValueError("No database URL configured for this source.")
    cached = _engines.get(src.id)
    if cached and cached[0] == url:
        return cached[1]
    eng = create_engine(url, pool_pre_ping=True, pool_recycle=1800,
                        connect_args={"connect_timeout": 10} if url.startswith("postgres") else {})
    _engines[src.id] = (url, eng)
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
        tables = []
        names = list(insp.get_table_names())
        try:
            names += list(insp.get_view_names())
        except Exception:
            pass
        for t in names[:max_tables]:
            try:
                cols = [{"name": c["name"], "type": str(c.get("type"))[:40]}
                        for c in insp.get_columns(t)[:max_cols]]
                tables.append({"table": t, "columns": cols})
            except Exception:
                continue
        schema = {"dialect": eng.dialect.name, "tables": tables,
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
