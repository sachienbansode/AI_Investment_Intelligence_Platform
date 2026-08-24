"""Live web search for the AI assistant — India-focused, compliance-bounded.

The assistant already answers from internal DB data, broker-research RAG, live
quotes/indices and RSS news. This module adds the missing LAYER: real-time web
search, used ONLY for current facts/events the platform data doesn't cover
(RBI/SEBI actions, results, macro, breaking company news, etc.).

Design goals:
  * Provider-agnostic: Tavily (default), SerpAPI or Brave — chosen + keyed in
    Admin (DB-backed app_settings), so nothing is hardcoded and it degrades to a
    silent no-op when unconfigured.
  * India-scoped: results are restricted to an allowlist of Indian finance /
    regulator / reputable-news domains, and the query is biased to Indian markets.
  * Safe: short timeout, never raises to the caller (returns [] on any error);
    results are factual snippets the model then explains under the usual SEBI
    guardrails (no advice, no price targets).
"""
from __future__ import annotations

import logging
from urllib.parse import urlparse

from app.services.app_settings import get_setting

log = logging.getLogger(__name__)

# Sensible default allowlist (admin-overridable). Only reputable Indian market /
# regulator / financial-news domains + a couple of global wires used for India.
DEFAULT_DOMAINS = [
    "nseindia.com", "bseindia.com", "sebi.gov.in", "rbi.org.in",
    "moneycontrol.com", "economictimes.indiatimes.com", "livemint.com",
    "business-standard.com", "thehindubusinessline.com", "financialexpress.com",
    "cnbctv18.com", "screener.in", "reuters.com", "bloombergquint.com",
    "ndtvprofit.com", "zeebiz.com", "investing.com",
]


def _domains() -> list[str]:
    d = get_setting("web_search_domains")
    if isinstance(d, list) and d:
        return [str(x).strip().lower() for x in d if str(x).strip()]
    return DEFAULT_DOMAINS


def _host(url: str) -> str:
    try:
        return (urlparse(url).hostname or "").lower().lstrip("www.")
    except Exception:
        return ""


def _in_allowlist(url: str, allow: list[str]) -> bool:
    if not allow:
        return True
    h = _host(url)
    return any(h == d or h.endswith("." + d) or h.lstrip("www.") == d for d in allow)


def _india_query(q: str) -> str:
    """Bias the query to Indian markets when it isn't already explicit."""
    low = (q or "").lower()
    if any(k in low for k in ("india", "nse", "bse", "sensex", "nifty", "sebi",
                              "rbi", "rupee", "₹")):
        return q
    return (q or "").strip() + " India stock market NSE"


# ---- provider adapters (pure parsers are separated for easy testing) ----------

def _parse_tavily(data: dict) -> list[dict]:
    out = []
    for r in (data.get("results") or []):
        out.append({"title": r.get("title") or "", "url": r.get("url") or "",
                    "snippet": (r.get("content") or "")[:600]})
    return out


def _parse_serpapi(data: dict) -> list[dict]:
    out = []
    for r in (data.get("organic_results") or []):
        out.append({"title": r.get("title") or "", "url": r.get("link") or "",
                    "snippet": (r.get("snippet") or "")[:600]})
    return out


def _parse_brave(data: dict) -> list[dict]:
    out = []
    for r in ((data.get("web") or {}).get("results") or []):
        out.append({"title": r.get("title") or "", "url": r.get("url") or "",
                    "snippet": (r.get("description") or "")[:600]})
    return out


def _finalize(rows: list[dict], allow: list[str], limit: int,
              tavily_answer: str = "") -> list[dict]:
    seen, out = set(), []
    for r in rows:
        url = r.get("url") or ""
        if not url or url in seen:
            continue
        if not _in_allowlist(url, allow):
            continue
        seen.add(url)
        out.append({"title": r.get("title") or _host(url), "url": url,
                    "snippet": (r.get("snippet") or "").strip(), "source": _host(url)})
        if len(out) >= limit:
            break
    if tavily_answer and out:
        out[0] = {**out[0], "answer": tavily_answer.strip()[:800]}
    return out


async def search(query: str) -> list[dict]:
    """Return a small list of {title, url, snippet, source} from the configured
    provider, restricted to the Indian-finance allowlist. [] on any problem."""
    if not get_setting("web_search_enabled"):
        return []
    provider = (get_setting("web_search_provider") or "tavily").lower()
    key = (get_setting("web_search_api_key") or "").strip()
    if provider != "none" and not key:
        return []
    try:
        limit = max(1, min(int(get_setting("web_search_max_results") or 5), 10))
    except Exception:
        limit = 5
    allow = _domains()
    q = _india_query(query)
    import httpx

    try:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            if provider == "tavily":
                r = await client.post("https://api.tavily.com/search", json={
                    "api_key": key, "query": q, "max_results": limit * 2,
                    "search_depth": "basic", "include_answer": True,
                    "include_domains": allow})
                r.raise_for_status()
                data = r.json()
                return _finalize(_parse_tavily(data), allow, limit,
                                 data.get("answer") or "")
            if provider == "serpapi":
                r = await client.get("https://serpapi.com/search.json", params={
                    "q": q, "api_key": key, "num": limit * 2, "hl": "en",
                    "gl": "in", "google_domain": "google.co.in"})
                r.raise_for_status()
                return _finalize(_parse_serpapi(r.json()), allow, limit)
            if provider == "brave":
                r = await client.get("https://api.search.brave.com/res/v1/web/search",
                                     params={"q": q, "count": limit * 2, "country": "IN"},
                                     headers={"X-Subscription-Token": key,
                                              "Accept": "application/json"})
                r.raise_for_status()
                return _finalize(_parse_brave(r.json()), allow, limit)
    except Exception as e:  # never break the answer on a search failure
        log.warning("web search (%s) failed: %s", provider, e)
    return []
