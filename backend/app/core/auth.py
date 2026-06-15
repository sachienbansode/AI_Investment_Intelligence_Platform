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
TOKEN_TTL_HOURS = 12

_bearer = HTTPBearer(auto_error=False)


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user: User) -> str:
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "admin": bool(user.is_admin),
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def _decode(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = _decode(creds.credentials)
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
