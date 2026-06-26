"""JWT authentication: password hashing, token issue/verify, route guards.

Swap `get_current_user` for your trading app's SSO validation later — the rest
of the codebase only depends on the returned User.
"""
from datetime import datetime, timedelta, timezone

import bcrypt
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import get_settings
from app.db.database import ALL_PAGES, Role, SessionLocal, USER_PAGES, User

JWT_SECRET = get_settings().jwt_secret
JWT_ALGO = "HS256"

# Hard server-side session policy:
# - Access token is SHORT-lived; it is the only credential the API accepts. A
#   stolen access token therefore dies within ACCESS_TTL_MINUTES.
# - Refresh token has a SLIDING idle window (IDLE_TTL_MINUTES): each successful
#   refresh rotates it and resets the window, so a session that goes IDLE (no
#   refresh) for longer than the window can no longer be refreshed and is dead
#   server-side - regardless of what the browser does.
# - MAX_SESSION_HOURS is an absolute cap from original login that no amount of
#   refreshing can exceed (re-login required).
ACCESS_TTL_MINUTES = 15
IDLE_TTL_MINUTES = 60
MAX_SESSION_HOURS = 12

_bearer = HTTPBearer(auto_error=False)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_access_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "admin": bool(user.is_admin),
        "typ": "access",
        "exp": _now() + timedelta(minutes=ACCESS_TTL_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def create_refresh_token(user: User, login_at: int | None = None) -> str:
    """Sliding-window refresh token. `login_at` is the original login epoch
    (carried across rotations) so the absolute cap can be enforced."""
    login_at = login_at or int(_now().timestamp())
    payload = {
        "sub": str(user.id),
        "typ": "refresh",
        "lia": login_at,
        "exp": _now() + timedelta(minutes=IDLE_TTL_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


# Backwards-compatible alias (some callers/tests import create_token).
def create_token(user: User) -> str:
    return create_access_token(user)


def issue_tokens(user: User, login_at: int | None = None) -> dict:
    """Return the access+refresh pair and access lifetime (seconds)."""
    return {
        "access_token": create_access_token(user),
        "refresh_token": create_refresh_token(user, login_at),
        "expires_in": ACCESS_TTL_MINUTES * 60,
    }


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")


def rotate_refresh(refresh_token: str) -> dict:
    """Validate a refresh token (sliding idle window + absolute cap) and return
    a freshly rotated access+refresh pair. Raises 401 when the session is dead."""
    payload = _decode(refresh_token)
    if payload.get("typ") != "refresh":
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    login_at = int(payload.get("lia") or 0)
    if login_at and (_now().timestamp() - login_at) > MAX_SESSION_HOURS * 3600:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED,
                            "Session expired - please log in again")
    db = SessionLocal()
    try:
        user = db.get(User, int(payload["sub"]))
    finally:
        db.close()
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or disabled")
    return issue_tokens(user, login_at or None)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = _decode(creds.credentials)
    if payload.get("typ") == "refresh":
        # A refresh token must never be accepted as an API credential.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    db = SessionLocal()
    try:
        user = db.get(User, int(payload["sub"]))
    finally:
        db.close()
    if user is None or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or disabled")
    return user


def effective_access(user: User) -> tuple[list[str], bool]:
    """Return (allowed_pages, is_admin) for a user, honouring their RBAC role."""
    role = None
    if getattr(user, "role_id", None):
        db = SessionLocal()
        try:
            role = db.get(Role, user.role_id)
        finally:
            db.close()
    is_admin = bool(user.is_admin) or bool(role and role.is_admin)
    if is_admin:
        return list(ALL_PAGES), True
    if role and role.pages:
        return list(role.pages), False
    return list(USER_PAGES), False


def require_admin(user: User = Depends(get_current_user)) -> User:
    _, is_admin = effective_access(user)
    if not is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return user
