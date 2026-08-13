"""Auth API: login + current user. Self-registration is disabled —
the initial admin is seeded from .env (ADMIN_EMAIL/ADMIN_PASSWORD) at startup,
and admins create further users via /api/v1/admin/users."""
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr

from app.core.auth import (get_current_user, hash_password, issue_tokens,
                           password_error, rotate_refresh, start_new_session, verify_password)
from app.core.compliance import audit_log
from app.db.database import SessionLocal, User
from app.core import registration
from app.services.app_settings import get_setting

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _client_ip(request: Request) -> str:
    """Real client IP, honouring the nginx X-Forwarded-For chain."""
    xff = request.headers.get("x-forwarded-for", "")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else ""


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
            "tos_ok": bool(getattr(u, "tos_accepted", False)) and (getattr(u, "tos_seq", None) or 0) >= (get_setting("tos_min_seq") or 1),
            "created_at": u.created_at.isoformat() if u.created_at else None}


@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, request: Request):
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
    if bool(get_setting("maintenance_mode")):
        from app.core.auth import effective_access
        if not effective_access(user)[1]:
            raise HTTPException(503, get_setting("maintenance_message")
                                or "The app is under maintenance. Please try again later.")
    if (getattr(user, "auth_provider", "email") == "email" and not user.email_verified
            and bool(get_setting("require_email_verification"))):
        raise HTTPException(403,
            "Please verify your email first \u2014 check your inbox for the verification link.")
    audit_log("login_success", user=user.email)
    import secrets
    from datetime import datetime, timezone
    db2 = SessionLocal()
    try:
        u2 = db2.get(User, user.id)
        if u2:
            u2.last_ip = _client_ip(request)
            u2.last_login_at = datetime.now(timezone.utc)
            u2.session_id = secrets.token_hex(8)   # new session invalidates any other
            db2.commit()
            user.session_id = u2.session_id
    finally:
        db2.close()
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


@router.post("/accept-terms")
def accept_terms(request: Request, user: User = Depends(get_current_user)):
    res = registration.accept_terms(user.id, ip=_client_ip(request))
    audit_log("tos_accepted", user=user.email, version=res.get("tos_version"))
    return res


@router.get("/terms")
def public_terms():
    """Public: current Terms & Conditions content + version for the site + consent."""
    return {"version": get_setting("tos_version") or "1.0",
            "html": get_setting("tos_html") or "",
            "support_email": get_setting("support_email") or ""}


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
    perr = password_error(req.new_password)
    if perr:
        raise HTTPException(400, perr)
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
    tos_accepted: bool = False


class GoogleRequest(BaseModel):
    id_token: str
    invite_code: str | None = None
    tos_accepted: bool = False


class WaitlistRequest(BaseModel):
    email: EmailStr


@router.get("/registration-info")
def registration_info():
    """Public: what the signup UI should show (mode, waitlist, google availability)."""
    from app.services.app_settings import get_setting
    from app.config import get_settings
    return {"mode": get_setting("registration_mode") or "invite_only",
            "waitlist_enabled": bool(get_setting("waitlist_enabled")),
            "platform_label": get_setting("platform_label") or "NIYTRI AI",
            "google_enabled": bool((get_settings().google_oauth_client_id or "").strip()),
            "google_client_id": (get_settings().google_oauth_client_id or "").strip()}


@router.get("/invite-info")
def get_invite_info(code: str):
    """Public: validity + the email an invite code was issued to (for prefill)."""
    return registration.invite_info(code)


@router.post("/register")
def register(req: RegisterRequest, request: Request):
    res = registration.register_email(req.email, req.password, req.full_name, req.invite_code,
                                      signup_ip=_client_ip(request), tos_accepted=req.tos_accepted)
    if res.get("needs_verification"):
        audit_log("register_pending", user=req.email.lower(), provider="email")
        return {"needs_verification": True, "delivered": bool(res.get("delivered")),
                "resent": bool(res.get("resent")), "verify_link": res.get("verify_link")}
    user = res["user"]
    user.session_id = start_new_session(user.id)
    audit_log("register", user=user.email, provider="email",
              invited_by=user.invited_by_code or "")
    return TokenResponse(**issue_tokens(user), user=_user_dict(user))


class VerifyRequest(BaseModel):
    token: str


@router.post("/verify", response_model=TokenResponse)
def verify_email(req: VerifyRequest):
    """Confirm an email via the emailed token and log the user in."""
    user = registration.verify_email_token(req.token)
    user.session_id = start_new_session(user.id)
    audit_log("email_verified", user=user.email)
    return TokenResponse(**issue_tokens(user), user=_user_dict(user))


class ResendRequest(BaseModel):
    email: EmailStr


@router.post("/resend-verification")
def resend_verification(req: ResendRequest):
    return registration.resend_verification(req.email)


@router.post("/google")
def google_auth(req: GoogleRequest, request: Request):
    user, created = registration.login_or_register_google(req.id_token, req.invite_code,
                                                          signup_ip=_client_ip(request), tos_accepted=req.tos_accepted)
    user.session_id = start_new_session(user.id)
    audit_log("login_google" if not created else "register", user=user.email, provider="google")
    return {**issue_tokens(user), "user": _user_dict(user), "created": created}


@router.post("/waitlist")
def join_waitlist(req: WaitlistRequest):
    res = registration.add_to_waitlist(req.email)
    return {"ok": True, **res}


class ForgotRequest(BaseModel):
    email: EmailStr


@router.post("/forgot-password")
def forgot_password(req: ForgotRequest):
    return registration.reset_password(req.email)


@router.post("/create-invite-code")
def create_invite_code(user: User = Depends(get_current_user)):
    res = registration.create_share_code(user.id)
    audit_log("invite_code_created", user=user.email)
    return res


@router.get("/my-invites")
def my_invites(user: User = Depends(get_current_user)):
    return registration.my_invites(user.id)


class SendInvitesRequest(BaseModel):
    emails: list[str]


class ResendInviteReq(BaseModel):
    email: EmailStr


@router.post("/resend-invite")
def resend_invite(req: ResendInviteReq, user: User = Depends(get_current_user)):
    res = registration.resend_invite(user.id, req.email)
    audit_log("invite_resend", user=user.email, to=str(req.email), delivered=res.get("delivered"))
    return res


@router.post("/send-invites")
def send_invites(req: SendInvitesRequest, user: User = Depends(get_current_user)):
    res = registration.send_invites(user.id, req.emails)
    audit_log("invites_sent", user=user.email, count=len(res.get("sent", [])))
    return res
