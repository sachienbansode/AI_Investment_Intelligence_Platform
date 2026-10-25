"""Multi-tenancy (schema-per-partner).

Each onboarded partner gets its OWN Postgres schema `tenant_<slug>` holding that
partner's user-owned data (users, watchlists, portfolios, chats, activity). NIYTRI's
shared analytics (scores, instruments, news, …) stay in the default schema and are read
by all tenants. The scoring ENGINE/methodology is never exposed — only outputs/data.

This module provisions a tenant schema + its tables. The request-time routing that
points a session at a tenant schema (via `search_path`) is applied by the tenancy
middleware in a later, carefully-tested phase; provisioning here is additive and does
not change behaviour for existing (NIYTRI-own) users.
"""
from __future__ import annotations

import logging
import re

from sqlalchemy import text

from app.db.database import _is_sqlite, engine

log = logging.getLogger(__name__)

# Partner-owned tables that live inside each tenant schema (NOT the shared analytics).
_TENANT_MODEL_NAMES = ["User", "WatchlistItem", "Portfolio", "ChatMessage", "UserActivity"]


def tenant_schema(slug: str) -> str:
    s = re.sub(r"[^a-z0-9_]", "", (slug or "").lower().replace("-", "_"))
    return "tenant_" + s


def _tenant_tables():
    import app.db.database as d
    out = []
    for n in _TENANT_MODEL_NAMES:
        m = getattr(d, n, None)
        if m is not None and hasattr(m, "__table__"):
            out.append(m.__table__)
    return out


def provision_tenant(slug: str) -> dict:
    """Create `tenant_<slug>` and the partner-owned tables inside it. Idempotent.
    No-op on SQLite dev (schemas work differently there)."""
    if _is_sqlite:
        return {"ok": False, "reason": "sqlite dev — schema-per-tenant applies on PostgreSQL"}
    sch = tenant_schema(slug)
    tables = _tenant_tables()
    try:
        from app.db.database import Base
        with engine.begin() as conn:
            conn.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{sch}"'))
            conn.execute(text(f'SET LOCAL search_path TO "{sch}"'))
            Base.metadata.create_all(bind=conn, tables=tables, checkfirst=True)
        log.info("provisioned tenant schema %s (%d tables)", sch, len(tables))
        return {"ok": True, "schema": sch, "tables": [t.name for t in tables]}
    except Exception as e:
        log.warning("provision_tenant failed for %s: %s", sch, e)
        return {"ok": False, "reason": str(e)[:200]}
