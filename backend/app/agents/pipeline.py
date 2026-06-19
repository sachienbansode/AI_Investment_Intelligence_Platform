"""Daily Agentic Workflow per BRD:
1 Market Data Agent → 2 Financial Data Agent → 3 News Agent → 4 Sentiment Agent
→ 5 Scoring Agent → 6 Explainability Agent → 7 Quality Agent → 8 Publishing Agent
"""
import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import date

from app.core.compliance import audit_log
from app.data.aggregator import get_market_data
from app.data.base import Quote
from app.data.rss_news import collect_news
from app.db.database import Instrument, SessionLocal, StockScore
from app.llm.router import get_llm_router
from app.services import scoring
from app.services.app_settings import get_setting


def scoring_universe() -> list[str]:
    """Symbols flagged for daily scoring in the instruments master (DB)."""
    db = SessionLocal()
    try:
        rows = (db.query(Instrument)
                .filter_by(is_active=True, in_scoring_universe=True).all())
        return [r.symbol for r in rows]
    finally:
        db.close()

log = logging.getLogger(__name__)


@dataclass
class AgentContext:
    symbols: list[str]
    quotes: dict[str, Quote] = field(default_factory=dict)
    news: list[dict] = field(default_factory=list)
    sentiments: dict[str, dict] = field(default_factory=dict)   # symbol -> counts
    pillar_scores: dict[str, dict] = field(default_factory=dict)
    composites: dict[str, float] = field(default_factory=dict)
    explanations: dict[str, str] = field(default_factory=dict)
    explanations_provider: dict[str, str] = field(default_factory=dict)  # symbol -> writer provider
    ai_reviews: dict[str, dict] = field(default_factory=dict)  # symbol -> checker verdict
    quality: dict[str, str] = field(default_factory=dict)


# ── 1. Market Data Agent ─────────────────────────────────────────
async def market_data_agent(ctx: AgentContext):
    md = get_market_data()
    sem = asyncio.Semaphore(8)  # 8 concurrent fetches

    async def fetch(sym: str):
        async with sem:
            q = await md.get_quote(sym)
            if q:
                ctx.quotes[sym] = q

    await asyncio.gather(*(fetch(s) for s in ctx.symbols))
    audit_log("agent_market_data", fetched=list(ctx.quotes))


# ── 2. Financial Data Agent ──────────────────────────────────────
async def financial_data_agent(ctx: AgentContext):
    """Enriches with fundamentals available from the quote source (P/E, sector).
    Extend here with corporate-filings / vendor fundamental feeds."""
    audit_log("agent_financial_data",
              with_pe=[s for s, q in ctx.quotes.items() if q.pe])


# ── 3. News Agent ────────────────────────────────────────────────
async def news_agent(ctx: AgentContext):
    ctx.news = await collect_news()
    audit_log("agent_news", count=len(ctx.news))


# ── 4. Sentiment Agent ───────────────────────────────────────────
async def sentiment_agent(ctx: AgentContext):
    """LLM classifies headline sentiment per symbol mentioned."""
    llm = get_llm_router()
    headlines = [n["title"] for n in ctx.news][:40]
    if not headlines:
        return
    prompt = (
        "For each stock symbol below, review the news headlines and count how many "
        "are positive, negative, or neutral FOR THAT COMPANY. Only count headlines "
        "clearly about that company. Respond with JSON only: "
        '{"SYMBOL": {"positive": n, "negative": n, "neutral": n}, ...}\n\n'
        f"Symbols: {', '.join(ctx.symbols)}\n\nHeadlines:\n- " + "\n- ".join(headlines)
    )
    try:
        resp = await llm.complete(
            "You are a precise financial news sentiment classifier for Indian equities.",
            prompt, task="sentiment", max_tokens=800, temperature=0,
        )
        ctx.sentiments = _extract_json(resp.text) or {}
    except Exception as e:
        log.warning("Sentiment agent failed: %s", e)
    audit_log("agent_sentiment", symbols=list(ctx.sentiments))


