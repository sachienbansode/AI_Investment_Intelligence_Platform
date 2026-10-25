"""Partner Open API authentication: API keys (hashed), scopes, rate limiting.

A partner sends its key as `Authorization: Bearer niy_live_...` (or `X-API-Key`).
We store only sha256(key); lookup is by that hash. Each key carries a set of
scopes (which endpoint groups it may call) and a per-minute rate limit.

This is intentionally separate from the end-user JWT auth in core/auth.py so
partner access is governed independently and never grants end-user privileges.
"""
import hashlib
import ipaddress
import logging
import secrets
import time
from types import SimpleNamespace

from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

log = logging.getLogger(__name__)

from app.db.database import PartnerKey, SessionLocal, utcnow

KEY_PREFIX = "niy_live_"          # visible scheme tag for issued keys
ALL_SCOPES = ["scores", "news", "ask", "portfolio", "screen"]

_bearer = HTTPBearer(auto_error=False)

# In-process fixed-window rate limiter: {key_id: [window_start_epoch, count]}.
# Single uvicorn process per deploy (see CLAUDE.md), so this is sufficient; move
# to Redis if the API is ever scaled to multiple workers.
_rl: dict[int, list] = {}


def generate_key() -> tuple[str, str, str]:
    """Return (full_key, key_prefix_for_display, sha256_hash). The full key is
    shown to the admin exactly once and never stored in plaintext."""
    secret = secrets.token_hex(24)            # 48 hex chars, 192 bits
    full = KEY_PREFIX + secret
    return full, full[:len(KEY_PREFIX) + 6], hashlib.sha256(full.encode()).hexdigest()


def hash_key(full: str) -> str:
    return hashlib.sha256(full.encode()).hexdigest()


def _fernet():
    """Symmetric cipher derived from the server JWT secret (never leaves the server)."""
    import base64
    from cryptography.fernet import Fernet
    from app.config import get_settings
    secret = (get_settings().jwt_secret or "dev-secret-change-in-production").encode()
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret).digest()))


def encrypt_key(full: str) -> str:
    try:
        return _fernet().encrypt(full.encode()).decode()
    except Exception as e:
        log.warning("encrypt_key failed: %s", e)
        return ""


def decrypt_key(enc: str) -> str | None:
    if not enc:
        return None
    try:
        return _fernet().decrypt(enc.encode()).decode()
    except Exception as e:
        log.warning("decrypt_key failed: %s", e)
        return None


def _extract(creds, x_api_key) -> str | None:
    if creds and creds.credentials:
        return creds.credentials.strip()
    if x_api_key:
        return x_api_key.strip()
    return None


def _check_rate(key) -> None:
    limit = int(key.rate_limit_per_min or 60)
    now = time.time()
    win = _rl.get(key.id)
    if not win or now - win[0] >= 60:
        _rl[key.id] = [now, 1]
        return
    if win[1] >= limit:
        retry = int(60 - (now - win[0])) + 1
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Rate limit exceeded ({limit}/min). Retry in ~{retry}s.",
            headers={"Retry-After": str(retry)})
    win[1] += 1


def _ip_allowed(client_ip: str, allow: list) -> bool:
    """True if client_ip matches any entry (exact IP or CIDR) in the allowlist."""
    if not allow:
        return True                      # empty allowlist = no IP restriction
    try:
        ip = ipaddress.ip_address(client_ip)
    except ValueError:
        return False
    for entry in allow:
        e = str(entry).strip()
        if not e:
            continue
        try:
            if "/" in e:
                if ip in ipaddress.ip_network(e, strict=False):
                    return True
            elif ip == ipaddress.ip_address(e):
                return True
        except ValueError:
            continue
    return False


def authenticate(full_key: str | None, client_ip: str | None = None):
    """Validate the API key and return a detached snapshot of it (SimpleNamespace
    with id/name/key_prefix/scopes/rate_limit_per_min/is_active/call_count/allowed_ips).
    Raises 401 (missing/invalid/revoked), 403 (IP not allowed) or 429 (rate limited)."""
    if not full_key:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Missing API key. Send 'Authorization: Bearer <key>'.")
    db = SessionLocal()
    try:
        row = db.query(PartnerKey).filter_by(key_hash=hash_key(full_key)).first()
        if row is None or not row.is_active:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or revoked API key.")
        exp = getattr(row, "expires_at", None)
        if exp is not None and utcnow() >= exp:
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "This API key has expired.")
        allow = list(getattr(row, "allowed_ips", None) or [])
        if allow and not _ip_allowed(client_ip or "", allow):
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "This API key is not permitted from your IP address.")
        _check_rate(row)
        # Snapshot needed fields BEFORE commit (commit expires ORM attributes,
        # which would otherwise break attribute access on the returned object).
        snap = SimpleNamespace(
            id=row.id, name=row.name, key_prefix=row.key_prefix,
            scopes=list(row.scopes or []), rate_limit_per_min=row.rate_limit_per_min,
            is_active=row.is_active, allowed_ips=allow,
            call_count=(row.call_count or 0) + 1)
        # usage accounting (best-effort)
        row.last_used_at = utcnow()
        row.call_count = snap.call_count
        db.commit()
        return snap
    finally:
        db.close()


def _client_ip(request: Request, xff: str | None) -> str:
    """Real client IP — prefer the first X-Forwarded-For hop (behind nginx)."""
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request and request.client else ""


def require_scope(scope: str):
    """FastAPI dependency factory: authenticate the partner key and require a scope."""
    def _dep(request: Request,
             creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
             x_api_key: str | None = Header(default=None, alias="X-API-Key"),
             xff: str | None = Header(default=None, alias="X-Forwarded-For")):
        key = authenticate(_extract(creds, x_api_key), _client_ip(request, xff))
        if scope not in (key.scopes or []):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"This API key lacks the '{scope}' scope. Granted: {sorted(key.scopes or [])}.")
        return key
    return _dep


def require_any(request: Request,
                creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
                x_api_key: str | None = Header(default=None, alias="X-API-Key"),
                xff: str | None = Header(default=None, alias="X-Forwarded-For")):
    """Authenticate without requiring a specific scope (used by /me)."""
    return authenticate(_extract(creds, x_api_key), _client_ip(request, xff))
