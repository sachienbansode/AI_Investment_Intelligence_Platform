"""Curated broking knowledge base.

The assistant answers data questions from the platform's own tables, but for
*concept* questions ("what is a covered call", "CNC vs MIS", "how does STT work")
it needs grounded reference material — otherwise it either declines or leans on
unverified model knowledge. This module ships a compact, India-specific knowledge
base and seeds it into the existing research/RAG store, so concept questions are
retrieved and grounded like any other research passage.

Content is EDUCATIONAL only (definitions and how-things-work) — no buy/sell advice,
no recommendations, no price targets — consistent with the platform's compliance
guardrails. Seeding is idempotent (safe to run on every boot).
"""
from __future__ import annotations

import logging

from app.db.database import ResearchDocument, SessionLocal

log = logging.getLogger(__name__)

KB_SOURCE = "NIYTRI Knowledge Base"

# Each entry is a themed document; blank-line-separated paragraphs become retrievable
# chunks. Keep each paragraph self-contained (it may be retrieved on its own).
DOCUMENTS: list[tuple[str, str]] = [
    ("Order types (Indian equities)", """
A market order executes immediately at the best available price; you control speed, not price.

A limit order executes only at your specified price or better; you control price, not certainty of execution.

A stop-loss (SL) order triggers a limit order once the market reaches your trigger price — used to cap a loss or protect a gain. An SL-M (stop-loss market) triggers a market order instead, trading certainty of execution for price.

A GTT (Good-Till-Triggered) order lets you set a trigger that stays active for a long period (e.g. up to a year) without re-entering it daily; it places the order when the trigger condition is met.

AMO (After-Market Order) is placed when the market is closed and queued for the next session's open.
"""),
    ("Product types & margin (CNC, MIS, NRML)", """
CNC (Cash and Carry) is for delivery-based equity trades: you take or give delivery of shares, held in your demat account, with no intraday leverage.

MIS (Margin Intraday Square-off) is for intraday trades that must be closed the same day; the broker auto-squares-off open MIS positions before the close. It offers leverage but higher risk.

NRML (Normal) is used for overnight F&O and currency positions, carried at full exchange margin.

Margin is the collateral the exchange requires to hold a position. SPAN + Exposure margin applies to F&O. Peak-margin and upfront-margin rules (SEBI) require the required margin to be collected in advance.

Margin pledge lets you pledge shares held in demat to receive collateral margin for trading, rather than selling them.
"""),
    ("Derivatives basics (futures & options)", """
A futures contract is an agreement to buy or sell an underlying (stock or index) at a set price on a future expiry date, traded in fixed lot sizes. Index futures (e.g. NIFTY) and stock futures settle on their expiry.

An option gives the buyer the right, not the obligation, to buy (call) or sell (put) the underlying at a strike price before/at expiry, for a premium paid to the seller (writer). The buyer's risk is limited to the premium; the writer's risk can be large.

The strike price is the fixed price in the option contract. The premium is the option's market price. In-the-money (ITM), at-the-money (ATM) and out-of-the-money (OTM) describe the strike relative to the current price.

Open interest (OI) is the number of outstanding (not yet closed) derivative contracts; rising OI with price can indicate conviction behind a move. Expiry is when the contract settles — Indian index options have weekly and monthly expiries.

The Greeks measure option sensitivity: Delta (to price), Theta (to time decay), Vega (to volatility), Gamma (rate of change of Delta). They explain how a premium moves, not what to trade.
"""),
    ("Common option structures (educational)", """
A covered call is holding a stock and selling a call option against it to earn premium; it caps upside above the strike in exchange for that premium. Described here for education, not as a recommendation.

A protective put is holding a stock and buying a put to limit downside below the strike, like insurance that costs the premium.

A long straddle is buying a call and a put at the same strike/expiry to position for a large move in either direction; a strangle uses different strikes. These are concepts, not advice.

These structures involve risk and costs; whether any is suitable depends on individual circumstances — consult a SEBI-registered investment adviser.
"""),
    ("Cash market: delivery, intraday, short selling, circuits", """
Delivery (investment) means buying shares and holding them in demat; intraday means buying and selling within the same session with no delivery.

Short selling is selling shares you don't own to profit from a fall; in the cash segment it must generally be closed intraday (you cannot deliver shares you don't have). Naked short delivery leads to auction.

Circuit limits (price bands) cap how far a stock or index can move in a day; the upper/lower circuit halts trading at the band. Index-level circuit breakers pause the whole market on sharp moves.

ASM (Additional Surveillance Measure) and GSM (Graded Surveillance Measure) are exchange frameworks that add surveillance/margins to stocks showing unusual price-volume behaviour, to protect investors.

Settlement in Indian equities is T+1 (trade date plus one business day) for delivery.
"""),
    ("Accounts, demat & regulation", """
A trading account places buy/sell orders on the exchange; a demat account holds the shares electronically. A bank account funds them. Most brokers offer a 2-in-1 or 3-in-1 setup.

SEBI (Securities and Exchange Board of India) is the market regulator; exchanges (NSE, BSE) and depositories (NSDL, CDSL) operate under its rules.

SCORES is SEBI's online complaint redressal portal for investors to file grievances against listed companies or registered intermediaries.

KYC (Know Your Customer) is mandatory account verification. A nominee can be registered to inherit holdings.

An investment adviser must be SEBI-registered to give personalised advice; information and education (like this platform) are different from advice.
"""),
    ("Costs & taxes (overview)", """
Brokerage is the broker's fee per trade (flat or percentage). Exchange transaction charges, GST, SEBI turnover fees and stamp duty also apply.

STT (Securities Transaction Tax) is a tax on exchange trades — charged on both sides for delivery equity, and differently for intraday and F&O.

Capital gains tax: equity held over 12 months is long-term (LTCG); 12 months or less is short-term (STCG). Rates and exemptions are set by the government and change over time — verify current rates before relying on them.

DP (Depository Participant) charges apply when shares are sold from demat.

This is general information, not tax advice; consult a qualified professional for your situation.
"""),
    ("Corporate actions", """
A dividend is a cash payout to shareholders from profits; the ex-dividend date determines eligibility.

A bonus issue gives existing shareholders extra shares free in a ratio (e.g. 1:1), increasing share count and reducing price proportionally — total value unchanged.

A stock split divides each share into more shares (e.g. 1 into 5), lowering the price per share; market cap is unchanged.

A rights issue offers existing shareholders new shares at a set price in proportion to holdings. A buyback is the company repurchasing its own shares, often returning cash and reducing share count.

The record date / book closure fixes who is eligible for a corporate action.
"""),
    ("Fundamental ratios explained", """
P/E (price to earnings) = price / earnings per share; a valuation multiple — lower can mean cheaper, but compare within a sector. P/B (price to book) = price / book value per share.

EPS (earnings per share) = net profit / shares outstanding. ROE (return on equity) = net profit / shareholder equity; ROCE (return on capital employed) measures returns on all capital (equity + debt). ROA is return on assets.

Net margin = net profit / revenue; operating margin = operating profit / revenue — higher margins indicate more profitable operations.

Debt-to-equity = total debt / equity; lower generally means less leverage risk. Interest coverage = EBIT / interest; higher is safer. Current ratio = current assets / current liabilities; above 1 indicates short-term liquidity.

Dividend yield = dividend per share / price. PEG = P/E / earnings growth; it contextualises a P/E against growth.
"""),
    ("Market structure, indices & instruments", """
Market capitalisation = share price × shares outstanding. By size: large-cap (biggest, generally more stable), mid-cap, and small-cap (higher growth potential and higher risk).

NIFTY 50 and SENSEX are benchmark indices of large, liquid companies; NIFTY 500 covers a broad set. Sectoral indices (Bank Nifty, Nifty IT, etc.) track specific sectors.

An ETF (Exchange-Traded Fund) trades like a stock and typically tracks an index. A mutual fund pools money into a managed portfolio; an SIP (Systematic Investment Plan) invests a fixed amount at regular intervals.

Bonds are debt instruments paying interest (coupon); their prices move inversely to interest rates.

An IPO (Initial Public Offering) is a company's first public share sale; ASBA (Application Supported by Blocked Amount) blocks the application money in your bank account until allotment.
"""),
    ("Technical analysis basics", """
Support is a price level where buying tends to emerge; resistance is where selling tends to emerge. A breakout is a move beyond such a level.

A moving average (e.g. 50-day, 200-day DMA) smooths price to show trend; crossovers are watched as trend signals.

RSI (Relative Strength Index) is a 0-100 momentum oscillator; conventionally above 70 is considered overbought and below 30 oversold — context matters.

Volume confirms moves: a price move on high volume carries more conviction than on low volume. MACD is a trend-momentum indicator built from moving averages.

Technical indicators describe probabilities, not certainties, and are one input among many.
"""),
]


def status() -> dict:
    db = SessionLocal()
    try:
        docs = db.query(ResearchDocument).filter_by(source=KB_SOURCE).all()
        return {"seeded": len(docs), "expected": len(DOCUMENTS),
                "titles": [d.title for d in docs],
                "chunks": sum(d.chunk_count or 0 for d in docs)}
    finally:
        db.close()


async def seed(force: bool = False) -> dict:
    """Ingest knowledge-base documents into the research store. Idempotent: skips any
    title already present (unless force=True re-adds missing ones). Returns a summary."""
    from app.services import research
    db = SessionLocal()
    try:
        existing = {d.title for d in db.query(ResearchDocument).filter_by(source=KB_SOURCE).all()}
    finally:
        db.close()
    added, skipped = [], []
    for title, text in DOCUMENTS:
        if title in existing and not force:
            skipped.append(title)
            continue
        try:
            await research.ingest_document(title=title, text=text.strip(),
                                           source=KB_SOURCE, uploaded_by="system")
            added.append(title)
        except Exception as e:
            log.warning("knowledge_base seed failed for %r: %s", title, e)
    return {"added": added, "skipped": skipped, "total": len(DOCUMENTS)}
