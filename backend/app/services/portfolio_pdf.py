"""Render a portfolio analysis (PortfolioResponse dict) into a shareable PDF."""
import io
import re
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)

_BRAND = colors.HexColor("#4f46e5")
_GREEN = colors.HexColor("#16a34a")
_AMBER = colors.HexColor("#d97706")
_RED = colors.HexColor("#dc2626")
_RAG = {"green": _GREEN, "amber": _AMBER, "red": _RED}


def _md(text: str) -> str:
    """Minimal markdown -> reportlab mini-HTML (bold + escape)."""
    text = (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)


def build_portfolio_pdf(analysis: dict, holdings: list[dict],
                        client_name: str = "") -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=18 * mm,
                            bottomMargin=16 * mm, leftMargin=16 * mm, rightMargin=16 * mm,
                            title="Portfolio Analysis")
    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontSize=20, textColor=_BRAND, spaceAfter=2)
    sub = ParagraphStyle("sub", parent=ss["Normal"], fontSize=9, textColor=colors.grey)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontSize=12, textColor=_BRAND,
                        spaceBefore=10, spaceAfter=4)
    body = ParagraphStyle("body", parent=ss["Normal"], fontSize=9.5, leading=14)
    bullet = ParagraphStyle("bullet", parent=body, leftIndent=10, bulletIndent=0)
    foot = ParagraphStyle("foot", parent=ss["Normal"], fontSize=7.5, textColor=colors.grey,
                          alignment=TA_CENTER)

    el = []
    el.append(Paragraph("Portfolio Analysis", h1))
    line = "Generated " + datetime.now().strftime("%d %b %Y, %H:%M")
    if client_name:
        line = "Prepared for " + client_name + " &nbsp;|&nbsp; " + line
    el.append(Paragraph(line, sub))
    el.append(Spacer(1, 8))

    # Health + status + P&L
    status = analysis.get("status", "")
    rag = _RAG.get(status, colors.grey)
    el.append(Paragraph("Summary", h2))
    el.append(Paragraph(_md(analysis.get("headline", "")), body))
    pnl = analysis.get("pnl") or {}
    health_tbl = [[
        Paragraph(f"<b>Health</b><br/>{analysis.get('health_score','-')}/100", body),
        Paragraph(f"<b>Status</b><br/>{(analysis.get('status_label') or status).title()}", body),
        Paragraph(f"<b>Invested</b><br/>Rs {pnl.get('invested',0):,.0f}", body),
        Paragraph(f"<b>Current</b><br/>Rs {pnl.get('current_value',0):,.0f}", body),
        Paragraph(f"<b>Est. P&amp;L</b><br/>{'+' if pnl.get('pnl',0)>=0 else '-'}Rs "
                  f"{abs(pnl.get('pnl',0)):,.0f} ({pnl.get('pnl_pct',0)}%)", body),
    ]]
    t = Table(health_tbl, colWidths=[34*mm]*5)
    t.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.5, colors.lightgrey),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.lightgrey),
        ("BACKGROUND", (1, 0), (1, 0), rag),
        ("TEXTCOLOR", (1, 0), (1, 0), colors.white),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("TOPPADDING", (0, 0), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    el.append(t)

    # Holdings
    if holdings:
        el.append(Paragraph("Holdings", h2))
        rows = [["Symbol", "Qty", "Avg price (Rs)"]]
        for h in holdings:
            rows.append([h.get("symbol", ""), str(h.get("quantity", "")),
                         f"{float(h.get('avg_price', 0)):,.2f}"])
        ht = Table(rows, colWidths=[60*mm, 40*mm, 60*mm])
        ht.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), _BRAND), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 9), ("GRID", (0, 0), (-1, -1), 0.4, colors.lightgrey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f6fa")])]))
        el.append(ht)

    # Diversification & concentration
    dv = analysis.get("diversification", {}) or {}
    cc = analysis.get("concentration_risk", {}) or {}
    el.append(Paragraph("Diversification &amp; concentration", h2))
    el.append(Paragraph(
        f"Holdings: <b>{dv.get('num_holdings','-')}</b> &nbsp;|&nbsp; Sectors: "
        f"<b>{dv.get('num_sectors','-')}</b> &nbsp;|&nbsp; Effective holdings: "
        f"<b>{dv.get('effective_holdings','-')}</b><br/>Concentration: "
        f"<b>{cc.get('level','-')}</b> &nbsp;|&nbsp; Top holding: "
        f"<b>{cc.get('top_holding','-')}</b> ({cc.get('top_holding_weight_pct','-')}%) "
        f"&nbsp;|&nbsp; HHI: <b>{cc.get('herfindahl_index','-')}</b>", body))

    # Sector exposure
    sec = analysis.get("sector_exposure", {}) or {}
    if sec:
        el.append(Paragraph("Sector exposure", h2))
        srows = [["Sector", "Weight %"]] + [[k, str(v)] for k, v in sec.items()]
        st = Table(srows, colWidths=[110*mm, 50*mm])
        st.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), _BRAND), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 9), ("GRID", (0, 0), (-1, -1), 0.4, colors.lightgrey),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f5f6fa")])]))
        el.append(st)

    # Why this score
    ded = analysis.get("deductions") or []
    if ded:
        el.append(Paragraph("Why this score", h2))
        for d in ded:
            el.append(Paragraph(f"&bull; -{d.get('points')}: {_md(d.get('reason',''))}", bullet))

    # AI insights
    el.append(Paragraph("AI insights", h2))
    for ln in (analysis.get("insights") or "").split("\n"):
        ln = ln.strip()
        if not ln:
            continue
        if ln.startswith(("- ", "* ")):
            el.append(Paragraph("&bull; " + _md(ln[2:]), bullet))
        else:
            el.append(Paragraph(_md(ln), body))

    el.append(Spacer(1, 10))
    el.append(Paragraph(_md(analysis.get("disclaimer", "")), foot))
    el.append(Paragraph("This output is AI-generated and must be reviewed before business use. "
                        "v1.1 &middot; Created By NIYTRI Technologies", foot))

    doc.build(el)
    return buf.getvalue()
