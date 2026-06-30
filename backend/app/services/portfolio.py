"""Portfolio Intelligence (BRD): health score, diversification, concentration
risk, sector exposure, personalized AI insights."""
import json

from app.core.compliance import AI_DISCLAIMER, audit_log
from app.data.aggregator import get_market_data
from app.db.database import Instrument, SessionLocal
from app.llm.router import get_llm_router
from app.models.schemas import Holding, PortfolioResponse


async def portfolio_metrics(holdings: list[Holding]) -> dict:
    """Compute the portfolio's health / concentration / exposure / P&L metrics
    (no LLM call). Shared by analyze_portfolio AND the AI assistant so their
    numbers always match the Portfolio page exactly."""
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

    # Health score 0-100 with transparent deductions (heuristic; tune with research team)
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
    health = round(max(0.0, min(100.0, 100.0 - sum(x["points"] for x in deductions))), 1)

    # Approximate P&L (current LTP vs average cost) and a Red/Amber/Green status
    pnl_abs = round(current_value - invested, 2)
    pnl_pct = round((current_value - invested) / invested * 100, 2) if invested else 0.0
    rag = "green" if health >= 70 else "amber" if health >= 50 else "red"
    rag_label = {"green": "Healthy", "amber": "Needs attention", "red": "High risk"}[rag]
    pnl = {"invested": round(invested, 2), "current_value": round(current_value, 2),
           "pnl": pnl_abs, "pnl_pct": pnl_pct}
    headline = (
        f"{len(rows)} holding(s) across {diversification['num_sectors']} sector(s); "
        f"{concentration['level']} concentration — top holding {concentration['top_holding']} "
        f"at {concentration['top_holding_weight_pct']}%. "
        f"Currently {'up' if pnl_abs >= 0 else 'down'} {abs(pnl_pct)}% "
        f"({'+' if pnl_abs >= 0 else '-'}Rs {abs(pnl_abs):,.0f}) versus invested cost."
    )
    return {"weights": weights, "sector_exposure": sector_exp, "concentration": concentration,
            "diversification": diversification, "deductions": deductions, "health": health,
            "pnl": pnl, "status": rag, "status_label": rag_label, "headline": headline}


async def analyze_portfolio(holdings: list[Holding]) -> PortfolioResponse:
    m = await portfolio_metrics(holdings)

    # AI insights (descriptive, not advisory)
    llm = get_llm_router()
    prompt = (
        f"Portfolio data: {json.dumps({'weights_pct': {k: round(v*100,1) for k, v in m['weights'].items()}, 'sector_exposure_pct': m['sector_exposure'], 'concentration': m['concentration'], 'diversification': m['diversification'], 'health_score': m['health'], 'score_deductions': m['deductions']})}\n"
        "Write 3-5 concise markdown bullet points ('- ') of neutral, factual "
        "observations about this portfolio's diversification, concentration and "
        "sector exposure. One observation per bullet, under 18 words, bold key "
        "numbers with **. Describe the data only. Do NOT recommend buying or "
        "selling anything. Output only the bullets."
    )
    try:
        resp = await llm.complete(
            "You write factual portfolio analytics commentary for a SEBI-regulated "
            "broker. Never give investment advice.", prompt,
            task="portfolio_insights", max_tokens=280,
        )
        insights = resp.text.strip()
    except Exception:
        insights = "AI insights unavailable; see computed metrics."

    audit_log("portfolio_analysis", holdings=m["diversification"]["num_holdings"],
              health=m["health"], pnl_pct=m["pnl"]["pnl_pct"], status=m["status"])
    return PortfolioResponse(
        health_score=m["health"], status=m["status"], status_label=m["status_label"],
        headline=m["headline"], pnl=m["pnl"], deductions=m["deductions"],
        diversification=m["diversification"], concentration_risk=m["concentration"],
        sector_exposure=m["sector_exposure"], insights=insights, disclaimer=AI_DISCLAIMER,
    )
