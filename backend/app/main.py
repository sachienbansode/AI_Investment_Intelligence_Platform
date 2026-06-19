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
from app.config import get_settings
from app.db.database import init_db
from app.services.news_intel import refresh_news

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)

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
    scheduler.add_job(run_daily_pipeline,
                      CronTrigger(hour=hour, minute=0, timezone=IST),
                      id="daily_scoring", replace_existing=True,
                      misfire_grace_time=6 * 3600, coalesce=True)
    scheduler.add_job(refresh_news, "interval", minutes=every,
                      id="news_refresh", replace_existing=True)
    scheduler.start()
    # Catch-up: if the box was down/restarted past the scheduled hour and today's
    # run hasn't happened yet, kick one off shortly after boot.
    try:
        if datetime.now(IST).hour >= hour and not _ran_today():
            scheduler.add_job(run_daily_pipeline, DateTrigger(run_date=datetime.now(IST)),
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

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins.split(","),
    allow_methods=["*"], allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(router)
app.include_router(admin_router)
