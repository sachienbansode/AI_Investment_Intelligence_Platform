"""Outbound email. Provider is admin-configurable (DB-backed, not .env):

  graph  - Microsoft 365 via Graph API sendMail (app-only client credentials)
  smtp   - classic SMTP (host/user/pass from .env; being retired by Microsoft)
  off    - email disabled

All senders in the app go through send_email(); it returns (delivered, error).
"""
import logging

log = logging.getLogger(__name__)

_GRAPH = "https://graph.microsoft.com/v1.0"
_LOGIN = "https://login.microsoftonline.com"


def _s(key: str) -> str:
    from app.services.app_settings import get_setting
    return (get_setting(key) or "").strip()


def graph_configured() -> bool:
    return bool(_s("graph_tenant_id") and _s("graph_client_id")
               and _s("graph_client_secret") and _s("graph_sender"))


def _graph_token() -> str:
    import httpx
    tenant, cid, secret = _s("graph_tenant_id"), _s("graph_client_id"), _s("graph_client_secret")
    r = httpx.post(f"{_LOGIN}/{tenant}/oauth2/v2.0/token", timeout=15, data={
        "client_id": cid, "client_secret": secret,
        "scope": "https://graph.microsoft.com/.default",
        "grant_type": "client_credentials",
    })
    if r.status_code != 200:
        raise RuntimeError(f"token error {r.status_code}: {r.text[:200]}")
    tok = r.json().get("access_token")
    if not tok:
        raise RuntimeError("no access_token in token response")
    return tok


def _send_graph(to: str, subject: str, body: str) -> None:
    import httpx
    sender = _s("graph_sender")
    token = _graph_token()
    payload = {
        "message": {
            "subject": subject,
            "body": {"contentType": "Text", "content": body},
            "toRecipients": [{"emailAddress": {"address": to}}],
        },
        "saveToSentItems": False,
    }
    r = httpx.post(f"{_GRAPH}/users/{sender}/sendMail", timeout=20,
                   headers={"Authorization": "Bearer " + token,
                            "Content-Type": "application/json"}, json=payload)
    if r.status_code not in (200, 202):
        raise RuntimeError(f"sendMail {r.status_code}: {r.text[:300]}")


def _send_smtp(to: str, subject: str, body: str) -> None:
    from app.config import get_settings
    s = get_settings()
    if not (s.smtp_host and s.smtp_from):
        raise RuntimeError("SMTP not configured (smtp_host/smtp_from missing)")
    import smtplib
    from email.mime.text import MIMEText
    msg = MIMEText(body); msg["Subject"] = subject; msg["From"] = s.smtp_from; msg["To"] = to
    srv = smtplib.SMTP(s.smtp_host, int(s.smtp_port or 587), timeout=15)
    srv.starttls()
    if s.smtp_user:
        srv.login(s.smtp_user, s.smtp_password)
    srv.sendmail(s.smtp_from, [to], msg.as_string()); srv.quit()


def send_email(to: str, subject: str, body: str) -> tuple[bool, str]:
    """Send via the configured provider. Returns (delivered, error_message)."""
    provider = _s("email_provider") or "smtp"
    try:
        if provider == "off":
            return False, "Email is turned off in settings."
        if provider == "graph":
            if not graph_configured():
                return False, "Microsoft 365 (Graph) email is not fully configured."
            _send_graph(to, subject, body)
            return True, ""
        _send_smtp(to, subject, body)
        return True, ""
    except Exception as e:
        msg = (str(e).splitlines() or [""])[0][:300]
        log.warning("email to %s failed via %s: %s", to, provider, msg)
        return False, msg
