"""Portfolio Intelligence (BRD): health score, diversification, concentration
risk, sector exposure, a value-weighted NIYTRI Score quality overlay, a plain
verdict (strengths / watch-outs) and personalized descriptive insights."""
import json

from app.core.compliance import AI_DISCLAIMER, audit_log
from app.data.aggregator import get_market_data
from app.db.database import Instrument, SessionLocal, StockScore
from app.llm.router import get_llm_router
from app.models.schemas import Holding, PortfolioResponse


def _band(s):
    return "strong" if s >= 65 else "neutral" if s >= 50 else "weak"


async def portfolio_metrics(holdings: list[Holding]) -> dict:
    """Compute the portfolio's health / concentration / exposure / P&L metrics AND
    the NIYTRI Score overlay + verdict (no LLM call). Shared by analyze_portfolio
    AND the AI assistant so their numbers always match the Portfolio page."""
    md = get_market_data()
    db = SessionLocal()
    try:  # sector master from instruments table (fallback when quote lacks it)
        sector_map = {r.symbol: r.sector for r in db.query(Instrument).all() if r.sector}
    finally:
        db.close()
    rows = []
    for h in holdings:
        q = await md.get_quote(h.symbol)
        price = (q.last_price if q and q.last_price else h.avg_price)
        sector = (h.sector or (q.sector if q else None)
                  or sector_map.get(h.symbol.upper()) or "Unknown")
        value = price * h.quantity
        rows.append({"symbol": h.symbol.upper(), "value": value, "sector": sector,
                     "pnl_pct": round((price - h.avg_price) / h.avg_price * 100, 2)})

    current_value = sum(r["value"] for r in rows)
    invested = sum(h.quantity * h.avg_price for h in holdings)
    total = current_value or 1.0
    weights = {r["symbol"]: r["value"] / total for r in rows}

    # Sector exposure
    sector_exp: dict[str, float] = {}
    for r in rows:
        sector_exp[r["sector"]] = sector_exp.get(r["sector"], 0) + r["value"] / total
    sector_exp = {k: round(v * 100, 1) for k, v in sector_exp.items()}

    # Concentration risk: Herfindahl index + top-holding weight
    hhi = sum(w * w for w in weights.values())
    top_symbol, top_w = (max(weights.items(), key=lambda kv: kv[1]) if weights else ("-", 0.0))
    concentration = {
        "herfindahl_index": round(hhi, 3),
        "top_holding": top_symbol,
        "top_holding_weight_pct": round(top_w * 100, 1),
        "level": "high" if hhi > 0.3 else "moderate" if hhi > 0.15 else "low",
    }

    # Diversification
    diversification = {
        "num_holdings": len(rows),
        "num_sectors": len(sector_exp),
        "effective_holdings": round(1 / hhi, 1) if hhi else 0,
    }

    # ---- NIYTRI Score overlay (value-weighted quality of the holdings) --------
    dbs = SessionLocal()
    try:
        srows = (dbs.query(StockScore.symbol, StockScore.composite_score)
                 .filter(StockScore.symbol.in_([r["symbol"] for r in rows]),
                         StockScore.quality_status == "approved")
                 .order_by(StockScore.score_date.desc()).all())
    finally:
        dbs.close()
    score_map: dict[str, float] = {}
    for sym, sc in srows:
        if sym not in score_map and sc is not None:
            score_map[sym] = round(float(sc), 1)

    for r in rows:
        r["weight_pct"] = round(r["value"] / total * 100, 1)
        r["value"] = round(r["value"], 2)
        r["score"] = score_map.get(r["symbol"])
        r["band"] = _band(r["score"]) if r["score"] is not None else None

    scored_val = sum(r2["value"] for r2 in rows if r2["score"] is not None)
    weighted_score = (round(sum(r2["value"] * r2["score"] for r2 in rows if r2["score"] is not None)
                            / scored_val, 1) if scored_val else None)
    band_weight = {"strong": 0.0, "neutral": 0.0, "weak": 0.0}
    band_count = {"strong": 0, "neutral": 0, "weak": 0}
    for r in rows:
        if r["score"] is not None:
            band_weight[r["band"]] += r["value"] / total * 100
            band_count[r["band"]] += 1
    band_weight = {k: round(v, 1) for k, v in band_weight.items()}
    weakest = sorted([r for r in rows if r["score"] is not None and r["score"] < 50],
                     key=lambda r: r["weight_pct"], reverse=True)
    strongest = sorted([r for r in rows if r["score"] is not None and r["score"] >= 65],
                       key=lambda r: r["weight_pct"], reverse=True)
    portfolio_score = {
        "weighted_score": weighted_score,
        "coverage_pct": round(scored_val / total * 100, 1),
        "band_weight_pct": band_weight, "band_count": band_count,
        "band": (_band(weighted_score) if weighted_score is not None else None),
        "strongest": [{"symbol": r["symbol"], "score": r["score"], "weight_pct": r["weight_pct"]} for r in strongest[:3]],
        "weakest": [{"symbol": r["symbol"], "score": r["score"], "weight_pct": r["weight_pct"]} for r in weakest[:3]],
    }

    # Health score 0-100 with transparent deductions (structure) — now also nudged
    # by the NIYTRI quality overlay so a portfolio of weak-scoring names scores lower.
    deductions = []
    d = max(0.0, (top_w - 0.20)) * 100
    if d:
        deductions.append({"reason": f"Top holding {top_symbol} is {round(top_w*100,1)}% "
                                     "of portfolio (guideline: under 20%)",
                           "points": round(d, 1)})
    d = max(0.0, (hhi - 0.15)) * 80
    if d:
        deductions.append({"reason": f"Overall concentration high (HHI {round(hhi,2)} "
                                     "vs 0.15 guideline)", "points": round(d, 1)})
    if len(sector_exp) < 3:
        deductions.append({"reason": f"Only {len(sector_exp)} sector(s) — guideline is 3+",
                           "points": 10})
    if len(rows) < 5:
        deductions.append({"reason": f"Only {len(rows)} holding(s) — guideline is 5+",
                           "points": 10})
    if weighted_score is not None and weighted_score < 50 and portfolio_score["coverage_pct"] >= 50:
        deductions.append({"reason": f"Holdings skew weak on the NIYTRI Score "
                                     f"(value-weighted {weighted_score})", "points": 12})
    elif band_weight["weak"] >= 30:
        deductions.append({"reason": f"{band_weight['weak']}% of value in weak-scoring names (below 50)",
                           "points": 8})
    health = round(max(0.0, min(100.0, 100.0 - sum(x["points"] for x in deductions))), 1)

    # Approximate P&L and Red/Amber/Green status
    pnl_abs = round(current_value - invested, 2)
    pnl_pct = round((current_value - invested) / invested * 100, 2) if invested else 0.0
    rag = "green" if health >= 70 else "amber" if health >= 50 else "red"
    rag_label = {"green": "Healthy", "amber": "Needs attention", "red": "High risk"}[rag]
    pnl = {"invested": round(invested, 2), "current_value": round(current_value, 2),
           "pnl": pnl_abs, "pnl_pct": pnl_pct}

    # ---- Verdict: plain strengths / watch-outs from the real numbers ----------
    strengths, watchouts = [], []
    if weighted_score is not None:
        if weighted_score >= 65:
            strengths.append(f"High overall quality — value-weighted **NIYTRI Score {weighted_score}** (strong).")
        elif weighted_score < 50:
            watchouts.append(f"Low overall quality — value-weighted **NIYTRI Score {weighted_score}** (weak).")
        else:
            watchouts.append(f"Middling quality — value-weighted **NIYTRI Score {weighted_score}** (neutral).")
    if concentration["level"] == "high":
        watchouts.append(f"High concentration — top holding **{concentration['top_holding']}** at **{concentration['top_holding_weight_pct']}%**.")
    elif concentration["level"] == "low":
        strengths.append("Well spread — low single-name concentration.")
    if diversification["num_sectors"] >= 4:
        strengths.append(f"Diversified across **{diversification['num_sectors']}** sectors.")
    elif diversification["num_sectors"] < 3:
        watchouts.append(f"Thin diversification — only **{diversification['num_sectors']}** sector(s).")
    if invested:
        if pnl_abs >= 0:
            strengths.append(f"In profit — **+{pnl_pct}%** versus cost.")
        else:
            watchouts.append(f"In the red — **{pnl_pct}%** versus cost.")
    if strongest:
        ssum = round(sum(r["weight_pct"] for r in strongest), 1)
        strengths.append(f"**{ssum}%** of value in strong-scoring names (65+).")
    if weakest:
        wsum = round(sum(r["weight_pct"] for r in weakest), 1)
        names = ", ".join(f"{r['symbol']} ({r['score']})" for r in weakest[:3])
        watchouts.append(f"**{len(weakest)}** holding(s) below 50 — {names} — **{wsum}%** of value.")
    if portfolio_score["coverage_pct"] < 60:
        watchouts.append(f"Only **{portfolio_score['coverage_pct']}%** of value has a NIYTRI Score yet — quality read is partial.")

    if health >= 70 and (weighted_score or 0) >= 60:
        label = "Healthy & high-quality"
    elif health < 50 or (weighted_score is not None and weighted_score < 50):
        label = "Needs attention"
    else:
        label = "Mixed — some strengths, some watch-outs"
    verdict = {"label": label, "strengths": strengths, "watchouts": watchouts}

    qtxt = (f"a value-weighted NIYTRI Score of {weighted_score}" if weighted_score is not None
            else "no NIYTRI Score coverage yet")
    headline = (
        f"{label}. {len(rows)} holding(s) across {diversification['num_sectors']} sector(s) with {qtxt}; "
        f"{concentration['level']} concentration (top: {concentration['top_holding']} "
        f"{concentration['top_holding_weight_pct']}%). "
        f"Currently {'up' if pnl_abs >= 0 else 'down'} {abs(pnl_pct)}% "
        f"({'+' if pnl_abs >= 0 else '-'}Rs {abs(pnl_abs):,.0f}) versus invested cost."
    )

    holdings_out = sorted(
        [{"symbol": r["symbol"], "weight_pct": r["weight_pct"], "value": r["value"],
          "pnl_pct": r["pnl_pct"], "sector": r["sector"], "score": r["score"], "band": r["band"]}
         for r in rows], key=lambda r: r["weight_pct"], reverse=True)

    return {"weights": weights, "sector_exposure": sector_exp, "concentration": concentration,
            "diversification": diversification, "deductions": deductions, "health": health,
            "pnl": pnl, "status": rag, "status_label": rag_label, "headline": headline,
            "holdings": holdings_out, "portfolio_score": portfolio_score, "verdict": verdict}


