"""Auth API: login + current user. Self-registration is disabled —
the initial admin is seeded from .env (ADMIN_EMAIL/ADMIN_PASSWORD) at startup,
and admins create further users via /api/v1/admin/users."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from app.core.auth import (get_current_user, issue_tokens, rotate_refresh,
                           verify_password)
from app.core.compliance import audit_log
from app.db.database import SessionLocal, User

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str = ""
    expires_in: int = 0
    token_type: str = "bearer"
    user: dict


def _user_dict(u: User) -> dict:
    from app.core.auth import effective_access
    pages, is_admin = effective_access(u)
    return {"id": u.id, "email": u.email, "full_name": u.full_name,
            "is_admin": is_admin, "pages": pages, "role_id": u.role_id}


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest):
    db = SessionLocal()
    try:
        user = db.query(User).filter_by(email=req.email.lower()).first()
    finally:
        db.close()
    if not user or not verify_password(req.password, user.hashed_password or ""):
        audit_log("login_failed", user=req.email.lower())
        raise HTTPException(401, "Invalid email or password")
    if not user.is_active:
        raise HTTPException(403, "Account disabled")
    audit_log("login_success", user=user.email)
    return TokenResponse(**issue_tokens(user), user=_user_dict(user))


@router.post("/refresh", response_model=TokenResponse)
def refresh(req: RefreshRequest):
    """Exchange a valid (non-idle, within-cap) refresh token for a fresh
    access+refresh pair. 401 here means the session is dead server-side."""
    from app.core.auth import _decode
    tokens = rotate_refresh(req.refresh_token)
    sub = int(_decode(tokens["access_token"])["sub"])
    db = SessionLocal()
    try:
        user = db.get(User, sub)
    finally:
        db.close()
    return TokenResponse(**tokens, user=_user_dict(user))


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return _user_dict(user)
