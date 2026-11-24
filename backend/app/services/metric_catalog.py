"""Semantic metric catalog — the layer that makes natural-language screening and
assistant SQL actually correct.

The LLM planners used to guess which table/column a domain term meant (so "ROCE",
"promoter holding" or "8-quarter profit growth" either resolved to the wrong column
or were refused). This catalog maps each domain METRIC to the right CMOTS table and
column concept, with synonyms, unit and direction, and flags the few things the
connected data genuinely cannot answer — so the planner resolves terms correctly and
only declines when the data is truly absent.

It is deliberately TABLE/COLUMN-concept level: the exact introspected column names are
still shown to the planner alongside this map, so the planner picks the real column
that matches the concept. That keeps the catalog robust even if a vendor renames a
column. Edit METRICS to teach the system a new term — no code changes elsewhere.
"""
from __future__ import annotations

# metric_key: {
#   "label": human name,
#   "syn":   [synonyms / phrasings users type],
#   "table": CMOTS table (or 'app' for our own analytics) that holds it,
#   "col":   column concept (match to the real introspected column of that table),
#   "unit":  %, x, Cr, ratio, price, score ... (for display/interpretation),
#   "good":  "high" | "low" | "" (which direction is generally favourable),
#   "note":  optional extra guidance for the planner,
# }
METRICS: dict[str, dict] = {
    # ---- valuation ----
    "pe": {"label": "P/E (price to earnings)", "syn": ["pe", "p/e", "price to earnings", "pe ratio", "trailing pe"],
           "table": "fundamentalttm", "col": "pe_ttm", "unit": "x", "good": "low"},
    "pb": {"label": "P/B (price to book)", "syn": ["pb", "p/b", "price to book", "pb ratio"],
           "table": "fundamentalttm", "col": "pb_ttm", "unit": "x", "good": "low"},
    "ev_ebitda": {"label": "EV/EBITDA", "syn": ["ev/ebitda", "ev ebitda", "enterprise value to ebitda"],
                  "table": "valuationratios", "col": "ev_ebitda", "unit": "x", "good": "low"},
    "peg": {"label": "PEG ratio", "syn": ["peg", "peg ratio", "price earnings to growth"],
            "table": "fundamentalttm", "col": "pegratio", "unit": "x", "good": "low"},
    "sector_pe": {"label": "Sector P/E", "syn": ["sector pe", "industry pe", "sector p/e"],
                  "table": "fundamentalttm", "col": "sectorpe", "unit": "x", "good": ""},
    # ---- performance / returns ----
    "roe": {"label": "ROE (return on equity)", "syn": ["roe", "return on equity"],
            "table": "performanceratios", "col": "roe", "unit": "%", "good": "high"},
    "roce": {"label": "ROCE (return on capital employed)",
             "syn": ["roce", "return on capital employed", "return on capital"],
             "table": "performanceratios", "col": "roce", "unit": "%", "good": "high",
             "note": "ROCE lives in performanceratios; if a literal roce column is absent use the "
                     "closest capital-return column there (e.g. returnoncapitalemployed)."},
    "roa": {"label": "ROA (return on assets)", "syn": ["roa", "return on assets"],
            "table": "performanceratios", "col": "roa", "unit": "%", "good": "high"},
    # ---- margins / profitability ----
    "net_margin": {"label": "Net profit margin", "syn": ["net margin", "net profit margin", "npm", "profit margin"],
                   "table": "fundamentalttm", "col": "netprofitmargin", "unit": "%", "good": "high"},
    "op_margin": {"label": "Operating margin", "syn": ["operating margin", "opm", "ebit margin", "operating profit margin"],
                  "table": "fundamentalttm", "col": "operatingprofitmargin", "unit": "%", "good": "high"},
    "gross_margin": {"label": "Gross margin", "syn": ["gross margin", "gross profit margin"],
                     "table": "marginratios", "col": "grossmargin", "unit": "%", "good": "high"},
    # ---- per-share / income ----
    "eps": {"label": "EPS (earnings per share)", "syn": ["eps", "earnings per share"],
            "table": "fundamentalttm", "col": "eps_ttm", "unit": "Rs", "good": "high"},
    "dividend_yield": {"label": "Dividend yield", "syn": ["dividend yield", "div yield", "yield"],
                       "table": "fundamentalttm", "col": "dividendyield", "unit": "%", "good": "high"},
    "dividend_history": {"label": "Dividend history", "syn": ["dividend history", "dividends paid", "dividend record"],
                         "table": "dividendcocodewise", "col": "dividend", "unit": "Rs", "good": ""},
    # ---- leverage / stability ----
    "debt_equity": {"label": "Debt/Equity", "syn": ["debt to equity", "debt/equity", "d/e", "de ratio", "leverage", "low debt"],
                    "table": "financialstabilityratios", "col": "totaldebt_equity", "unit": "x", "good": "low"},
    "current_ratio": {"label": "Current ratio", "syn": ["current ratio", "liquidity"],
                      "table": "financialstabilityratios", "col": "currentratio", "unit": "x", "good": "high"},
    "interest_cover": {"label": "Interest coverage", "syn": ["interest coverage", "interest cover", "icr"],
                       "table": "financialstabilityratios", "col": "interestcover", "unit": "x", "good": "high"},
    # ---- size / price / liquidity ----
    "market_cap": {"label": "Market capitalisation", "syn": ["market cap", "mcap", "m-cap", "marketcap", "size"],
                   "table": "fundamentalttm", "col": "mcap", "unit": "Cr", "good": "",
                   "note": "mcap is in Rs crore. mcaptype on companymaster tags Large/Mid/Small."},
    "cap_type": {"label": "Cap tier (large/mid/small)", "syn": ["large cap", "mid cap", "small cap", "largecap", "midcap", "smallcap"],
                 "table": "companymaster", "col": "mcaptype", "unit": "", "good": ""},
    "price": {"label": "Close price", "syn": ["price", "ltp", "cmp", "close", "current price", "share price"],
              "table": "price_change", "col": "close", "unit": "price", "good": ""},
    "volume": {"label": "Traded volume", "syn": ["volume", "traded volume", "turnover"],
               "table": "price_change", "col": "volume", "unit": "", "good": ""},
    "delivery_volume": {"label": "Deliverable volume", "syn": ["delivery volume", "deliverable quantity", "delivery %"],
                        "table": "deliverablevolume", "col": "deliverablequantity", "unit": "", "good": ""},
    # ---- growth / quarterly ----
    "sales_growth": {"label": "Sales / revenue growth", "syn": ["sales growth", "revenue growth", "topline growth"],
                     "table": "quarterlyresults", "col": "netsales", "unit": "%", "good": "high",
                     "note": "Growth = compare netsales across periods. For 'last N quarters' use "
                             "quarterlyresults ordered by period; for annual use proftandloss/yearly."},
    "profit_growth": {"label": "Profit growth", "syn": ["profit growth", "earnings growth", "pat growth", "bottomline growth"],
                      "table": "quarterlyresults", "col": "netprofit", "unit": "%", "good": "high",
                      "note": "Growth = compare netprofit across periods (quarterlyresults) or years (proftandloss)."},
    # ---- ownership / shareholding ----
    "promoter_holding": {"label": "Promoter holding", "syn": ["promoter holding", "promoter stake", "promoter %", "promoters"],
                         "table": "shareholdingpatterndetailed", "col": "promoter", "unit": "%", "good": "",
                         "note": "Shareholding pattern holds promoter / FII / DII / public %. Use the latest period."},
    "fii_holding": {"label": "FII holding", "syn": ["fii holding", "fii stake", "foreign holding", "fpi"],
                    "table": "shareholdingpatterndetailed", "col": "fii", "unit": "%", "good": ""},
    "dii_holding": {"label": "DII holding", "syn": ["dii holding", "dii stake", "domestic institutional"],
                    "table": "shareholdingpatterndetailed", "col": "dii", "unit": "%", "good": ""},
    "mf_holding": {"label": "Mutual-fund holding", "syn": ["mutual fund holding", "mf holding"],
                   "table": "companywisemfholding", "col": "holding", "unit": "%", "good": ""},
    "bulk_block": {"label": "Bulk / block deals", "syn": ["bulk deal", "block deal", "bulk/block"],
                   "table": "bulkblockdeal", "col": "quantity", "unit": "", "good": ""},
    # ---- technicals ----
    "rsi": {"label": "RSI", "syn": ["rsi", "relative strength index"],
            "table": "technicalindicatorratios", "col": "rsi", "unit": "", "good": ""},
    "macd": {"label": "MACD", "syn": ["macd"], "table": "technicalindicatorratios", "col": "macd", "unit": "", "good": ""},
    "sma": {"label": "Moving average", "syn": ["sma", "moving average", "dma", "50 dma", "200 dma"],
            "table": "sma", "col": "sma", "unit": "price", "good": ""},
    # ---- classification ----
    "sector": {"label": "Sector / industry", "syn": ["sector", "industry", "sectorname"],
               "table": "companymaster", "col": "sectorname", "unit": "", "good": "",
               "note": "Classify themes/sectors ONLY via sectorname/industry — never by company name text."},
    # ---- NIYTRI's own analytics (source 'app') ----
    "niytri_score": {"label": "NIYTRI Score", "syn": ["niytri score", "score", "composite score", "ai score", "rating"],
                     "table": "app:stock_scores", "col": "composite_score", "unit": "score", "good": "high",
                     "note": "0-100. Bands: 65+ strong, 50-64 neutral, below 50 weak. 'app' source."},
    "index_membership": {"label": "Index membership", "syn": ["nifty 50", "nifty 500", "index", "constituent"],
                         "table": "app:instruments", "col": "indices", "unit": "", "good": "",
                         "note": "indices is a JSON list of tags like NIFTY50/NIFTY500. 'app' source."},
}

