"""Auth API: login + current user. Self-registration is disabled —
the initial admin is seeded from .env (ADMIN_EMAIL/ADMIN_PASSWORD) at startup,
and admins create further users via /api/v1/admin/users."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr

from app.core.auth import (get_current_user, hash_password, issue_tokens,
                           rotate_refresh, verify_password)
from app.core.compliance import audit_log
from app.db.database import SessionLocal, User
from app.core import registration

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
            "is_admin": is_admin, "pages": pages, "role_id": u.role_id,
            "avatar": getattr(u, "avatar", None),
            "created_at": u.created_at.isoformat() if u.created_at else None}


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


class ProfileUpdate(BaseModel):
    full_name: str | None = None
    avatar: str | None = None   # data:image/... URI, or "" to clear


class PasswordChange(BaseModel):
    current_password: str
    new_password: str


@router.put("/profile")
def update_profile(req: ProfileUpdate, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        u = db.get(User, user.id)
        if req.full_name is not None:
            fn = req.full_name.strip()
            if not (1 <= len(fn) <= 80):
                raise HTTPException(400, "Name must be 1-80 characters")
            u.full_name = fn
        if req.avatar is not None:
            av = req.avatar
            if av and not av.startswith("data:image/"):
                raise HTTPException(400, "Avatar must be a data:image/... URI or empty")
            if len(av) > 900000:
                raise HTTPException(400, "Image too large (max ~600KB)")
            u.avatar = av
        db.commit()
        db.refresh(u)
        audit_log("profile_update", user=u.email)
        return _user_dict(u)
    finally:
        db.close()


@router.post("/change-password")
def change_password(req: PasswordChange, user: User = Depends(get_current_user)):
    if len(req.new_password) < 6:
        raise HTTPException(400, "New password must be at least 6 characters")
    db = SessionLocal()
    try:
        u = db.get(User, user.id)
        if not verify_password(req.current_password, u.hashed_password or ""):
            raise HTTPException(400, "Current password is incorrect")
        u.hashed_password = hash_password(req.new_password)
        db.commit()
        audit_log("password_change", user=u.email)
        return {"ok": True}
    finally:
        db.close()


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str = ""
    invite_code: str | None = None


class GoogleRequest(BaseModel):
    id_token: str
    invite_code: str | None = None


class WaitlistRequest(BaseModel):
    email: EmailStr


@router.get("/registration-info")
def registration_info():
    """Public: what the signup UI should show (mode, waitlist, google availability)."""
    from app.services.app_settings import get_setting
    from app.config import get_settings
    return {"mode": get_setting("registration_mode") or "invite_only",
            "waitlist_enabled": bool(get_setting("waitlist_enabled")),
            "google_enabled": bool((get_settings().google_oauth_client_id or "").strip()),
            "google_client_id": (get_settings().google_oauth_client_id or "").strip()}


@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest):
    user = registration.register_email(req.email, req.password, req.full_name, req.invite_code)
    audit_log("register", user=user.email, provider="email",
              invited_by=user.invited_by_code or "")
    return TokenResponse(**issue_tokens(user), user=_user_dict(user))


@router.post("/google")
def google_auth(req: GoogleRequest):
    user, created = registration.login_or_register_google(req.id_token, req.invite_code)
    audit_log("login_google" if not created else "register", user=user.email, provider="google")
    return {**issue_tokens(user), "user": _user_dict(user), "created": created}


@router.post("/waitlist")
def join_waitlist(req: WaitlistRequest):
    registration.add_to_waitlist(req.email)
    return {"ok": True}


@router.get("/my-invites")
def my_invites(user: User = Depends(get_current_user)):
    return registration.my_invites(user.id)


class SendInvitesRequest(BaseModel):
    emails: list[str]


@router.post("/send-invites")
def send_invites(req: SendInvitesRequest, user: User = Depends(get_current_user)):
    res = registration.send_invites(user.id, req.emails)
    audit_log("invites_sent", user=user.email, count=len(res.get("sent", [])))
    return res
