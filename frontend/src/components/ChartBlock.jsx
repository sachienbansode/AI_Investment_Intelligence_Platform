// Renders a chart the assistant requested. Data-bound charts (score_history,
// price_history, compare, sector, distribution) pull REAL platform data so the
// numbers are trustworthy; "data" charts are illustrative values the model gave
// (clearly labelled). Kept compact and reuses the app's chart styling.
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import ScoreHistoryPanel from './ScoreHistoryPanel.jsx'

const RS = String.fromCharCode(0x20B9)
const band = v => (v >= 65 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)')
const PALETTE = ['#f94c00', '#ff8a3d', '#12a06b', '#c07d0a', '#4f8ef7', '#7c5cfc', '#e0503f']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = d => (d && d.length >= 10 ? `${d.slice(8, 10)}-${MON[(+d.slice(5, 7) || 1) - 1]}-${d.slice(2, 4)}` : d)
const titleCase = s => String(s || '').replace(/\b\w/g, c => c.toUpperCase())

function Wrap({ title, note, children }) {
  return (
    <div className="chart-block">
      {title && <div className="chart-title">{title}</div>}
      {children}
      {note && <div className="chart-note">{note}</div>}
    </div>
  )
}

// ---- generic line for price / illustrative line ----------------------------
function LineChart({ labels, values, color = 'var(--accent)', fmtY = v => v }) {
  const [hi, setHi] = useState(null)
  const n = values.length
  if (n < 2) return <p className="hint">Not enough data to chart.</p>
  const W = 640, H = 200, M = { l: 44, r: 12, t: 14, b: 26 }
  const iw = W - M.l - M.r, ih = H - M.t - M.b
  const lo = Math.min(...values), hv = Math.max(...values), sp = (hv - lo) || 1
  const yMin = lo - sp * 0.15, yMax = hv + sp * 0.15
  const X = i => M.l + iw * (i / (n - 1))
  const Y = v => M.t + ih * (1 - (v - yMin) / ((yMax - yMin) || 1))
  const pts = values.map((v, i) => `${X(i)},${Y(v)}`).join(' ')
  const area = `${X(0)},${M.t + ih} ${pts} ${X(n - 1)},${M.t + ih}`
  const every = Math.max(1, Math.ceil(n / 7))
  const cur = hi != null ? hi : null
  return (
    <div className="trend2-wrap" onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend2-svg" preserveAspectRatio="none">
        {[yMin, (yMin + yMax) / 2, yMax].map((t, k) => (
          <g key={k}>
            <line x1={M.l} y1={Y(t)} x2={W - M.r} y2={Y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={M.l - 6} y={Y(t) + 3} textAnchor="end" className="t2axis">{fmtY(Math.round(t * 100) / 100)}</text>
          </g>
        ))}
        <polygon points={area} fill={color} opacity="0.12" />
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        {cur != null && <line x1={X(cur)} y1={M.t} x2={X(cur)} y2={M.t + ih} stroke={color} strokeWidth="1" opacity=".5" strokeDasharray="3 3" />}
        {values.map((v, i) => <circle key={i} cx={X(i)} cy={Y(v)} r={hi === i ? 4.5 : 0} fill={color} />)}
        {labels.map((l, i) => (i % every === 0 || i === n - 1) && (
          <text key={i} x={X(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="t2date">{l}</text>
        ))}
        {values.map((v, i) => <rect key={'r' + i} x={X(i) - iw / n / 2} y={M.t} width={iw / n} height={ih} fill="transparent" onMouseEnter={() => setHi(i)} />)}
      </svg>
      {cur != null && (
        <div className="trend2-tip" style={{ left: `${X(cur) / W * 100}%` }}>
          <div className="t2tip-d">{labels[cur]}</div>
          <div className="t2tip-row"><span>Value</span><b>{fmtY(values[cur])}</b></div>
        </div>
      )}
    </div>
  )
}

// ---- generic bars (illustrative + reused for sector / distribution) --------
function BarChart({ labels, values, colors, fmtY = v => v }) {
  const n = values.length
  if (!n) return <p className="hint">No data.</p>
  const W = 640, H = 210, M = { l: 44, r: 12, t: 14, b: 46 }
  const iw = W - M.l - M.r, ih = H - M.t - M.b
  const hv = Math.max(...values, 1)
  const bw = Math.min(48, iw / n * 0.62)
  const X = i => M.l + iw * ((i + 0.5) / n)
  const Y = v => M.t + ih * (1 - v / hv)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="trend2-svg" preserveAspectRatio="none">
      {[0, hv / 2, hv].map((t, k) => (
        <g key={k}>
          <line x1={M.l} y1={Y(t)} x2={W - M.r} y2={Y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={M.l - 6} y={Y(t) + 3} textAnchor="end" className="t2axis">{fmtY(Math.round(t * 10) / 10)}</text>
        </g>
      ))}
      {values.map((v, i) => (
        <g key={i}>
          <rect x={X(i) - bw / 2} y={Y(v)} width={bw} height={M.t + ih - Y(v)} rx="3"
                fill={(colors && colors[i]) || PALETTE[i % PALETTE.length]} />
          <text x={X(i)} y={Y(v) - 4} textAnchor="middle" className="t2pt">{fmtY(v)}</text>
          <text x={X(i)} y={H - 26} textAnchor="middle" className="t2date">{String(labels[i]).slice(0, 12)}</text>
        </g>
      ))}
    </svg>
  )
}

function PieChart({ labels, values }) {
  const total = values.reduce((a, b) => a + b, 0) || 1
  let acc = 0
  const R = 80, C = 100
  const seg = values.map((v, i) => {
    const a0 = acc / total * 2 * Math.PI; acc += v
    const a1 = acc / total * 2 * Math.PI
    const large = a1 - a0 > Math.PI ? 1 : 0
    const x0 = C + R * Math.sin(a0), y0 = C - R * Math.cos(a0)
    const x1 = C + R * Math.sin(a1), y1 = C - R * Math.cos(a1)
    return <path key={i} d={`M${C},${C} L${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} Z`}
                 fill={PALETTE[i % PALETTE.length]} stroke="var(--panel)" strokeWidth="1.5" />
  })
  return (
    <div className="pie-wrap">
      <svg viewBox="0 0 200 200" className="pie-svg">{seg}</svg>
      <div className="pie-legend">
        {labels.map((l, i) => (
          <div key={i}><i style={{ background: PALETTE[i % PALETTE.length] }} />{l} <b>{Math.round(values[i] / total * 100)}%</b></div>
        ))}
      </div>
    </div>
  )
}

// ---- data-bound loaders -----------------------------------------------------
function PriceHistory({ symbol }) {
  const [d, setD] = useState(null)
  useEffect(() => { let a = true; api.publicPriceHistory(symbol, '1Y').then(r => a && setD(r)).catch(() => a && setD({ points: [] })); return () => { a = false } }, [symbol])
  if (!d) return <p className="hint">Loading price history…</p>
  const pts = (d.points || []).filter(p => p && p.c != null)
  if (pts.length < 2) return <p className="hint">No stored price history for {symbol} yet.</p>
  return (
    <Wrap title={`${symbol} — Price (LTP), 1Y`} note="Delayed / end-of-day price from stored history.">
      <LineChart labels={pts.map(p => shortDate(p.d))} values={pts.map(p => p.c)} color="var(--accent)" fmtY={v => RS + v} />
    </Wrap>
  )
}

function CompareMini({ symbols }) {
  const [d, setD] = useState(null)
  const [a, b] = symbols
  useEffect(() => { let al = true; api.compare(a, b).then(r => al && setD(r)).catch(() => al && setD({ error: true })); return () => { al = false } }, [a, b])
  if (!d) return <p className="hint">Comparing {a} vs {b}…</p>
  if (d.error || !d.a || !d.b) return <p className="hint">Couldn’t load comparison for {a} / {b}.</p>
  const row = (lab, fa, fb) => <tr><td>{lab}</td><td>{fa}</td><td>{fb}</td></tr>
  const px = x => x?.last_price != null ? RS + Number(x.last_price).toLocaleString('en-IN') : '—'
  const sc = x => x?.ai_score != null ? x.ai_score : '—'
  return (
    <Wrap title={`${a} vs ${b}`} note="Live snapshot from platform data.">
      <div className="md-table-wrap"><table className="md-table">
        <thead><tr><th>Metric</th><th>{a}</th><th>{b}</th></tr></thead>
        <tbody>
          {row('NIYTRI Score', sc(d.a), sc(d.b))}
          {row('LTP', px(d.a), px(d.b))}
          {row('Day %', (d.a?.change_pct ?? '—') + '%', (d.b?.change_pct ?? '—') + '%')}
          {row('P/E', d.a?.pe != null ? Number(d.a.pe).toFixed(1) : '—', d.b?.pe != null ? Number(d.b.pe).toFixed(1) : '—')}
        </tbody>
      </table></div>
      <BarChart labels={[a, b]} values={[Number(d.a?.ai_score) || 0, Number(d.b?.ai_score) || 0]}
                colors={[band(d.a?.ai_score || 0), band(d.b?.ai_score || 0)]} />
    </Wrap>
  )
}

function SectorBars() {
  const [rows, setRows] = useState(null)
  useEffect(() => { let a = true; api.scores().then(r => a && setRows(r.scores || [])).catch(() => a && setRows([])); return () => { a = false } }, [])
  if (!rows) return <p className="hint">Loading sector strength…</p>
  const g = {}
  rows.forEach(s => { if (s.sector && s.composite_score != null) (g[s.sector] = g[s.sector] || []).push(s.composite_score) })
  let arr = Object.entries(g).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length])
  arr = arr.sort((a, b) => b[1] - a[1]).slice(0, 10)
  if (!arr.length) return <p className="hint">No sector data.</p>
  return (
    <Wrap title="Sector Strength — Average NIYTRI Score" note="Average of approved scores per sector (top 10).">
      <BarChart labels={arr.map(x => x[0])} values={arr.map(x => Math.round(x[1] * 10) / 10)}
                colors={arr.map(x => band(x[1]))} />
    </Wrap>
  )
}

function Distribution() {
  const [rows, setRows] = useState(null)
  useEffect(() => { let a = true; api.scores().then(r => a && setRows(r.scores || [])).catch(() => a && setRows([])); return () => { a = false } }, [])
  if (!rows) return <p className="hint">Loading score distribution…</p>
  const strong = rows.filter(s => s.composite_score >= 65).length
  const neutral = rows.filter(s => s.composite_score >= 50 && s.composite_score < 65).length
  const weak = rows.filter(s => s.composite_score != null && s.composite_score < 50).length
  if (!(strong + neutral + weak)) return <p className="hint">No scores available.</p>
  return (
    <Wrap title="Market Score Distribution" note="Count of stocks by score band (today).">
      <BarChart labels={['Strong 65+', 'Neutral 50–64', 'Weak <50']} values={[strong, neutral, weak]}
                colors={['var(--green)', 'var(--amber)', 'var(--red)']} fmtY={v => Math.round(v)} />
    </Wrap>
  )
}

const PILLAR_ORDER = ['fundamental', 'technical', 'valuation', 'momentum', 'earnings', 'news_sentiment', 'institutional', 'risk']

function Pillars({ symbol }) {
  const [d, setD] = useState(null)
  useEffect(() => { let a = true; api.stockScore(symbol).then(r => a && setD(r)).catch(() => a && setD({ error: true })); return () => { a = false } }, [symbol])
  if (!d) return <p className="hint">Loading pillars…</p>
  if (d.error || !d.pillar_scores) return <p className="hint">No pillar breakdown for {symbol} yet.</p>
  const rows = PILLAR_ORDER.filter(k => d.pillar_scores[k] != null).map(k => [titleCase(k.replace('_', ' ')), Math.round(d.pillar_scores[k])])
  return (
    <Wrap title={`${symbol} — NIYTRI Score Pillars (Composite ${Math.round(d.composite_score)}/100)`}
          note="Each pillar 0–100; higher = stronger. Green ≥65, amber 50–64, red <50.">
      <div className="pillar-chart">
        {rows.map(([lab, v]) => (
          <div key={lab} className="pillar">
            <span>{lab}</span>
            <div className="bar"><div style={{ width: v + '%', background: band(v) }} /></div>
            <span>{v}</span>
          </div>
        ))}
      </div>
    </Wrap>
  )
}

function PortfolioCard({ p }) {
  const rows = p.rows || []
  const inr = v => RS + Number(v || 0).toLocaleString('en-IN')
  const sec = {}
  rows.forEach(r => { sec[r.sector] = (sec[r.sector] || 0) + Number(r.amount || 0) })
  const bars = Object.entries(sec).sort((a, b) => b[1] - a[1])
  return (
    <div className="chart-block pf-basket">
      <div className="pf-chips">
        <div><span>Amount</span><b>{inr(p.amount)}</b></div>
        <div><span>Invested</span><b>{inr(p.invested)}</b></div>
        <div><span>Cash left</span><b>{inr(p.cash)}</b></div>
        <div><span>NIYTRI Score</span><b style={{ color: band(p.weighted_score) }}>{p.weighted_score}</b></div>
        <div><span>Sectors</span><b>{p.sectors}</b></div>
        <div><span>Stocks</span><b>{rows.length}</b></div>
      </div>
      <div className="md-table-wrap">
        <table className="md-table">
          <thead><tr>
            <th>Stock</th><th>Sector</th>
            <th style={{ textAlign: 'right' }}>NIYTRI</th><th style={{ textAlign: 'right' }}>LTP</th>
            <th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Amount</th>
            <th style={{ textAlign: 'right' }}>Weight</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.symbol}>
                <td><strong>{r.symbol}</strong></td><td>{r.sector}</td>
                <td style={{ textAlign: 'right', fontWeight: 700, color: band(r.score) }}>{r.score}</td>
                <td style={{ textAlign: 'right' }}>{inr(r.ltp)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{r.qty}</td>
                <td style={{ textAlign: 'right' }}>{inr(r.amount)}</td>
                <td style={{ textAlign: 'right' }}>{r.weight}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bars.length > 0 && <div className="chart-title" style={{ marginTop: 10 }}>Allocation by sector</div>}
      {bars.length > 0 && <BarChart labels={bars.map(x => x[0])} values={bars.map(x => Math.round(x[1]))} fmtY={v => RS + v} />}
    </div>
  )
}

