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

from app.core.auth import hash_password, password_error
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


def _mint_code(db, owner_user_id: int, created_by: str = "member") -> str:
    """Create a UNIQUE, single-use invite code owned by a member. Each recipient
    gets their own code so it can't be reused or forwarded to extra people."""
    code = _gen_code(db)
    db.add(InviteCode(code=code, owner_user_id=owner_user_id, max_uses=1,
                      used_count=0, is_active=True, created_by=created_by))
    return code


def _is_expired(row) -> bool:
    """True if the invite code is older than invite_expiry_days."""
    import datetime
    days = int(get_setting("invite_expiry_days") or 30)
    created = getattr(row, "created_at", None)
    if not created:
        return False
    if created.tzinfo is None:
        created = created.replace(tzinfo=datetime.timezone.utc)
    return (datetime.datetime.now(datetime.timezone.utc) - created).days >= days


def _invite_email_for_code(db, code: str):
    """The email an invite code was issued to (if it's an emailed invitation)."""
    inv = db.query(Invitation).filter(Invitation.code == code.strip().upper()).first()
    return (inv.email or "").lower() if inv else None


def _redeem(db, code: str, email: str | None = None):
    """Validate + consume an invite code. If the code was emailed to a specific
    address, the registering email must match it (codes can't be forwarded)."""
    code = code.strip().upper()
    row = db.query(InviteCode).filter(InviteCode.code == code).first()
    if not row or not row.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid or inactive invite code.")
    if (row.used_count or 0) >= (row.max_uses or 0):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This invite code has already been used.")
    if _is_expired(row):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This invite code has expired. Please ask for a new one.")
    bound = _invite_email_for_code(db, code)
    if bound and email and bound != (email or "").lower():
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            "This invite code was issued for a different email address.")
    return row


def invite_info(code: str) -> dict:
    """Public: is this code usable, and which email was it issued to (for prefill)."""
    code = (code or "").strip().upper()
    if not code:
        return {"valid": False}
    db = SessionLocal()
    try:
        row = db.query(InviteCode).filter(InviteCode.code == code).first()
        if not row or not row.is_active:
            return {"valid": False}
        used = (row.used_count or 0) >= (row.max_uses or 0)
        expired = _is_expired(row)
        email = _invite_email_for_code(db, code)
        return {"valid": not used and not expired, "used": used, "expired": expired, "email": email}
    finally:
        db.close()


def _finalize_new_user(db, user: User, code_row):
    """Consume the inviter's code, link the referral, and issue the member's code."""
    if code_row is not None:
        code_row.used_count = (code_row.used_count or 0) + 1
        user.invited_by_code = code_row.code
    db.flush()  # ensure user.id
    db.query(Waitlist).filter(Waitlist.email == user.email).delete()  # they joined; drop from waitlist