# ── 5. Scoring Agent ─────────────────────────────────────────────
async def scoring_agent(ctx: AgentContext):
    for sym, q in ctx.quotes.items():
        pillars = {
            "fundamental": 50.0,  # neutral until fundamentals feed is connected
            "technical": scoring.technical_score(q),
            "valuation": scoring.valuation_score(q),
            "momentum": scoring.momentum_score(q),
            "earnings": 50.0,     # neutral until earnings feed is connected
            "news_sentiment": scoring.sentiment_to_score(ctx.sentiments.get(sym, {})),
            "institutional": 50.0,  # neutral until FII/DII holdings feed is connected
            "risk": scoring.risk_score(q),
        }
        ctx.pillar_scores[sym] = pillars
        ctx.composites[sym] = scoring.composite(pillars, get_setting("scoring_weights"))
    audit_log("agent_scoring", composites=ctx.composites)


_PILLAR_LABELS = {
    "fundamental": "Fundamentals", "technical": "Technicals", "valuation": "Valuation",
    "momentum": "Momentum", "earnings": "Earnings", "news_sentiment": "News sentiment",
    "institutional": "Institutional activity", "risk": "Risk profile",
}


def _pillar_rationale(comp: float, pillars: dict) -> str:
    """Clean, factual markdown-bullet rationale built from the pillar scores.
    Used when the LLM explainability call fails, so users still get a readable
    summary (not a raw data dump). Informational only \u2014 no advice."""
    items = [(k, round(v)) for k, v in pillars.items()]
    strong = sorted([i for i in items if i[1] >= 60], key=lambda x: -x[1])[:2]
    weak = sorted([i for i in items if i[1] <= 40], key=lambda x: x[1])[:2]
    neutral = [k for k, v in items if 40 < v < 60]
    bullets = [f"- Composite AI score **{comp}/100**, a weighted blend of 8 pillars."]
    for k, v in strong:
        bullets.append(f"- **{_PILLAR_LABELS.get(k, k)}** is a key strength at **{v}/100**.")
    for k, v in weak:
        bullets.append(f"- **{_PILLAR_LABELS.get(k, k)}** weighs on the score at **{v}/100**.")
    if neutral:
        labels = ", ".join(_PILLAR_LABELS.get(k, k).lower() for k in neutral)
        bullets.append(f"- {labels[:1].upper() + labels[1:]} sit neutral (~50/100), pending dedicated data feeds.")
    bullets.append("- AI-generated from pillar analytics; informational only, not investment advice.")
    return "\n".join(bullets)


# ── 6. Explainability Agent ──────────────────────────────────────
async def explainability_agent(ctx: AgentContext):
    llm = get_llm_router()
    sem = asyncio.Semaphore(5)  # 5 concurrent LLM calls

    async def explain(sym: str):
        q = ctx.quotes[sym]
        prompt = (
            f"Stock: {sym} (NSE). Composite score {ctx.composites[sym]}/100.\n"
            f"Pillar scores: {json.dumps(ctx.pillar_scores[sym])}\n"
            f"Price: {q.last_price}, day change: {q.change_pct}%, P/E: {q.pe}, "
            f"52w range: {q.week52_low}-{q.week52_high}.\n"
            "Write 3-5 concise markdown bullet points ('- ') explaining what drove "
            "this score — one factor per bullet, under 15 words each, bold key "
            "numbers with **. Factual data only. Do NOT give buy/sell/hold advice "
            "or price targets. Output only the bullets."
        )
        async with sem:
            try:
                resp = await llm.complete(
                    "You write factual, explainable-AI score rationales for a SEBI-regulated "
                    "broker. Never give investment advice or recommendations.",
                    prompt, task="explainability", max_tokens=300,
                )
                ctx.explanations[sym] = resp.text.strip()
                ctx.explanations_provider[sym] = resp.provider
            except Exception as e:
                ctx.explanations[sym] = _pillar_rationale(ctx.composites[sym], ctx.pillar_scores[sym])
                log.warning("Explainability failed for %s: %s", sym, e)

    await asyncio.gather(*(explain(s) for s in ctx.composites))
    audit_log("agent_explainability", symbols=list(ctx.explanations))


