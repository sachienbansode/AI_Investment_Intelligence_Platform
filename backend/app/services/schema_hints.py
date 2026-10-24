"""Semantic schema hints — plain-English descriptions of tables/columns.

The schema agent calls describe_missing() so the query planner understands new data
(not just column names). Descriptions are stored per scope ('app' or a source name)
and merged into the schema docs handed to the assistant / screener planners.
"""
from __future__ import annotations

import logging

from app.db.database import SchemaHint, SessionLocal, utcnow

log = logging.getLogger(__name__)


def get_hints(scope: str) -> dict:
    db = SessionLocal()
    try:
        return {h.table_name.lower(): h.description
                for h in db.query(SchemaHint).filter_by(scope=scope).all()
                if h.description}
    except Exception:
        return {}
    finally:
        db.close()


def set_hint(scope: str, table: str, desc: str):
    db = SessionLocal()
    try:
        row = (db.query(SchemaHint).filter_by(scope=scope, table_name=table).first())
        if row:
            row.description = desc
            row.updated_at = utcnow()
        else:
            db.add(SchemaHint(scope=scope, table_name=table, description=desc))
        db.commit()
    except Exception as e:
        log.warning("set_hint failed (%s.%s): %s", scope, table, e)
        db.rollback()
    finally:
        db.close()


async def describe_missing(scope: str, tables_cols: dict, cap: int = 15) -> int:
    """For tables in `tables_cols` ({table: [columns]}) that have no stored hint yet,
    ask the LLM for a one-line description and store it. Capped per run to bound cost.
    Returns the number of new descriptions written."""
    have = set(get_hints(scope).keys())
    todo = [(t, cols) for t, cols in tables_cols.items()
            if t.lower() not in have][:max(0, cap)]
    if not todo:
        return 0
    from app.llm.router import get_llm_router
    router = get_llm_router()
    sys = ("You document a database table for an Indian-equities analytics platform. "
           "Given a table name and its columns, write ONE short plain-English sentence "
           "(max ~25 words) describing what the table holds and what its most important "
           "columns mean. Output ONLY that sentence, no preamble.")
    n = 0
    for table, cols in todo:
        try:
            usr = f"Table: {table}\nColumns: {', '.join(cols[:40])}"
            r = await router.complete(sys, usr, task="schema_describe",
                                      max_tokens=90, temperature=0.1)
            desc = (r.text or "").strip().replace("\n", " ")[:300]
            if desc:
                set_hint(scope, table, desc)
                n += 1
        except Exception as e:
            log.warning("describe %s.%s failed: %s", scope, table, e)
    return n
