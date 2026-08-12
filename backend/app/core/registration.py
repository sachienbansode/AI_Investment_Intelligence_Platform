"""Self-service registration with invite-only mode + referral codes.

Modes (app setting `registration_mode`):
  invite_only  - a valid, non-exhausted invite code is required to sign up
  open         - anyone can sign up; a code is optional (still recorded)
  closed       - self-service signup disabled (admins create users)

Referral: every new member gets their OWN invite code (max_uses = invites_per_user,
default 5). Signing up with someone's code increments that code's used_count and
records invited_by_code on the new user, so the referral graph stays intact.
"""
import re
import secrets

from fastapi import HTTPException, status

from app.core.auth import hash_password
from app.db.database import InviteCode, SessionLocal, User, Waitlist, utcnow
from app.services.app_settings import get_setting

_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"   # no ambiguous chars
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _gen_code(db) -> str:
    for _ in range(20):
        code = "".join(secrets.choice(_ALPHABET) for _ in range(8))
        if not db.query(InviteCode.id).filter_by(code=code).first():
            return code
    return "".join(secrets.choice(_ALPHABET) for _ in range(10))


def _issue_member_code(db, user_id: int) -> str:
    """Create the new member's personal referral code (idempotent per user)."""
    existing = db.query(InviteCode).filter_by(owner_user_id=user_id).first()
    if existing:
        return existing.code
    code = _gen_code(db)
    db.add(InviteCode(code=code, owner_user_id=user_id,
                      max_uses=int(get_setting("invites_per_user") or 5),
                      used_count=0, is_active=True, created_by="member"))
    return code


def _redeem(db, code: str):
    """Validate + consume an invite code. Returns the InviteCode row or raises."""
    row = db.query(InviteCode).filter(InviteCode.code == code.strip().upper()).first()
    if not row or not row.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or inactive invite code.")
    if (row.used_count or 0) >= (row.max_uses or 0):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This invite code has been fully used.")
    return row


def _finalize_new_user(db, user: User, code_row):
    """Consume the inviter's code, link the referral, and issue the member's code."""
    if code_row is not None:
        code_row.used_count = (code_row.used_count or 0) + 1
        user.invited_by_code = code_row.code
    db.flush()  # ensure user.id
    user.referral_code = _issue_member_code(db, user.id)


def register_email(email: str, password: str, full_name: str, invite_code: str | None):
    email = (email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    if len(password or "") < 6:
        raise HTTPException(400, "Password must be at least 6 characters.")
    mode = get_setting("registration_mode") or "invite_only"
    if mode == "closed":
        raise HTTPException(403, "Sign-ups are closed. Please contact your administrator.")

    db = SessionLocal()
    try:
        if db.query(User.id).filter(User.email == email).first():
            raise HTTPException(400, "An account with this email already exists. Try logging in.")
        code_row = None
        if invite_code and invite_code.strip():
            code_row = _redeem(db, invite_code)
        elif mode == "invite_only":
            raise HTTPException(400, "An invite code is required to join the beta.")
        user = User(email=email, full_name=(full_name or "").strip() or email.split("@")[0],
                    hashed_password=hash_password(password), is_admin=False, is_active=True,
                    auth_provider="email",
                    email_verified=not bool(get_setting("require_email_verification")))
        db.add(user)
        _finalize_new_user(db, user, code_row)
        db.commit()
        db.refresh(user)
        return user
    finally:
        db.close()


def verify_google_id_token(id_token: str) -> dict:
    """Verify a Google Sign-In id_token via Google's tokeninfo endpoint. Returns
    {email, name, email_verified}. Requires google_oauth_client_id to be configured."""
    from app.config import get_settings
    client_id = (get_settings().google_oauth_client_id or "").strip()
    if not client_id:
        raise HTTPException(503, "Google sign-in is not configured on the server.")
    import httpx
    try:
        r = httpx.get("https://oauth2.googleapis.com/tokeninfo",
                      params={"id_token": id_token}, timeout=8)
        data = r.json() if r.status_code == 200 else {}
    except Exception:
        data = {}
    if not data or data.get("aud") != client_id:
        raise HTTPException(401, "Could not verify your Google sign-in.")
    email = (data.get("email") or "").lower()
    if not email:
        raise HTTPException(401, "Google account has no email.")
    return {"email": email, "name": data.get("name") or email.split("@")[0],
            "email_verified": str(data.get("email_verified")).lower() == "true"}


def login_or_register_google(id_token: str, invite_code: str | None):
    """Existing user -> login. New user -> register (needs a code in invite_only)."""
    info = verify_google_id_token(id_token)
    email = info["email"]
    mode = get_setting("registration_mode") or "invite_only"
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).first()
        if user:
            if not user.is_active:
                raise HTTPException(403, "Account disabled.")
            db.expunge(user)
            return user, False
        if mode == "closed":
            raise HTTPException(403, "Sign-ups are closed. Please contact your administrator.")
        code_row = None
        if invite_code and invite_code.strip():
            code_row = _redeem(db, invite_code)
        elif mode == "invite_only":
            raise HTTPException(400, "An invite code is required to join the beta.")
        user = User(email=email, full_name=info["name"], hashed_password="",
                    is_admin=False, is_active=True, auth_provider="google",
                    email_verified=info["email_verified"])
        db.add(user)
        _finalize_new_user(db, user, code_row)
        db.commit()
        db.refresh(user)
        db.expunge(user)
        return user, True
    finally:
        db.close()


def add_to_waitlist(email: str) -> None:
    email = (email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    if not bool(get_setting("waitlist_enabled")):
        raise HTTPException(403, "The waitlist is closed right now.")
    db = SessionLocal()
    try:
        if not db.query(Waitlist.id).filter(Waitlist.email == email).first():
            db.add(Waitlist(email=email))
            db.commit()
    finally:
        db.close()


def my_invites(user_id: int) -> dict:
    """The member's referral code + how many invites remain + who they've invited."""
    db = SessionLocal()
    try:
        row = db.query(InviteCode).filter_by(owner_user_id=user_id).first()
        if not row:
            code = _issue_member_code(db, user_id)
            db.commit()
            row = db.query(InviteCode).filter_by(owner_user_id=user_id).first()
        used = row.used_count or 0
        invitees = [u.email for u in db.query(User.email)
                    .filter(User.invited_by_code == row.code).all()]
        return {"code": row.code, "max": row.max_uses, "used": used,
                "remaining": max(0, (row.max_uses or 0) - used), "invited": invitees}
    finally:
        db.close()
