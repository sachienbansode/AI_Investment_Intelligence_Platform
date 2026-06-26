"""Market News Intelligence (BRD): collect, summarize (short + detailed),
identify impacted stocks/sectors, link to source."""
import json
import logging

from app.core.compliance import audit_log
from app.data.rss_news import collect_news
from app.db.database import NewsItem, SessionLocal
from app.llm.router import get_llm_router

log = logging.getLogger(__name__)


async def refresh_news(max_items: int = 15) -> int:
    """Fetch fresh news, enrich with LLM, persist. Returns count stored."""
    try:
        from app.services.app_settings import get_setting
        include_global = bool(get_setting("global_markets_enabled"))
    except Exception:
        include_global = False
    items = (await collect_news(include_global=include_global))[:max_items]
    if not items:
        return 0

    llm = get_llm_router()
    batch = [{"i": i, "title": it["title"], "snippet": it["raw_summary"][:300]}
             for i, it in enumerate(items)]
    prompt = (
        "For each news item, produce JSON with keys: i, summary_short (1 sentence), "
        "summary_detailed (2-3 sentences), impacted_stocks (NSE symbols, may be empty), "
        "impacted_sectors (list), sentiment (positive/negative/neutral). "
        "Be factual; do not advise. Respond with a JSON array only.\n\n"
        + json.dumps(batch, ensure_ascii=False)
    )
    enriched = {}
    try:
        resp = await llm.complete(
            "You are a financial news analyst for Indian markets producing structured "
            "summaries.", prompt, task="news_summarization", max_tokens=1800, temperature=0.2,
        )
        import re
        m = re.search(r"\[.*\]", resp.text, re.DOTALL)
        if m:
            for row in json.loads(m.group()):
                enriched[row.get("i")] = row
    except Exception as e:
        log.warning("News enrichment failed: %s", e)

    db = SessionLocal()
    stored = 0
    try:
        for i, it in enumerate(items):
            if db.query(NewsItem).filter_by(link=it["link"]).first():
                continue
            e = enriched.get(i, {})
            db.add(NewsItem(
                title=it["title"], link=it["link"], source=it["source"],
                published=it["published"],
                summary_short=e.get("summary_short") or it["raw_summary"][:200],
                summary_detailed=e.get("summary_detailed"),
                impacted_stocks=e.get("impacted_stocks", []),
                impacted_sectors=e.get("impacted_sectors", []),
                sentiment=e.get("sentiment"),
            ))
            stored += 1
        db.commit()
    finally:
        db.close()
    audit_log("news_refresh", fetched=len(items), stored=stored)
    return stored


def latest_news(limit: int = 20, days: int | None = None) -> list[dict]:
    db = SessionLocal()
    try:
        q = db.query(NewsItem).order_by(NewsItem.created_at.desc())
        if days:
            from datetime import datetime, timedelta, timezone
            q = q.filter(NewsItem.created_at >= datetime.now(timezone.utc) - timedelta(days=days))
        rows = q.limit(limit).all()
        return [{
            "title": r.title, "link": r.link, "source": r.source,
            "published": r.published, "summary_short": r.summary_short,
            "summary_detailed": r.summary_detailed,
            "impacted_stocks": r.impacted_stocks or [],
            "impacted_sectors": r.impacted_sectors or [],
            "sentiment": r.sentiment,
        } for r in rows]
    finally:
        db.close()
