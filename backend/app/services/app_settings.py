"""DB-backed application settings (Admin-editable), with safe defaults.

Settings live in the app_settings table as JSON values. Unknown keys are
rejected so the Admin UI can't break the app.
"""
import time

from app.config import get_settings
from app.db.database import AppSetting, SessionLocal

DEFAULTS: dict = {
    # BRD weights — must sum to 1.0
    "scoring_weights": {
        "fundamental": 0.30, "technical": 0.15, "valuation": 0.15,
        "momentum": 0.10, "earnings": 0.10, "news_sentiment": 0.10,
        "institutional": 0.05, "risk": 0.05,
    },
    "daily_scoring_hour": 18,         # 0-23 IST; post-close (after 15:30) so scores reflect daily moves (restart to apply)
    # Maker-checker: when True, the pipeline publishes scores as 'pending' and a
    # human admin must approve each before it reaches users/the assistant.
    "strict_maker_checker": False,
    # Independent AI checker: a second LLM (different provider when available)
    # reviews every rationale for compliance + factual consistency before the
    # Quality Agent decides. Flagged items are rejected (or held pending).
    "ai_checker_enabled": True,
    "news_refresh_minutes": 30,       # scheduler interval (restart to apply)
    "max_news_items": 50,             # items per news refresh
    "assistant_history_messages": 6,  # prior messages given to the LLM
    "assistant_max_tokens": 350,
    # Live DB read access for the assistant: when ON, the assistant may run
    # admin-bounded, read-only SELECT queries (scores/instruments/news + the
    # current user's OWN watchlist/portfolio only) to answer questions the
    # pre-built context does not cover. Never reads users/admin/config tables.
    "assistant_sql_tool_enabled": True,
    "assistant_sql_max_rows": 200,      # max rows returned per query
    "assistant_sql_max_queries": 3,     # max queries per question
    # Score-crossing alerts (in-app): raise an alert when a followed script
    # crosses a score band or moves by at least alert_score_jump points.
    "alerts_enabled": True,
    "alert_bands_enabled": True,        # band-crossing alerts (weak/neutral/strong)
    "alert_jumps_enabled": True,        # sharp same-band moves
    "alert_score_jump": 5.0,            # min |delta| points for a jump/drop alert
    # LLM pricing for INR billing estimates (USD per 1 MILLION tokens) —
    # update to your negotiated rates; estimates only, verify against invoices
    # LLM routing (admin-configurable; applied live, no restart)
    "brand_logo": "",   # admin-uploaded logo as a data: URI (favicon + app logo)
    "llm_provider_order": ["anthropic", "openai", "gemini", "groq"],
    "llm_strategy": "failover",          # "failover" | "round_robin"
    "llm_enabled": {"anthropic": True, "openai": True, "gemini": True, "groq": True},
    # DB-stored API keys / base URLs (admin-managed). Take priority over .env;
    # empty -> fall back to the .env value. Never returned raw to the browser.
    "llm_api_keys": {},
    "llm_base_urls": {},
    # Global markets: when on, include global indices + global news alongside India
    "global_markets_enabled": False,
    # Prompt caching: cache the Anthropic system prompt (cache_control: ephemeral)
    # so repeated calls reuse it - lower latency + input-token cost. Admin toggle.
    "prompt_caching_enabled": True,
    # Which index scopes the daily AI agents score (union): NIFTY50 / NIFTY500 / NSE.
    "scoring_indices": ["NIFTY500"],
    # On-demand runs only (re)score scripts missing/failed for today (save cost).
    "incremental_rescore_enabled": True,
    # When OFF (default), the daily run writes deterministic pillar rationales (no
    # LLM) and skips the AI Checker - far cheaper/faster. ON uses an LLM to write
    # every script's rationale + independent review (high token cost at scale).
    "bulk_explanations_llm": False,
    # Per-source on/off for market data (kite/smartapi/upstox/nse/yahoo).
    "market_sources_enabled": {"kite": True, "smartapi": True, "upstox": True,
                               "nse": True, "yahoo": True},
    # NSE-symbol -> Yahoo-ticker overrides for scripts whose Yahoo ticker isn't
    # "<SYMBOL>.NS" (renames / BSE-only). Value may include a suffix (e.g.
    # "ABC.BO"); without one ".NS" is assumed. Empty by default.
    "yahoo_symbol_aliases": {},
    "score_label": "NIYTRI Score",    # display name for the composite score (was "AI Score")
    "platform_label": "NIYTRI Investment Intelligence",    # brand shown in the assistant's answer "Basis:" tag
    "ticker_position": "top",         # NSE/BSE index ticker placement: top | bottom | right
    "show_active_model": True,        # show the currently active AI model in the top bar
    # Public sharing of a chat answer (WhatsApp / email / PDF / link).
    "app_public_url": "https://dev-invest.niytri.com",   # base URL used in shares
    "share_intro": "Shared from NIYTRI Investment Intelligence — AI-powered insights on Indian stocks.",
    "share_link_days": 30,            # public share link lifetime (days)
    # Self-service registration (public landing). Modes: invite_only | open | closed.
    "registration_mode": "invite_only",
    "invites_per_user": 5,            # invite codes each member can share
    # Live web search (fills the current-events gap the DB/RSS don't cover).
    # Provider + key are admin-set; empty key => silently disabled.
    "web_search_enabled": False,
    "web_search_provider": "tavily",   # tavily | serpapi | brave
    "web_search_api_key": "",
    "web_search_max_results": 5,
    "web_search_domains": [],           # empty => service's India allowlist
    "invite_expiry_days": 30,         # invite codes auto-expire this many days after creation
    "support_email": "admin@niytri.com",   # contact email shown in emails + T&C
    "tos_version": "1.0",             # current Terms&Conditions version label
    "tos_seq": 1,                     # numeric sequence, bumped on each publish
    "tos_min_seq": 1,                 # existing users must have accepted >= this seq
    "tos_html": (
        "<h2>Terms &amp; Conditions</h2>"
        "<h3>1. Important disclaimer</h3><p>All AI outputs in this application — scores, insights, summaries and "
        "chat responses — are generated by artificial intelligence for informational purposes only. They are not "
        "investment advice, research reports, or recommendations to buy or sell securities, and must be reviewed and "
        "approved before business or regulatory use. Investments in securities markets are subject to market risks. "
        "Please consult a SEBI-registered investment adviser before investing.</p>"
        "<h3>2. Nature of the service</h3><p>The Platform provides information and analytics about listed securities "
        "in Indian markets, including AI-generated scores, explanations, news summaries and a conversational "
        "assistant. It is not an investment adviser, research analyst, portfolio manager, broker or distributor, and "
        "nothing on the Platform constitutes investment, legal, tax or financial advice, or an offer or solicitation "
        "to buy or sell any security.</p>"
        "<h3>3. Eligibility</h3><p>You must be at least 18 years old and legally capable of entering into a binding "
        "contract. Access is currently offered on an invite-only basis; invitations and invite codes are personal to "
        "the recipient and may not be shared, sold or transferred.</p>"
        "<h3>4. Your account</h3><p>You are responsible for the accuracy of your registration details, for keeping "
        "your credentials confidential, and for all activity under your account. Only one active session is permitted "
        "per account; signing in on a new device may end other sessions. Notify us immediately of any unauthorised "
        "use.</p>"
        "<h3>5. Acceptable use</h3><p>You agree not to: (a) use the Platform for unlawful purposes; (b) rely on any "
        "output as a recommendation to transact; (c) scrape, resell, redistribute or create derivative commercial "
        "products from Platform data except via an authorised Partner API agreement; (d) attempt to disrupt, "
        "reverse-engineer or gain unauthorised access to the Platform; or (e) misrepresent Platform outputs as "
        "independent advice or research.</p>"
        "<h3>6. Data, sources and delays</h3><p>Market data (including prices and indices) is sourced from third "
        "parties and exchanges and may be delayed, incomplete or inaccurate. Prices shown are indicative and not for "
        "execution. We do not guarantee the timeliness, accuracy or completeness of any data or output.</p>"
        "<h3>7. AI limitations</h3><p>AI outputs may be incomplete, out of date, or incorrect, and the scoring "
        "methodology is proprietary and may change without notice. Outputs must be independently verified and, where "
        "used for business or regulatory purposes, reviewed and approved by a qualified person before use.</p>"
        "<h3>8. No liability for decisions</h3><p>You are solely responsible for your investment decisions. To the "
        "maximum extent permitted by law, NIYTRI Technologies, its affiliates, officers and employees are not liable "
        "for any loss or damage (including trading or investment losses) arising from your use of, or reliance on, "
        "the Platform or its outputs.</p>"
        "<h3>9. Intellectual property</h3><p>All content, software, scores, methodology and branding are owned by or "
        "licensed to NIYTRI Technologies and are protected by law. You receive a limited, non-exclusive, "
        "non-transferable, revocable licence to use the Platform for your personal, non-commercial use.</p>"
        "<h3>10. Privacy</h3><p>We collect and process account and usage data (including sign-up/login IP and "
        "activity) as described in our Privacy Policy, to operate and improve the Platform and for security and "
        "compliance. By using the Platform you consent to that processing.</p>"
        "<h3>11. Suspension and termination</h3><p>We may suspend or terminate access at any time, including for "
        "breach of these Terms, misuse of invites, or where required by law. You may stop using the Platform at any "
        "time.</p>"
        "<h3>12. Changes to these terms</h3><p>We may update these Terms from time to time. Material changes will be "
        "notified in the app, and continued use after an update constitutes acceptance. We may require you to "
        "re-accept updated Terms before continuing to use the Platform.</p>"
        "<h3>13. Governing law</h3><p>These Terms are governed by the laws of India, and the courts at the "
        "registered office location shall have exclusive jurisdiction, subject to applicable law.</p>"
        "<h3>14. Contact</h3><p>Questions about these Terms may be sent to our support email (shown in the footer of "
        "our emails and on this page). — NIYTRI Technologies.</p>"
    ),
    "waitlist_enabled": True,
    "require_email_verification": True,
    # Outbound email. provider: graph (Microsoft 365 Graph) | smtp | off.
    # Graph creds are DB-backed (admin UI), NOT .env. graph_client_secret is redacted.
    # Maintenance mode: when ON, non-admin users are blocked (admins unaffected).
    "maintenance_mode": False,
    "maintenance_message": "We're doing some quick maintenance and will be back shortly. Thanks for your patience.",
    "email_provider": "smtp",
    "graph_tenant_id": "",
    "graph_client_id": "",
    "graph_client_secret": "",
    "graph_sender": "",
    "llm_models": {"anthropic": "claude-sonnet-4-6", "openai": "gpt-4o",
                   "gemini": "gemini-3.5-flash", "groq": "openai/gpt-oss-120b"},
    "llm_pricing": {
        "anthropic": {"input_usd_per_mtok": 3.0, "output_usd_per_mtok": 15.0},
        "openai": {"input_usd_per_mtok": 2.5, "output_usd_per_mtok": 10.0},
        "gemini": {"input_usd_per_mtok": 1.25, "output_usd_per_mtok": 5.0},
        "groq": {"input_usd_per_mtok": 0.59, "output_usd_per_mtok": 0.79},
        "usd_inr": 94.5,
    },
    # Editable persona/behaviour prompt (compliance guardrails are appended
    # automatically in code and cannot be removed via settings)
    "assistant_system_prompt": (
        "You are the AI investment assistant inside an Indian broking app. "
        "You help everyday customers - most are BEGINNERS - understand markets, "
        "stocks, the platform's AI scores, news and their portfolios using the "
        "CONTEXT provided. Be warm, precise and confident. Write in simple, "
        "plain English like you are explaining to a friend new to the share "
        "market: short sentences, no jargon (or explain it in a few plain words), "
        "and a small everyday example when it makes things clearer. Keep answers "
        "SHORT and conclusive - lead with the answer, then at most 3-5 supporting "
        "bullets. Bold key numbers and symbols."
    ),
}

