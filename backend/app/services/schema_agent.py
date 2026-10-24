"""Schema-Refresh agent.

Relearns the app DB schema (db_query) and re-introspects every connected data
source (CMOTS, APIs) so new integrations / tables / columns are always known.
Runs nightly (00:00 IST) and on demand from the Agents page, reporting progress,
status, and what was newly identified since the last run.
"""
from __future__ import annotations

import logging

from app.db.database import utcnow

log = logging.getLogger(__name__)

_status = {
    "running": False,
    "last_run": None,
    "last_error": "",
    "app_tables": [],          # allowed app analytics tables (last run)
    "sources": [],             # [{name, tables}] per connected source (last run)
    "new_app_tables": [],      # app tables newly discovered on the last run
    "new_source_tables": [],   # [{source, tables:[...]}] newly discovered on last run
}


def status() -> dict:
    s = dict(_status)
    # don't surface raw internal table-name lists
    s["sources"] = [{"name": x["name"], "tables": x.get("tables", 0)}
                    for x in (_status.get("sources") or [])]
    return s


def run() -> dict:
    """Refresh app + source schemas, record deltas. Safe to call anytime."""
    if _status["running"]:
        return {"ok": False, "error": "already running", **status()}
    _status["running"] = True
    _status["last_error"] = ""
    try:
        # ---- app DB schema ------------------------------------------------
        prev_app = set(_status.get("app_tables") or [])
        app_tables = []
        try:
            from app.services import db_query
            db_query.refresh_schema()
            app_tables = sorted((db_query.allowed_tables() - db_query.USER_VIEWS))
        except Exception as e:
            log.warning("schema_agent app refresh failed: %s", e)
        new_app = sorted(set(app_tables) - prev_app) if prev_app else []

        # ---- connected sources (CMOTS, APIs) ------------------------------
        prev_src = {s["name"]: set(s.get("_tnames") or []) for s in (_status.get("sources") or [])}
        sources, new_src = [], []
        try:
            from app.services import data_sources as ds
            for s in ds.enabled_sources():
                try:
                    schema = ds.introspect(s)
                except Exception as e:
                    log.warning("reintrospect %s failed: %s", getattr(s, "name", "?"), e)
                    schema = s.schema_json or {}
                tnames = [t.get("table") for t in (schema.get("tables") or []) if t.get("table")]
                added = sorted(set(tnames) - prev_src.get(s.name, set())) if s.name in prev_src else []
                if added:
                    new_src.append({"source": s.name, "tables": added[:50]})
                sources.append({"name": s.name, "tables": len(tnames), "_tnames": tnames})
        except Exception as e:
            log.warning("schema_agent sources refresh failed: %s", e)

        _status.update(
            app_tables=app_tables,
            sources=[{"name": s["name"], "tables": s["tables"], "_tnames": s["_tnames"]} for s in sources],
            new_app_tables=new_app,
            new_source_tables=new_src,
            last_run=utcnow().isoformat(),
        )
        return {"ok": True, "app_tables": len(app_tables),
                "sources": [{"name": s["name"], "tables": s["tables"]} for s in sources],
                "new_app_tables": new_app, "new_source_tables": new_src}
    except Exception as e:
        _status["last_error"] = str(e)[:200]
        return {"ok": False, "error": str(e)[:200]}
    finally:
        _status["running"] = False
