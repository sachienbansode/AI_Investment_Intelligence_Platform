import AiIcon from './AiIcon.jsx'

// Features grouped by category for the About page.
const CATEGORIES = [
  {
    name: 'Conversational AI',
    features: [
      { icon: <AiIcon />, title: 'AI Assistant', desc: "Conversational intelligence grounded in live quotes, the platform's scores and market news. Multilingual, with per-user chat history and smart follow-up suggestions after every reply." },
      { icon: '⇄', title: 'Stock Comparison', desc: "Side-by-side comparison of any two NSE scripts - or a random same-sector pair - with live metrics and an advice-free AI summary and conclusion." },
    ],
  },
  {
    name: 'Answer Quality & Trust',
    features: [
      { icon: '✓', title: 'Exact, Verified Answers', desc: "Quantitative questions - sector averages, counts, thresholds, top/bottom rankings and totals - are computed deterministically in code rather than estimated by the model, so figures are exact and consistent." },
      { icon: '⚑', title: 'Answer Feedback Loop', desc: "Every answer can be rated helpful or not. Ratings feed an Admin quality dashboard so the team improves whole categories of answers instead of one chat at a time." },
      { icon: '◷', title: 'Grounded Confidence & Sources', desc: "Each answer shows a confidence level and the exact sources that grounded it, derived from the evidence actually used for that specific question." },
      { icon: '◎', title: 'Independent AI Checker', desc: "A second LLM (a different provider than the one that wrote the rationale, when available) reviews each score rationale for compliance and factual consistency before publishing." },
      { icon: '❏', title: 'Broker-Research RAG', desc: "Upload the firm's research notes (PDF/text); the assistant retrieves and cites the most relevant passages to ground its answers as reference material, not advice." },
    ],
  },
  {
    name: 'Scoring & Analytics',
    features: [
      { icon: '▤', title: 'Agentic Stock Scoring', desc: "A daily multi-agent pipeline scores every script 0-100 using a proprietary blend of fundamentals, technicals, valuation, momentum, earnings, news sentiment, institutional activity and risk." },
      { icon: '↺', title: 'On-demand Rescore', desc: "Refresh any script's score with a live quote at any time, with day-over-day change, the pillars that drove the move and an AI-written rationale." },
      { icon: '≣', title: 'Deep Fundamentals', desc: "Each score carries P/E, market cap, EPS, P/B, dividend yield, ROE, 52-week range and volume, pulled daily from multiple data feeds with fallback for near-complete coverage." },
      { icon: '▦', title: 'Sector Strength & Stats', desc: "A sector heatmap plus exact per-sector aggregates (average, min and max of every metric) that power accurate sector comparisons in the assistant." },
    ],
  },
  {
    name: 'Data & Markets',
    features: [
      { icon: '◈', title: 'Market News Intelligence', desc: "Continuous collection from leading Indian financial sources, AI-summarized and tagged with impacted stocks, sectors and sentiment, linked to the original article." },
      { icon: '◴', title: 'Live Market Data', desc: "Broker, NSE and Yahoo feeds with automatic fallback so quotes and indices keep working everywhere - including cloud servers where some sources are blocked." },
      { icon: '⊕', title: 'Global Markets', desc: "Optional global indices (S&P 500, Nasdaq, Dow, FTSE, Nikkei, Hang Seng) and global news shown alongside Indian markets." },
      { icon: '◆', title: 'Dashboard & Index Filters', desc: "KPIs, score trends with avg/min/max labels, top movers and an index filter (Nifty 50, Nifty 500 and sectors)." },
    ],
  },
  {
    name: 'Portfolio & Watchlist',
    features: [
      { icon: '◐', title: 'Portfolio Intelligence', desc: "Health score with a transparent deduction breakdown, diversification and concentration metrics (HHI), sector exposure, factual AI insights and a downloadable PDF report." },
      { icon: '☆', title: 'Personal Watchlist', desc: "Follow any script with live price, day change and its latest score in one view." },
    ],
  },
  {
    name: 'Governance & Compliance',
    features: [
      { icon: '⛨', title: 'Maker-Checker Governance', desc: "Every score passes an automated Quality Agent gate plus an optional strict mode that holds scores as pending until a human admin approves them - every decision attributed and audit-logged." },
      { icon: '⚖', title: 'SEBI-Compliant Guardrails', desc: "No buy/sell/hold calls, no price targets and no personalised advice; the scoring methodology stays confidential and every AI output is flagged as informational and reviewable." },
      { icon: '≡', title: 'Audit Logging', desc: "Every AI call, score decision and admin action is attributed and audit-logged for governance and review." },
    ],
  },
  {
    name: 'Platform & Engine',
    features: [
      { icon: '⬡', title: 'Multi-LLM Engine', desc: "Anthropic Claude, OpenAI GPT and Google Gemini behind one router with automatic failover and key-based auto-switch - no single-vendor dependency, with per-call usage tracked." },
      { icon: '⚡', title: 'Prompt Caching', desc: "Optional caching of the assistant's system prompt across Anthropic, OpenAI and Gemini to cut latency and repeated input-token cost - toggled from Admin." },
      { icon: '⚒', title: 'Fully DB-Configurable', desc: "Instruments master with one-click NIFTY500 import, editable scoring weights, scheduler times, chatbot persona, display names and branding - all from the Admin tab." },
      { icon: '▣', title: 'Mobile Apps', desc: "The same experience packaged as native iOS and Android apps (Capacitor) with a mobile-first UI, bottom navigation and a compact assistant." },
      { icon: '⇲', title: 'Open APIs', desc: "REST APIs for Ask AI, Stock Score, News, Portfolio and Watchlist - JWT-secured and ready for mobile and partner integration." },
    ],
  },
]

export default function About() {
  return (
    <div>
      <div className="panel about-hero">
        <h3>AI Investment Intelligence Platform</h3>
        <p className="hint">
          Explainable, agentic AI for Indian markets - combining large language models,
          live market data and transparent governance to deliver conversational insight,
          daily stock scoring and portfolio analytics inside your broking experience.
        </p>
        <p className="hint">Built for SEBI-regulated broking</p>
      </div>

      {CATEGORIES.map(cat => (
        <div key={cat.name}>
          <h3 className="about-cat">{cat.name}</h3>
          <div className="feature-grid">
            {cat.features.map(f => (
              <div key={f.title} className="feature-card">
                <div className="feature-icon">{f.icon}</div>
                <h4>{f.title}</h4>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="panel">
        <h4>Important information</h4>
        <p className="hint">
          All AI outputs in this application - scores, insights, summaries and chat
          responses - are generated by artificial intelligence for informational purposes
          only. They are not investment advice, research reports, or recommendations to
          buy or sell securities, and must be reviewed and approved before business or
          regulatory use. Investments in securities markets are subject to market risks.
          Please consult a SEBI-registered investment adviser before investing.
        </p>
      </div>
    </div>
  )
}
