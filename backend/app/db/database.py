"""Persistence: users, instruments, settings, scores, news, chat, watchlists.
SQLite for dev / PostgreSQL (AWS RDS) for production."""
import json
from datetime import datetime, timezone

from sqlalchemy import (JSON, Boolean, Column, DateTime, Float, Index, Integer, String,
                        Text, UniqueConstraint, create_engine, text)
from sqlalchemy.orm import declarative_base, sessionmaker

from app.config import get_settings

_url = get_settings().database_url
# Normalize common Postgres URL variants (e.g. RDS/Heroku-style postgres://)
if _url.startswith("postgres://"):
    _url = _url.replace("postgres://", "postgresql+psycopg2://", 1)
elif _url.startswith("postgresql://"):
    _url = _url.replace("postgresql://", "postgresql+psycopg2://", 1)
_is_sqlite = _url.startswith("sqlite")
engine = create_engine(
    _url,
    connect_args={"check_same_thread": False} if _is_sqlite else {},
    pool_pre_ping=not _is_sqlite,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False)
Base = declarative_base()


def utcnow():
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True)
    email = Column(String, unique=True, index=True)
    full_name = Column(String, default="")
    hashed_password = Column(String)
    is_admin = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    role_id = Column(Integer, nullable=True)   # FK -> roles.id (RBAC)
    created_at = Column(DateTime, default=utcnow)


class Role(Base):
    """RBAC role: a named set of page permissions. is_admin grants admin APIs."""
    __tablename__ = "roles"
    id = Column(Integer, primary_key=True)
    name = Column(String, unique=True, index=True)
    pages = Column(JSON)                       # list of allowed page names
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, default=utcnow)


# Canonical page catalog (matches the frontend nav tab names)
ALL_PAGES = ["Dashboard", "AI Assistant", "Stock Scores", "Compare", "Market News",
             "Watchlist", "Portfolio", "About", "Agents", "Audit", "Admin"]
USER_PAGES = ["Dashboard", "AI Assistant", "Stock Scores", "Compare", "Market News",
              "Watchlist", "Portfolio", "About"]


class Instrument(Base):
    """Instrument master — which scripts exist, and which get daily AI scores."""
    __tablename__ = "instruments"
    id = Column(Integer, primary_key=True)
    symbol = Column(String, unique=True, index=True)   # NSE symbol
    name = Column(String, default="")
    sector = Column(String, default="")
    is_active = Column(Boolean, default=True)          # visible in app
    in_scoring_universe = Column(Boolean, default=True)  # scored daily
    created_at = Column(DateTime, default=utcnow)


class AppSetting(Base):
    """Key/value JSON settings editable from the Admin tab."""
    __tablename__ = "app_settings"
    key = Column(String, primary_key=True)
    value = Column(JSON)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class WatchlistItem(Base):
    __tablename__ = "watchlist_items"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, index=True)
    symbol = Column(String)
    created_at = Column(DateTime, default=utcnow)
    __table_args__ = (UniqueConstraint("user_id", "symbol", name="uq_watch_user_symbol"),)


class UserActivity(Base):
    """Per-user interest signal for personalising assistant suggestions.
    One row per (user, kind, value), with a hit count and recency. Learned from
    the symbols a user asks about. Indexed for fast per-user lookups."""
    __tablename__ = "user_activity"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, index=True)
    kind = Column(String, default="symbol")   # 'symbol' (extensible: sector/topic)
    value = Column(String)
    count = Column(Integer, default=1)
    last_at = Column(DateTime, default=utcnow)
    __table_args__ = (
        UniqueConstraint("user_id", "kind", "value", name="uq_user_activity"),
        Index("ix_user_activity_user_last", "user_id", "last_at"),
    )


class DeviceToken(Base):
    """Push-notification token per device, for the mobile app."""
    __tablename__ = "device_tokens"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, index=True)
    token = Column(String, unique=True, index=True)
    platform = Column(String, default="")     # ios | android | web
    created_at = Column(DateTime, default=utcnow)


class Portfolio(Base):
    """A user's saved holdings (uploaded or hand-entered). One row per user."""
    __tablename__ = "portfolios"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, unique=True, index=True)
    holdings = Column(JSON)   # [{symbol, quantity, avg_price, sector}]
    created_at = Column(DateTime, default=utcnow)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow)


