"""Public sharing of an assistant answer or a whole chat session.

Creates an expiring, read-only snapshot (chat_shares) viewable at a public URL,
and renders a branded PDF. Charts are SNAPSHOTTED at share time (their real data
is resolved and stored) so the public page can render them without a login and
they stay stable over time. Shared content is public, so it stays advice-free
(the assistant guardrails ensure that).
"""
from __future__ import annotations

import io
import re
import secrets
from datetime import datetime, timedelta

from app.core.compliance import AI_DISCLAIMER
from app.db.database import (ChatMessage, ChatShare, Instrument, SessionLocal,
                             StockPrice, StockScore)
from app.services.app_settings import get_setting

_GREEN, _AMBER, _RED = "#12a06b", "#c07d0a", "#e0503f"
_PILLARS = ["fundamental", "technical", "valuation", "momentum", "earnings",
            "news_sentiment", "institutional", "risk"]


def _brand() -> dict:
    return {
        "platform_label": get_setting("platform_label") or "NIYTRI Investment Intelligence",
        "url": (get_setting("app_public_url") or "https://dev-invest.niytri.com").rstrip("/"),
        "intro": get_setting("share_intro") or "Shared from NIYTRI Investment Intelligence.",
    }


def _band_color(v):
    return _GREEN if v >= 65 else _AMBER if v >= 50 else _RED


def _title(s):
    return re.sub(r"\b\w", lambda m: m.group().upper(), str(s or ""))


# ---- chart snapshotting -----------------------------------------------------

def _latest_score_row(db, symbol):
    return (db.query(StockScore)
            .filter(StockScore.symbol == symbol, StockScore.quality_status == "approved")
            .order_by(StockScore.score_date.desc()).first())


def resolve_chart(spec: dict) -> dict | None:
    """Turn a chart spec into a static, self-contained snapshot the public page can
    render with no live/authenticated calls. Returns normalized {kind, ...}."""
    if not spec:
        return None
    if spec.get("src") == "portfolio":
        return {"kind": "portfolio", "amount": spec.get("amount"),
                "invested": spec.get("invested"), "cash": spec.get("cash"),
                "weighted_score": spec.get("weighted_score"), "sectors": spec.get("sectors"),
                "rows": spec.get("rows") or []}
    if spec.get("src") == "data":
        k = spec.get("kind", "bar")
        title = _title(spec.get("title") or "Illustrative")
        if not spec.get("real"):
            title += " (illustrative)"
        return {"kind": {"bar": "bars", "line": "line", "pie": "pie"}.get(k, "bars"),
                "title": title,
                "labels": [str(x) for x in (spec.get("x") or [])],
                "values": [float(v) for v in (spec.get("y") or [])]}
    t = spec.get("type")
    sym = (spec.get("symbol") or "").upper()
    db = SessionLocal()
    try:
        if t == "pillars" and sym:
            row = _latest_score_row(db, sym)
            if not row or not row.pillar_scores:
                return None
            rows = [[_title(k.replace("_", " ")), round(float(row.pillar_scores[k])),
                     _band_color(float(row.pillar_scores[k]))]
                    for k in _PILLARS if row.pillar_scores.get(k) is not None]
            return {"kind": "pillars", "title": f"{sym} — NIYTRI Score Pillars "
                    f"(Composite {round(float(row.composite_score))}/100)", "rows": rows}
        if t == "score_history" and sym:
            hrows = (db.query(StockScore.score_date, StockScore.composite_score)
                     .filter(StockScore.symbol == sym, StockScore.quality_status != "rejected")
                     .order_by(StockScore.score_date.desc()).limit(90).all())
            hrows = list(reversed(hrows))
            if len(hrows) < 2:
                return None
            return {"kind": "line", "title": f"{sym} — NIYTRI Score History",
                    "labels": [str(d) for d, _ in hrows], "values": [round(float(s), 1) for _, s in hrows]}
        if t == "price_history" and sym:
            prows = (db.query(StockPrice.price_date, StockPrice.close)
                     .filter(StockPrice.symbol == sym).order_by(StockPrice.price_date.desc()).limit(250).all())
            prows = [(d, c) for d, c in reversed(prows) if c is not None]
            if len(prows) < 2:
                return None
            return {"kind": "line", "rupee": True, "title": f"{sym} — Price (LTP)",
                    "labels": [d.isoformat() if hasattr(d, "isoformat") else str(d) for d, _ in prows],
                    "values": [round(float(c), 2) for _, c in prows]}
        if t == "compare" and spec.get("symbols"):
            labels, values, colors = [], [], []
            for s in spec["symbols"][:2]:
                r = _latest_score_row(db, s.upper())
                labels.append(s.upper())
                v = round(float(r.composite_score)) if r and r.composite_score is not None else 0
                values.append(v); colors.append(_band_color(v))
            return {"kind": "bars", "title": " vs ".join(labels) + " — NIYTRI Score",
                    "labels": labels, "values": values, "colors": colors}
        if t == "sector":
            latest = (db.query(StockScore.symbol, StockScore.composite_score)
                      .filter(StockScore.quality_status == "approved")
                      .order_by(StockScore.score_date.desc()).limit(3000).all())
            secmap = {r.symbol: r.sector for r in db.query(Instrument).all() if r.sector}
            seen, g = set(), {}
            for symn, sc in latest:
                if symn in seen or sc is None:
                    continue
                seen.add(symn)
                sec = secmap.get(symn, "Unknown")
                g.setdefault(sec, []).append(float(sc))
            arr = sorted(((k, sum(v) / len(v)) for k, v in g.items()), key=lambda x: x[1], reverse=True)[:10]
            if not arr:
                return None
            return {"kind": "bars", "title": "Sector Strength — Average NIYTRI Score",
                    "labels": [k for k, _ in arr], "values": [round(v, 1) for _, v in arr],
                    "colors": [_band_color(v) for _, v in arr]}
        if t == "distribution":
            latest = (db.query(StockScore.symbol, StockScore.composite_score)
                      .filter(StockScore.quality_status == "approved")
                      .order_by(StockScore.score_date.desc()).limit(3000).all())
            seen, strong, neutral, weak = set(), 0, 0, 0
            for symn, sc in latest:
                if symn in seen or sc is None:
                    continue
                seen.add(symn); sc = float(sc)
                if sc >= 65: strong += 1
                elif sc >= 50: neutral += 1
                else: weak += 1
            if not (strong + neutral + weak):
                return None
            return {"kind": "bars", "title": "Market Score Distribution",
                    "labels": ["Strong 65+", "Neutral 50-64", "Weak <50"],
                    "values": [strong, neutral, weak], "colors": [_GREEN, _AMBER, _RED]}
    finally:
        db.close()
    return None


