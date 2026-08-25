"""Pydantic request/response schemas for the 5 BRD APIs."""
from pydantic import BaseModel, Field


class AskAIRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=2000)
    session_id: str = "default"
    language: str = "en"  # BRD: multilingual support


class AskAIResponse(BaseModel):
    answer: str
    sources: list[dict] = []
    confidence: float = Field(ge=0, le=1)
    provider: str
    disclaimer: str
    # Optional one-shot request for user input (rendered as chips / an input box).
    # Shape: {"q": str, "type": "select"|"input"|"mixed", "options": [str]}
    clarify: dict | None = None
    # Optional multi-field form (rendered as a small form; submitted as one message).
    # Shape: {"title","submit","fields":[{"key","type","label","options":[],"default"}]}
    form: dict | None = None
    # Optional charts to render under the reply. Each is either data-bound
    # {"src":"bound","type":"score_history|price_history|compare|sector|distribution",
    #  "symbol":..., "symbols":[...]} or illustrative
    # {"src":"data","kind":"bar|line|pie","title":..,"x":[..],"y":[..]}.
    charts: list[dict] = []


class PillarScores(BaseModel):
    fundamental: float
    technical: float
    valuation: float
    momentum: float
    earnings: float
    news_sentiment: float
    institutional: float
    risk: float


class StockScoreResponse(BaseModel):
    symbol: str
    score_date: str
    composite_score: float = Field(ge=0, le=100)
    pillar_scores: PillarScores
    explanation: str
    quality_status: str
    disclaimer: str


class NewsSummaryItem(BaseModel):
    title: str
    link: str
    source: str
    published: str | None = None
    summary_short: str | None = None
    summary_detailed: str | None = None
    impacted_stocks: list[str] = []
    impacted_sectors: list[str] = []
    sentiment: str | None = None


class Holding(BaseModel):
    symbol: str
    quantity: float = Field(gt=0)
    avg_price: float = Field(gt=0)
    sector: str | None = None


class PortfolioRequest(BaseModel):
    holdings: list[Holding]


class PortfolioResponse(BaseModel):
    health_score: float
    status: str = ""              # green | amber | red
    status_label: str = ""
    headline: str = ""            # one-line plain-language summary
    pnl: dict = {}                # {invested, current_value, pnl, pnl_pct}
    deductions: list[dict] = []   # why the health score lost points
    diversification: dict
    concentration_risk: dict
    sector_exposure: dict
    insights: str
    disclaimer: str
    # NIYTRI Score overlay + verdict (added in the quality upgrade)
    holdings: list[dict] = []       # per-holding: symbol, weight_pct, value, pnl_pct, sector, score, band
    portfolio_score: dict = {}      # weighted_score, coverage_pct, band_weight_pct, band_count, strongest, weakest, band
    verdict: dict = {}              # label, strengths[], watchouts[]


class WatchlistRequest(BaseModel):
    symbols: list[str] = Field(..., min_length=1, max_length=50)