export default function ChartBlock({ spec }) {
  if (!spec) return null
  if (spec.src === 'portfolio') return <PortfolioCard p={spec} />
  if (spec.src === 'bound') {
    if (spec.type === 'score_history') return <Wrap><ScoreHistoryPanel symbol={spec.symbol} /></Wrap>
    if (spec.type === 'price_history') return <PriceHistory symbol={spec.symbol} />
    if (spec.type === 'pillars') return <Pillars symbol={spec.symbol} />
    if (spec.type === 'compare') return <CompareMini symbols={spec.symbols} />
    if (spec.type === 'sector') return <SectorBars />
    if (spec.type === 'distribution') return <Distribution />
    return null
  }
  // illustrative LLM data
  const labels = spec.x || [], values = spec.y || []
  const title = (spec.title || 'Illustrative') + ' · illustrative'
  if (spec.kind === 'pie') return <Wrap title={title} note="Illustrative — figures from the explanation, not live data."><PieChart labels={labels} values={values} /></Wrap>
  if (spec.kind === 'line') return <Wrap title={title} note="Illustrative — figures from the explanation, not live data."><LineChart labels={labels} values={values} /></Wrap>
  return <Wrap title={title} note="Illustrative — figures from the explanation, not live data."><BarChart labels={labels} values={values} /></Wrap>
}
