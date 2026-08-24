"""AI Investment Intelligence Platform — FastAPI entry point.

Run:  uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.date import DateTrigger
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.agents.pipeline import run_daily_pipeline
from app.api.admin_routes import router as admin_router
from app.api.auth_routes import router as auth_router
from app.api.routes import router
from app.api.partner_routes import router as partner_router
from app.config import get_settings
from app.db.database import init_db
from app.services.news_intel import refresh_news

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


async def refresh_then_score(*args, **kwargs):
    """Daily job: refresh the NIFTY 50 / 500 master, THEN run the scoring pipeline
    on the fresh universe. A refresh failure never blocks scoring."""
    try:
        import asyncio as _a
        from app.services import universe
        await _a.to_thread(universe.refresh_universe)
    except Exception as e:
        log.warning("universe refresh failed (continuing to score): %s", e)
    await run_daily_pipeline(*args, **kwargs)

IST = ZoneInfo("Asia/Kolkata")
scheduler = AsyncIOScheduler(timezone=IST)


def _ran_today() -> bool:
    """True if a scoring pipeline already ran today (IST)."""
    from app.db.database import PipelineRun, SessionLocal
    today = datetime.now(IST).date()
    db = SessionLocal()
    try:
        rows = db.query(PipelineRun).order_by(PipelineRun.started.desc()).limit(20).all()
        for r in rows:
            st = r.started
            if not st:
                continue
            if st.tzinfo is None:
                st = st.replace(tzinfo=timezone.utc)
            if st.astimezone(IST).date() == today:
                return True
        return False
    except Exception:
        log.exception("ran_today check failed")
        return False
    finally:
        db.close()


def reschedule_scoring(hour) -> bool:
    """Apply a new daily scoring hour to the RUNNING scheduler — no restart."""
    try:
        scheduler.reschedule_job(
            "daily_scoring",
            trigger=CronTrigger(hour=int(hour), minute=0, timezone=IST))
        log.info("Daily scoring rescheduled live to %02d:00 IST", int(hour))
        return True
    except Exception:
        log.exception("Live reschedule of daily scoring failed")
        return False


def reschedule_news(minutes) -> bool:
    """Apply a new news-refresh interval to the running scheduler — no restart."""
    try:
        scheduler.reschedule_job("news_refresh", trigger="interval", minutes=int(minutes))
        log.info("News refresh rescheduled live to every %d min", int(minutes))
        return True
    except Exception:
        log.exception("Live reschedule of news refresh failed")
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    from app.services.app_settings import get_setting
    hour = int(get_setting("daily_scoring_hour"))
    every = int(get_setting("news_refresh_minutes"))
    # Daily agentic scoring at the configured hour in IST, tolerant of restarts.
    scheduler.add_job(refresh_then_score,
                      CronTrigger(hour=hour, minute=0, timezone=IST),
                      id="daily_scoring", replace_existing=True,
                      misfire_grace_time=6 * 3600, coalesce=True)
    scheduler.add_job(refresh_news, "interval", minutes=every,
                      id="news_refresh", replace_existing=True)
    # Daily EOD price refresh (~18:30 IST, after close + delayed-data settle).
    from app.services.prices import daily_update as _daily_prices
    scheduler.add_job(_daily_prices,
                      CronTrigger(hour=18, minute=30, timezone=IST),
                      id="daily_prices", replace_existing=True,
                      misfire_grace_time=6 * 3600, coalesce=True, max_instances=1)
    scheduler.start()
    # Catch-up: if the box was down/restarted past the scheduled hour and today's
    # run hasn't happened yet, kick one off shortly after boot.
    try:
        if datetime.now(IST).hour >= hour and not _ran_today():
            scheduler.add_job(refresh_then_score, DateTrigger(run_date=datetime.now(IST)),
                              id="daily_scoring_catchup", misfire_grace_time=3600)
            log.info("Catch-up scoring run scheduled (today's %02d:00 IST was missed)", hour)
    except Exception:
        log.exception("Catch-up scheduling failed")
    log.info("Scheduler started: daily scoring %02d:00 IST, news every %dm", hour, every)
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(
    title="AI Investment Intelligence Platform",
    description="Conversational investment intelligence, agentic stock scoring, "
                "news intelligence and portfolio analytics for an Indian broking app. "
                "All outputs are AI-generated, informational only, not investment advice.",
    version="0.3.0",
    lifespan=lifespan,
)

_cors_origins = [o.strip() for o in get_settings().cors_origins.split(",") if o.strip()]
# Capacitor / Ionic native app shells load from these origins; allow them so the
# packaged iOS/Android app can call the API.
_cors_origins += ["capacitor://localhost", "ionic://localhost",
                  "http://localhost", "https://localhost"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(dict.fromkeys(_cors_origins)),
    allow_methods=["*"], allow_headers=["*"],
)

# ── Maintenance mode ────────────────────────────────────────────────────────
# When app_settings.maintenance_mode is ON, non-admin users are blocked with a
# 503 (admins pass through). A short allowlist keeps auth + health + branding up
# so admins can still sign in and the client can detect maintenance.
_MAINT_ALLOW = ("/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/me",
                "/api/v1/auth/registration-info", "/api/v1/health", "/api/v1/branding",
                "/api/v1/public/")


def _request_is_admin(request) -> bool:
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        return False
    try:
        from app.core.auth import _decode, effective_access
        from app.db.database import SessionLocal, User
        payload = _decode(auth.split(" ", 1)[1])
        if payload.get("typ") == "refresh":
            return False
        db = SessionLocal()
        try:
            u = db.get(User, int(payload["sub"]))
        finally:
            db.close()
        if not u or not u.is_active:
            return False
        return effective_access(u)[1]
    except Exception:
        return False


@app.middleware("http")
async def maintenance_gate(request, call_next):
    from starlette.responses import JSONResponse
    path = request.url.path
    if (path.startswith("/api/v1") and not path.startswith("/api/v1/admin")
            and not any(path.startswith(p) for p in _MAINT_ALLOW)):
        from app.services.app_settings import get_setting
        if get_setting("maintenance_mode") and not _request_is_admin(request):
            msg = get_setting("maintenance_message") or "The app is temporarily down for maintenance."
            return JSONResponse(status_code=503, content={"detail": msg, "maintenance": True})
    return await call_next(request)


app.include_router(auth_router)
app.include_router(router)
app.include_router(admin_router)
app.include_router(partner_router)
