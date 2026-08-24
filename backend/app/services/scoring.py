"""Composite stock scoring engine — BRD weights:
Fundamental 30%, Technical 15%, Valuation 15%, Momentum 10%, Earnings 10%,
News Sentiment 10%, Institutional Activity 5%, Risk 5%.

Pure functions: deterministic and unit-testable. Pillar scores are 0-100.

Data-unit conventions (as populated by the data adapters, see data/yahoo.py):
  roe, dividend_yield -> PERCENT (e.g. 15.0 means 15%)
  pe, pb, eps, beta   -> raw ratios / values
  market_cap          -> absolute currency (INR); /1e7 => crore
Each pillar blends only the sub-metrics actually present, and falls back to the
neutral 50 ONLY when none of its inputs are available (never a blanket 50).
"""
import math

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


def _blend(parts: list[tuple[float, float]]) -> float:
    """Weighted mean of (weight, score) pairs; None result -> caller uses 50."""
    parts = [(w, s) for w, s in parts if s is not None]
    if not parts:
        return 50.0
    wsum = sum(w for w, _ in parts)
    return round(clamp(sum(w * s for w, s in parts) / wsum), 1)


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


def fundamental_score(q: Quote) -> float:
    """Profitability (ROE), balance-sheet valuation quality (P/B), shareholder
    yield (dividend) and earnings positivity (EPS sign). Blends whatever is
    present so scores differ across stocks instead of a constant 50."""
    parts: list[tuple[float, float | None]] = []
    if q.roe is not None:                                   # percent
        parts.append((0.40, clamp(40 + q.roe * 2)))         # 0%->40, 15%->70, >=30%->100
    if q.pb is not None and q.pb > 0:
        pb = q.pb
        s = 85 if pb < 1 else 70 if pb < 3 else 55 if pb < 6 else 40 if pb < 10 else 25
        parts.append((0.25, float(s)))
    if q.dividend_yield is not None:                        # percent
        parts.append((0.15, clamp(50 + q.dividend_yield * 8)))  # 0->50, 2.5%->70
    if q.eps is not None:
        parts.append((0.20, 70.0 if q.eps > 0 else 25.0))
    return _blend(parts)


def earnings_score(q: Quote) -> float:
    """Earnings strength: earnings yield (EPS/price) plus EPS positivity.
    Distinct from valuation (how cheap) — this measures profit generation."""
    parts: list[tuple[float, float | None]] = []
    if q.eps is not None and q.last_price and q.last_price > 0:
        ey = q.eps / q.last_price * 100                     # earnings yield %
        parts.append((0.60, clamp(45 + ey * 3)))            # 4%->57, 8%->69
    if q.eps is not None:
        parts.append((0.40, 72.0 if q.eps > 0 else 20.0))
    return _blend(parts)


def institutional_score(q: Quote) -> float:
    """Proxy for institutional interest until a real FII/DII holdings feed is
    connected: larger, more liquid, steadier (lower-beta) names screen higher.
    This is a size/stability PROXY, not actual shareholding data."""
    parts: list[tuple[float, float | None]] = []
    if q.market_cap:
        mc_cr = q.market_cap / 1e7                          # crore
        s = (85 if mc_cr >= 200000 else 75 if mc_cr >= 50000 else 65 if mc_cr >= 10000
             else 55 if mc_cr >= 2000 else 45)
        parts.append((0.60, float(s)))
    if q.beta is not None:
        parts.append((0.25, clamp(90 - abs(q.beta - 0.9) * 40)))  # ~0.9->90, 1.4->70
    if q.volume:
        parts.append((0.15, clamp(35 + math.log10(max(q.volume, 1)) * 8)))
    return _blend(parts)


def sentiment_to_score(sentiment_counts: dict) -> float:
    """Map news sentiment counts {positive, negative, neutral} to 0-100."""
    sentiment_counts = sentiment_counts or {}
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


def build_pillars(q: Quote, sentiment_counts: dict | None = None) -> dict:
    """All 8 pillar scores for a quote. Single source of truth used by the daily
    pipeline and the on-demand rescore so both stay consistent."""
    return {
        "fundamental": fundamental_score(q),
        "technical": technical_score(q),
        "valuation": valuation_score(q),
        "momentum": momentum_score(q),
        "earnings": earnings_score(q),
        "news_sentiment": sentiment_to_score(sentiment_counts or {}),
        "institutional": institutional_score(q),
        "risk": risk_score(q),
    }


def composite(pillars: dict, weights: dict | None = None) -> float:
    """Weighted composite, 0-100, self-normalizing over the provided weights
    (so zeroing a pillar's weight cleanly re-weights the rest). Missing pillar
    values default to neutral 50. Weights default to BRD; Admin can override."""
    w = weights or WEIGHTS
    tw = sum(float(w.get(k, 0.0)) for k in WEIGHTS)
    if tw <= 0:
        return 50.0
    total = sum(float(w.get(k, 0.0)) * pillars.get(k, 50.0) for k in WEIGHTS)
    return round(clamp(total / tw), 1)


def has_news(sentiment_counts: dict | None) -> bool:
    c = sentiment_counts or {}
    return (c.get("positive", 0) + c.get("negative", 0) + c.get("neutral", 0)) > 0


def composite_for(pillars: dict, sentiment_counts: dict | None = None,
                  weights: dict | None = None) -> float:
    """Composite that DROPS the news pillar (renormalizing the other pillars)
    when the stock has NO news for the day — so a stock with no coverage isn't
    quietly diluted toward neutral 50 by an inert news pillar. When news IS
    present, behaves exactly like composite()."""
    w = weights or WEIGHTS
    if not has_news(sentiment_counts):
        w = {**w, "news_sentiment": 0.0}
    return composite(pillars, w)