class PipelineRun(Base):
    """Persistent audit record of every agentic pipeline run."""
    __tablename__ = "pipeline_runs"
    id = Column(Integer, primary_key=True)
    run_id = Column(String, unique=True, index=True)
    started = Column(DateTime)
    finished = Column(DateTime)
    status = Column(String)               # completed | partial | failed
    symbols_count = Column(Integer, default=0)
    symbols = Column(JSON)
    agents = Column(JSON)                 # [{name, status, started, finished, detail}]
    created_at = Column(DateTime, default=utcnow)


class StockScore(Base):
    __tablename__ = "stock_scores"
    id = Column(Integer, primary_key=True)
    symbol = Column(String, index=True)
    score_date = Column(String, index=True)
    composite_score = Column(Float)
    pillar_scores = Column(JSON)
    explanation = Column(Text)
    quality_status = Column(String, default="pending")
    reviewed_by = Column(String, default="")
    reviewed_at = Column(DateTime, nullable=True)
    # Independent AI checker verdict: {verdict, reason, checker_provider, independent}
    ai_review = Column(JSON, nullable=True)
    pe = Column(Float, nullable=True)              # trailing P/E captured at scoring time
    market_cap = Column(Float, nullable=True)      # market capitalisation (absolute, e.g. INR)
    created_at = Column(DateTime, default=utcnow)


class NewsItem(Base):
    __tablename__ = "news_items"
    id = Column(Integer, primary_key=True)
    title = Column(Text)
    link = Column(String, unique=True)
    source = Column(String)
    published = Column(String)
    summary_short = Column(Text)
    summary_detailed = Column(Text)
    impacted_stocks = Column(JSON)
    impacted_sectors = Column(JSON)
    sentiment = Column(String)
    created_at = Column(DateTime, default=utcnow)


class ResearchDocument(Base):
    """A broker-research document ingested into the RAG store."""
    __tablename__ = "research_documents"
    id = Column(Integer, primary_key=True)
    title = Column(String)
    source = Column(String, default="")        # e.g. "Equity Research", analyst, desk
    filename = Column(String, default="")
    uploaded_by = Column(String, default="")
    chunk_count = Column(Integer, default=0)
    embedding_method = Column(String, default="")
    created_at = Column(DateTime, default=utcnow)


class ResearchChunk(Base):
    """A chunk of a research document plus its embedding vector (JSON array)."""
    __tablename__ = "research_chunks"
    id = Column(Integer, primary_key=True)
    document_id = Column(Integer, index=True)
    ordinal = Column(Integer, default=0)
    text = Column(Text)
    embedding = Column(JSON)                   # list[float]
    created_at = Column(DateTime, default=utcnow)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, index=True, nullable=True)
    session_id = Column(String, index=True)
    role = Column(String)
    content = Column(Text)
    meta = Column(JSON)
    created_at = Column(DateTime, default=utcnow)


_MIGRATIONS = [
    ("chat_messages", "user_id", "INTEGER"),
    ("stock_scores", "reviewed_by", "VARCHAR DEFAULT ''"),
    ("stock_scores", "reviewed_at", "DATETIME"),
    ("stock_scores", "ai_review", "JSON"),
    ("stock_scores", "pe", "FLOAT"),
    ("stock_scores", "market_cap", "FLOAT"),
    ("users", "role_id", "INTEGER"),
]