_cache: dict = {}
_cache_at: float = 0.0
_TTL = 30  # seconds


def all_settings() -> dict:
    global _cache, _cache_at
    if time.time() - _cache_at > _TTL:
        merged = dict(DEFAULTS)
        db = SessionLocal()
        try:
            for row in db.query(AppSetting).all():
                if row.key in DEFAULTS:
                    merged[row.key] = row.value
        finally:
            db.close()
        _cache, _cache_at = merged, time.time()
    return _cache


def get_setting(key: str):
    return all_settings().get(key, DEFAULTS.get(key))


def set_setting(key: str, value) -> None:
    global _cache_at
    if key not in DEFAULTS:
        raise KeyError(f"Unknown setting '{key}'. Allowed: {sorted(DEFAULTS)}")
    _validate(key, value)
    db = SessionLocal()
    try:
        row = db.get(AppSetting, key)
        if row:
            row.value = value
        else:
            db.add(AppSetting(key=key, value=value))
        db.commit()
    finally:
        db.close()
    _cache_at = 0.0  # invalidate cache
    if key == "market_sources_enabled":
        try:
            import app.data.aggregator as _agg_mod
            _agg_mod._agg = None   # rebuild provider chain on next use
        except Exception:
            pass
    if key in ("llm_api_keys", "llm_base_urls", "llm_models", "llm_provider_order",
               "llm_enabled", "llm_strategy"):
        try:
            import app.llm.router as _r
            _r._router = None   # rebuild router + provider clients with fresh keys
        except Exception:
            pass


