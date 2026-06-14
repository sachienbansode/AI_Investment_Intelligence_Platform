"""Composite stock scoring engine — BRD weights:
Fundamental 30%, Technical 15%, Valuation 15%, Momentum 10%, Earnings 10%,
News Sentiment 10%, Institutional Activity 5%, Risk 5%.

Pure functions: deterministic and unit-testable. Pillar scores are 0-100.
"""
from app.data.base import Quote

WEIGHTS = {
    "fundamental": 0.30,
    "technical": 0.15,
    "valuation": 0.15,
    "momentum": 0.10,
    "earnings": 0.10,
    "news_sentiment": 0.10,
    "institutional": 0.05,
    "risk": 0.05,
}


def clamp(v: float, lo: float = 0, hi: float = 100) -> float:
    return max(lo, min(hi, v))


def technical_score(q: Quote) -> float:
    """Position within 52-week range + intraday strength."""
    score = 50.0
    if q.last_price and q.week52_high and q.week52_low and q.week52_high > q.week52_low:
        pos = (q.last_price - q.week52_low) / (q.week52_high - q.week52_low)
        score = 20 + pos * 60  # 20..80 by range position
    if q.change_pct is not None:
        score += clamp(q.change_pct * 2, -10, 10)
    return clamp(score)


def momentum_score(q: Quote) -> float:
    if q.change_pct is None:
        return 50.0
    return clamp(50 + q.change_pct * 8)


def valuation_score(q: Quote) -> float:
    """Lower P/E relative to broad-market band scores higher (simplified)."""
    if not q.pe or q.pe <= 0:
        return 50.0
    if q.pe < 15:
        return 80.0
    if q.pe < 25:
        return 65.0
    if q.pe < 40:
        return 50.0
    if q.pe < 60:
        return 35.0
    return 20.0


def sentiment_to_score(sentiment_counts: dict) -> float:
    """Map news sentiment counts {positive, negative, neutral} to 0-100."""
    pos = sentiment_counts.get("positive", 0)
    neg = sentiment_counts.get("negative", 0)
    total = pos + neg + sentiment_counts.get("neutral", 0)
    if total == 0:
        return 50.0
    return clamp(50 + (pos - neg) / total * 50)


def risk_score(q: Quote) -> float:
    """Higher = lower risk. Penalize high intraday swing (simplified vol proxy)."""
    if q.high and q.low and q.last_price and q.last_price > 0:
        swing_pct = (q.high - q.low) / q.last_price * 100
        return clamp(80 - swing_pct * 8)
    return 50.0


def composite(pillars: dict, weights: dict | None = None) -> float:
    """Weighted composite, 0-100. Missing pillars default to neutral 50.
    Weights default to the BRD values; Admin can override via app settings."""
    w = weights or WEIGHTS
    total = sum(w[k] * pillars.get(k, 50.0) for k in WEIGHTS)
    return round(clamp(total), 1)
