"""Self-service registration with invite-only mode + referral codes.

Modes (app setting `registration_mode`):
  invite_only  - a valid, non-exhausted invite code is required to sign up
  open         - anyone can sign up; a code is optional (still recorded)
  closed       - self-service signup disabled (admins create users)

Referral: every new member gets their OWN invite code (max_uses = invites_per_user,
default 5). Signing up with someone's code increments that code's used_count and
records invited_by_code on the new user, so the referral graph stays intact.
"""
import logging
import re
import secrets

from fastapi import HTTPException, status

from app.core.auth import hash_password
from app.db.database import InviteCode, Invitation, SessionLocal, User, Waitlist, utcnow
from app.services.app_settings import get_setting

log = logging.getLogger(__name__)

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
    """Create an email/password account. Returns a dict:
    {"needs_verification": bool, "user": User|None, "delivered": bool, "verify_link": str|None}.
    When email verification is required, no login tokens are issued until the user
    confirms via the emailed link."""
    email = (email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    if len(password or "") < 6:
        raise HTTPException(400, "Password must be at least 6 characters.")
    mode = get_setting("registration_mode") or "invite_only"
    if mode == "closed":
        raise HTTPException(403, "Sign-ups are closed. Please contact your administrator.")
    require_verify = bool(get_setting("require_email_verification"))

    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            # Registered but never verified? Re-send the link instead of a dead end.
            if require_verify and existing.auth_provider == "email" and not existing.email_verified:
                token = _new_verify_token(db, existing)
                db.commit()
                delivered = _send_verification_email(email, token, existing.full_name)
                return {"needs_verification": True, "user": None, "resent": True,
                        "delivered": delivered,
                        "verify_link": None if delivered else _verify_link(token)}
            raise HTTPException(400, "An account with this email already exists. Try logging in.")
        code_row = None
        if invite_code and invite_code.strip():
            code_row = _redeem(db, invite_code)
        elif mode == "invite_only":
            raise HTTPException(400, "An invite code is required to join the beta.")
        user = User(email=email, full_name=(full_name or "").strip() or email.split("@")[0],
                    hashed_password=hash_password(password), is_admin=False, is_active=True,
                    auth_provider="email", email_verified=not require_verify)
        db.add(user)
        _finalize_new_user(db, user, code_row)
        token = _new_verify_token(db, user) if require_verify else None
        db.commit()
        db.refresh(user)
        if require_verify:
            delivered = _send_verification_email(email, token, user.full_name)
            return {"needs_verification": True, "user": None, "delivered": delivered,
                    "verify_link": None if delivered else _verify_link(token)}
        db.expunge(user)
        return {"needs_verification": False, "user": user, "delivered": True, "verify_link": None}
    finally:
        db.close()


def _new_verify_token(db, user) -> str:
    token = secrets.token_urlsafe(24)
    user.verify_token = token
    user.email_verified = False
    return token


def _verify_link(token: str) -> str:
    from app.config import get_settings
    base = (get_settings().app_base_url or "").rstrip("/")
    return (base + "/?verify=" + token) if base else ("/?verify=" + token)


def _send_verification_email(to: str, token: str, name: str) -> bool:
    from app.config import get_settings
    s = get_settings()
    if not (s.smtp_host and s.smtp_from):
        return False
    link = _verify_link(token)
    subject = "Verify your email for NIYTRI AI"
    body = (f"Hi {name or ''},\n\nConfirm your email to activate your NIYTRI AI account:\n"
            f"{link}\n\nIf you didn\u2019t create this account, you can ignore this email.\n\n"
            f"\u2014 NIYTRI Technologies")
    try:
        import smtplib
        from email.mime.text import MIMEText
        msg = MIMEText(body); msg["Subject"] = subject; msg["From"] = s.smtp_from; msg["To"] = to
        srv = smtplib.SMTP(s.smtp_host, int(s.smtp_port or 587), timeout=12)
        srv.starttls()
        if s.smtp_user:
            srv.login(s.smtp_user, s.smtp_password)
        srv.sendmail(s.smtp_from, [to], msg.as_string()); srv.quit()
        return True
    except Exception as e:
        log.warning("verification email to %s failed: %s", to, e)
        return False


def verify_email_token(token: str):
    """Consume a verification token and mark the account verified. Returns the User."""
    token = (token or "").strip()
    if not token:
        raise HTTPException(400, "Missing verification token.")
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.verify_token == token).first()
        if not user:
            raise HTTPException(400, "This verification link is invalid or has already been used.")
        user.email_verified = True
        user.verify_token = None
        db.commit()
        db.refresh(user)
        db.expunge(user)
        return user
    finally:
        db.close()


