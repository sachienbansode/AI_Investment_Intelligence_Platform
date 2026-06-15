"""Market news collection from Indian financial RSS feeds (BRD: News Agent)."""
import asyncio
import logging

import feedparser
import httpx

log = logging.getLogger(__name__)

FEEDS = {
    "Economic Times Markets": "https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms",
    "Moneycontrol Markets": "https://www.moneycontrol.com/rss/marketreports.xml",
    "Moneycontrol Business": "https://www.moneycontrol.com/rss/business.xml",
    "LiveMint Markets": "https://www.livemint.com/rss/markets",
    "Business Standard Markets": "https://www.business-standard.com/rss/markets-106.rss",
}

# Global market feeds (used only when admin enables global markets)
GLOBAL_FEEDS = {
    "CNBC World Markets": "https://www.cnbc.com/id/100727362/device/rss/rss.html",
    "Yahoo Finance": "https://finance.yahoo.com/news/rssindex",
    "Investing.com": "https://www.investing.com/rss/news_25.rss",
}


async def fetch_feed(name: str, url: str, limit: int = 10) -> list[dict]:
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True,
                                     headers={"User-Agent": "Mozilla/5.0"}) as client:
            r = await client.get(url)
            r.raise_for_status()
        parsed = await asyncio.to_thread(feedparser.parse, r.content)
        return [
            {
                "title": e.get("title", "").strip(),
                "link": e.get("link", ""),
                "source": name,
                "published": e.get("published", e.get("updated", "")),
                "raw_summary": _clean(e.get("summary", ""))[:1000],
            }
            for e in parsed.entries[:limit] if e.get("title")
        ]
    except Exception as e:
        log.warning("RSS fetch failed (%s): %s", name, e)
        return []


async def collect_news(limit_per_feed: int = 8, include_global: bool = False) -> list[dict]:
    feeds = dict(FEEDS)
    if include_global:
        feeds.update(GLOBAL_FEEDS)
    results = await asyncio.gather(*(fetch_feed(n, u, limit_per_feed) for n, u in feeds.items()))
    seen, items = set(), []
    for feed_items in results:
        for it in feed_items:
            if it["link"] and it["link"] not in seen:
                seen.add(it["link"])
                items.append(it)
    return items


def _clean(html: str) -> str:
    import re
    return re.sub(r"<[^>]+>", " ", html).replace("&nbsp;", " ").strip()