# NIFTY50 constituents (seed; constituents change over time — manage from
# Admin → Instruments after first boot)
NIFTY50_SEED = [
    ("RELIANCE", "Reliance Industries", "Energy"),
    ("HDFCBANK", "HDFC Bank", "Banking"),
    ("ICICIBANK", "ICICI Bank", "Banking"),
    ("INFY", "Infosys", "IT"),
    ("TCS", "Tata Consultancy Services", "IT"),
    ("ITC", "ITC", "FMCG"),
    ("LT", "Larsen & Toubro", "Infrastructure"),
    ("KOTAKBANK", "Kotak Mahindra Bank", "Banking"),
    ("AXISBANK", "Axis Bank", "Banking"),
    ("SBIN", "State Bank of India", "Banking"),
    ("BHARTIARTL", "Bharti Airtel", "Telecom"),
    ("BAJFINANCE", "Bajaj Finance", "Financial Services"),
    ("ASIANPAINT", "Asian Paints", "Consumer"),
    ("MARUTI", "Maruti Suzuki", "Auto"),
    ("HCLTECH", "HCL Technologies", "IT"),
    ("TITAN", "Titan Company", "Consumer"),
    ("SUNPHARMA", "Sun Pharmaceutical", "Pharma"),
    ("ULTRACEMCO", "UltraTech Cement", "Cement"),
    ("NTPC", "NTPC", "Power"),
    ("NESTLEIND", "Nestle India", "FMCG"),
    ("POWERGRID", "Power Grid Corporation", "Power"),
    ("M&M", "Mahindra & Mahindra", "Auto"),
    ("WIPRO", "Wipro", "IT"),
    ("TATAMOTORS", "Tata Motors", "Auto"),
    ("TATASTEEL", "Tata Steel", "Metals"),
    ("ADANIENT", "Adani Enterprises", "Conglomerate"),
    ("ADANIPORTS", "Adani Ports & SEZ", "Infrastructure"),
    ("COALINDIA", "Coal India", "Mining"),
    ("BAJAJFINSV", "Bajaj Finserv", "Financial Services"),
    ("ONGC", "Oil & Natural Gas Corporation", "Energy"),
    ("HINDALCO", "Hindalco Industries", "Metals"),
    ("JSWSTEEL", "JSW Steel", "Metals"),
    ("GRASIM", "Grasim Industries", "Cement"),
    ("CIPLA", "Cipla", "Pharma"),
    ("DRREDDY", "Dr. Reddy's Laboratories", "Pharma"),
    ("TECHM", "Tech Mahindra", "IT"),
    ("INDUSINDBK", "IndusInd Bank", "Banking"),
    ("EICHERMOT", "Eicher Motors", "Auto"),
    ("APOLLOHOSP", "Apollo Hospitals", "Healthcare"),
    ("DIVISLAB", "Divi's Laboratories", "Pharma"),
    ("HEROMOTOCO", "Hero MotoCorp", "Auto"),
    ("BRITANNIA", "Britannia Industries", "FMCG"),
    ("TATACONSUM", "Tata Consumer Products", "FMCG"),
    ("BAJAJ-AUTO", "Bajaj Auto", "Auto"),
    ("BPCL", "Bharat Petroleum", "Energy"),
    ("HDFCLIFE", "HDFC Life Insurance", "Insurance"),
    ("SBILIFE", "SBI Life Insurance", "Insurance"),
    ("LTIM", "LTIMindtree", "IT"),
    ("SHRIRAMFIN", "Shriram Finance", "Financial Services"),
    ("HINDUNILVR", "Hindustan Unilever", "FMCG"),
]


def init_db():
    Base.metadata.create_all(bind=engine)
    if _is_sqlite:
        with engine.connect() as conn:
            for table, col, ddl in _MIGRATIONS:
                cols = [r[1] for r in conn.execute(text(f"PRAGMA table_info({table})"))]
                if cols and col not in cols:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
            conn.commit()
    else:  # PostgreSQL: idempotently add columns introduced since v1 (auto-heal)
        pg_cols = [
            ("chat_messages", "user_id", "INTEGER"),
            ("stock_scores", "reviewed_by", "VARCHAR DEFAULT ''"),
            ("stock_scores", "reviewed_at", "TIMESTAMPTZ"),
            ("stock_scores", "ai_review", "JSON"),
            ("stock_scores", "pe", "DOUBLE PRECISION"),
            ("stock_scores", "market_cap", "DOUBLE PRECISION"),
            ("users", "role_id", "INTEGER"),
        ]
        with engine.connect() as conn:
            for table, col, ddl in pg_cols:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {ddl}"))
            conn.commit()
    _seed_instruments()
    _seed_roles()
    # Admin creation: run `python scripts/create_admin.py` (interactive).


def _seed_instruments():
    db = SessionLocal()
    try:
        if db.query(Instrument).count() == 0:
            for symbol, name, sector in NIFTY50_SEED:
                db.add(Instrument(symbol=symbol, name=name, sector=sector))
            db.commit()
    finally:
        db.close()


def _seed_roles():
    db = SessionLocal()
    try:
        if db.query(Role).count() == 0:
            db.add(Role(name="Administrator", pages=ALL_PAGES, is_admin=True))
            db.add(Role(name="User", pages=USER_PAGES, is_admin=False))
            db.commit()
    finally:
        db.close()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