def resend_verification(email: str) -> dict:
    """Re-issue and send a verification link. Silent about whether the account exists."""
    email = (email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    db = SessionLocal()
    delivered = False
    try:
        user = db.query(User).filter(User.email == email).first()
        if user and user.auth_provider == "email" and not user.email_verified:
            token = _new_verify_token(db, user)
            db.commit()
            delivered = _send_verification_email(email, token, user.full_name)
    finally:
        db.close()
    return {"ok": True, "delivered": delivered}


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


def add_to_waitlist(email: str) -> dict:
    """Add an email to the waitlist. Returns {"status": added|exists, "position", "total"}."""
    email = (email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    if not bool(get_setting("waitlist_enabled")):
        raise HTTPException(403, "The waitlist is closed right now.")
    if db_user_exists(email):
        raise HTTPException(400, "You already have an account with this email. Try logging in.")
    db = SessionLocal()
    try:
        row = db.query(Waitlist).filter(Waitlist.email == email).first()
        if row:
            position = db.query(Waitlist).filter(Waitlist.id <= row.id).count()
            total = db.query(Waitlist).count()
            return {"status": "exists", "position": position, "total": total}
        db.add(Waitlist(email=email))
        db.commit()
        total = db.query(Waitlist).count()
        return {"status": "added", "position": total, "total": total}
    finally:
        db.close()


def db_user_exists(email: str) -> bool:
    db = SessionLocal()
    try:
        return bool(db.query(User.id).filter(User.email == email.lower()).first())
    finally:
        db.close()


def _send_invite_email(to: str, code: str, inviter_name: str) -> bool:
    from app.config import get_settings
    s = get_settings()
    link = f"{(s.app_base_url or '').rstrip('/')}/?invite={code}"
    if not (s.smtp_host and s.smtp_from):
        return False
    subject = "You\u2019re invited to NIYTRI AI"
    body = (f"{inviter_name or 'A friend'} invited you to NIYTRI AI \u2014 AI-powered, "
            f"explainable stock intelligence for Indian markets.\n\n"
            f"Join with invite code {code} or use this link:\n{link}\n\n"
            f"\u2014 NIYTRI Technologies")
    try:
        import smtplib
        from email.mime.text import MIMEText
        msg = MIMEText(body); msg["Subject"] = subject; msg["From"] = s.smtp_from; msg["To"] = to
        srv = smtplib.SMTP(s.smtp_host, int(s.smtp_port or 587), timeout=12)
        srv.starttls()
        if s.smtp_user:
            srv.login(s.smtp_user, s.smtp_password)
        srv.sendmail(s.smtp_from, [to], msg.as_string()); srv.quit()
        return True
    except Exception as e:
        log.warning("invite email to %s failed: %s", to, e)
        return False


def send_invites(user_id: int, emails: list[str]) -> dict:
    """Send up to invites_per_user email invites. Validates format, dedupes, skips
    existing members / already-invited, enforces the max, and emails (or records
    for manual sharing if SMTP isn't configured)."""
    max_n = int(get_setting("invites_per_user") or 5)
    db = SessionLocal()
    try:
        me = db.get(User, user_id)
        if not me.referral_code:
            me.referral_code = _issue_member_code(db, user_id)
            db.commit(); db.refresh(me)
        code = me.referral_code
        already = db.query(Invitation).filter_by(inviter_user_id=user_id).count()
        remaining = max(0, max_n - already)

        clean, seen = [], set()
        for e in (emails or [])[:max_n]:
            e = (e or "").strip().lower()
            if not e:
                continue
            if not _EMAIL_RE.match(e):
                raise HTTPException(400, f"Not a valid email address: {e}")
            if e == (me.email or "").lower():
                raise HTTPException(400, "You can\u2019t invite yourself.")
            if e not in seen:
                seen.add(e); clean.append(e)
        if not clean:
            raise HTTPException(400, "Enter at least one email address.")
        if len(clean) > remaining:
            raise HTTPException(400, f"You can send {remaining} more invite(s).")

        sent, skipped = [], []
        for e in clean:
            if db.query(User.id).filter(User.email == e).first():
                skipped.append({"email": e, "reason": "already a member"}); continue
            if db.query(Invitation.id).filter_by(inviter_user_id=user_id, email=e).first():
                skipped.append({"email": e, "reason": "already invited"}); continue
            delivered = _send_invite_email(e, code, me.full_name or "")
            db.add(Invitation(inviter_user_id=user_id, email=e, code=code,
                              status="sent", delivered=delivered))
            sent.append({"email": e, "delivered": delivered})
        db.commit()
        new_total = db.query(Invitation).filter_by(inviter_user_id=user_id).count()
        return {"sent": sent, "skipped": skipped, "code": code,
                "remaining": max(0, max_n - new_total),
                "emailed": all(x["delivered"] for x in sent) if sent else True}
    finally:
        db.close()


def my_invites(user_id: int) -> dict:
    """The member's referral code, invites remaining, and who they've invited."""
    max_n = int(get_setting("invites_per_user") or 5)
    db = SessionLocal()
    try:
        row = db.query(InviteCode).filter_by(owner_user_id=user_id).first()
        if not row:
            _issue_member_code(db, user_id); db.commit()
            row = db.query(InviteCode).filter_by(owner_user_id=user_id).first()
        invs = db.query(Invitation).filter_by(inviter_user_id=user_id).order_by(
            Invitation.created_at.desc()).all()
        joined = {u.email for u in db.query(User.email)
                  .filter(User.invited_by_code == row.code).all()}
        items = [{"email": i.email,
                  "status": "joined" if i.email in joined else ("sent" if i.delivered else "shared"),
                  "created_at": i.created_at.isoformat() if i.created_at else None} for i in invs]
        sent_count = len(invs)
        return {"code": row.code, "max": max_n, "sent": sent_count,
                "remaining": max(0, max_n - sent_count),
                "redeemed": row.used_count or 0, "invitations": items}
    finally:
        db.close()