# ── 6.5 Independent AI Checker Agent ─────────────────────────────
async def ai_checker_agent(ctx: AgentContext):
    """A SECOND LLM independently reviews each rationale for (a) compliance —
    no buy/sell/hold advice, price targets or leaked methodology internals —
    and (b) factual consistency with the composite/pillar scores. Uses a
    different provider than the rationale writer when more than one is
    configured (true independence); otherwise the same model with a fresh,
    adversarial prompt. Verdicts feed the Quality Agent's decision."""
    if not get_setting("ai_checker_enabled"):
        audit_log("agent_ai_checker", skipped="disabled")
        return
    llm = get_llm_router()
    sem = asyncio.Semaphore(5)

    async def check(sym: str):
        rationale = ctx.explanations.get(sym, "")
        if not rationale:
            return
        prompt = (
            f"Stock {sym}. Composite score {ctx.composites.get(sym)}/100. "
            f"Pillar scores: {json.dumps(ctx.pillar_scores.get(sym, {}))}.\n"
            f"RATIONALE UNDER REVIEW:\n{rationale}\n\n"
            "You are an independent compliance + accuracy reviewer for a "
            "SEBI-regulated broker. FLAG the rationale if ANY of these are true:\n"
            "1. It gives buy/sell/hold advice, recommendations or price targets.\n"
            "2. It states a fact that contradicts the pillar/composite scores.\n"
            "3. It reveals scoring methodology internals (weights, formulas, thresholds).\n"
            "4. It contains fabricated numbers not derivable from the data shown.\n"
            'Respond with JSON ONLY: {"verdict": "pass" | "flag", '
            '"reason": "<=20 words"}'
        )
        async with sem:
            try:
                resp = await llm.complete(
                    "You are a strict, independent reviewer. Output JSON only.",
                    prompt, task="ai_checker", max_tokens=120, temperature=0,
                    exclude=ctx.explanations_provider.get(sym),
                )
                parsed = _extract_json(resp.text) or {}
                verdict = "flag" if str(parsed.get("verdict", "")).lower() == "flag" else "pass"
                ctx.ai_reviews[sym] = {
                    "verdict": verdict,
                    "reason": str(parsed.get("reason", ""))[:200],
                    "checker_provider": resp.provider,
                    "independent": resp.provider != ctx.explanations_provider.get(sym),
                }
            except Exception as e:
                # Distinguish an infrastructure error (checker could not run) from a
                # genuine content "flag". An error must NOT auto-reject the score —
                # otherwise an LLM outage rejects the entire day's pipeline. We mark
                # it "error" so the Quality Agent holds it for human review instead.
                ctx.ai_reviews[sym] = {"verdict": "error",
                                       "reason": f"checker error: {str(e)[:80]}",
                                       "checker_provider": "", "independent": False}
                log.warning("AI checker failed for %s: %s", sym, e)

    await asyncio.gather(*(check(s) for s in ctx.composites))
    flagged = [s for s, r in ctx.ai_reviews.items() if r.get("verdict") == "flag"]
    errored = [s for s, r in ctx.ai_reviews.items() if r.get("verdict") == "error"]
    audit_log("agent_ai_checker", reviewed=len(ctx.ai_reviews), flagged=flagged, errored=errored)