async def analyze_portfolio(holdings: list[Holding]) -> PortfolioResponse:
    m = await portfolio_metrics(holdings)

    # AI commentary (descriptive, not advisory) — grounded in the real numbers,
    # including the NIYTRI Score overlay and verdict.
    llm = get_llm_router()
    ctx = {
        "health_score": m["health"], "status": m["status_label"],
        "pnl_pct": m["pnl"]["pnl_pct"],
        "weighted_niytri_score": m["portfolio_score"].get("weighted_score"),
        "score_coverage_pct": m["portfolio_score"].get("coverage_pct"),
        "band_weight_pct": m["portfolio_score"].get("band_weight_pct"),
        "sector_exposure_pct": m["sector_exposure"],
        "concentration": m["concentration"], "diversification": m["diversification"],
        "weakest": m["portfolio_score"].get("weakest"),
        "strongest": m["portfolio_score"].get("strongest"),
    }
    prompt = (
        f"Portfolio metrics: {json.dumps(ctx)}\n"
        "Write a crisp assessment of THIS portfolio for its owner. Start with ONE bold "
        "conclusion sentence (the overall read, referencing the value-weighted NIYTRI "
        "Score and health). Then 3-5 markdown bullets ('- ') of factual observations on "
        "quality (NIYTRI Score bands), diversification, concentration and sector tilt, "
        "bolding key numbers with **. Reference specific holdings where relevant. "
        "Describe the data only — do NOT recommend buying, selling or holding anything, "
        "and give no price targets. Output the conclusion line, a blank line, then bullets."
    )
    try:
        resp = await llm.complete(
            "You write factual, insightful portfolio analytics for a SEBI-regulated broker. "
            "Never give investment advice, recommendations or price targets.", prompt,
            task="portfolio_insights", max_tokens=380,
        )
        insights = resp.text.strip()
    except Exception:
        insights = m["headline"]

    audit_log("portfolio_analysis", holdings=m["diversification"]["num_holdings"],
              health=m["health"], pnl_pct=m["pnl"]["pnl_pct"], status=m["status"],
              niytri_score=m["portfolio_score"].get("weighted_score"))
    return PortfolioResponse(
        health_score=m["health"], status=m["status"], status_label=m["status_label"],
        headline=m["headline"], pnl=m["pnl"], deductions=m["deductions"],
        diversification=m["diversification"], concentration_risk=m["concentration"],
        sector_exposure=m["sector_exposure"], insights=insights, disclaimer=AI_DISCLAIMER,
        holdings=m["holdings"], portfolio_score=m["portfolio_score"], verdict=m["verdict"],
    )