def register_email(email: str, password: str, full_name: str, invite_code: str | None, signup_ip: str | None = None):
    """Create an email/password account. Returns a dict:
    {"needs_verification": bool, "user": User|None, "delivered": bool, "verify_link": str|None}.
    When email verification is required, no login tokens are issued until the user
    confirms via the emailed link."""
    email = (email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    perr = password_error(password)
    if perr:
        raise HTTPException(400, perr)
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
            code_row = _redeem(db, invite_code, email=email)
        elif mode == "invite_only":
            raise HTTPException(400, "An invite code is required to join the beta.")
        user = User(email=email, full_name=(full_name or "").strip() or email.split("@")[0],
                    hashed_password=hash_password(password), is_admin=False, is_active=True,
                    auth_provider="email", email_verified=not require_verify, signup_ip=signup_ip)
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
    from html import escape as _esc
    from app.services import emailer
    plat = emailer.platform_name()
    link = _verify_link(token)
    subject = f"Verify your email for {plat}"
    body = (f"Hi {name or ''},\n\nConfirm your email to activate your {plat} account:\n"
            f"{link}\n\nIf you didn\u2019t create this account, you can ignore this email.")
    inner = (
        f'<h1 style="margin:0 0 10px;font-size:22px;color:#181d27">Confirm your email</h1>'
        f'<p style="font-size:15px;line-height:1.7;color:#2a3140;margin:0 0 22px">'
        f'Hi {_esc(name or "there")}, please confirm your email to activate your <b>{_esc(plat)}</b> account.</p>'
        f'<p style="margin:0 0 24px">{emailer.button(link, "Verify My Email")}</p>'
        f'<p style="font-size:13px;color:#8a93a4;margin:0">Or paste this link into your browser:<br>'
        f'<a href="{link}" style="color:#F94C00;word-break:break-all">{link}</a></p>')
    delivered, _ = emailer.send_email(to, subject, body, html_inner=inner)
    return delivered


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


def _gen_password(n: int = 12) -> str:
    import string
    specials = "!@#$%^&*"
    pools = [string.ascii_uppercase, string.ascii_lowercase, string.digits, specials]
    pw = [secrets.choice(pool) for pool in pools]  # guarantee one of each
    allc = string.ascii_letters + string.digits + specials
    pw += [secrets.choice(allc) for _ in range(max(0, n - len(pw)))]
    secrets.SystemRandom().shuffle(pw)
    return "".join(pw)


def _send_password_email(to: str, newpw: str, name: str) -> bool:
    from html import escape as _esc
    from app.config import get_settings
    from app.services import emailer
    base = (get_settings().app_base_url or "").rstrip("/")
    plat = emailer.platform_name()
    subject = f"Your new {plat} password"
    body = (f"Hi {name or ''},\n\nAs requested, your password has been reset. Use this "
            f"temporary password to log in{(' at ' + base) if base else ''}:\n\n"
            f"    {newpw}\n\nPlease change it from your profile after logging in.\n\n"
            f"If you didn\u2019t request this, contact support immediately.")
    inner = (
        f'<h1 style="margin:0 0 10px;font-size:22px;color:#181d27">Your new password</h1>'
        f'<p style="font-size:15px;line-height:1.7;color:#2a3140;margin:0 0 18px">'
        f'Hi {_esc(name or "there")}, your password has been reset. Use this temporary password to log in:</p>'
        f'<div style="background:#f4f6fb;border:1px dashed #cfd8e6;border-radius:10px;padding:14px 16px;margin:0 0 22px;'
        f'font-family:monospace;font-size:20px;font-weight:700;letter-spacing:2px;color:#181d27;text-align:center">{_esc(newpw)}</div>'
        + (f'<p style="margin:0 0 22px">{emailer.button(base, "Log In")}</p>' if base else '')
        + f'<p style="font-size:13px;color:#8a93a4;margin:0">Please change it from your profile after logging in. '
          f'If you didn\u2019t request this, contact support immediately.</p>')
    delivered, _ = emailer.send_email(to, subject, body, html_inner=inner)
    return delivered


def reset_password(email: str) -> dict:
    """Forgot-password: generate a new temporary password, store it, and email it.
    Silent about whether the account exists. For email/password accounts only."""
    from app.config import get_settings
    email = (email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    db = SessionLocal()
    delivered = False
    newpw = None
    try:
        user = db.query(User).filter(User.email == email).first()
        if user and (user.auth_provider or "email") == "email":
            newpw = _gen_password()
            user.hashed_password = hash_password(newpw)
            db.commit()
            delivered = _send_password_email(email, newpw, user.full_name)
    finally:
        db.close()
    is_prod = (get_settings().environment or "").lower() == "production"
    return {"ok": True, "delivered": delivered,
            "temp_password": (newpw if (newpw and not delivered and not is_prod) else None)}


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


def login_or_register_google(id_token: str, invite_code: str | None, signup_ip: str | None = None):
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
            code_row = _redeem(db, invite_code, email=email)
        elif mode == "invite_only":
            raise HTTPException(400, "An invite code is required to join the beta.")
        user = User(email=email, full_name=info["name"], hashed_password="",
                    is_admin=False, is_active=True, auth_provider="google",
                    email_verified=info["email_verified"], signup_ip=signup_ip)
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
    from html import escape as _esc
    from app.config import get_settings
    from app.services import emailer
    plat = emailer.platform_name()
    link = f"{(get_settings().app_base_url or '').rstrip('/')}/?invite={code}"
    subject = f"You\u2019re invited to {plat}"
    body = (f"{inviter_name or 'A friend'} invited you to {plat} \u2014 AI-powered, "
            f"explainable stock intelligence for Indian markets.\n\n"
            f"Join with invite code {code} or use this link:\n{link}")
    feats = [
        ("Explainable AI scores", "Every NSE stock rated 0-100 daily, with the reason behind each score."),
        ("Ask-anything assistant", "Chat about any stock, your portfolio or the market - in your language."),
        ("Real-time smart alerts", "Know the moment a stock turns Strong or Weak - before the crowd."),
        ("Portfolio X-Ray", "Instant health score, concentration and sector-risk on your holdings."),
        ("Delayed charts + key stats", "Clean price charts with P/E, market cap and 52-week range."),
        ("AI market news", "The day's headlines, summarised and linked to the stocks they move."),
    ]
    rows = "".join(
        f'<tr><td style="padding:8px 0;vertical-align:top;width:22px">'
        f'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#F94C00"></span></td>'
        f'<td style="padding:8px 0"><b style="color:#181d27">{t}</b>'
        f'<div style="color:#6b7280;font-size:13.5px;line-height:1.5">{d}</div></td></tr>'
        for t, d in feats)
    # Today's top-scored stock (with a chart image) to spark interest.
    spot_html = ""
    try:
        base = (get_settings().app_base_url or "").rstrip("/")
        from app.services import spotlight as sp
        sd = sp.get_spotlight()
        if sd.get("available") and base:
            sc = round(sd.get("score") or 0)
            weights = get_setting("scoring_weights") or {}
            pk = sd.get("pillars") or {}
            LABELS = {"fundamental": "Fundamentals", "technical": "Technicals",
                      "valuation": "Valuation", "momentum": "Momentum", "earnings": "Earnings",
                      "news_sentiment": "News sentiment", "institutional": "Institutional", "risk": "Risk"}
            keys = sorted((weights or pk).keys(), key=lambda k: weights.get(k, 0), reverse=True)

            def _pcol(v):
                return "#12a06b" if v >= 65 else ("#c07d0a" if v >= 45 else "#e0503f")

            head = ('<tr>'
                    '<td style="padding:0 0 6px;color:#8a93a4;font-size:11px;text-transform:uppercase;letter-spacing:.4px">Pillar</td>'
                    '<td style="padding:0 0 6px;color:#8a93a4;font-size:11px;text-transform:uppercase;letter-spacing:.4px;text-align:center">Importance</td>'
                    '<td style="padding:0 0 6px;color:#8a93a4;font-size:11px;text-transform:uppercase;letter-spacing:.4px;text-align:right">Score</td></tr>')
            prows = "".join(
                f'<tr><td style="padding:7px 0;border-top:1px solid #f2f3f7;color:#2a3140">{LABELS.get(k, k.title())}</td>'
                f'<td style="padding:7px 0;border-top:1px solid #f2f3f7;text-align:center;color:#6b7280">{round(weights.get(k, 0) * 100)}%</td>'
                f'<td style="padding:7px 0;border-top:1px solid #f2f3f7;text-align:right;font-weight:700;color:{_pcol(round(pk.get(k, 0)))}">{round(pk.get(k, 0))}/100</td></tr>'
                for k in keys)
            table = ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
                     'style="font-size:13px;margin:10px 0 4px">' + head + prows + '</table>')
            tops = sorted(((LABELS.get(k, k.title()), round(pk.get(k, 0))) for k in keys),
                          key=lambda x: x[1], reverse=True)[:2]
            strengths = ", ".join(f"{n} ({v}/100)" for n, v in tops)
            spot_html = (
                '<div style="margin:26px 0 0;border:1px solid #f0f0f5;border-radius:12px;overflow:hidden">'
                '<div style="background:#fff7f0;padding:12px 16px;font-size:12px;font-weight:700;'
                'text-transform:uppercase;letter-spacing:.5px;color:#b25a12">Today’s top NIYTRI score</div>'
                '<div style="padding:14px 16px">'
                f'<div style="font-size:17px;font-weight:800;color:#181d27">{_esc(sd["symbol"])} '
                f'<span style="color:{_pcol(sc)}">{sc}/100</span> '
                f'<span style="color:#6b7280;font-weight:400;font-size:13px">{_esc(sd.get("name") or "")}</span></div>'
                f'<img src="{base}/api/v1/public/spotlight-chart.png" width="536" alt="Score trend" '
                'style="display:block;width:100%;max-width:536px;border-radius:8px;margin:12px 0;border:1px solid #f2f3f7">'
                f'<div style="font-size:13px;color:#2a3140;margin:0 0 4px">The NIYTRI Score blends <b>8 pillars</b> by importance. '
                f'<b>{_esc(sd["symbol"])}</b> leads on <b>{_esc(strengths)}</b>.</div>'
                + table +
                '</div></div>')
    except Exception:
        spot_html = ""
    inner = (
        f'<h1 style="margin:0 0 12px;font-size:24px;color:#181d27">You\u2019re invited to {_esc(plat)} <span style="color:#F94C00">Pro</span></h1>'
        f'<p style="font-size:15px;line-height:1.7;color:#2a3140;margin:0 0 20px">'
        f'<b>{_esc(inviter_name or "A friend")}</b> invited you to {_esc(plat)} \u2014 AI-powered, explainable stock '
        f'intelligence for Indian markets. Join the invite-only beta and unlock your <b>Pro workspace</b>.</p>'
        f'<p style="margin:0 0 18px">{emailer.button(link, "Create My Pro Account")}</p>'
        f'<div style="background:#fff7f0;border:1px solid #ffd9bd;border-radius:10px;padding:12px 16px;margin:0 0 24px;font-size:14px;color:#7a4a1e">'
        f'Your invite code: <b style="letter-spacing:1px;font-size:16px;color:#F94C00">{code}</b></div>'
        f'<div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#b25a12;margin:0 0 6px">What you get</div>'
        f'<table role="presentation" cellpadding="0" cellspacing="0" width="100%">{rows}</table>'
        f'{spot_html}'
        f'<p style="font-size:12.5px;color:#8a93a4;margin:22px 0 0">Or paste this link:<br>'
        f'<a href="{link}" style="color:#F94C00;word-break:break-all">{link}</a></p>')
    delivered, _ = emailer.send_email(to, subject, body, html_inner=inner)
    return delivered


def send_invites(user_id: int, emails: list[str]) -> dict:
    """Send email invites, each with its OWN unique single-use code. Validates
    format, dedupes, skips existing members / already-invited, enforces the cap."""
    max_n = int(get_setting("invites_per_user") or 5)
    db = SessionLocal()
    try:
        me = db.get(User, user_id)
        used = db.query(InviteCode).filter_by(owner_user_id=user_id).count()
        remaining = max(0, max_n - used)
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
            code = _mint_code(db, user_id); db.flush()
            delivered = _send_invite_email(e, code, me.full_name or "")
            db.add(Invitation(inviter_user_id=user_id, email=e, code=code,
                              status="sent", delivered=delivered))
            sent.append({"email": e, "delivered": delivered})
        db.commit()
        used2 = db.query(InviteCode).filter_by(owner_user_id=user_id).count()
        return {"sent": sent, "skipped": skipped, "remaining": max(0, max_n - used2),
                "emailed": all(x["delivered"] for x in sent) if sent else True}
    finally:
        db.close()


def resend_invite(user_id: int, email: str) -> dict:
    """Re-send an existing invitation using its OWN unique code (spam/deleted)."""
    email = (email or "").strip().lower()
    db = SessionLocal()
    try:
        me = db.get(User, user_id)
        inv = db.query(Invitation).filter_by(inviter_user_id=user_id, email=email).first()
        if not inv:
            raise HTTPException(404, "No invitation found for that email.")
        already = bool(db.query(User.id).filter(User.email == email).first())
        code = inv.code or _mint_code(db, user_id)
        if not inv.code:
            inv.code = code
        db.commit()
        name = me.full_name or ""
    finally:
        db.close()
    if already:
        return {"delivered": False, "already_member": True}
    delivered = _send_invite_email(email, code, name)
    db = SessionLocal()
    try:
        inv = db.query(Invitation).filter_by(inviter_user_id=user_id, email=email).first()
        if inv and delivered and not inv.delivered:
            inv.delivered = True
            db.commit()
    finally:
        db.close()
    return {"delivered": delivered, "already_member": False}


def create_share_code(user_id: int) -> dict:
    """Mint one unique single-use code the member can share manually (counts
    against their invite limit)."""
    max_n = int(get_setting("invites_per_user") or 5)
    db = SessionLocal()
    try:
        used = db.query(InviteCode).filter_by(owner_user_id=user_id).count()
        if used >= max_n:
            raise HTTPException(400, "You\u2019ve used all your invites.")
        code = _mint_code(db, user_id, created_by="member-share")
        db.commit()
        return {"code": code, "remaining": max(0, max_n - (used + 1))}
    finally:
        db.close()
    if already:
        return {"delivered": False, "already_member": True}
    delivered = _send_invite_email(email, code, name)
    db = SessionLocal()
    try:
        inv = db.query(Invitation).filter_by(inviter_user_id=user_id, email=email).first()
        if inv and delivered and not inv.delivered:
            inv.delivered = True
            db.commit()
    finally:
        db.close()
    return {"delivered": delivered, "already_member": False}


def my_invites(user_id: int) -> dict:
    """Invites remaining and who they've invited (each invite has its own code)."""
    max_n = int(get_setting("invites_per_user") or 5)
    db = SessionLocal()
    try:
        codes = [c.code for c in db.query(InviteCode).filter_by(owner_user_id=user_id).all()]
        used = len(codes)
        invs = db.query(Invitation).filter_by(inviter_user_id=user_id).order_by(
            Invitation.created_at.desc()).all()
        joined = set()
        redeemed = 0
        if codes:
            joined = {u.email for u in db.query(User.email).filter(User.invited_by_code.in_(codes)).all()}
            redeemed = db.query(User.id).filter(User.invited_by_code.in_(codes)).count()
        items = [{"email": i.email, "code": i.code,
                  "status": "joined" if i.email in joined else ("sent" if i.delivered else "shared"),
                  "created_at": i.created_at.isoformat() if i.created_at else None} for i in invs]
        return {"max": max_n, "sent": len(invs), "remaining": max(0, max_n - used),
                "redeemed": redeemed, "invitations": items}
    finally:
        db.close()