def _resolve_all(specs):
    out = []
    for sp in (specs or []):
        try:
            r = resolve_chart(sp)
            if r:
                out.append(r)
        except Exception:
            pass
    return out[:6]


# ---- create / read ----------------------------------------------------------

def create_share(question: str, answer: str, charts=None, user_id=None) -> dict:
    token = secrets.token_urlsafe(9)
    days = int(get_setting("share_link_days") or 30)
    b = _brand()
    db = SessionLocal()
    try:
        db.add(ChatShare(token=token, user_id=user_id,
                         question=(question or "")[:2000], answer=(answer or "")[:12000],
                         charts=_resolve_all(charts) or None,
                         expires_at=datetime.utcnow() + timedelta(days=days)))
        db.commit()
    finally:
        db.close()
    return {"token": token, "url": f"{b['url']}/s/{token}", "intro": b["intro"],
            "platform_label": b["platform_label"], "expires_days": days}


def _session_rows(session_id, user_id):
    db = SessionLocal()
    try:
        q = db.query(ChatMessage).filter_by(session_id=session_id)
        if user_id is not None:
            q = q.filter(ChatMessage.user_id == user_id)
        return q.order_by(ChatMessage.created_at).all()
    finally:
        db.close()


def session_transcript(session_id: str, user_id=None) -> str:
    parts = []
    for m in _session_rows(session_id, user_id):
        c = (m.content or "").strip()
        if not c:
            continue
        parts.append(("**You:** " if m.role == "user" else "**NIYTRI AI:** ") + c
                     if m.role in ("user", "assistant") else c)
    return "\n\n".join(parts) or "(This conversation is empty.)"


def create_session_share(session_id: str, user_id=None) -> dict:
    rows = _session_rows(session_id, user_id)
    parts, specs = [], []
    for m in rows:
        c = (m.content or "").strip()
        if c:
            parts.append(("**You:** " if m.role == "user" else "**NIYTRI AI:** ") + c)
        if m.role == "assistant" and isinstance(m.meta, dict):
            specs.extend(m.meta.get("charts") or [])
    transcript = "\n\n".join(parts) or "(This conversation is empty.)"
    # snapshot the session's charts once
    token = secrets.token_urlsafe(9)
    days = int(get_setting("share_link_days") or 30)
    b = _brand()
    db = SessionLocal()
    try:
        db.add(ChatShare(token=token, user_id=user_id, question="Chat with NIYTRI AI",
                         answer=transcript[:12000], charts=_resolve_all(specs) or None,
                         expires_at=datetime.utcnow() + timedelta(days=days)))
        db.commit()
    finally:
        db.close()
    return {"token": token, "url": f"{b['url']}/s/{token}", "intro": b["intro"],
            "platform_label": b["platform_label"], "expires_days": days}


def purge_expired(grace_days: int = 1) -> int:
    """Hard-delete shares whose expiry passed (plus a small grace). Returns the
    number removed. Called by the daily scheduler so expired snapshots don't
    accumulate in chat_shares."""
    import logging
    from sqlalchemy import delete as sa_delete
    cutoff = datetime.utcnow() - timedelta(days=max(0, grace_days))
    db = SessionLocal()
    try:
        res = db.execute(sa_delete(ChatShare).where(
            ChatShare.expires_at.isnot(None), ChatShare.expires_at < cutoff))
        db.commit()
        n = res.rowcount or 0
        if n:
            logging.getLogger(__name__).info("purged %d expired chat_shares", n)
        return n
    except Exception as e:
        db.rollback()
        logging.getLogger(__name__).warning("purge_expired failed: %s", e)
        return 0
    finally:
        db.close()


def get_share(token: str) -> dict | None:
    db = SessionLocal()
    try:
        row = db.query(ChatShare).filter_by(token=token).first()
        if not row or (row.expires_at and row.expires_at < datetime.utcnow()):
            return None
        b = _brand()
        return {"question": row.question, "answer": row.answer, "charts": row.charts or [],
                "created_at": row.created_at.isoformat() if row.created_at else "",
                "platform_label": b["platform_label"], "url": b["url"], "intro": b["intro"],
                "disclaimer": AI_DISCLAIMER}
    finally:
        db.close()


# ---- PDF --------------------------------------------------------------------

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
