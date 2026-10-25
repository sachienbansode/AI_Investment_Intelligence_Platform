"""Numeric self-check — auto-correct count claims the model may have miscounted.

LLMs are unreliable at counting over lists. Before an answer is returned, we scan it
for count claims ("N of M … below 50", "N holdings … weak", etc.) and, when we have the
code-computed TRUE value for that band, replace a wrong number with the correct one and
log the correction. Conservative: only touches numbers clearly tied to a known fact.
"""
from __future__ import annotations

import logging
import re

log = logging.getLogger(__name__)

# band keyword -> fact key (the code-computed correct count)
_BANDS = [
    (r"(?:below|under)\s*50|weak", "below_50"),
    (r"(?:50\s*(?:to|-|–)\s*64|neutral)", "neutral"),
    (r"(?:65\s*\+|above\s*65|65\s*or\s*(?:more|above)|strong(?:-scoring)?)", "strong"),
]
_NOUN = r"(?:of\s*(?:your|the)\s*)?(?:holdings?|stocks?|scripts?|names?)"


def check_and_fix(answer: str, facts: dict):
    """Return (fixed_answer, [corrections]). `facts` may contain: below_50, neutral,
    strong, scored, total (ints). Only claims matching a present fact are touched."""
    if not answer or not facts:
        return answer, []
    corrections = []
    text = answer
    total = facts.get("scored") or facts.get("total")

    for band_pat, key in _BANDS:
        if facts.get(key) is None:
            continue
        correct = int(facts[key])

        # "N of M <...> <band>"   e.g. "5 of 7 holdings score below 50"
        def _of(m, _c=correct, _k=key):
            n, mm, tail = m.group(1), m.group(2), m.group(3)
            fixed_n = str(_c)
            fixed_m = str(int(total)) if total else mm
            if n != fixed_n or mm != fixed_m:
                corrections.append({"was": m.group(0).strip(), "key": _k, "correct": _c})
            return f"{fixed_n} of {fixed_m}{tail}"
        text = re.sub(r"\b(\d{1,3})\s*of\s*(\d{1,3})(\b[^.\n\d]{0,40}?(?:" + band_pat + r"))",
                      _of, text, flags=re.IGNORECASE)

        # "N <noun> <...> <band>"   e.g. "6 holdings are weak"
        def _n(m, _c=correct, _k=key):
            n, tail = m.group(1), m.group(2)
            if n != str(_c):
                corrections.append({"was": m.group(0).strip(), "key": _k, "correct": _c})
            return f"{_c}{tail}"
        # (skip the "M" in a "N of M" phrase — that total is already handled above)
        text = re.sub(r"(?<!of )\b(\d{1,3})(\s*" + _NOUN + r"[^.\n\d]{0,30}?(?:" + band_pat + r"))",
                      _n, text, flags=re.IGNORECASE)

    return text, corrections
