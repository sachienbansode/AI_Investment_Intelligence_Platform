"""Auth API: login + current user. Self-registration is disabled —
the initial admin is seeded from .env (ADMIN_EMAIL/ADMIN_PASSWORD) at startup,
and admins create further users via /api/v1/admin/users."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from app.core.auth import create_token, get_current_user, verify_password
from app.core.compliance import audit_log
from app.db.database import SessionLocal, User

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


def _user_dict(u: User) -> dict:
    return {"id": u.id, "email": u.email, "full_name": u.full_name,
            "is_admin": bool(u.is_admin)}


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
    return TokenResponse(access_token=create_token(user), user=_user_dict(user))


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return _user_dict(user)
