"""Unit tests for the deterministic scoring engine."""
from app.data.base import Quote
from app.services import scoring


def make_quote(**kw):
    base = dict(symbol="TEST", last_price=100, change_pct=1.0, open=99, high=102,
                low=98, prev_close=99, week52_high=120, week52_low=80, pe=20)
    base.update(kw)
    return Quote(**base)


def test_weights_sum_to_one():
    assert abs(sum(scoring.WEIGHTS.values()) - 1.0) < 1e-9


def test_composite_in_range():
    q = make_quote()
    pillars = {
        "fundamental": 50, "technical": scoring.technical_score(q),
        "valuation": scoring.valuation_score(q), "momentum": scoring.momentum_score(q),
        "earnings": 50, "news_sentiment": 50, "institutional": 50,
        "risk": scoring.risk_score(q),
    }
    c = scoring.composite(pillars)
    assert 0 <= c <= 100


def test_composite_neutral_defaults():
    assert scoring.composite({}) == 50.0


def test_valuation_prefers_lower_pe():
    cheap = scoring.valuation_score(make_quote(pe=10))
    expensive = scoring.valuation_score(make_quote(pe=80))
    assert cheap > expensive


def test_sentiment_mapping():
    assert scoring.sentiment_to_score({"positive": 5, "negative": 0, "neutral": 0}) == 100
    assert scoring.sentiment_to_score({"positive": 0, "negative": 5, "neutral": 0}) == 0
    assert scoring.sentiment_to_score({}) == 50


def test_technical_uses_52w_position():
    near_high = scoring.technical_score(make_quote(last_price=119))
    near_low = scoring.technical_score(make_quote(last_price=81))
    assert near_high > near_low


def test_missing_data_is_neutral():
    q = Quote(symbol="X")
    assert scoring.momentum_score(q) == 50.0
    assert scoring.valuation_score(q) == 50.0
    assert scoring.risk_score(q) == 50.0
