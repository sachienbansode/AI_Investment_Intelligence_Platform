"""Outbound email. Provider is admin-configurable (DB-backed, not .env):

  graph  - Microsoft 365 via Graph API sendMail (app-only client credentials)
  smtp   - classic SMTP (host/user/pass from .env; being retired by Microsoft)
  off    - email disabled

All senders go through send_email(to, subject, text_body, html_inner=None). Every
message is wrapped in a branded HTML layout (logo + footer); plain text is sent as
a fallback part. Returns (delivered, error).
"""
import html as _html
import logging
import re

log = logging.getLogger(__name__)

_GRAPH = "https://graph.microsoft.com/v1.0"
_LOGIN = "https://login.microsoftonline.com"
_GRAD = "linear-gradient(90deg,#FF8A3D,#F94C00)"


def _s(key: str) -> str:
    from app.services.app_settings import get_setting
    return (get_setting(key) or "").strip()


def platform_name() -> str:
    from app.services.app_settings import get_setting
    return (get_setting("platform_label") or "NIYTRI AI").strip()


def app_url() -> str:
    from app.config import get_settings
    return (get_settings().app_base_url or "").rstrip("/")


def mark_url() -> str:
    base = app_url()
    return (base + "/NIYTRI-Rupee-Square.png") if base else ""


def button(url: str, label: str) -> str:
    return (f'<a href="{url}" style="display:inline-block;background:{_GRAD};'
            f'background-color:#F94C00;color:#ffffff;text-decoration:none;font-weight:700;'
            f'padding:13px 30px;border-radius:10px;font-family:Arial,Helvetica,sans-serif;'
            f'font-size:15px">{label}</a>')


def _footer_text() -> str:
    import datetime
    plat, url, year = platform_name(), app_url(), datetime.datetime.now().year
    lines = ["", "—"]
    if url:
        lines.append(f"{plat} · {url}")
    lines.append(f"© {year} {plat}. All rights reserved.")
    lines.append("Information & analytics only — not investment advice. Investments are subject to market risks.")
    return "\n".join(lines)


def _layout(inner_html: str) -> str:
    import datetime
    plat, url, mark, year = platform_name(), app_url(), mark_url(), datetime.datetime.now().year
    wordmark = f'<span style="font-size:20px;font-weight:800;color:#F94C00;vertical-align:middle;font-family:Arial,Helvetica,sans-serif">{_html.escape(plat)}</span>'
    header = ((f'<img src="{mark}" alt="" width="36" height="36" style="height:36px;width:36px;border:0;'
               f'border-radius:8px;vertical-align:middle;margin-right:10px">' if mark else '') + wordmark)
    return (
        '<!doctype html><html><body style="margin:0;padding:24px 0;background:#f4f6fb;'
        'font-family:Arial,Helvetica,sans-serif;color:#181d27">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">'
        '<table role="presentation" width="600" cellpadding="0" cellspacing="0" '
        'style="max-width:600px;width:100%;background:#ffffff;border:1px solid #edf0f5;border-radius:16px;overflow:hidden">'
        f'<tr><td style="padding:22px 28px;border-bottom:1px solid #f2f3f7">{header}</td></tr>'
        f'<tr><td style="padding:30px 28px">{inner_html}</td></tr>'
        '<tr><td style="padding:18px 28px;background:#fafbfe;border-top:1px solid #f2f3f7;'
        'font-size:12px;color:#8a93a4;line-height:1.6;font-family:Arial,Helvetica,sans-serif">'
        f'<a href="{url}" style="color:#F94C00;text-decoration:none">{_html.escape(plat)}</a> · {url}<br>'
        f'© {year} {_html.escape(plat)}. All rights reserved.<br>'
        'Information &amp; analytics only — not investment advice. Investments are subject to market risks.'
        '</td></tr></table></td></tr></table></body></html>'
    )


def _auto_inner(text: str) -> str:
    esc = _html.escape(text or "")
    esc = re.sub(r'(https?://[^\s]+)', r'<a href="\1" style="color:#F94C00">\1</a>', esc)
    return ('<div style="font-size:15px;line-height:1.7;color:#2a3140;'
            'font-family:Arial,Helvetica,sans-serif">' + esc.replace("\n", "<br>") + '</div>')


def graph_configured() -> bool:
    return bool(_s("graph_tenant_id") and _s("graph_client_id")
               and _s("graph_client_secret") and _s("graph_sender"))


def _graph_token() -> str:
    import httpx
    tenant, cid, secret = _s("graph_tenant_id"), _s("graph_client_id"), _s("graph_client_secret")
    r = httpx.post(f"{_LOGIN}/{tenant}/oauth2/v2.0/token", timeout=15, data={
        "client_id": cid, "client_secret": secret,
        "scope": "https://graph.microsoft.com/.default", "grant_type": "client_credentials",
    })
    if r.status_code != 200:
        raise RuntimeError(f"token error {r.status_code}: {r.text[:200]}")
    tok = r.json().get("access_token")
    if not tok:
        raise RuntimeError("no access_token in token response")
    return tok


def _send_graph(to: str, subject: str, html_body: str) -> None:
    import httpx
    sender = _s("graph_sender")
    token = _graph_token()
    payload = {"message": {"subject": subject,
                           "body": {"contentType": "HTML", "content": html_body},
                           "toRecipients": [{"emailAddress": {"address": to}}]},
               "saveToSentItems": False}
    r = httpx.post(f"{_GRAPH}/users/{sender}/sendMail", timeout=20,
                   headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
                   json=payload)
    if r.status_code not in (200, 202):
        raise RuntimeError(f"sendMail {r.status_code}: {r.text[:300]}")


def _send_smtp(to: str, subject: str, text_body: str, html_body: str) -> None:
    from app.config import get_settings
    s = get_settings()
    if not (s.smtp_host and s.smtp_from):
        raise RuntimeError("SMTP not configured (smtp_host/smtp_from missing)")
    import smtplib
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject; msg["From"] = s.smtp_from; msg["To"] = to
    msg.attach(MIMEText(text_body, "plain", "utf-8"))
    msg.attach(MIMEText(html_body, "html", "utf-8"))
    srv = smtplib.SMTP(s.smtp_host, int(s.smtp_port or 587), timeout=15)
    srv.starttls()
    if s.smtp_user:
        srv.login(s.smtp_user, s.smtp_password)
    srv.sendmail(s.smtp_from, [to], msg.as_string()); srv.quit()


def send_email(to: str, subject: str, text_body: str, html_inner: str | None = None) -> tuple[bool, str]:
    """Send via the configured provider as branded HTML (+ plain-text fallback)."""
    provider = _s("email_provider") or "smtp"
    text = (text_body or "").rstrip() + "\n\n" + _footer_text()
    html = _layout(html_inner if html_inner is not None else _auto_inner(text_body or ""))
    try:
        if provider == "off":
            return False, "Email is turned off in settings."
        if provider == "graph":
            if not graph_configured():
                return False, "Microsoft 365 (Graph) email is not fully configured."
            _send_graph(to, subject, html)
            return True, ""
        _send_smtp(to, subject, text, html)
        return True, ""
    except Exception as e:
        msg = (str(e).splitlines() or [""])[0][:300]
        log.warning("email to %s failed via %s: %s", to, provider, msg)
        return False, msg
