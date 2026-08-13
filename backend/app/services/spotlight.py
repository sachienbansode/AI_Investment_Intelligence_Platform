"""Today's top NIYTRI-scored stock, shared by the public landing endpoint, the
invitation email and the email chart image. Info-only (no advice)."""
import io
import logging

log = logging.getLogger(__name__)

_chart_cache: dict = {}   # (date, symbol) -> png bytes


def get_spotlight() -> dict:
    """Top stock by latest NIYTRI score (approved preferred) + 30-day score history."""
    from app.db.database import Instrument, SessionLocal, StockScore
    db = SessionLocal()
    try:
        latest = db.query(StockScore.score_date).order_by(StockScore.score_date.desc()).first()
        if not latest:
            return {"available": False}
        d = latest[0]
        q = db.query(StockScore).filter(StockScore.score_date == d)
        row = (q.filter(StockScore.quality_status == "approved")
               .order_by(StockScore.composite_score.desc()).first()
               or q.order_by(StockScore.composite_score.desc()).first())
        if not row:
            return {"available": False}
        sym = row.symbol
        inst = db.query(Instrument).filter_by(symbol=sym).first()
        hist = [{"date": r.score_date, "score": r.composite_score} for r in
                (db.query(StockScore.score_date, StockScore.composite_score)
                 .filter(StockScore.symbol == sym)
                 .order_by(StockScore.score_date.desc()).limit(30).all())][::-1]
        f = row.fundamentals or {}
        return {"available": True, "symbol": sym, "name": inst.name if inst else sym,
                "sector": inst.sector if inst else "", "score": row.composite_score,
                "score_date": d, "explanation": row.explanation or "",
                "pillars": row.pillar_scores or {}, "history": hist,
                "last_price": (getattr(row, "last_price", None) or f.get("last_price")),
                "change_pct": f.get("change_pct")}
    finally:
        db.close()


def render_sparkline_png(history: list, date_key: str = "", symbol: str = "") -> bytes:
    """Render the score history as a small orange sparkline PNG (for email)."""
    key = (date_key, symbol)
    if date_key and key in _chart_cache:
        return _chart_cache[key]
    from PIL import Image, ImageDraw
    W, H, pad, right = 600, 190, 18, 46
    scale = 2  # render at 2x for crispness
    img = Image.new("RGB", (W * scale, H * scale), (255, 255, 255))
    d = ImageDraw.Draw(img)
    scores = [h["score"] for h in (history or []) if h.get("score") is not None]
    orange = (249, 76, 0)
    if len(scores) >= 2:
        mn, mx = min(scores), max(scores)
        rng = (mx - mn) or 1
        plotW = (W - pad - right) * scale
        plotH = (H - pad * 2) * scale
        ox, oy = pad * scale, pad * scale
        n = len(scores)
        pts = [(ox + plotW * (i / (n - 1)), oy + plotH * (1 - (v - mn) / rng)) for i, v in enumerate(scores)]
        for g in (0.0, 0.5, 1.0):     # light gridlines
            y = oy + plotH * g
            d.line([(ox, y), (ox + plotW, y)], fill=(240, 230, 220), width=1)
        d.polygon(pts + [(pts[-1][0], oy + plotH), (pts[0][0], oy + plotH)], fill=(255, 238, 226))
        d.line(pts, fill=orange, width=3 * scale, joint="curve")
        r = 5 * scale
        d.ellipse([pts[-1][0] - r, pts[-1][1] - r, pts[-1][0] + r, pts[-1][1] + r], fill=orange)
        for val, gy in ((mx, 0.0), (mn, 1.0)):
            d.text((ox + plotW + 8 * scale, oy + plotH * gy - 6 * scale), str(round(val)), fill=(138, 147, 164))
    else:
        d.text((W * scale // 2 - 60, H * scale // 2), "Chart available after today's run", fill=(138, 147, 164))
    img = img.resize((W, H), Image.LANCZOS)
    buf = io.BytesIO(); img.save(buf, format="PNG")
    png = buf.getvalue()
    if date_key:
        _chart_cache.clear(); _chart_cache[key] = png
    return png