# Concepts the connected data genuinely does NOT hold — the planner must say so
# (which triggers the screener's alternative-screen suggestions) instead of faking.
UNAVAILABLE = {
    "intraday tick / order-book / market depth data",
    "analyst price targets or broker buy/sell recommendations",
    "credit ratings (CRISIL/ICRA) feed",
    "management commentary / concall transcripts as structured fields",
    "ESG scores",
}


def resolve(term: str) -> list[dict]:
    """Return catalog entries whose label/synonyms match the term (best-effort)."""
    t = (term or "").strip().lower()
    if not t:
        return []
    out = []
    for key, m in METRICS.items():
        hay = [m["label"].lower()] + [s.lower() for s in m.get("syn", [])]
        if any(t == h or t in h or h in t for h in hay):
            out.append({"key": key, **m})
    return out


def catalog_text() -> str:
    """Compact METRIC MAP for the LLM planners: domain term -> table.column concept."""
    lines = [
        "# METRIC MAP (resolve a user's domain term to the RIGHT table + column concept; "
        "then pick the actual column from the introspected schema shown elsewhere). "
        "co_code is the join key; companymaster maps co_code<->nsesymbol. Tables prefixed "
        "'app:' are our OWN analytics (source 'app'), everything else is the market DB "
        "(source 'market')."
    ]
    for key, m in METRICS.items():
        syn = ", ".join(m.get("syn", [])[:5])
        unit = (" [" + m["unit"] + "]") if m.get("unit") else ""
        good = (" (" + m["good"] + " is better)") if m.get("good") else ""
        note = ("  NOTE: " + m["note"]) if m.get("note") else ""
        lines.append(f"- {m['label']}{unit}{good}: {m['table']}.{m['col']} — synonyms: {syn}.{note}")
    lines.append("\n# NOT AVAILABLE in the connected data (say so plainly, do NOT fabricate): "
                 + "; ".join(sorted(UNAVAILABLE)) + ".")
    lines.append("RULES: resolve every metric via this map; a term absent from BOTH the map and the "
                 "schema means the data can't answer it — return an empty query and say what's missing. "
                 "Growth/streak questions ('last N quarters', 'YoY') compare periods in quarterlyresults "
                 "(quarterly) or proftandloss/yearly (annual). Always de-duplicate to one row per company.")
    return "\n".join(lines)