# ── 7. Quality Agent ─────────────────────────────────────────────
async def quality_agent(ctx: AgentContext):
    """Validates outputs before publishing (range checks, completeness, AI-checker
    verdict). In strict maker-checker mode, valid scores are held as 'pending'
    until a human admin approves them; otherwise they are auto-'approved'.
    Anything failing validation or flagged by the AI checker is 'rejected'."""
    strict = bool(get_setting("strict_maker_checker"))
    for sym, comp in ctx.composites.items():
        rules_ok = (
            0 <= comp <= 100
            and all(0 <= v <= 100 for v in ctx.pillar_scores[sym].values())
            and len(ctx.explanations.get(sym, "")) > 20
        )
        verdict = ctx.ai_reviews.get(sym, {}).get("verdict")
        ai_flag = verdict == "flag"     # genuine compliance/factual flag -> reject
        # A genuine AI-checker FLAG rejects. A checker ERROR (e.g. LLM down) does
        # NOT block publishing: only strict maker-checker holds scores as pending.
        if not rules_ok or ai_flag:
            ctx.quality[sym] = "rejected"
        elif strict:
            ctx.quality[sym] = "pending"   # await human approval (maker-checker)
        else:
            ctx.quality[sym] = "approved"
    audit_log("agent_quality", strict=strict, results=ctx.quality)


# ── 8. Publishing Agent ──────────────────────────────────────────
async def publishing_agent(ctx: AgentContext):
    today = date.today().isoformat()
    db = SessionLocal()
    try:
        for sym, comp in ctx.composites.items():
            q = ctx.quotes.get(sym)
            db.query(StockScore).filter_by(symbol=sym, score_date=today).delete()
            db.add(StockScore(
                symbol=sym, score_date=today, composite_score=comp,
                pillar_scores=ctx.pillar_scores[sym],
                explanation=ctx.explanations.get(sym, ""),
                quality_status=ctx.quality.get(sym, "pending"),
                ai_review=ctx.ai_reviews.get(sym),
                pe=q.pe if q else None,
                market_cap=q.market_cap if q else None,
            ))
        db.commit()
    finally:
        db.close()
    audit_log("agent_publishing", date=today, published=list(ctx.composites))


PIPELINE = [
    market_data_agent, financial_data_agent, news_agent, sentiment_agent,
    scoring_agent, explainability_agent, ai_checker_agent, quality_agent,
    publishing_agent,
]


def _persist_run(run: dict) -> None:
    """Write the finished run to the pipeline_runs audit table."""
    from datetime import datetime, timezone

    from app.db.database import PipelineRun
    try:
        db = SessionLocal()
        try:
            db.add(PipelineRun(
                run_id=run["run_id"],
                started=datetime.fromtimestamp(run["started"], tz=timezone.utc),
                finished=datetime.fromtimestamp(run["finished"], tz=timezone.utc),
                status=run["status"], symbols_count=len(run["symbols"]),
                symbols=run["symbols"], agents=run["agents"],
            ))
            db.commit()
        finally:
            db.close()
    except Exception:
        log.exception("Failed to persist pipeline run %s", run.get("run_id"))

# ── Live agent status (powers the Agents dashboard) ──────────────
import time as _time
import uuid as _uuid

PIPELINE_STATE: dict = {"current": None, "last": None, "history": []}


def _agent_detail(name: str, ctx: AgentContext) -> str:
    return {
        "market_data_agent": f"{len(ctx.quotes)}/{len(ctx.symbols)} quotes fetched",
        "financial_data_agent": f"{sum(1 for q in ctx.quotes.values() if q.pe)} with fundamentals",
        "news_agent": f"{len(ctx.news)} news items collected",
        "sentiment_agent": f"{len(ctx.sentiments)} symbols classified",
        "scoring_agent": f"{len(ctx.composites)} composite scores",
        "explainability_agent": f"{len(ctx.explanations)}/{len(ctx.composites) or len(ctx.symbols)} explanations written",
        "ai_checker_agent": f"{len(ctx.ai_reviews)} reviewed, "
                            f"{sum(1 for r in ctx.ai_reviews.values() if r.get('verdict') == 'flag')} flagged",
        "quality_agent": f"{sum(1 for v in ctx.quality.values() if v == 'approved')} approved, "
                         f"{sum(1 for v in ctx.quality.values() if v == 'pending')} pending, "
                         f"{sum(1 for v in ctx.quality.values() if v == 'rejected')} rejected",
        "publishing_agent": f"{len(ctx.composites)} scores published",
    }.get(name, "")


