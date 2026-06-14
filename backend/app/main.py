"""AI Investment Intelligence Platform — FastAPI entry point.

Run:  uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs
"""
import logging
from contextlib import asynccontextmanager

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
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

scheduler = AsyncIOScheduler()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    from app.services.app_settings import get_setting  # after init_db
    hour = int(get_setting("daily_scoring_hour"))
    every = int(get_setting("news_refresh_minutes"))
    # Daily agentic scoring run over the DB-configured universe
    scheduler.add_job(run_daily_pipeline, CronTrigger(hour=hour, minute=0),
                      id="daily_scoring")
    scheduler.add_job(refresh_news, "interval", minutes=every, id="news_refresh")
    scheduler.start()
    log.info("Scheduler started: daily scoring at %02d:00, news every %dm", hour, every)
    yield
    scheduler.shutdown(wait=False)


app = FastAPI(
    title="AI Investment Intelligence Platform",
    description="Conversational investment intelligence, agentic stock scoring, "
                "news intelligence, and portfolio analytics for an Indian broking app. "
                "All outputs are AI-generated, informational only, and not investment advice.",
    version="0.1.0",
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
