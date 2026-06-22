"""Deterministic analytics for the AI assistant.

LLMs are unreliable at arithmetic, counting and aggregation over long lists.
For recognised quantitative questions we compute the answer in code and inject
it as an AUTHORITATIVE figure the model must report verbatim — so sector
averages, threshold counts and top/bottom rankings are always exact.

`compute(question, rows, sectors, names)` returns a short factual string when a
quantitative intent is confidently detected, else None (the model then falls
back to ALL_SCORES + SECTOR_STATS with the accuracy rules).
"""
import re

# question keyword -> case-insensitive substring to match against a sector tag
_SECTOR_SYN = {
    "bank": "bank", "banking": "bank", "it": "it", "tech": "it",
    "software": "it", "pharma": "pharma", "healthcare": "health", "auto": "auto",
    "fmcg": "fmcg", "metal": "metal", "energy": "energy", "power": "power",
    "cement": "cement", "insurance": "insurance", "finance": "financ",
    "financial": "financ", "realty": "realty", "telecom": "telecom",
}

# (phrase, fundamentals-key, label) — longest phrases first
_METRICS = [
    ("price to earnings", "pe", "P/E"), ("pe ratio", "pe", "P/E"),
    ("p/e", "pe", "P/E"), ("pe", "pe", "P/E"),
    ("dividend yield", "dividend_yield", "dividend yield %"),
    ("dividend", "dividend_yield", "dividend yield %"),
    ("price to book", "pb", "P/B"), ("p/b", "pb", "P/B"), ("pb", "pb", "P/B"),
    ("return on equity", "roe", "ROE %"), ("roe", "roe", "ROE %"),
    ("market cap", "market_cap", "market cap (cr)"),
    ("marketcap", "market_cap", "market cap (cr)"),
    ("market capitalisation", "market_cap", "market cap (cr)"),
    ("day change", "change_pct", "day change %"), ("change", "change_pct", "day change %"),
    ("score", "composite_score", "score"), ("rating", "composite_score", "score"),
]


def _val(r, key):
    if key == "composite_score":
        return r.composite_score
    if key == "pe":
        return r.pe if r.pe is not None else (r.fundamentals or {}).get("pe")
    if key == "market_cap":
        return r.market_cap if r.market_cap is not None else (r.fundamentals or {}).get("market_cap")
    return (r.fundamentals or {}).get(key)


def _fmt(v, key):
    if v is None:
        return "n/a"
    if key == "market_cap":
        return str(round(v / 1e7)) + " cr"
    if key == "composite_score":
        return str(round(v, 1))
    return str(round(v, 2))


def _metric(lower):
    for phrase, key, label in _METRICS:
        if re.search(r"\b" + re.escape(phrase) + r"\b", lower):
            return key, label
    return None


def _group(lower, rows, sectors, names):
    """Return (label, rows-subset) for the sector/group named in the question,
    or (None, None) when no single clear group is referenced."""
    if re.search(r"\b(all|entire|whole|overall|market|universe|every)\b", lower) \
            and "sector" not in lower:
        return "all scripts", rows
    for kw, tok in _SECTOR_SYN.items():
        # short tags (e.g. "it") need exact-word match; longer ones allow plural/
        # derivative forms ("bank" -> banks/banking, "auto" -> autos).
        pat = r"\b" + re.escape(kw) + (r"\b" if len(kw) <= 3 else r"")
        if re.search(pat, lower):
            grp = [r for r in rows
                   if tok in (sectors.get(r.symbol) or "").lower()
                   or (tok == "bank" and "bank" in (names.get(r.symbol) or "").lower())]
            if grp:
                return kw + " stocks", grp
    secset = {}
    for r in rows:
        s = sectors.get(r.symbol) or ""
        if s and re.search(r"\b" + re.escape(s.lower()) + r"\b", lower):
            secset.setdefault(s, []).append(r)
    if len(secset) == 1:
        s, grp = next(iter(secset.items()))
        return s, grp
    return None, None


def compute(question, rows, sectors, names):
    if not rows:
        return None
    lower = " " + (question or "").lower() + " "
    met = _metric(lower)

    # 1) threshold count / list (e.g. "stocks below 50", "P/E under 15")
    m = re.search(r"(at least|at most|greater than|less than|more than|fewer than|above|over|below|under|>=|<=|>|<)\s*[₹$]?\s*([0-9]+(?:\.[0-9]+)?)", lower)
    if m:
        key, label = met or ("composite_score", "score")
        op, num = m.group(1), float(m.group(2))
        hi = op in ("at least", "greater than", "more than", "above", "over", ">=", ">")
        inc = op in ("at least", ">=", "at most", "<=")
        def ok(v):
            if v is None:
                return False
            return (v >= num if inc else v > num) if hi else (v <= num if inc else v < num)
        grp_label, grp = _group(lower, rows, sectors, names)
        base = grp if grp else rows
        hits = [(r.symbol, _val(r, key)) for r in base if ok(_val(r, key))]
        hits.sort(key=lambda x: x[1], reverse=hi)
        shown = ", ".join(f"{s} ({_fmt(v, key)})" for s, v in hits[:60])
        more = "" if len(hits) <= 60 else f" (showing 60 of {len(hits)})"
        scope = f" in {grp_label}" if grp else ""
        return f"{len(hits)} script(s){scope} with {label} {op} {num:g}: {shown}{more}."

    # 2) top / bottom N by a metric
    m = re.search(r"\b(top|bottom|highest|lowest|best|worst)\b(?:\s+(\d+))?", lower)
    if m and (met or "stock" in lower or "score" in lower or "share" in lower):
        key, label = met or ("composite_score", "score")
        word = m.group(1)
        n = int(m.group(2)) if m.group(2) else (1 if word in ("highest", "lowest") else 10)
        desc = word in ("top", "highest", "best")
        grp_label, grp = _group(lower, rows, sectors, names)
        base = grp if grp else rows
        valued = [(r.symbol, _val(r, key)) for r in base if _val(r, key) is not None]
        valued.sort(key=lambda x: x[1], reverse=desc)
        picks = valued[:n]
        scope = f" in {grp_label}" if grp else ""
        lst = ", ".join(f"{s} ({_fmt(v, key)})" for s, v in picks)
        return f"{'Top' if desc else 'Bottom'} {len(picks)} by {label}{scope}: {lst}."

    # 3) average / min / max / count of a metric (optionally for a group)
    if re.search(r"\b(average|avg|mean|median|sum|total|how many|count|min|max|minimum|maximum)\b", lower) and met:
        key, label = met
        grp_label, grp = _group(lower, rows, sectors, names)
        base = grp if grp else rows
        vals = [v for v in (_val(r, key) for r in base) if v is not None]
        if vals:
            avg = sum(vals) / len(vals)
            scope = f" for {grp_label}" if grp else " across all scripts"
            extra = ""
            if key == "market_cap" and re.search(r"\b(sum|total|combined|aggregate)\b", lower):
                extra = " total=" + format(round(sum(vals) / 1e7), ",") + " cr,"
            return (f"{label}{scope}: n={len(vals)},{extra} average={_fmt(avg, key)}, "
                    f"min={_fmt(min(vals), key)}, max={_fmt(max(vals), key)}.")
    return None
