"""On-demand single-symbol rescore: fresh quote → pillars → composite →
delta vs previous score with driver analysis → LLM explanation of the change."""
import json
import logging
from datetime import date, datetime, timezone

from app.core.compliance import AI_DISCLAIMER, audit_log
from app.data.aggregator import get_market_data
from app.db.database import SessionLocal, StockScore
from app.llm.router import get_llm_router
from app.services import scoring
from app.services.app_settings import get_setting

log = logging.getLogger(__name__)


def pillar_drivers(new_p: dict, old_p: dict, top: int = 3) -> list[str]:
    """Largest pillar moves, e.g. ['technical +12.4', 'momentum -8.0']."""
    diffs = sorted(
        ((k, round(new_p.get(k, 50) - old_p.get(k, 50), 1)) for k in new_p),
        key=lambda kv: -abs(kv[1]),
    )
    return [f"{k} {'+' if d >= 0 else ''}{d}" for k, d in diffs[:top] if abs(d) >= 0.5]


async def rescore_symbol(symbol: str) -> dict | None:
    symbol = symbol.upper()
    md = get_market_data()
    q = await md.get_quote(symbol)
    if not q or q.last_price is None:
        return None

    pillars = {
        "fundamental": 50.0,
        "technical": scoring.technical_score(q),
        "valuation": scoring.valuation_score(q),
        "momentum": scoring.momentum_score(q),
        "earnings": 50.0,
        "news_sentiment": 50.0,   # daily pipeline supplies this; neutral intraday
        "institutional": 50.0,
        "risk": scoring.risk_score(q),
    }
    composite = scoring.composite(pillars, get_setting("scoring_weights"))
    today = date.today().isoformat()

    db = SessionLocal()
    try:
        prev = (db.query(StockScore).filter(StockScore.symbol == symbol,
                                            StockScore.score_date < today)
                .order_by(StockScore.score_date.desc()).first())
        today_row = (db.query(StockScore)
                     .filter_by(symbol=symbol, score_date=today).first())
        prev_for_delta = prev or today_row
        delta = round(composite - prev_for_delta.composite_score, 1) if prev_for_delta else None
        drivers = (pillar_drivers(pillars, prev_for_delta.pillar_scores or {})
                   if prev_for_delta else [])
    finally:
        db.close()

    # LLM: explain the level and the change
    change_txt = (f"Previous score ({prev_for_delta.score_date}): "
                  f"{prev_for_delta.composite_score}. Change: {delta:+}. "
                  f"Biggest pillar moves: {', '.join(drivers) or 'none material'}."
                  if prev_for_delta else "No previous score to compare.")
    try:
        resp = await get_llm_router().complete(
            "You write factual, explainable-AI score rationales for a SEBI-regulated "
            "broker. Never give investment advice or recommendations.",
            f"Stock: {symbol} (NSE). New composite score {composite}/100 "
            f"(0-100 scale, weighted pillars).\n"
            f"Pillars: {json.dumps(pillars)}\nPrice: {q.last_price}, "
            f"day change: {q.change_pct}%, P/E: {q.pe}, "
            f"52w: {q.week52_low}-{q.week52_high}.\n{change_txt}\n"
            "Write 3-5 concise markdown bullet points ('- '): what drives the "
            "current score, and if it changed, why it moved (bold the change). "
            "Under 15 words per bullet. No advice, no targets. Output only bullets.",
            task="rescore", max_tokens=250,
        )
        explanation = resp.text.strip()
    except Exception as e:
        log.warning("Rescore explanation failed: %s", e)
        explanation = f"Score from pillar data: {pillars}. {change_txt}"

    quality = "approved" if 0 <= composite <= 100 and all(
        0 <= v <= 100 for v in pillars.values()) else "rejected"

    db = SessionLocal()
    try:
        db.query(StockScore).filter_by(symbol=symbol, score_date=today).delete()
        db.add(StockScore(symbol=symbol, score_date=today, composite_score=composite,
                          pillar_scores=pillars, explanation=explanation,
                          quality_status=quality))
        db.commit()
    finally:
        db.close()
    audit_log("score_refresh", symbol=symbol, score=composite, delta=delta)

    return {
        "symbol": symbol, "score_date": today, "composite_score": composite,
        "pillar_scores": pillars, "explanation": explanation,
        "quality_status": quality,
        "previous": ({"score": prev_for_delta.composite_score,
                      "date": prev_for_delta.score_date} if prev_for_delta else None),
        "delta": delta, "drivers": drivers,
        "disclaimer": AI_DISCLAIMER,
    }
