"""The 5 BRD APIs + chat history + instruments + watchlist + agents status."""
import asyncio
from datetime import date, timedelta

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from app.agents.pipeline import PIPELINE_STATE, live_snapshot, run_daily_pipeline
from app.core.auth import get_current_user, require_admin
from app.core.compliance import AI_DISCLAIMER
from app.data.aggregator import get_market_data
from app.db.database import (ChatMessage, Instrument, SessionLocal, StockScore,
                             User, WatchlistItem)
from app.llm.router import get_llm_router
from app.models.schemas import (AskAIRequest, AskAIResponse, PortfolioRequest,
                                PortfolioResponse, StockScoreResponse, WatchlistRequest)
from app.services import news_intel
from app.services.assistant import ask
from app.services.portfolio import analyze_portfolio

router = APIRouter(prefix="/api/v1")


# ── 1. Ask AI API ────────────────────────────────────────────────
@router.post("/ask", response_model=AskAIResponse)
async def ask_ai(req: AskAIRequest, user: User = Depends(get_current_user)):
    return await ask(req.question, req.session_id, req.language, user_id=user.id)


# ── Chat history (per user) ──────────────────────────────────────
@router.get("/chat/sessions")
async def chat_sessions(user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        rows = (db.query(ChatMessage).filter_by(user_id=user.id, role="user")
                .order_by(ChatMessage.created_at.desc()).limit(500).all())
        seen, sessions = set(), []
        for r in rows:
            if r.session_id not in seen:
                seen.add(r.session_id)
                sessions.append({"session_id": r.session_id,
                                 "title": r.content[:60],
                                 "last_at": str(r.created_at)})
        return {"sessions": sessions[:30]}
    finally:
        db.close()


@router.get("/chat/history/{session_id}")
async def chat_history(session_id: str, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        rows = (db.query(ChatMessage)
                .filter_by(user_id=user.id, session_id=session_id)
                .order_by(ChatMessage.created_at).limit(200).all())
        return {"messages": [{"role": r.role, "content": r.content,
                              "meta": r.meta or {}} for r in rows]}
    finally:
        db.close()


# ── Instruments (read; admin manages via /admin) ─────────────────
@router.get("/instruments")
async def instruments(user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        rows = (db.query(Instrument).filter_by(is_active=True)
                .order_by(Instrument.symbol).all())
        return {"instruments": [{"symbol": r.symbol, "name": r.name,
                                 "sector": r.sector} for r in rows]}
    finally:
        db.close()


# ── 2. Stock Score API ───────────────────────────────────────────
@router.get("/score/{symbol}", response_model=StockScoreResponse)
async def stock_score(symbol: str):
    db = SessionLocal()
    try:
        row = (db.query(StockScore).filter_by(symbol=symbol.upper())
               .order_by(StockScore.score_date.desc()).first())
    finally:
        db.close()
    if not row:
        raise HTTPException(404, f"No score for {symbol.upper()} yet.")
    return StockScoreResponse(
        symbol=row.symbol, score_date=row.score_date,
        composite_score=row.composite_score, pillar_scores=row.pillar_scores,
        explanation=row.explanation or "", quality_status=row.quality_status,
        disclaimer=AI_DISCLAIMER,
    )


@router.get("/scores")
async def all_scores():
    from app.services.rescore import pillar_drivers
    db = SessionLocal()
    try:
        today = date.today().isoformat()
        latest_row = (db.query(StockScore.score_date)
                      .order_by(StockScore.score_date.desc()).first())
        latest_date = latest_row[0] if latest_row else today
        # all rows for the latest run (no truncation, works for 500+ scripts)
        rows = (db.query(StockScore).filter_by(score_date=latest_date)
                .order_by(StockScore.composite_score.desc()).all())
        prev_row = (db.query(StockScore.score_date)
                    .filter(StockScore.score_date < latest_date)
                    .order_by(StockScore.score_date.desc()).first())
        prev_date = prev_row[0] if prev_row else None
        prev = ({r.symbol: r for r in
                 db.query(StockScore).filter_by(score_date=prev_date).all()}
                if prev_date else {})
        sectors = {r.symbol: r.sector for r in db.query(Instrument).all()}

        out = []
        for r in rows:
            p = prev.get(r.symbol)
            out.append({
                "symbol": r.symbol, "composite_score": r.composite_score,
                "pillar_scores": r.pillar_scores, "explanation": r.explanation,
                "quality_status": r.quality_status,
                "sector": sectors.get(r.symbol, ""),
                "prev_score": p.composite_score if p else None,
                "prev_date": p.score_date if p else None,
                "delta": round(r.composite_score - p.composite_score, 1) if p else None,
                "drivers": (pillar_drivers(r.pillar_scores or {}, p.pillar_scores or {})
                            if p else []),
            })
        return {"score_date": latest_date, "scores": out, "disclaimer": AI_DISCLAIMER}
    finally:
        db.close()


@router.get("/scores/trends")
async def score_trends(days: int = 30):
    """Daily average score + coverage for the last N days, plus the biggest
    score gainers/losers between the earliest and latest run in the window."""
    from sqlalchemy import func
    days = max(2, min(days, 90))
    cutoff = (date.today() - timedelta(days=days)).isoformat()
    db = SessionLocal()
    try:
        daily_rows = (db.query(StockScore.score_date,
                               func.avg(StockScore.composite_score),
                               func.count(StockScore.id))
                      .filter(StockScore.score_date >= cutoff)
                      .group_by(StockScore.score_date)
                      .order_by(StockScore.score_date).all())
        daily = [{"date": d, "avg_score": round(float(a), 1), "count": n}
                 for d, a, n in daily_rows]

        gainers, losers = [], []
        if len(daily) >= 2:
            first_d, last_d = daily[0]["date"], daily[-1]["date"]
            old = {r.symbol: r.composite_score for r in
                   db.query(StockScore).filter_by(score_date=first_d).all()}
            cur = {r.symbol: r.composite_score for r in
                   db.query(StockScore).filter_by(score_date=last_d).all()}
            moves = sorted(
                ({"symbol": s, "from": old[s], "to": cur[s],
                  "delta": round(cur[s] - old[s], 1)}
                 for s in cur if s in old),
                key=lambda m: m["delta"])
            losers = [m for m in moves[:5] if m["delta"] < 0]
            gainers = [m for m in reversed(moves[-5:]) if m["delta"] > 0]
        return {"days": days, "daily": daily, "gainers": gainers, "losers": losers,
                "disclaimer": AI_DISCLAIMER}
    finally:
        db.close()


@router.post("/score/{symbol}/refresh")
async def refresh_symbol_score(symbol: str, user: User = Depends(get_current_user)):
    """Re-score one script on demand with a fresh quote; returns the change
    vs the previous score and which pillars drove it."""
    from app.services.rescore import rescore_symbol
    result = await rescore_symbol(symbol)
    if not result:
        raise HTTPException(502, f"Could not fetch a live quote for {symbol.upper()}")
    return result


# ── 3. News Summary API ──────────────────────────────────────────
@router.get("/news")
async def news_summary(limit: int = 20, refresh: bool = False):
    if refresh:
        await news_intel.refresh_news()
    items = news_intel.latest_news(limit)
    if not items:
        await news_intel.refresh_news()
        items = news_intel.latest_news(limit)
    return {"items": items, "disclaimer": AI_DISCLAIMER}


# ── 4. Portfolio Analysis API ────────────────────────────────────
@router.post("/portfolio/analyze", response_model=PortfolioResponse)
async def portfolio_analyze(req: PortfolioRequest, user: User = Depends(get_current_user)):
    if not req.holdings:
        raise HTTPException(400, "holdings cannot be empty")
    return await analyze_portfolio(req.holdings)


# ── 5. Watchlist (persistent, per user) ──────────────────────────
async def _watchlist_rows(symbols: list[str]) -> list[dict]:
    md = get_market_data()
    quotes = await asyncio.gather(*(md.get_quote(s) for s in symbols))
    db = SessionLocal()
    try:
        out = []
        for sym, q in zip(symbols, quotes):
            row = (db.query(StockScore).filter_by(symbol=sym.upper())
                   .order_by(StockScore.score_date.desc()).first())
            out.append({
                "symbol": sym.upper(),
                "last_price": q.last_price if q else None,
                "change_pct": q.change_pct if q else None,
                "ai_score": row.composite_score if row else None,
                "score_date": row.score_date if row else None,
            })
        return out
    finally:
        db.close()


@router.get("/watchlist")
async def get_watchlist(user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        symbols = [r.symbol for r in
                   db.query(WatchlistItem).filter_by(user_id=user.id)
                   .order_by(WatchlistItem.created_at).all()]
    finally:
        db.close()
    return {"watchlist": await _watchlist_rows(symbols), "disclaimer": AI_DISCLAIMER}


@router.post("/watchlist/insights")
async def watchlist_insights(req: WatchlistRequest, user: User = Depends(get_current_user)):
    """BRD Watchlist Insights API — ad-hoc symbol list."""
    return {"watchlist": await _watchlist_rows(req.symbols), "disclaimer": AI_DISCLAIMER}


@router.post("/watchlist/{symbol}")
async def add_to_watchlist(symbol: str, user: User = Depends(get_current_user)):
    symbol = symbol.upper()
    db = SessionLocal()
    try:
        if not db.query(Instrument).filter_by(symbol=symbol, is_active=True).first():
            raise HTTPException(404, f"Unknown instrument {symbol}")
        if db.query(WatchlistItem).filter_by(user_id=user.id, symbol=symbol).first():
            raise HTTPException(409, f"{symbol} already in watchlist")
        db.add(WatchlistItem(user_id=user.id, symbol=symbol))
        db.commit()
    finally:
        db.close()
    return {"added": symbol}


@router.delete("/watchlist/{symbol}")
async def remove_from_watchlist(symbol: str, user: User = Depends(get_current_user)):
    db = SessionLocal()
    try:
        n = (db.query(WatchlistItem)
             .filter_by(user_id=user.id, symbol=symbol.upper()).delete())
        db.commit()
    finally:
        db.close()
    if not n:
        raise HTTPException(404, "Not in watchlist")
    return {"removed": symbol.upper()}


# ── Agents dashboard ─────────────────────────────────────────────
@router.get("/agents/status")
async def agents_status(user: User = Depends(get_current_user)):
    from app.main import scheduler  # late import avoids circular dependency
    from app.services.app_settings import get_setting
    freq = {
        "daily_scoring": f"daily at {int(get_setting('daily_scoring_hour')):02d}:00 (server time)",
        "news_refresh": f"every {int(get_setting('news_refresh_minutes'))} minutes",
    }
    jobs = [{"id": j.id,
             "frequency": freq.get(j.id, ""),
             "next_run": j.next_run_time.isoformat() if j.next_run_time else None}
            for j in scheduler.get_jobs()]
    running = live_snapshot()
    return {
        "running": bool(running),
        "active_agents": ([a["name"] for a in running["agents"]
                           if a["status"] == "running"] if running else []),
        "current": running,
        "last": PIPELINE_STATE["last"],
        "history": PIPELINE_STATE["history"],
        "scheduled_jobs": jobs,
        "llm_providers": get_llm_router().active_providers,
        "market_data_providers": get_market_data().active_providers,
    }


# ── Market snapshot + ops ────────────────────────────────────────
@router.get("/market/indices")
async def market_indices():
    return {"indices": await get_market_data().get_indices()}


@router.post("/admin/run-scoring", dependencies=[Depends(require_admin)])
async def trigger_scoring(background: BackgroundTasks):
    if PIPELINE_STATE["current"]:
        raise HTTPException(409, "Pipeline already running")
    background.add_task(run_daily_pipeline)
    return {"status": "scoring pipeline started"}


@router.get("/health")
async def health():
    return {
        "status": "ok",
        "llm_providers": get_llm_router().active_providers,
        "market_data_providers": get_market_data().active_providers,
    }
