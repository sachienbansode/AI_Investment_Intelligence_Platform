import { useEffect, useMemo, useRef, useState } from 'react'
import { api, setSession } from '../api.js'

// Public marketing landing + auth. Matches approved mockup (v5). Shows today's top
// NIYTRI-scored stock LIVE (score + delayed price chart + key stats) and an animated
// NSE/BSE indices ticker — all without login. The logged-in app is unchanged.

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
)

const FEATURES = [
  ['k1', 'AI Assistant', 'Chat with an analyst that never sleeps. Ask about any stock, your portfolio, the market or a score — grounded in live data and answered in plain English or your language.',
    <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />],
  ['k2', 'Explainable NIYTRI Score', 'Every NSE stock rated 0–100 daily across 8 factors — fundamentals, technicals, valuation, momentum, earnings, sentiment, institutions and risk — each with a clear reason, never a black box.',
    <><path d="M4 20a8 8 0 1 1 16 0" /><path d="M12 20V9" /><path d="M12 9l4.5 3.3" /></>],
  ['k3', 'Smart Alerts', 'Follow the stocks you care about and get notified the moment one crosses into Strong, slips to Weak, or moves sharply — with a one-line explanation of what drove the change.',
    <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>],
  ['k4', 'Portfolio X-Ray', 'Upload your holdings and instantly see a health score, concentration and sector risk, and estimated P&L — understand what you actually own, not just what you bought.',
    <path d="M21 12a9 9 0 1 1-9-9v9z" />],
  ['k6', 'Market News AI', "The day's market news, summarised and sentiment-tagged, and automatically linked to the stocks and sectors each headline actually moves.",
    <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h8M7 12h8M7 16h5" /></>],
]
const STEPS = [
  ['Create Your Account', "Sign up in seconds with Google or email — or redeem a friend's invite code to skip the queue."],
  ['Follow Your Stocks', 'Add the stocks you care about to a watchlist, or upload your whole portfolio in one tap.'],
  ['Ask & Act', 'Let the AI explain any score, headline or risk in plain language — and ping you the moment things change.'],
]

function demoSpotlight() {
  let seed = 42
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  const hist = [], pts = []
  let v = 66, price = 1180
  const today = new Date()
  for (let i = 29; i >= 0; i--) {
    v = Math.max(40, Math.min(88, v + (rnd() - 0.45) * 3))
    price += (rnd() - 0.46) * 22
    const dt = new Date(today); dt.setDate(today.getDate() - i)
    hist.push({ date: dt.toISOString().slice(0, 10), score: Math.round(v * 10) / 10 })
    pts.push({ t: Math.floor(dt.getTime() / 1000), c: Math.round(price) })
  }
  hist[hist.length - 1].score = 72
  return { available: true, demo: true, symbol: 'RELIANCE', name: 'Reliance Industries Ltd',
    score: 72, last_price: pts[pts.length - 1].c, change_pct: 0.42, history: hist,
    pe: 24.6, market_cap: 176500000000000, week52_high: 1370, week52_low: 1114,
    explanation: 'Leads on value and price trend with steady institutional interest; earnings momentum is neutral and near-term volatility stays moderate. A balanced, broadly constructive profile across the eight pillars.',
    pillars: { value: 78, price_trend: 74, institutions: 70, fundamentals: 66, momentum: 61, sentiment: 58, earnings: 54, risk: 52 },
    price_history: { points: pts, prev_close: pts[0].c, last: pts[pts.length - 1].c, delayed: true, source: 'sample' } }
}

const fmtDate = (s) => { try { return new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) } catch { return String(s) } }
function pwError(pw) {
  pw = pw || ''
  if (pw.length < 8) return 'Password must be at least 8 characters.'
  if (!/[A-Za-z]/.test(pw)) return 'Password must include a letter.'
  if (!/\d/.test(pw)) return 'Password must include a number.'
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include a special character (e.g. ! @ # $ %).'
  return null
}
const PW_RULES = [
  ['8+ characters', p => (p || '').length >= 8],
  ['A letter', p => /[A-Za-z]/.test(p || '')],
  ['A number', p => /\d/.test(p || '')],
  ['A special character', p => /[^A-Za-z0-9]/.test(p || '')],
]
const bandCol = (sc) => sc >= 65 ? '#12b981' : sc >= 45 ? '#d4920f' : '#e05252'
const fmtCr = (v) => v == null ? '—' : (Number(v) >= 1e7 ? (Number(v) / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' Cr' : Number(v).toLocaleString('en-IN'))
const fmtNum = (v, d = 2) => v == null ? '—' : Number(v).toLocaleString('en-IN', { maximumFractionDigits: d })

// Interactive line chart — full-bleed, gridlines, gradient fill, glow, animated
// draw + hover crosshair. Works for score or price.
function HoverChart({ series, prefix = '', round = 0 }) {
  const [hi, setHi] = useState(null)
  const W = 760, H = 230, padT = 20, padB = 30, padL = 12, padR = 46
  const g = useMemo(() => {
    const vals = series.map(s => s.value)
    const n = vals.length
    const mn = Math.min(...vals), mx = Math.max(...vals)
    const pad = (mx - mn) * 0.14 || 1
    const lo = mn - pad, hiV = mx + pad, rng = (hiV - lo) || 1
    const X = i => padL + (W - padL - padR) * (i / Math.max(1, n - 1))
    const Y = v => padT + (H - padT - padB) * (1 - (v - lo) / rng)
    const up = vals[n - 1] >= vals[0]
    let d = 'M' + X(0).toFixed(1) + ',' + Y(vals[0]).toFixed(1)
    for (let i = 1; i < n; i++) { const cx = (X(i - 1) + X(i)) / 2; d += ' Q' + X(i - 1).toFixed(1) + ',' + Y(vals[i - 1]).toFixed(1) + ' ' + cx.toFixed(1) + ',' + ((Y(vals[i - 1]) + Y(vals[i])) / 2).toFixed(1) }
    d += ' T' + X(n - 1).toFixed(1) + ',' + Y(vals[n - 1]).toFixed(1)
    const iMax = vals.indexOf(mx), iMin = vals.indexOf(mn)
    return { vals, n, mn, mx, lo, hiV, X, Y, up, d, iMax, iMin }
  }, [series])
  const col = g.up ? '#FF6A00' : '#e0503f'
  const gy = [0.12, 0.35, 0.58, 0.81].map(f => padT + (H - padT - padB) * f)
  const lbl = v => prefix + Number(v).toLocaleString('en-IN', { maximumFractionDigits: round })
  function move(e) { const r = e.currentTarget.getBoundingClientRect(); const frac = (e.clientX - r.left) / r.width; setHi(Math.max(0, Math.min(g.n - 1, Math.round(frac * (g.n - 1))))) }
  const cur = hi != null ? series[hi] : null
  return (
    <div className="lp-chartbox">
      <svg viewBox={'0 0 ' + W + ' ' + H} width="100%" style={{ display: 'block', height: 'auto' }} preserveAspectRatio="xMidYMid meet" onMouseMove={move} onMouseLeave={() => setHi(null)}>
        <defs>
          <linearGradient id="lpfl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={col} stopOpacity=".28" /><stop offset="1" stopColor={col} stopOpacity="0" /></linearGradient>
          <linearGradient id="lpln" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#FF8A3D" /><stop offset="1" stopColor={col} /></linearGradient>
          <filter id="lpglow" x="-20%" y="-40%" width="140%" height="180%"><feDropShadow dx="0" dy="3" stdDeviation="4" floodColor={col} floodOpacity="0.28" /></filter>
        </defs>
        {gy.map((y, i) => <line key={i} x1={padL} y1={y.toFixed(1)} x2={W - padR} y2={y.toFixed(1)} stroke="#f2e6db" strokeWidth="1" />)}
        <path d={g.d + ' L' + (W - padR) + ',' + (H - padB) + ' L' + padL + ',' + (H - padB) + ' Z'} fill="url(#lpfl)" />
        <path className="lp-cline" d={g.d} fill="none" stroke="url(#lpln)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" filter="url(#lpglow)" />
        {[g.mx, (g.mx + g.mn) / 2, g.mn].map((val, i) => (<text key={i} x={W - padR + 8} y={(g.Y(val) + 4).toFixed(1)} fill="#9aa3b2" fontSize="11">{lbl(val)}</text>))}
        {[0, Math.floor((g.n - 1) / 2), g.n - 1].map((i, k) => (<text key={k} x={g.X(i).toFixed(1)} y={H - 8} fill="#9aa3b2" fontSize="11" textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}>{series[i].label}</text>))}
        <circle cx={g.X(g.n - 1).toFixed(1)} cy={g.Y(g.vals[g.n - 1]).toFixed(1)} r="4.5" fill={col} stroke="#fff" strokeWidth="2" />
        {cur && <>
          <line x1={g.X(hi).toFixed(1)} y1={padT} x2={g.X(hi).toFixed(1)} y2={H - padB} stroke="#d9c4b0" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx={g.X(hi).toFixed(1)} cy={g.Y(cur.value).toFixed(1)} r="5" fill="#fff" stroke={col} strokeWidth="2.5" />
        </>}
      </svg>
      {cur && <div className="lp-tip" style={{ left: (g.X(hi) / W * 100) + '%' }}><b>{lbl(cur.value)}</b> <span>{cur.label}</span></div>}
      <div className="lp-chart-meta"><span>Low <b>{lbl(g.mn)}</b></span><span>High <b>{lbl(g.mx)}</b></span><span>Hover for any day</span></div>
    </div>
  )
}

function TickerRow({ items, reverse }) {
  if (!items.length) return null
  // Repeat short rows so a single sequence is wide enough (no gaps), then render
  // it twice for a seamless translateX(-50%) loop. Duration ∝ item count → every
  // row scrolls at the SAME pixel speed regardless of how many indices it has.
  let seq = items
  while (seq.length < 8) seq = seq.concat(items)
  const dur = seq.length * 4
  return (
    <div className="lp-ticker">
      <div className={'lp-track' + (reverse ? ' rev' : '')} style={{ animationDuration: dur + 's' }}>
        {[...seq, ...seq].map((i, idx) => (
          <span className="lp-tk" key={idx} aria-hidden={idx >= seq.length}>
            <span className="ex">{i.exch}</span>
            <b>{i.index.replace(' (BSE)', '')}</b>
            <span className="val">{i.last?.toLocaleString('en-IN')}</span>
            <em className={i.pct_change >= 0 ? 'up' : 'dn'}>{(i.pct_change >= 0 ? String.fromCharCode(0x25B2) : String.fromCharCode(0x25BC))} {Math.abs(i.pct_change)}%</em>
          </span>
        ))}
      </div>
    </div>
  )
}

function fmtBold(text) {
  return text.split('**').map((p, i) => i % 2 ? <b key={i}>{p}</b> : <span key={i}>{p}</span>)
}
function analysisBullets(text) {
  if (!text) return []
  return text.split(/\s*[-•]\s+/).map(s => s.trim()).filter(Boolean)
    .filter(s => !/not investment advice|ai-generated|informational only/i.test(s))
}

function ScoreAnalysis({ explanation, pillars }) {
  const rows = Object.entries(pillars || {}).sort((a, b) => b[1] - a[1]).slice(0, 4)
  const bullets = analysisBullets(explanation)
  if (!bullets.length && !rows.length) return null
  const lbl = v => v >= 65 ? 'Strong' : v >= 45 ? 'Moderate' : 'Weak'
  const cls = v => v >= 65 ? 'g' : v >= 45 ? 'a' : 'r'
  return (
    <div className="lp-analysis">
      <div className="lp-an-top">
        <div className="lp-an-h">Score Analysis</div>
        <span className="lp-pro">{String.fromCharCode(0x2605)} Pro</span>
      </div>
      {bullets.length > 1
        ? <ul className="lp-an-list">{bullets.map((b, i) => <li key={i}>{fmtBold(b)}</li>)}</ul>
        : bullets.length === 1 && <p className="lp-an-p">{fmtBold(bullets[0])}</p>}
      {rows.length > 0 && (
        <div className="lp-pills">
          {rows.map(([k, v]) => (
            <div className="lp-pillrow" key={k}>
              <span>{k.replace(/_/g, ' ')}</span>
              <div className="lp-pbar"><i style={{ width: Math.max(3, Math.min(100, v)) + '%', background: 'linear-gradient(90deg,#FF8A3D,#F94C00)' }} /></div>
              <b>{Math.round(v)}</b>
              <em className={'lp-pl ' + cls(v)}>{lbl(v)}</em>
            </div>
          ))}
        </div>
      )}
      <div className="lp-pro-note">{String.fromCharCode(0x1F513)} This full 8-pillar breakdown with daily AI rationale is part of your <b>Pro workspace</b> — sign in to unlock live scores, alerts and your portfolio.</div>
    </div>
  )
}

const ABOUT_CATS = [
  { name: 'Conversational AI', features: [
    { icon: '◉', title: 'NIYTRI Data Lense', desc: "Lets the assistant read the platform's live database on demand to answer questions the standard context doesn't cover — strictly read-only, bounded queries over scores, instruments, news and only your own watchlist and portfolio. Accounts, admin config and the confidential scoring methodology are never accessible." },
    { icon: '✦', title: 'AI Assistant', desc: "Conversational intelligence grounded in live quotes, the platform's scores and market news. Multilingual, with per-user chat history and smart follow-up suggestions after every reply." },
    { icon: '⇄', title: 'Stock Comparison', desc: "Side-by-side comparison of any two NSE scripts — or a random same-sector pair — with live metrics and an advice-free AI summary." },
  ] },
  { name: 'Answer Quality & Trust', features: [
    { icon: '✓', title: 'Exact, Verified Answers', desc: "Quantitative questions — sector averages, counts, thresholds, top/bottom rankings and totals — are computed deterministically in code, so figures are exact and consistent." },
    { icon: '⚑', title: 'Answer Feedback Loop', desc: "Every answer can be rated helpful or not, feeding an Admin quality dashboard so whole categories of answers improve over time." },
    { icon: '◷', title: 'Grounded Confidence & Sources', desc: "Each answer shows a confidence level and the exact sources that grounded it, derived from the evidence actually used." },
    { icon: '◎', title: 'Independent AI Checker', desc: "A second LLM (a different provider, when available) reviews each score rationale for compliance and factual consistency before publishing." },
    { icon: '❏', title: 'Broker-Research RAG', desc: "Upload the firm's research notes (PDF/text); the assistant retrieves and cites the most relevant passages as reference material, not advice." },
  ] },
  { name: 'Scoring & Analytics', features: [
    { icon: '▤', title: 'Agentic Stock Scoring', desc: "A daily multi-agent pipeline scores every script 0-100 using a proprietary blend of fundamentals, technicals, valuation, momentum, earnings, news sentiment, institutional activity and risk." },
    { icon: '↺', title: 'On-demand Rescore', desc: "Refresh any script's score with a live quote anytime — day-over-day change, the pillars that drove the move and an AI-written rationale." },
    { icon: '≣', title: 'Deep Fundamentals', desc: "Each score carries P/E, market cap, EPS, P/B, dividend yield, ROE, 52-week range and volume, pulled daily with fallback for near-complete coverage." },
    { icon: '▦', title: 'Sector Strength & Stats', desc: "A sector heatmap plus exact per-sector aggregates that power accurate sector comparisons in the assistant." },
  ] },
  { name: 'Data & Markets', features: [
    { icon: '◈', title: 'Market News Intelligence', desc: "Continuous collection from leading Indian financial sources, AI-summarised and tagged with impacted stocks, sectors and sentiment, linked to the original article." },
    { icon: '◴', title: 'Live Market Data', desc: "Broker, NSE and Yahoo feeds with automatic fallback so quotes and indices keep working everywhere — including cloud servers where some sources are blocked." },
    { icon: '⊕', title: 'Global Markets', desc: "Optional global indices (S&P 500, Nasdaq, Dow, FTSE, Nikkei, Hang Seng) and global news shown alongside Indian markets." },
    { icon: '◆', title: 'Dashboard & Index Filters', desc: "KPIs, score trends with avg/min/max labels, top movers and an index filter (Nifty 50, Nifty 500 and sectors)." },
  ] },
  { name: 'Portfolio & Watchlist', features: [
    { icon: '◐', title: 'Portfolio Intelligence', desc: "Health score with a transparent deduction breakdown, diversification and concentration metrics (HHI), sector exposure, factual AI insights and a downloadable PDF report." },
    { icon: '☆', title: 'Personal Watchlist', desc: "Follow any script with live price, day change and its latest score in one view." },
    { icon: '⚑', title: 'Score-Crossing Alerts', desc: "Proactive in-app alerts when a watchlist/portfolio script crosses a score band or moves sharply — each with a plain-language explanation of the drivers. Per-user preferences included. Informational only, not advice." },
  ] },
  { name: 'Governance & Compliance', features: [
    { icon: '⛨', title: 'Maker-Checker Governance', desc: "Every score passes an automated Quality Agent gate plus an optional strict mode that holds scores as pending until a human admin approves them — every decision attributed and audit-logged." },
    { icon: '⚖', title: 'SEBI-Compliant Guardrails', desc: "No buy/sell/hold calls, no price targets and no personalised advice; the scoring methodology stays confidential and every AI output is flagged as informational and reviewable." },
    { icon: '≡', title: 'Audit Logging', desc: "Every AI call, score decision and admin action is attributed and audit-logged for governance and review." },
  ] },
  { name: 'Platform & Engine', features: [
    { icon: '⬡', title: 'Multi-LLM Engine', desc: "Anthropic Claude, OpenAI GPT and Google Gemini behind one router with automatic failover and key-based auto-switch — no single-vendor dependency." },
    { icon: '⚡', title: 'Prompt Caching', desc: "Optional caching of the assistant's system prompt to cut latency and repeated input-token cost — toggled from Admin." },
    { icon: '⚒', title: 'Fully DB-Configurable', desc: "Instruments master with one-click NIFTY500 import, editable scoring weights, scheduler times, chatbot persona, display names and branding — all from Admin." },
    { icon: '◉', title: 'User Profiles & Preferences', desc: "Each user has a self-service profile — update name and photo, change password and manage personal alert preferences — all in one place." },
    { icon: '▣', title: 'Mobile Apps', desc: "The same experience packaged as native iOS and Android apps with a mobile-first UI and a compact assistant." },
    { icon: '⇲', title: 'Open Partner API', desc: "A versioned REST API for partners and mobile apps — scores, instruments, news, the assistant and stateless portfolio analysis, secured with per-partner keys, scopes and rate limits." },
  ] },
]

function AboutView({ brand, onStart }) {
  return (
    <div>
      <section className="lp-sec" style={{ paddingTop: 34, paddingBottom: 12 }}>
        <span className="lp-ribbon">{String.fromCharCode(0x2726)} About</span>
        <h1 className="lp-about-h1">Meet <span className="lp-grad">{brand}</span></h1>
        <p className="lp-about-lead">Explainable, agentic AI for Indian markets — combining large language models,
          live market data and transparent governance to deliver conversational insight, daily stock scoring and
          portfolio analytics. Information and analytics, never buy/sell advice. Built for SEBI-regulated broking.</p>
        <div style={{ marginTop: 20 }}><button className="lp-btn lp-btn-grad lg" onClick={onStart}>Grab Your Seat</button></div>
      </section>
      {ABOUT_CATS.map(cat => (
        <section className="lp-sec" style={{ paddingTop: 4, paddingBottom: 6 }} key={cat.name}>
          <div className="lp-cat">{cat.name}</div>
          <div className="lp-cards">
            {cat.features.map(f => (
              <div className="lp-card lp-card-c" key={f.title}>
                <div className="lp-card-head"><span className="lp-ic-sm">{f.icon}</span><h3>{f.title}</h3></div>
                <p>{f.desc}</p>
              </div>
            ))}
          </div>
        </section>
      ))}
      <section className="lp-sec" style={{ paddingTop: 10 }}>
        <div className="lp-about-important">
          <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>Important information</h3>
          <p style={{ margin: 0, color: '#7a4a1e', fontSize: 13.5, lineHeight: 1.65 }}>All AI outputs in this application
            — scores, insights, summaries and chat responses — are generated by artificial intelligence for informational
            purposes only. They are not investment advice, research reports, or recommendations to buy or sell securities,
            and must be reviewed and approved before business or regulatory use. Investments in securities markets are
            subject to market risks. Please consult a SEBI-registered investment adviser before investing.</p>
        </div>
      </section>
    </div>
  )
}


function TermsView({ brand, onBack }) {
  const [t, setT] = useState(null)
  useEffect(() => { api.publicTerms().then(setT).catch(() => setT({ html: '' })) }, [])
  return (
    <div>
      <section className="lp-sec" style={{ paddingTop: 34 }}>
        <span className="lp-ribbon">Terms &amp; Conditions {t?.version ? '· v' + t.version : ''}</span>
        <h1 className="lp-about-h1">{brand} <span className="lp-grad">Terms</span></h1>
        {t ? <div className="lp-terms-html" dangerouslySetInnerHTML={{ __html: t.html }} />
          : <p className="lp-about-lead">Loading…</p>}
        {t?.support_email && <p className="lp-about-lead" style={{ fontSize: 14, marginTop: 12 }}>Questions? Contact <a className="lp-grad" href={'mailto:' + t.support_email}>{t.support_email}</a>.</p>}
        <div style={{ marginTop: 24 }}><button className="lp-btn lp-btn-login" onClick={onBack}>← Back</button></div>
      </section>
    </div>
  )
}

export default function Landing({ onLogin }) {
  const [info, setInfo] = useState(null)
  const [spot, setSpot] = useState(null)
  const [indices, setIndices] = useState([])
  const [pvTab, setPvTab] = useState('score')
  const [view, setView] = useState('signin')
  const [full_name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [invite, setInvite] = useState('')
  const [invitedEmail, setInvitedEmail] = useState('')
  const [lockedInvite, setLockedInvite] = useState(false)
  const [agree, setAgree] = useState(false)
  const agreeRef = useRef(false)
  useEffect(() => { agreeRef.current = agree }, [agree])
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null)
  const [forgot, setForgot] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [page, setPage] = useState('home')   // home | about
  const gbtn = useRef(null)

  useEffect(() => {
    if (!document.getElementById('lp-inter-font')) {
      const l = document.createElement('link'); l.id = 'lp-inter-font'; l.rel = 'stylesheet'
      l.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap'
      document.head.appendChild(l)
    }
  }, [])
  useEffect(() => { api.registrationInfo().then(setInfo).catch(() => setInfo({ mode: 'invite_only' })) }, [])
  useEffect(() => {
    api.publicSpotlight().then(d => setSpot(d && d.available && (d.history || []).length >= 2 ? d : demoSpotlight())).catch(() => setSpot(demoSpotlight()))
    api.indices().then(d => setIndices(d.indices || [])).catch(() => {})
  }, [])

  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const token = p.get('verify')
    if (!token) {
      const inv = p.get('invite')
      if (inv) {
        setInvite(inv); setLockedInvite(true); setView('signup'); setModalOpen(true)   // open sign-up prefilled
        api.inviteInfo(inv).then(r => {
          if (r && r.email) { setEmail(r.email); setInvitedEmail(r.email) }
          if (r && !r.valid) setErr(r.expired ? 'This invite link has expired — please ask for a new one.'
            : (r.used ? 'This invite link has already been used.' : 'This invite link is not valid.'))
        }).catch(() => {})
      }
      return
    }
    api.verifyEmail(token).then(r => { setSession(r); onLogin(r.user) })
      .catch(() => { setErr('This verification link is invalid or has already been used.'); setView('signin') })
      .finally(() => window.history.replaceState({}, '', window.location.pathname))
  }, [])

  const inviteRef = useRef('')
  useEffect(() => { inviteRef.current = invite }, [invite])
  const [gReady, setGReady] = useState(false)

  // Load + initialise Google Identity Services once the server enables it.
  useEffect(() => {
    if (!info || !info.google_enabled || !info.google_client_id) return
    function init() {
      if (!window.google || !window.google.accounts || !window.google.accounts.id) return false
      window.google.accounts.id.initialize({
        client_id: info.google_client_id,
        callback: async (resp) => {
          if (view === 'signup' && !agreeRef.current) { setErr('Please accept the Terms & Conditions to continue.'); return }
          setBusy(true); setErr('')
          try { const r = await api.googleAuth(resp.credential, inviteRef.current.trim() || null, view === 'signup' ? true : agreeRef.current); setSession(r); onLogin(r.user) }
          catch (ex) { setErr(ex.message) } finally { setBusy(false) }
        },
      })
      setGReady(true); return true
    }
    if (init()) return
    const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true; s.onload = init; document.head.appendChild(s)
  }, [info])

  // (Re)render the official Google button whenever it's ready and the container is shown.
  useEffect(() => {
    if (!gReady || !gbtn.current || !window.google) return
    gbtn.current.innerHTML = ''
    window.google.accounts.id.renderButton(gbtn.current, { theme: 'outline', size: 'large', shape: 'pill', width: 330, text: 'continue_with' })
  }, [gReady, view, pending, modalOpen])

  const mode = info ? info.mode : 'invite_only'
  const brand = (info && info.platform_label) || 'NIYTRI Investment Intelligence'
  const inviteRequired = mode === 'invite_only'
  const closed = mode === 'closed'
  const googleOn = info && info.google_enabled
  const waitlistOn = closed || (info && info.waitlist_enabled)

  async function doLogin(e) { e.preventDefault(); setBusy(true); setErr(''); setOk(''); try { const r = await api.login(email, password); setSession(r); onLogin(r.user) } catch (ex) { setErr(ex.message) } finally { setBusy(false) } }
  async function doRegister(e) {
    e.preventDefault(); setErr(''); setOk('')
    if (!full_name.trim()) return setErr('Please enter your full name.')
    const perr = pwError(password)
    if (perr) return setErr(perr)
    if (password !== confirm) return setErr('Passwords do not match.')
    if (inviteRequired && !invite.trim()) return setErr('An invite code is required to join the beta.')
    if (!agree) return setErr('Please accept the Terms & Conditions to create an account.')
    setBusy(true)
    try { const r = await api.register({ email, password, full_name, invite_code: invite.trim() || null, tos_accepted: true }); if (r && r.needs_verification) setPending({ email, delivered: r.delivered, verify_link: r.verify_link, resent: r.resent }); else { setSession(r); onLogin(r.user) } }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  async function doWaitlist(e) {
    e.preventDefault(); setBusy(true); setErr(''); setOk('')
    try { const r = await api.waitlist(email); setOk(r && r.status === 'exists' ? "You're already on the waitlist — currently #" + r.position + " of " + r.total + "." : "You're on the list! You're #" + (r?.position || '?') + " in line — we'll email you when a seat opens.") }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  async function doResend() { setBusy(true); setErr(''); setOk(''); try { await api.resendVerification(pending.email); setOk('Verification email re-sent.') } catch (ex) { setErr(ex.message) } finally { setBusy(false) } }
  async function doForgot(e) {
    e.preventDefault(); setBusy(true); setErr(''); setOk('')
    if (!email.trim()) { setErr('Enter your email first.'); setBusy(false); return }
    try {
      const r = await api.forgotPassword(email)
      setOk(r && r.temp_password
        ? 'Email delivery isn’t set up yet. Your temporary password is: ' + r.temp_password
        : 'If an account exists for that email, a new password has been sent to it.')
      setForgot(false)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  function goAuth(v) { setView(v); setForgot(false); setErr(''); setOk(''); setModalOpen(true) }
  function closeModal() { setModalOpen(false) }

  const sval = spot ? (Number(spot.score) || 0) : 0
  const scoreLbl = v => { const n = Math.round((Number(v) || 0) * 10) / 10; return Number.isInteger(n) ? String(n) : n.toFixed(1) }
  const sc = scoreLbl(sval)
  const scoreSeries = spot ? spot.history.map(h => ({ label: fmtDate(h.date), value: h.score })) : []
  const pricePts = spot && spot.price_history ? (spot.price_history.points || []) : []
  const priceSeries = pricePts.map(p => ({ label: fmtDate(new Date(p.t * 1000)), value: p.c }))
  const hasPrice = priceSeries.length >= 2

  const mapped = useMemo(() => indices.map(i => ({ ...i, exch: i.index.includes('(BSE)') ? 'BSE' : i.index.includes('(GL)') ? 'GL' : 'NSE' })), [indices])
  const nse = mapped.filter(i => i.exch === 'NSE')
  const bse = mapped.filter(i => i.exch === 'BSE')

  const authPanel = (
    <div className="lp-auth">
              {pending ? (
                <div className="lp-verify">
                  <div className="lp-verify-ic">{String.fromCharCode(0x2709)}</div>
                  <h3>{pending.resent ? 'Check your inbox again' : 'Confirm your email'}</h3>
                  <p className="lp-vtext">We sent a verification link to <b>{pending.email}</b>. Click it to activate your account and log in.</p>
                  {!pending.delivered && pending.verify_link && (<p className="lp-invite">Email delivery isn't set up yet. <a className="lp-grad" href={pending.verify_link}>Click here to verify →</a></p>)}
                  {!pending.delivered && !pending.verify_link && (<p className="lp-invite">We couldn't send the email right now — try resend or contact support.</p>)}
                  <button className="lp-btn lp-btn-grad lp-full" disabled={busy} onClick={doResend}>{busy ? 'Please wait…' : 'Resend Email'}</button>
                  <p className="lp-invite"><a className="lp-grad" onClick={() => { setPending(null); setView('signin') }}>← Back to log in</a></p>
                  {err && <p className="lp-err">{err}</p>}{ok && <p className="lp-ok">{ok}</p>}
                </div>
              ) : (
                <>
                  <div className="lp-tabs">
                    <button className={view === 'signin' ? 'on' : ''} onClick={() => setView('signin')}>Log In</button>
                    {!closed && <button className={view === 'signup' ? 'on' : ''} onClick={() => setView('signup')}>Sign Up</button>}
                    {waitlistOn && <button className={view === 'waitlist' ? 'on' : ''} onClick={() => setView('waitlist')}>Waitlist</button>}
                  </div>
                  {googleOn && view !== 'waitlist' && (<><div className="lp-google" ref={gbtn} /><div className="lp-or">— or —</div></>)}
                  {view === 'signin' && !forgot && (
                    <form onSubmit={doLogin}>
                      <input className="lp-field" type="email" placeholder="name@email.com" value={email} required onChange={e => setEmail(e.target.value)} />
                      <input className="lp-field" type="password" placeholder="Password" value={password} required onChange={e => setPassword(e.target.value)} />
                      <button className="lp-btn lp-btn-grad lp-full" disabled={busy}>{busy ? 'Please wait…' : 'Log In'}</button>
                      <div className="lp-forgot"><a onClick={() => { setForgot(true); setErr(''); setOk('') }}>Forgot password?</a></div>
                    </form>
                  )}
                  {view === 'signin' && forgot && (
                    <form onSubmit={doForgot}>
                      <p className="lp-vtext">Enter your email and we'll send a new password to it.</p>
                      <input className="lp-field" type="email" placeholder="name@email.com" value={email} required onChange={e => setEmail(e.target.value)} />
                      <button className="lp-btn lp-btn-grad lp-full" disabled={busy}>{busy ? 'Please wait…' : 'Send New Password'}</button>
                      <div className="lp-forgot"><a onClick={() => { setForgot(false); setErr(''); setOk('') }}>← Back to log in</a></div>
                    </form>
                  )}
                  {view === 'signup' && !closed && (
                    <form onSubmit={doRegister}>
                      <input className="lp-field" placeholder="Full name" value={full_name} required onChange={e => setName(e.target.value)} />
                      <input className="lp-field" type="email" placeholder="name@email.com" value={email} required
                             readOnly={!!invitedEmail} onChange={e => setEmail(e.target.value)}
                             style={invitedEmail ? { background: '#f4f6fb', color: '#6b7280', cursor: 'not-allowed' } : undefined} />
                      {invitedEmail && <div className="lp-invite" style={{ marginTop: -2, textAlign: 'left' }}>Invited as <b>{invitedEmail}</b> — this invite is tied to your email.</div>}
                      <input className="lp-field" type="password" placeholder="Create a password" value={password} required minLength={8} onChange={e => setPassword(e.target.value)} />
                      <input className="lp-field" type="password" placeholder="Confirm password" value={confirm} required onChange={e => setConfirm(e.target.value)} />
                      <ul className="lp-pwrules">
                        {PW_RULES.map(([label, test]) => { const okr = test(password); return <li key={label} className={password ? (okr ? 'ok' : '') : ''}>{okr ? '✓' : '○'} {label}</li> })}
                      </ul>
                      <input className="lp-field" placeholder={inviteRequired ? 'Invite code (required)' : 'Invite code (optional)'} value={invite} required={inviteRequired}
                             readOnly={lockedInvite} onChange={e => setInvite(e.target.value)}
                             style={lockedInvite ? { background: '#f4f6fb', color: '#6b7280', cursor: 'not-allowed' } : undefined} />
                      <label className="lp-agree">
                        <input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />
                        <span>I agree to the <a className="lp-grad" onClick={() => { setModalOpen(false); setPage('terms'); window.scrollTo({ top: 0 }) }}>Terms &amp; Conditions</a>.</span>
                      </label>
                      <button className="lp-btn lp-btn-grad lp-full" disabled={busy || !agree}>{busy ? 'Please wait…' : 'Create Account'}</button>
                      {inviteRequired && waitlistOn && <div className="lp-invite">No code? <a className="lp-grad" onClick={() => setView('waitlist')}>Join the waitlist →</a></div>}
                    </form>
                  )}
                  {view === 'waitlist' && (
                    <form onSubmit={doWaitlist}>
                      <p className="lp-vtext">Beta is invite-only right now. Leave your email and we'll reach out when a seat opens.</p>
                      <input className="lp-field" type="email" placeholder="name@email.com" value={email} required onChange={e => setEmail(e.target.value)} />
                      <button className="lp-btn lp-btn-grad lp-full" disabled={busy}>{busy ? 'Please wait…' : 'Join Waitlist'}</button>
                    </form>
                  )}
                  {err && <p className="lp-err">{err}</p>}{ok && <p className="lp-ok">{ok}</p>}
                  <div className="lp-invite">Members invite up to <b style={{ color: '#cfd6ea' }}>5 friends</b>.</div>
                </>
              )}
            </div>
  )

  return (
    <div className="lp">
      <style>{CSS}</style>
      <div className="lp-wrap">
        <nav className="lp-nav">
          <div className="lp-brand" onClick={() => { setPage('home'); window.scrollTo({ top: 0, behavior: 'smooth' }) }} style={{ cursor: 'pointer' }}>
            <span className="lp-grad lp-word">{brand}</span>
          </div>
          <div className="lp-navbtns">
            <button className={'lp-navlink' + (page === 'home' ? ' on' : '')} onClick={() => { setPage('home'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Home</button>
            <button className={'lp-navlink' + (page === 'about' ? ' on' : '')} onClick={() => { setPage('about'); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>About</button>
            <button className="lp-btn lp-btn-login" onClick={() => goAuth('signin')}>Log In</button>
            <button className="lp-btn lp-btn-grad" onClick={() => goAuth(closed ? 'waitlist' : 'signup')}>{closed ? 'Join Waitlist' : 'Get Started'}</button>
          </div>
        </nav>
      </div>

      {(nse.length > 0 || bse.length > 0) && (
        <div className="lp-tickers">
          {nse.length > 0 && <TickerRow items={nse} />}
          {bse.length > 0 && <TickerRow items={bse} reverse />}
        </div>
      )}

      <div className="lp-wrap">
        {page === 'terms' ? <TermsView brand={brand} onBack={() => { setPage('home'); window.scrollTo({ top: 0 }) }} />
          : page === 'about' ? <AboutView brand={brand} onStart={() => goAuth(closed ? 'waitlist' : 'signup')} /> : (<>
        <section className="lp-hero">
          <div className="lp-hero-l">
            <span className="lp-ribbon">{String.fromCharCode(0x2726)} {inviteRequired ? 'Invite-Only Beta — Grab Your Seat' : 'Now In Beta'}</span>
            <h1>Invest Smarter,<br /><span className="lp-grad">Your Way.</span></h1>
            <p>{brand} is your AI investing companion for Indian markets — it scores every NSE stock daily,
              explains the “why” in plain language, watches your portfolio, and answers your questions in
              English or your language.</p>
            <div className="lp-cta-row">
              {googleOn
                ? <button className="lp-btn lp-btn-google" onClick={() => goAuth('signin')}><GoogleG /> Continue With Google</button>
                : <button className="lp-btn lp-btn-login" onClick={() => goAuth('signin')}>Log In</button>}
              <button className="lp-btn lp-btn-grad" onClick={() => goAuth(closed ? 'waitlist' : 'signup')}>{closed ? 'Join Waitlist' : 'Sign Up Free'}</button>
            </div>
            <div className="lp-chips"><span><b>Explainable</b> AI</span><span><b>NSE &amp; BSE</b></span><span><b>Delayed</b> Charts</span><span><b>SEBI</b>-Compliant</span></div>
          </div>

          <div className="lp-preview">
            {!spot ? <div className="lp-pv-load">Loading today's top stock…</div> : (<>
              <div className="lp-pv-badge">Today's Top NIYTRI Score</div>
              <div className="lp-pv-top">
                <div>
                  <div className="lp-nm">{spot.symbol}</div>
                  <div className="lp-pvsub">{spot.name}
                    {spot.last_price != null && <> · {String.fromCharCode(0x20B9)}{Number(spot.last_price).toLocaleString('en-IN')}</>}
                    {spot.change_pct != null && <span className={spot.change_pct >= 0 ? 'lp-up' : 'lp-dn'}> {spot.change_pct >= 0 ? String.fromCharCode(0x25B2) : String.fromCharCode(0x25BC)} {Math.abs(spot.change_pct).toFixed(2)}%</span>}
                  </div>
                </div>
                <div className="lp-score" style={{ background: 'linear-gradient(135deg,' + bandCol(sval) + ',' + bandCol(sval) + 'cc)' }}>{sc}</div>
              </div>

              <div className="lp-pvtabs">
                <button className={pvTab === 'score' ? 'on' : ''} onClick={() => setPvTab('score')}>NIYTRI Score</button>
                <button className={pvTab === 'price' ? 'on' : ''} onClick={() => setPvTab('price')}>Delayed Price</button>
              </div>

              {pvTab === 'score' && (<>
                <HoverChart series={scoreSeries} prefix="" round={0} />
                <ScoreAnalysis explanation={spot.explanation} pillars={spot.pillars} />
              </>)}
              {pvTab === 'price' && (hasPrice
                ? <><HoverChart series={priceSeries} prefix={String.fromCharCode(0x20B9)} round={0} />
                    <div className="lp-stats">
                      <div><span>P/E</span><b>{fmtNum(spot.pe)}</b></div>
                      <div><span>Mkt Cap</span><b>{fmtCr(spot.market_cap)}</b></div>
                      <div><span>52W Range</span><b>{spot.week52_low != null ? String.fromCharCode(0x20B9) + fmtNum(spot.week52_low, 0) + ' – ' + String.fromCharCode(0x20B9) + fmtNum(spot.week52_high, 0) : '—'}</b></div>
                    </div>
                    <div className="lp-bubble"><b>{String.fromCharCode(0x23F1)} ~15-min delayed</b> price for {spot.symbol}, shown beside its AI score.{spot.demo && <span className="lp-demoflag"> Sample preview.</span>}</div></>
                : <div className="lp-pv-load" style={{ height: 160 }}>Delayed price chart unavailable right now.</div>)}
            </>)}
          </div>
        </section>

        <section className="lp-sec">
          <h2>How the <span className="lp-grad">scoring engine</span> works</h2>
          <div className="lp-subh">An 8-stage rule engine, checked by people — every handoff audited.</div>
          <div className="lp-pipe">
            <iframe src="/pipeline.html" title="How the NIYTRI scoring pipeline works" loading="lazy" />
          </div>
        </section>

        <section className="lp-sec">
          <h2>Your Edge, <span className="lp-grad">In One Place</span></h2>
          <div className="lp-subh">A quick look at what you get. Sign in to explore the full platform.</div>
          <div className="lp-cards">
            {FEATURES.map(([k, t, d, icon]) => (
              <div className="lp-card" key={t}><div className={'lp-ic ' + k}><svg viewBox="0 0 24 24">{icon}</svg></div><h3>{t}</h3><p>{d}</p></div>
            ))}
          </div>
        </section>

        <section className="lp-sec">
          <h2>Start In <span className="lp-grad">30 Seconds</span></h2>
          <div className="lp-steps">
            {STEPS.map(([t, d], i) => (<div className="lp-step" key={t}><div className="lp-num">{i + 1}</div><h3>{t}</h3><p>{d}</p></div>))}
          </div>
        </section>

        <section className="lp-sec">
          <div className="lp-join">
            <h2>Ready To <span className="lp-grad">Invest Smarter?</span></h2>
            <p>{inviteRequired ? 'Join the invite-only beta today.' : 'Create your free account today.'}</p>
            {!modalOpen && authPanel}
          </div>
        </section>
        </>)}

        <footer className="lp-foot">© {new Date().getFullYear()} {brand} · <a className="lp-foot-link" onClick={() => { setPage('terms'); window.scrollTo({ top: 0 }) }}>Terms &amp; Conditions</a> · Informational analytics, not investment advice · Prices delayed · Markets carry risk.</footer>
      </div>
      {modalOpen && (
        <div className="lp-modal" onMouseDown={e => { if (e.target === e.currentTarget) closeModal() }}>
          <div className="lp-modal-card">
            <button className="lp-modal-x" onClick={closeModal} aria-label="Close">{String.fromCharCode(0x2715)}</button>
            {authPanel}
          </div>
        </div>
      )}
    </div>
  )
}

const CSS = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');" + `
.lp{--bg:#ffffff;--soft:#fff7f0;--card:#ffffff;--line:#f0e6dc;--line2:#ecdfd2;--ink:#181d27;--mut:#6b7280;--faint:#9aa3b2;
  --or1:#FF8A3D;--or2:#FF6A00;--or3:#F94C00;--grad:linear-gradient(90deg,#FF8A3D,#FF6A00 55%,#F94C00);
  position:fixed;inset:0;overflow-y:auto;z-index:50;color:var(--ink);line-height:1.58;font-size:14px;
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;
  background:radial-gradient(900px 520px at 12% -8%,rgba(255,138,61,.12),transparent 60%),
             radial-gradient(820px 480px at 92% 4%,rgba(249,76,0,.08),transparent 60%),var(--bg)}
.lp *{box-sizing:border-box}
.lp-wrap{max-width:1560px;margin:0 auto;padding:0 40px}
.lp-grad{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.lp-nav{display:flex;align-items:center;justify-content:space-between;padding:20px 0}
.lp-brand{display:flex;align-items:center;gap:10px}
.lp-brand img{width:38px;height:38px;display:block}
.lp-word{font-weight:800;font-size:20px;letter-spacing:1.4px}
.lp-navbtns{display:flex;gap:11px;align-items:center}
.lp-navlink{background:none;border:none;color:#5b6473;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;padding:8px 6px}
.lp-navlink:hover{color:var(--or3)}
.lp-navlink.on{color:var(--or3)}
.lp-about-h1{font-size:clamp(32px,4.4vw,48px);font-weight:900;letter-spacing:-1px;margin:14px 0 12px}
.lp-about-lead{color:var(--mut);font-size:17px;line-height:1.7;max-width:760px}
.lp-about-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}
.lp-about-item{display:flex;gap:12px;align-items:flex-start;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px}
.lp-about-num{flex:0 0 auto;width:30px;height:30px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;background:var(--grad)}
.lp-about-item b{font-size:15px}.lp-about-d{color:var(--mut);font-size:13.5px;line-height:1.5;margin-top:3px}
.lp-about-disc{color:#8a93a4;font-size:12.5px;line-height:1.6;margin-top:24px;max-width:820px}
.lp-cat{font-size:13px;font-weight:800;text-transform:uppercase;letter-spacing:.6px;color:#b25a12;border-left:3px solid #F94C00;padding-left:10px;margin:6px 0 14px}
.lp-ic{font-size:20px}
.lp-about-important{background:#fff7f0;border:1px solid #ffe0c7;border-radius:14px;padding:18px}
.lp-card-c{padding:16px}
.lp-card-head{display:flex;align-items:center;gap:10px;margin-bottom:6px}
.lp-card-head h3{margin:0;font-size:15px}
.lp-ic-sm{width:32px;height:32px;flex:0 0 auto;border-radius:9px;background:rgba(255,106,0,.10);color:#F94C00;display:flex;align-items:center;justify-content:center;font-size:16px}
.lp-card-c p{font-size:13px;line-height:1.5}
.lp-terms-html{max-width:860px;color:var(--mut);font-size:14.5px;line-height:1.7}
.lp-terms-html h2{font-size:20px;color:var(--ink);margin:0 0 10px}
.lp-terms-html h3{font-size:16px;color:var(--ink);margin:18px 0 6px}
.lp-terms-html p{margin:0 0 10px}
.lp-terms-html b{color:var(--ink)}
.lp-agree{display:flex;gap:9px;align-items:flex-start;text-align:left;margin:6px 2px 2px;font-size:13px;color:var(--mut)}
.lp-agree input{margin-top:2px;flex:0 0 auto;width:16px;height:16px;accent-color:#F94C00}
.lp-agree a{cursor:pointer;font-weight:600}
.lp-foot-link{color:var(--or3);cursor:pointer;text-decoration:none;font-weight:600}
@media(max-width:700px){.lp-about-grid{grid-template-columns:1fr}}
.lp-btn{border:none;border-radius:12px;padding:11px 18px;font-weight:600;font-size:14px;cursor:pointer;font-family:inherit;transition:.15s;white-space:nowrap}
.lp-btn-grad{background:var(--grad);color:#fff;font-weight:700;box-shadow:0 10px 26px rgba(255,106,0,.28)}
.lp-btn-grad:hover{filter:brightness(1.05)}
.lp-btn.lg{padding:14px 32px;font-size:16px}
.lp-btn-google{background:#fff;color:#20242e;border:1px solid var(--line2);display:inline-flex;gap:11px;align-items:center;justify-content:center;font-weight:600}
.lp-btn-login{background:#fff;border:1px solid var(--line2);color:#2a3140;padding:10px 16px}
.lp-btn-login:hover{border-color:var(--or2);color:var(--or3)}
.lp-full{width:100%;margin-top:6px}
.lp-tickers{border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
.lp-ticker{overflow:hidden;background:var(--soft)}
.lp-tickers .lp-ticker + .lp-ticker{border-top:1px solid var(--line)}
.lp-track{display:inline-flex;padding:8px 0;white-space:nowrap;animation-name:lpmarq;animation-timing-function:linear;animation-iteration-count:infinite;will-change:transform}
.lp-track.rev{animation-direction:reverse}
@keyframes lpmarq{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.lp-tk{display:inline-flex;gap:7px;align-items:center;font-size:12px;margin-right:34px}
.lp-tk .ex{font-size:10px;font-weight:700;color:#fff;background:var(--or2);border-radius:5px;padding:1px 6px}
.lp-tk b{color:#181d27;font-weight:700}.lp-tk .val{color:var(--mut);font-variant-numeric:tabular-nums}
.lp-tk .up{color:#12a06b;font-style:normal}.lp-tk .dn{color:#e0503f;font-style:normal}
.lp-hero{display:grid;grid-template-columns:1.05fr .95fr;gap:44px;align-items:start;padding:30px 0 24px}
.lp-hero-l{padding-top:8px}
.lp-ribbon{display:inline-flex;gap:8px;align-items:center;background:rgba(255,106,0,.10);border:1px solid rgba(255,106,0,.28);color:#c24a00;border-radius:999px;padding:6px 13px;font-size:12px;font-weight:600;margin-bottom:18px}
.lp-hero h1{font-size:clamp(34px,4.6vw,50px);line-height:1.05;font-weight:900;letter-spacing:-1.2px}
.lp-hero p{color:var(--mut);font-size:15.5px;margin:16px 0 22px;max-width:520px}
.lp-cta-row{display:flex;gap:13px;flex-wrap:wrap}
.lp-chips{margin-top:20px;display:flex;gap:18px;flex-wrap:wrap;color:#8a93a4;font-size:13px}.lp-chips b{color:#3a4150;font-weight:600}
.lp-preview{position:relative;background:#fff;border:1px solid var(--line);border-radius:22px;padding:18px;box-shadow:0 30px 70px rgba(24,29,39,.10)}
.lp-pv-load{height:300px;display:flex;align-items:center;justify-content:center;color:var(--mut)}
.lp-pv-badge{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.4px;text-transform:uppercase;color:#0f8f5f;background:rgba(18,160,107,.10);border:1px solid rgba(18,160,107,.25);border-radius:999px;padding:4px 11px;margin-bottom:14px}
.lp-pv-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}
.lp-pv-top>div:first-child{flex:1;min-width:0}
.lp-nm{font-weight:800;font-size:18px}.lp-pvsub{color:var(--mut);font-size:13px}.lp-up{color:#12a06b;font-weight:600}.lp-dn{color:#e0503f;font-weight:600}
.lp-score{color:#fff;font-weight:800;border-radius:12px;padding:8px 14px;font-size:20px;flex:0 0 auto;white-space:nowrap}
.lp-pvtabs{display:flex;gap:6px;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:4px;margin:4px 0 12px}
.lp-pvtabs button{flex:1;background:transparent;border:0;color:var(--mut);font-weight:600;padding:7px;border-radius:7px;cursor:pointer;font-family:inherit;font-size:13px}
.lp-pvtabs button.on{background:var(--grad);color:#fff}
.lp-chartbox{position:relative}
.lp-cline{stroke-dasharray:2600;stroke-dashoffset:2600;animation:lpdraw 1.15s cubic-bezier(.4,0,.2,1) forwards}
@keyframes lpdraw{to{stroke-dashoffset:0}}
@media(prefers-reduced-motion:reduce){.lp-cline{animation:none;stroke-dashoffset:0}}
.lp-tip{position:absolute;top:2px;transform:translateX(-50%);background:#fff;border:1px solid var(--line2);border-radius:9px;padding:4px 9px;font-size:12px;color:var(--ink);pointer-events:none;white-space:nowrap;box-shadow:0 6px 18px rgba(24,29,39,.10)}
.lp-tip b{color:var(--or3)}.lp-tip span{color:var(--mut);margin-left:4px}
.lp-chart-meta{display:flex;gap:16px;color:#8a93a4;font-size:12px;margin-top:6px}.lp-chart-meta b{color:#3a4150}.lp-chart-meta span:last-child{margin-left:auto}
.lp-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:12px}
.lp-stats div{background:var(--soft);border:1px solid var(--line);border-radius:11px;padding:10px 12px}
.lp-stats span{display:block;color:var(--mut);font-size:11.5px;margin-bottom:3px}.lp-stats b{font-size:14px;font-variant-numeric:tabular-nums}
.lp-bubble{background:rgba(255,106,0,.08);border:1px solid rgba(255,106,0,.20);border-radius:16px;padding:14px 16px;font-size:14.5px;color:#3a4150;margin-top:14px}
.lp-demoflag{color:#9aa3b2;font-style:italic}
.lp-analysis{margin-top:14px;background:var(--soft);border:1px solid rgba(255,106,0,.28);border-radius:16px;padding:16px}
.lp-an-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:9px}
.lp-an-h{font-weight:700;font-size:12px;text-transform:uppercase;letter-spacing:.6px;color:#b25a12}
.lp-pro{font-size:11px;font-weight:800;letter-spacing:.4px;color:#fff;background:var(--grad);border-radius:999px;padding:3px 10px}
.lp-an-p{color:#3a4150;font-size:13px;line-height:1.55;margin-bottom:11px}
.lp-an-list{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:7px}
.lp-an-list li{position:relative;padding-left:16px;color:#3a4150;font-size:13px;line-height:1.5}
.lp-an-list li:before{content:'';position:absolute;left:0;top:7px;width:6px;height:6px;border-radius:50%;background:linear-gradient(90deg,#FF8A3D,#F94C00)}
.lp-an-list li b{color:#181d27;font-weight:700}
.lp-forgot{margin-top:10px;text-align:center}.lp-forgot a{color:var(--or3);font-size:12.5px;font-weight:600;cursor:pointer}
.lp-pills{display:grid;gap:8px}
.lp-pillrow{display:grid;grid-template-columns:104px 1fr 26px 64px;gap:10px;align-items:center;font-size:12.5px}
.lp-pillrow>span{color:var(--mut);text-transform:capitalize;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lp-pbar{height:7px;background:#f2e4d6;border-radius:6px;overflow:hidden}
.lp-pbar i{display:block;height:100%;border-radius:6px;background:linear-gradient(90deg,#FF8A3D,#F94C00)}
.lp-pillrow b{text-align:right;font-variant-numeric:tabular-nums;color:#181d27}
.lp-pl{font-style:normal;font-size:11px;font-weight:600;text-align:right}
.lp-pl.g{color:#12a06b}.lp-pl.a{color:#c07d0a}.lp-pl.r{color:#e0503f}
.lp-pro-note{margin-top:13px;background:rgba(255,106,0,.10);border:1px dashed rgba(255,106,0,.4);border-radius:12px;padding:11px 13px;font-size:12.5px;color:#7a4a1e;line-height:1.5}
.lp-pro-note b{color:#b25a12}
.lp-sec{padding:44px 0}
.lp-pipe{position:relative;width:100%;max-width:1120px;margin:14px auto 0;aspect-ratio:16/9;border-radius:18px;overflow:hidden;border:1px solid var(--line);box-shadow:0 30px 80px rgba(24,29,39,.16)}
.lp-pipe iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}
@media(max-width:640px){.lp-pipe{aspect-ratio:3/4}}
.lp-sec h2{font-size:clamp(24px,3vw,34px);font-weight:800;text-align:center;letter-spacing:-.4px}
.lp-subh{color:var(--mut);text-align:center;margin:12px auto 30px;max-width:620px;font-size:15px}
.lp-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.lp-card{border-radius:18px;padding:24px;border:1px solid var(--line);background:#fff;transition:.18s;box-shadow:0 10px 30px rgba(24,29,39,.04)}
.lp-card:hover{transform:translateY(-6px);border-color:var(--or1);box-shadow:0 18px 44px rgba(255,106,0,.12)}
.lp-ic{width:46px;height:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;margin-bottom:18px;background:rgba(255,106,0,.10);color:var(--or3)}
.lp-ic svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lp-card h3{font-size:17px;margin-bottom:8px;font-weight:700}
.lp-card p{color:var(--mut);font-size:13.5px}
.k1,.k2,.k3,.k4,.k5,.k6{background:rgba(255,106,0,.10);color:var(--or3)}
.lp-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.lp-step{background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px;text-align:center;box-shadow:0 10px 30px rgba(24,29,39,.04)}
.lp-num{width:42px;height:42px;border-radius:13px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;font-size:19px;background:var(--grad)}
.lp-step h3{font-size:18px;font-weight:700;margin-bottom:8px}
.lp-step p{color:var(--mut);font-size:13.5px;line-height:1.6;max-width:280px;margin:0 auto}
.lp-join{background:linear-gradient(120deg,rgba(255,138,61,.14),rgba(255,106,0,.10) 55%,rgba(249,76,0,.12));border:1px solid var(--line2);border-radius:24px;padding:40px 22px;text-align:center}
.lp-join>p{color:var(--mut);margin-top:8px}
.lp-auth{background:#fff;border:1px solid var(--line2);border-radius:20px;padding:26px;max-width:420px;margin:26px auto 0;text-align:center;box-shadow:0 20px 50px rgba(24,29,39,.10)}
.lp-tabs{display:flex;gap:6px;background:var(--soft);border:1px solid var(--line);border-radius:12px;padding:5px;margin-bottom:18px}
.lp-tabs button{flex:1;background:transparent;border:0;color:var(--mut);font-weight:600;padding:9px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px}
.lp-tabs button.on{background:var(--grad);color:#fff}
.lp-google{display:flex;justify-content:center;min-height:44px}
.lp-field{width:100%;background:#fff;border:1px solid var(--line2);border-radius:11px;padding:12px 13px;color:var(--ink);margin:5px 0;font-size:14px;font-family:inherit}
.lp-field:focus{outline:none;border-color:var(--or2);box-shadow:0 0 0 3px rgba(255,106,0,.15)}
.lp-or{color:#9aa3b2;font-size:13px;margin:14px 0}
.lp-invite{margin-top:16px;font-size:13px;color:var(--mut)}
.lp-invite a{cursor:pointer;font-weight:600;text-decoration:none;color:var(--or3)}
.lp-vtext{color:var(--mut);font-size:14.5px;margin-bottom:8px}
.lp-pwrules{list-style:none;margin:6px 2px 2px;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:4px 12px;text-align:left}
.lp-pwrules li{font-size:11.5px;color:var(--mut)}
.lp-pwrules li.ok{color:#0f8f5f}
.lp-verify-ic{font-size:34px;margin-bottom:6px}
.lp-verify h3{font-size:20px;font-weight:700;margin-bottom:8px}
.lp-err{color:#d23b3b;font-size:13.5px;margin-top:12px}
.lp-ok{color:#0f8f5f;font-size:13.5px;margin-top:12px}
.lp-foot{color:#9aa3b2;font-size:13px;text-align:center;padding:38px 0;border-top:1px solid var(--line);margin-top:24px}
.lp-modal{position:fixed;inset:0;z-index:70;background:rgba(24,29,39,.55);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:16px;overflow-y:auto;perspective:1200px;animation:lpfade .35s ease both}
@keyframes lpfade{from{opacity:0}to{opacity:1}}
.lp-modal-card{position:relative;width:100%;max-width:430px;max-height:92vh;overflow:auto;border-radius:20px;box-shadow:0 50px 110px rgba(24,29,39,.45),0 0 0 1px rgba(255,106,0,.15);transform-origin:center 40%;animation:lppop .72s cubic-bezier(.16,1.12,.3,1) both}
@keyframes lppop{
  0%{opacity:0;transform:translateY(70px) scale(.82) rotateX(14deg)}
  45%{opacity:1}
  70%{transform:translateY(-6px) scale(1.015) rotateX(0)}
  100%{opacity:1;transform:translateY(0) scale(1) rotateX(0)}
}
.lp-modal-x{animation:lpxin .5s .25s backwards}
@keyframes lpxin{from{opacity:0;transform:scale(.4) rotate(-90deg)}to{opacity:1;transform:scale(1) rotate(0)}}
@media(prefers-reduced-motion:reduce){.lp-modal,.lp-modal-card,.lp-modal-x{animation-duration:.01ms}}
.lp-modal-card .lp-auth{margin:0;padding-top:52px;border-radius:20px;box-shadow:none}
.lp-modal-x{position:absolute;top:14px;right:14px;width:34px;height:34px;border-radius:50%;border:1px solid var(--line);background:#fff;color:#6b7280;font-size:16px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s;z-index:2;box-shadow:0 2px 6px rgba(24,29,39,.08)}
.lp-modal-x:hover{background:var(--or2);color:#fff;border-color:var(--or2);transform:rotate(90deg)}
@media(max-width:840px){.lp-hero{grid-template-columns:1fr;padding-top:20px}.lp-cards,.lp-steps{grid-template-columns:1fr}}
@media(max-width:560px){.lp-word{font-size:16px;letter-spacing:.6px}}
@media(max-width:560px){.lp-wrap{padding:0 16px}.lp-preview{padding:14px}.lp-hero h1{font-size:34px}.lp-hero p{font-size:15px}
  .lp-nav{padding:14px 0;flex-wrap:wrap;gap:10px}
  .lp-brand{flex:1 1 100%}
  .lp-navbtns{flex:1 1 100%;justify-content:flex-start;gap:8px}
  .lp-navlink{padding:8px 4px;font-size:13px}
  .lp-btn{padding:9px 13px;font-size:13px}.lp-cta-row{gap:10px}.lp-cta-row .lp-btn{flex:1}
  .lp-modal{padding:10px}.lp-modal-card{max-height:94vh}.lp-pvtabs button{font-size:12px}}
`
