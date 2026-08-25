"""Public sharing of a single assistant answer.

Creates an expiring, read-only snapshot (chat_shares) that can be opened at a
public URL, and renders the same answer as a branded PDF. Every shared surface
carries the app URL, a short intro and the compliance disclaimer - shared content
becomes public, so it must stay advice-free (the assistant guardrails already
ensure that).
"""
from __future__ import annotations

import io
import re
import secrets
from datetime import datetime, timedelta

from app.core.compliance import AI_DISCLAIMER
from app.db.database import ChatShare, SessionLocal
from app.services.app_settings import get_setting


def _brand() -> dict:
    return {
        "platform_label": get_setting("platform_label") or "NIYTRI Investment Intelligence",
        "url": (get_setting("app_public_url") or "https://dev-invest.niytri.com").rstrip("/"),
        "intro": get_setting("share_intro") or "Shared from NIYTRI Investment Intelligence.",
    }


def create_share(question: str, answer: str, charts=None, user_id=None) -> dict:
    """Persist a share snapshot and return its token + public URL + share text."""
    token = secrets.token_urlsafe(9)
    days = int(get_setting("share_link_days") or 30)
    b = _brand()
    db = SessionLocal()
    try:
        db.add(ChatShare(token=token, user_id=user_id,
                         question=(question or "")[:2000], answer=(answer or "")[:8000],
                         charts=charts or None,
                         expires_at=datetime.utcnow() + timedelta(days=days)))
        db.commit()
    finally:
        db.close()
    url = f"{b['url']}/s/{token}"
    return {"token": token, "url": url, "intro": b["intro"],
            "platform_label": b["platform_label"], "expires_days": days}


def get_share(token: str) -> dict | None:
    db = SessionLocal()
    try:
        row = db.query(ChatShare).filter_by(token=token).first()
        if not row:
            return None
        if row.expires_at and row.expires_at < datetime.utcnow():
            return None
        b = _brand()
        return {"question": row.question, "answer": row.answer, "charts": row.charts or [],
                "created_at": row.created_at.isoformat() if row.created_at else "",
                "platform_label": b["platform_label"], "url": b["url"], "intro": b["intro"],
                "disclaimer": AI_DISCLAIMER}
    finally:
        db.close()


# ---- PDF ---------------------------------------------------------------------

def _md(text: str) -> str:
    text = (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    return re.sub(r"\*(.+?)\*", r"<i>\1</i>", text)


def build_share_pdf(question: str, answer: str) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.enums import TA_CENTER
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

    b = _brand()
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm, bottomMargin=16 * mm,
                            leftMargin=18 * mm, rightMargin=18 * mm, title="NIYTRI AI — Shared answer")
    ss = getSampleStyleSheet()
    accent = colors.HexColor("#f94c00")
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=18, textColor=accent, spaceAfter=1)
    sub = ParagraphStyle("sub", parent=ss["Normal"], fontSize=9, textColor=colors.grey, spaceAfter=8)
    qst = ParagraphStyle("qst", parent=ss["Normal"], fontSize=11, textColor=colors.HexColor("#181d27"),
                         spaceBefore=6, spaceAfter=6, leading=15)
    body = ParagraphStyle("body", parent=ss["Normal"], fontSize=10, leading=15)
    bullet = ParagraphStyle("bullet", parent=body, leftIndent=12, bulletIndent=2)
    foot = ParagraphStyle("foot", parent=ss["Normal"], fontSize=7.5, textColor=colors.grey, alignment=TA_CENTER)

    el = [Paragraph(b["platform_label"], h1),
          Paragraph(b["intro"] + "  |  " + b["url"], sub)]
    if question:
        el.append(Paragraph("<b>Q:</b> " + _md(question), qst))
    for raw in (answer or "").split("\n"):
        line = raw.strip()
        if not line:
            el.append(Spacer(1, 5)); continue
        if line.startswith(">"):
            el.append(Paragraph(_md(line.lstrip("> ").strip()),
                                ParagraphStyle("cal", parent=body, backColor=colors.HexColor("#fff3ea"),
                                               borderPadding=6, leftIndent=6, spaceAfter=6)))
        elif re.match(r"^[-*•]\s+", line):
            el.append(Paragraph(_md(re.sub(r"^[-*•]\s+", "", line)), bullet, bulletText="•"))
        else:
            el.append(Paragraph(_md(line), body))
    el.append(Spacer(1, 12))
    el.append(Paragraph("Generated " + datetime.now().strftime("%d %b %Y, %H:%M IST") + " &nbsp;|&nbsp; "
                        + b["url"], foot))
    el.append(Paragraph(AI_DISCLAIMER, foot))
    doc.build(el)
    return buf.getvalue()