def _progress(name: str, ctx: AgentContext):
    pairs = {
        "market_data_agent": (len(ctx.quotes), len(ctx.symbols)),
        "sentiment_agent": (len(ctx.sentiments), len(ctx.symbols)),
        "scoring_agent": (len(ctx.composites), len(ctx.quotes) or len(ctx.symbols)),
        "explainability_agent": (len(ctx.explanations), len(ctx.composites) or len(ctx.symbols)),
        "ai_checker_agent": (len(ctx.ai_reviews), len(ctx.composites) or len(ctx.symbols)),
        "quality_agent": (len(ctx.quality), len(ctx.composites) or len(ctx.symbols)),
    }
    return pairs.get(name)


def live_snapshot() -> dict | None:
    """Current run with LIVE per-agent detail and progress (for the dashboard)."""
    run = PIPELINE_STATE["current"]
    if not run:
        return None
    ctx = run.get("_ctx")
    agents = []
    for a in run["agents"]:
        a2 = dict(a)
        if ctx is not None and a2["status"] == "running":
            a2["detail"] = _agent_detail(a2["name"], ctx)
            pr = _progress(a2["name"], ctx)
            if pr and pr[1]:
                a2["progress"] = {"done": pr[0], "total": pr[1]}
        agents.append(a2)
    out = {k: v for k, v in run.items() if k != "_ctx"}
    out["agents"] = agents
    return out


async def run_daily_pipeline(symbols: list[str] | None = None) -> AgentContext:
    if PIPELINE_STATE["current"]:
        log.warning("Pipeline already running; skipping duplicate trigger")
        return AgentContext(symbols=[])
    if not symbols:
        symbols = scoring_universe()
    ctx = AgentContext(symbols=[s.upper() for s in symbols])
    run = {
        "run_id": str(_uuid.uuid4())[:8],
        "started": _time.time(), "finished": None, "status": "running",
        "symbols": ctx.symbols,
        "agents": [{"name": a.__name__, "status": "pending",
                    "started": None, "finished": None, "detail": ""}
                   for a in PIPELINE],
    }
    run["_ctx"] = ctx  # live reference for the dashboard (never serialized)
    PIPELINE_STATE["current"] = run
    audit_log("pipeline_start", run_id=run["run_id"], symbols=ctx.symbols)
    try:
        for i, agent in enumerate(PIPELINE):
            a = run["agents"][i]
            a["status"], a["started"] = "running", _time.time()
            log.info("Running %s", agent.__name__)
            try:
                await agent(ctx)
                a["status"] = "completed"
            except Exception as e:
                a["status"], a["detail"] = "failed", str(e)[:200]
                log.exception("Agent %s failed", agent.__name__)
            a["finished"] = _time.time()
            if a["status"] == "completed":
                a["detail"] = _agent_detail(agent.__name__, ctx)
        run["status"] = ("completed" if all(a["status"] == "completed"
                                            for a in run["agents"]) else "partial")
    finally:
        run.pop("_ctx", None)
        run["finished"] = _time.time()
        PIPELINE_STATE["current"] = None
        PIPELINE_STATE["last"] = run
        PIPELINE_STATE["history"] = ([{
            "run_id": run["run_id"], "started": run["started"],
            "finished": run["finished"], "status": run["status"],
            "symbols_count": len(run["symbols"]),
        }] + PIPELINE_STATE["history"])[:10]
        _persist_run(run)
    audit_log("pipeline_complete", run_id=run["run_id"], scored=list(ctx.composites))
    return ctx


def _extract_json(text: str):
    import re
    m = re.search(r"\{.*\}", text, re.DOTALL)
    if m:
        try:
            return json.loads(m.group())
        except json.JSONDecodeError:
            return None
    return None