def _validate(key: str, value) -> None:
    if key == "scoring_weights":
        if not isinstance(value, dict) or set(value) != set(DEFAULTS["scoring_weights"]):
            raise ValueError("scoring_weights must contain exactly the 8 pillar keys")
        total = sum(float(v) for v in value.values())
        if abs(total - 1.0) > 0.001:
            raise ValueError(f"scoring_weights must sum to 1.0 (got {total:.3f})")
    elif key == "daily_scoring_hour":
        if not (isinstance(value, int) and 0 <= value <= 23):
            raise ValueError("daily_scoring_hour must be 0-23")
    elif key in ("strict_maker_checker", "ai_checker_enabled", "prompt_caching_enabled",
                 "incremental_rescore_enabled", "bulk_explanations_llm", "show_active_model"):
        if not isinstance(value, bool):
            raise ValueError(f"{key} must be true or false")
    elif key == "brand_logo":
        if not isinstance(value, str):
            raise ValueError("brand_logo must be a string")
        if value and not value.startswith("data:image/"):
            raise ValueError("brand_logo must be a data:image/... URI or empty")
        if len(value) > 900000:
            raise ValueError("logo too large (max ~600KB)")
    elif key == "llm_provider_order":
        valid = {"anthropic", "openai", "gemini", "groq"}
        if not (isinstance(value, list) and value and all(v in valid for v in value)):
            raise ValueError("llm_provider_order must be a non-empty list from: "
                             "anthropic, openai, gemini")
    elif key == "llm_strategy":
        if value not in ("failover", "round_robin"):
            raise ValueError("llm_strategy must be 'failover' or 'round_robin'")
    elif key == "llm_enabled":
        valid = {"anthropic", "openai", "gemini", "groq"}
        if not (isinstance(value, dict) and set(value) <= valid
                and all(isinstance(v, bool) for v in value.values())):
            raise ValueError("llm_enabled must map anthropic/openai/gemini -> true/false")
        if value and not any(value.get(k, False) for k in valid):
            raise ValueError("At least one LLM provider must remain enabled")
    elif key in ("llm_api_keys", "llm_base_urls"):
        valid = {"anthropic", "openai", "gemini", "groq"}
        if not (isinstance(value, dict) and set(value) <= valid
                and all(isinstance(v, str) for v in value.values())):
            raise ValueError(f"{key} must map anthropic/openai/gemini/groq -> string")
    elif key == "global_markets_enabled":
        if not isinstance(value, bool):
            raise ValueError("global_markets_enabled must be true or false")
    elif key == "market_sources_enabled":
        valid = {"kite", "smartapi", "upstox", "nse", "yahoo"}
        if not (isinstance(value, dict) and set(value) <= valid
                and all(isinstance(v, bool) for v in value.values())):
            raise ValueError("market_sources_enabled must map kite/smartapi/upstox/"
                             "nse/yahoo -> true/false")
    elif key == "scoring_indices":
        valid = {"NIFTY50", "NIFTY500", "NSE"}
        if not (isinstance(value, list) and value and all(v in valid for v in value)):
            raise ValueError("scoring_indices must be a non-empty list from "
                             "NIFTY50, NIFTY500, NSE")
    elif key in ("score_label", "platform_label"):
        if not (isinstance(value, str) and 1 <= len(value.strip()) <= 40):
            raise ValueError(f"{key} must be 1-40 characters")
    elif key == "ticker_position":
        if value not in ("top", "bottom", "right"):
            raise ValueError("ticker_position must be top, bottom or right")
    elif key == "app_public_url":
        if not (isinstance(value, str) and value.strip().startswith("http") and len(value) <= 200):
            raise ValueError("app_public_url must be an http(s) URL")
    elif key == "share_intro":
        if not (isinstance(value, str) and 1 <= len(value.strip()) <= 300):
            raise ValueError("share_intro must be 1-300 characters")
    elif key == "share_link_days":
        if not (isinstance(value, int) and 1 <= value <= 365):
            raise ValueError("share_link_days must be an integer 1-365")
    elif key == "llm_models":
        if not isinstance(value, dict):
            raise ValueError("llm_models must be a dict of provider -> model")
        for k, v in value.items():
            if k not in ("anthropic", "openai", "gemini", "groq") or not (isinstance(v, str) and v.strip()):
                raise ValueError("llm_models keys must be anthropic/openai/gemini "
                                 "with non-empty model strings")
    elif key in ("news_refresh_minutes", "max_news_items",
                 "assistant_history_messages", "assistant_max_tokens"):
        if not (isinstance(value, int) and value > 0):
            raise ValueError(f"{key} must be a positive integer")
    elif key == "assistant_sql_tool_enabled":
        if not isinstance(value, bool):
            raise ValueError("assistant_sql_tool_enabled must be true or false")
    elif key in ("assistant_sql_max_rows", "assistant_sql_max_queries"):
        if not (isinstance(value, int) and value > 0):
            raise ValueError(f"{key} must be a positive integer")
        if key == "assistant_sql_max_rows" and value > 2000:
            raise ValueError("assistant_sql_max_rows must be <= 2000")
        if key == "assistant_sql_max_queries" and value > 6:
            raise ValueError("assistant_sql_max_queries must be <= 6")
    elif key in ("alerts_enabled", "alert_bands_enabled", "alert_jumps_enabled"):
        if not isinstance(value, bool):
            raise ValueError(f"{key} must be true or false")
    elif key == "alert_score_jump":
        if not (isinstance(value, (int, float)) and 0 < value <= 100):
            raise ValueError("alert_score_jump must be a number between 0 and 100")
    elif key == "registration_mode":
        if value not in ("invite_only", "open", "closed"):
            raise ValueError("registration_mode must be invite_only, open or closed")
    elif key == "invites_per_user":
        if not (isinstance(value, int) and 0 <= value <= 100):
            raise ValueError("invites_per_user must be an integer 0-100")
    elif key == "invite_expiry_days":
        if not (isinstance(value, int) and 1 <= value <= 365):
            raise ValueError("invite_expiry_days must be an integer 1-365")
    elif key == "web_search_enabled":
        if not isinstance(value, bool):
            raise ValueError("web_search_enabled must be true or false")
    elif key == "web_search_provider":
        if value not in ("tavily", "serpapi", "brave", "none"):
            raise ValueError("web_search_provider must be tavily, serpapi, brave or none")
    elif key == "web_search_api_key":
        if not (isinstance(value, str) and len(value) <= 400):
            raise ValueError("web_search_api_key must be a string")
    elif key == "web_search_max_results":
        if not (isinstance(value, int) and 1 <= value <= 10):
            raise ValueError("web_search_max_results must be an integer 1-10")
    elif key == "web_search_domains":
        if not (isinstance(value, list) and all(isinstance(x, str) for x in value)):
            raise ValueError("web_search_domains must be a list of domain strings")
    elif key == "tos_version":
        if not (isinstance(value, str) and 1 <= len(value) <= 20):
            raise ValueError("tos_version must be a short string")
    elif key == "support_email":
        if not (isinstance(value, str) and "@" in value and len(value) <= 120):
            raise ValueError("support_email must be a valid email string")
    elif key == "tos_html":
        if not (isinstance(value, str) and len(value) <= 100000):
            raise ValueError("tos_html must be a string up to 100000 chars")
    elif key in ("tos_seq", "tos_min_seq"):
        if not (isinstance(value, int) and value >= 1):
            raise ValueError(f"{key} must be a positive integer")
    elif key in ("waitlist_enabled", "require_email_verification"):
        if not isinstance(value, bool):
            raise ValueError(f"{key} must be true or false")
    elif key == "maintenance_mode":
        if not isinstance(value, bool):
            raise ValueError("maintenance_mode must be true or false")
    elif key == "maintenance_message":
        if not (isinstance(value, str) and len(value) <= 500):
            raise ValueError("maintenance_message must be a string up to 500 chars")
    elif key == "email_provider":
        if value not in ("graph", "smtp", "off"):
            raise ValueError("email_provider must be graph, smtp or off")
    elif key in ("graph_tenant_id", "graph_client_id", "graph_client_secret", "graph_sender"):
        if not isinstance(value, str):
            raise ValueError(f"{key} must be a string")
    elif key == "assistant_system_prompt":
        if not (isinstance(value, str) and 20 <= len(value) <= 4000):
            raise ValueError("assistant_system_prompt must be a string of 20-4000 chars")
    elif key == "yahoo_symbol_aliases":
        if not (isinstance(value, dict)
                and all(isinstance(k, str) and isinstance(v, str) for k, v in value.items())):
            raise ValueError("yahoo_symbol_aliases must be a dict of symbol->yahoo_ticker strings")
    elif key == "llm_pricing":
        if not (isinstance(value, dict) and "usd_inr" in value):
            raise ValueError("llm_pricing must be a dict including usd_inr")
        for k, v in value.items():
            if k == "usd_inr":
                if not (isinstance(v, (int, float)) and v > 0):
                    raise ValueError("usd_inr must be a positive number")
            elif not (isinstance(v, dict)
                      and all(isinstance(v.get(f), (int, float)) and v.get(f) >= 0
                              for f in ("input_usd_per_mtok", "output_usd_per_mtok"))):
                raise ValueError(f"llm_pricing.{k} needs input/output_usd_per_mtok numbers")


def llm_key(provider: str) -> str:
    """Resolve an LLM API key: DB (admin-set) first, else the .env value."""
    k = ((all_settings().get("llm_api_keys") or {}).get(provider) or "").strip()
    if k:
        return k
    s = get_settings()
    return ({"anthropic": s.anthropic_api_key, "openai": s.openai_api_key,
             "gemini": s.google_api_key, "groq": s.groq_api_key}.get(provider) or "")


def llm_base(provider: str) -> str:
    """Resolve an LLM base URL: DB first, else .env / built-in default."""
    b = ((all_settings().get("llm_base_urls") or {}).get(provider) or "").strip()
    if b:
        return b
    s = get_settings()
    if provider == "openai":
        return (getattr(s, "openai_base_url", "") or "")
    if provider == "groq":
        return (s.groq_base_url or "https://api.groq.com/openai/v1")
    return ""
