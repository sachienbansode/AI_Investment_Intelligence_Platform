"""Open Partner API (v1) — API-key authenticated, rate-limited, scoped.

Exposes a curated, advice-free subset for partner/mobile integrations:
  GET  /api/partner/v1/instruments          scope: scores
  GET  /api/partner/v1/scores               scope: scores
  GET  /api/partner/v1/scores/{symbol}      scope: scores
  GET  /api/partner/v1/news                 scope: news
  POST /api/partner/v1/ask                  scope: ask
  POST /api/partner/v1/portfolio/analyze    scope: portfolio
  GET  /api/partner/v1/me                   any valid key
  GET  /api/partner/v1/health               no auth

All outputs are AI-generated, informational only and NOT investment advice
(SEBI guardrails enforced in the underlying services).
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException

from app.core.compliance import AI_DISCLAIMER, audit_log
from app.core.partner_auth import PartnerKey, require_any, require_scope
from app.db.database import Instrument, SessionLocal, StockScore
from app.models.schemas import (AskAIRequest, AskAIResponse, PortfolioRequest,
                                PortfolioResponse, StockScoreResponse)
from app.services import news_intel
from app.services.assistant import ask
from app.services.portfolio import analyze_portfolio

router = APIRouter(prefix="/api/partner/v1", tags=["partner"])


@router.get("/health", summary="Service health (no auth)")
async def partner_health():
    return {"status": "ok", "service": "niytri-partner-api", "version": "1.0"}


@router.get("/me", summary="Inspect the calling API key")
async def partner_me(key: PartnerKey = Depends(require_any)):
    return {"name": key.name, "key_prefix": key.key_prefix, "scopes": key.scopes,
            "rate_limit_per_min": key.rate_limit_per_min, "call_count": key.call_count}


@router.get("/instruments", summary="List active instruments")
async def partner_instruments(key: PartnerKey = Depends(require_scope("scores"))):
    db = SessionLocal()
    try:
        rows = (db.query(Instrument).filter_by(is_active=True)
                .order_by(Instrument.symbol).all())
        return {"instruments": [{"symbol": r.symbol, "name": r.name,
                                 "sector": r.sector} for r in rows]}
    finally:
        db.close()


@router.get("/scores", summary="Latest published NIYTRI scores")
async def partner_scores(score_date: str = "", limit: int = 500,
                         key: PartnerKey = Depends(require_scope("scores"))):
    limit = max(1, min(int(limit or 500), 1000))
    db = SessionLocal()
    try:
        dates = [d[0] for d in (db.query(StockScore.score_date).distinct()
                 .order_by(StockScore.score_date.desc()).limit(60).all())]
        latest = (score_date if score_date in dates
                  else (dates[0] if dates else date.today().isoformat()))
        rows = (db.query(StockScore).filter_by(score_date=latest)
                .order_by(StockScore.composite_score.desc()).limit(limit).all())
        sectors = {r.symbol: r.sector for r in db.query(Instrument).all()}
        scores = [{"symbol": r.symbol, "composite_score": r.composite_score,
                   "quality_status": r.quality_status, "sector": sectors.get(r.symbol, ""),
                   "pe": r.pe, "market_cap": r.market_cap, "last_price": r.last_price,
                   "pillar_scores": r.pillar_scores or {}} for r in rows]
        audit_log("partner_scores", key=key.key_prefix, date=latest, n=len(scores))
        return {"score_date": latest, "count": len(scores), "scores": scores,
                "disclaimer": AI_DISCLAIMER}
    finally:
        db.close()


@router.get("/scores/{symbol}", response_model=StockScoreResponse,
            summary="Latest score for one symbol")
async def partner_score(symbol: str, key: PartnerKey = Depends(require_scope("scores"))):
    db = SessionLocal()
    try:
        row = (db.query(StockScore).filter_by(symbol=symbol.upper())
               .order_by(StockScore.score_date.desc()).first())
    finally:
        db.close()
    if not row:
        raise HTTPException(404, f"No score for {symbol.upper()} yet.")
    audit_log("partner_score", key=key.key_prefix, symbol=symbol.upper())
    return StockScoreResponse(
        symbol=row.symbol, score_date=row.score_date,
        composite_score=row.composite_score, pillar_scores=row.pillar_scores,
        explanation=row.explanation or "", quality_status=row.quality_status,
        disclaimer=AI_DISCLAIMER)


@router.get("/news", summary="Latest market news (AI-summarised)")
async def partner_news(limit: int = 20, key: PartnerKey = Depends(require_scope("news"))):
    limit = max(1, min(int(limit or 20), 100))
    items = news_intel.latest_news(limit)
    if not items:
        await news_intel.refresh_news()
        items = news_intel.latest_news(limit)
    audit_log("partner_news", key=key.key_prefix, n=len(items))
    return {"count": len(items), "items": items, "disclaimer": AI_DISCLAIMER}


@router.post("/ask", response_model=AskAIResponse, summary="Conversational AI (advice-free)")
async def partner_ask(req: AskAIRequest, key: PartnerKey = Depends(require_scope("ask"))):
    try:
        # Partner sessions are namespaced by key; no end-user identity is used.
        resp = await ask(req.question, session_id=f"partner:{key.key_prefix}:{req.session_id}",
                         language=req.language, user_id=None)
        audit_log("partner_ask", key=key.key_prefix, provider=resp.provider)
        return resp
    except RuntimeError as e:
        raise HTTPException(502, f"AI service unavailable — {e}")


@router.post("/portfolio/analyze", response_model=PortfolioResponse,
             summary="Stateless portfolio analysis")
async def partner_portfolio(req: PortfolioRequest,
                            key: PartnerKey = Depends(require_scope("portfolio"))):
    if not req.holdings:
        raise HTTPException(400, "holdings cannot be empty")
    if len(req.holdings) > 500:
        raise HTTPException(400, "too many holdings (max 500)")
    res = await analyze_portfolio(req.holdings)
    audit_log("partner_portfolio", key=key.key_prefix, holdings=len(req.holdings))
    return res
