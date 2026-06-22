"""Eval suite for the deterministic analytics layer.

Locks in EXACT answers for the quantitative question types the LLM used to get
wrong (counts, thresholds, top/bottom, sector averages). Runs in CI so any
regression fails the build instead of reaching users.
"""
from app.services import analytics


class R:
    def __init__(self, symbol, score, pe=None, mcap=None, fund=None):
        self.symbol = symbol
        self.composite_score = score
        self.pe = pe
        self.market_cap = mcap
        self.last_price = None
        self.fundamentals = fund or {}


ROWS = [
    R("AAA", 55, 10.0, 1e11, {"pe": 10.0, "dividend_yield": 2.0, "pb": 1.5, "change_pct": 1.0}),
    R("BBB", 60, 20.0, 2e11, {"pe": 20.0, "dividend_yield": 1.0, "pb": 2.5, "change_pct": -0.5}),
    R("CCC", 30, 30.0, 3e11, {"pe": 30.0, "dividend_yield": 0.5, "pb": 3.5, "change_pct": 0.2}),
    R("DDD", 80, 40.0, 5e11, {"pe": 40.0, "dividend_yield": 0.0, "pb": 8.0, "change_pct": 2.0}),
]
SECT = {"AAA": "Banking", "BBB": "Banking", "CCC": "Banking", "DDD": "IT"}
NAMES = {"AAA": "Alpha Bank", "BBB": "Beta Bank", "CCC": "Gamma Bank", "DDD": "Delta Tech"}


def test_sector_pe_average_is_exact():
    out = analytics.compute("what is the average pe for banks", ROWS, SECT, NAMES)
    assert out and "n=3" in out and "average=20.0" in out and "min=10.0" in out and "max=30.0" in out


def test_threshold_below_score_counts_correctly():
    out = analytics.compute("which stocks are below 50 on score", ROWS, SECT, NAMES)
    assert out and out.startswith("1 script") and "CCC" in out and "AAA" not in out


def test_pe_threshold_under():
    out = analytics.compute("list stocks with pe under 15", ROWS, SECT, NAMES)
    assert out and out.startswith("1 script") and "AAA" in out


def test_top_n_by_score():
    out = analytics.compute("top 2 stocks by score", ROWS, SECT, NAMES)
    assert out and out.startswith("Top 2") and "DDD" in out and "BBB" in out and "CCC" not in out


def test_bottom_n_by_pe():
    out = analytics.compute("bottom 1 by pe", ROWS, SECT, NAMES)
    assert out and out.startswith("Bottom 1") and "AAA" in out


def test_market_average_pe_all():
    out = analytics.compute("average pe across the whole market", ROWS, SECT, NAMES)
    assert out and "average=25.0" in out and "n=4" in out


def test_non_quantitative_returns_none():
    assert analytics.compute("tell me about the market mood today", ROWS, SECT, NAMES) is None


def test_total_market_cap():
    out = analytics.compute("what is the total market cap of all stocks", ROWS, SECT, NAMES)
    # (1+2+3+5)e11 = 1.1e12 -> 110000 cr
    assert out and "total=110,000 cr" in out
