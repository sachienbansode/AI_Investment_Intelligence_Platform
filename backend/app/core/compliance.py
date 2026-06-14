"""SEBI-compliance helpers: AI disclaimer, audit logging, consent.

Every AI-generated payload carries the disclaimer (BRD: 'AI disclaimer',
'audit logs', 'explainability', 'model governance').
"""
import json
import logging
import os
import time
import uuid
from logging.handlers import RotatingFileHandler

AI_DISCLAIMER = (
    "This output is AI-generated and must be reviewed and approved before "
    "business or regulatory use. It is for informational purposes only and "
    "is not investment advice or a recommendation to buy or sell securities. "
    "Investments in securities markets are subject to market risks. "
    "Please consult a SEBI-registered investment adviser before investing."
)

def audit_log_path() -> str:
    """Resolved path of the immutable audit trail (configurable for Docker)."""
    from app.config import get_settings
    return get_settings().audit_log_path

_audit_logger = logging.getLogger("audit")
if not _audit_logger.handlers:
    _audit_logger.setLevel(logging.INFO)
    _path = audit_log_path()
    _dir = os.path.dirname(_path)
    if _dir:
        os.makedirs(_dir, exist_ok=True)
    handler = RotatingFileHandler(_path, maxBytes=10_000_000, backupCount=10)
    handler.setFormatter(logging.Formatter("%(message)s"))
    _audit_logger.addHandler(handler)


def audit_log(event: str, **fields) -> str:
    """Write an immutable, structured audit record. Returns the audit id."""
    audit_id = str(uuid.uuid4())
    record = {"audit_id": audit_id, "ts": time.time(), "event": event, **fields}
    _audit_logger.info(json.dumps(record, default=str))
    return record["audit_id"]


def with_disclaimer(payload: dict) -> dict:
    payload.setdefault("disclaimer", AI_DISCLAIMER)
    return payload
