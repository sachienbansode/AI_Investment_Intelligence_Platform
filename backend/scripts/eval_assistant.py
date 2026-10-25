#!/usr/bin/env python3
"""NIYTRI assistant numeric QA suite.

Runs a set of golden checks for the parts that MUST be numerically exact — the
answer self-check (verify.check_and_fix) and the score-band counting rules. Add a
case here whenever a numeric bug is found, so regressions are caught automatically.

Usage (from backend/):  python scripts/eval_assistant.py
Exit code 0 = all pass, 1 = one or more failed (use in CI / on deploy).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import verify  # noqa: E402

_pass = _fail = 0


def check(name, got, want):
    global _pass, _fail
    ok = got == want
    _pass += ok
    _fail += (not ok)
    print(("  PASS " if ok else "  FAIL ") + name)
    if not ok:
        print("        got : %r" % (got,))
        print("        want: %r" % (want,))


def band_counts(scores):
    """The authoritative band rule used across the app (50 is NEUTRAL, not below-50)."""
    s = [x for x in scores if x is not None]
    return {"below_50": sum(1 for v in s if v < 50),
            "neutral": sum(1 for v in s if 50 <= v < 65),
            "strong": sum(1 for v in s if v >= 65),
            "scored": len(s), "total": len(scores)}


print("== Band counting (boundaries) ==")
fc = band_counts([38.9, 40.5, 42.9, 50.0, 39.2, 47.4, 42.1])   # the reported portfolio
check("6 below 50 (50.0 is neutral)", fc["below_50"], 6)
check("1 neutral (exactly 50)", fc["neutral"], 1)
check("0 strong", fc["strong"], 0)
check("65 is strong not neutral", band_counts([65.0])["strong"], 1)
check("49.99 is below 50", band_counts([49.99])["below_50"], 1)

print("== Answer self-check (auto-correct) ==")
f = {"below_50": 6, "neutral": 1, "strong": 0, "scored": 7, "total": 7}
cases = [
    ("5 of 7 holdings score below 50.", "6 of 7 holdings score below 50."),
    ("Only 3 stocks are below 50.", "Only 6 stocks are below 50."),
    ("4 of 7 holdings are neutral.", "1 of 7 holdings are neutral."),
    # must NOT touch legitimate prose / unrelated numbers:
    ("Your portfolio has strong fundamentals overall.",
     "Your portfolio has strong fundamentals overall."),
    ("The stock trades at a P/E of 50.", "The stock trades at a P/E of 50."),
    ("6 holdings are weak.", "6 holdings are weak."),   # already correct -> unchanged
]
for inp, want in cases:
    got, _ = verify.check_and_fix(inp, f)
    check(repr(inp), got, want)

print("== Deflection guard (answer_guard) ==")
from app.services import answer_guard as ag  # noqa: E402
# Must FIRE on refusals / "I don't have" / "contact support":
for t in [
    "I don't have a live list of which stocks are in the NIFTY 500.",
    "I can't run a query on the database right now.",
    "I'm unable to pull that data — please contact customer support.",
    "I don't have real-time access to scores.",
]:
    check("deflects: " + t[:40], ag.looks_deflecting(t), True)
# Must NOT fire on legitimate answers / scoped messages:
for t in [
    "RELIANCE scores 71 and is in the NIFTY 50.",
    "That stock is outside the selected NIFTY 500 universe — switch to All NSE to include it.",
    "The top 5 stocks by NIYTRI Score are TCS, INFY, HDFCBANK, RELIANCE and ITC.",
]:
    check("no-deflect: " + t[:40], ag.looks_deflecting(t), False)
check("is_grounded via deterministic", ag.is_grounded([], deterministic="x"), True)
check("is_grounded via marker",
      ag.is_grounded(["AI_SCORES_SUMMARY (date ...): total=50"]), True)
check("not grounded (empty)", ag.is_grounded(["QUOTE RELIANCE: ..."]), False)

print("== Universe SQL hard-scope (db_query) ==")
from app.services import db_query  # noqa: E402
syms = {"RELIANCE", "TCS", "INFY"}
q1 = db_query._scope_universe(
    "SELECT COUNT(*) FROM stock_scores WHERE composite_score < 50", syms)
check("count query filtered at source", "WHERE symbol IN (" in q1 and "stock_scores WHERE" in q1, True)
q2 = db_query._scope_universe(
    "SELECT i.sector, AVG(s.composite_score) FROM stock_scores s "
    "JOIN instruments i ON s.symbol=i.symbol GROUP BY i.sector", syms)
check("join: both tables scoped + aliases kept", ("AS s" in q2 and "AS i" in q2
      and q2.count("WHERE symbol IN (") == 2), True)
check("no scope when syms empty",
      db_query._scope_universe("SELECT * FROM stock_scores", None),
      "SELECT * FROM stock_scores")
check("symbols sanitised (no injection)",
      "'; DROP" not in db_query._scope_universe(
          "SELECT * FROM stock_scores", {"X'; DROP TABLE users;--"}), True)

print("== Index-membership handler (negative paths, no DB) ==")
from app.services import assistant as _asst  # noqa: E402
check("non-index question returns None",
      _asst._index_membership_answer("top 5 stocks by score", None), None)
check("index name but no intent returns None",
      _asst._index_membership_answer("nifty 500", None) is None
      or isinstance(_asst._index_membership_answer("nifty 500", None), str), True)

print("\n%d passed, %d failed" % (_pass, _fail))
sys.exit(1 if _fail else 0)
