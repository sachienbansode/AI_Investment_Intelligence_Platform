// Public (no-login) view of a shared assistant answer. Self-contained: renders the
// Q&A with branding, the app intro + URL call-to-action, and the compliance
// disclaimer. Charts aren't rendered here (they need live data / login) — instead
// we invite the reader into the app.
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'

const RUPEE = String.fromCharCode(0x20B9)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PALETTE = ['#f94c00', '#ff8a3d', '#12a06b', '#c07d0a', '#4f8ef7', '#7c5cfc', '#e0503f']
const sDate = d => (d && d.length >= 10 ? `${d.slice(8, 10)}-${MON[(+d.slice(5, 7) || 1) - 1]}-${d.slice(2, 4)}` : d)

// Renders a snapshotted chart from embedded data — no live/authenticated calls.
function StaticChart({ c }) {
  if (!c) return null
  const W = 640
  if (c.kind === 'pillars') {
    return (
      <div className="chart-block">
        <div className="chart-title">{c.title}</div>
        <div className="pillar-chart">
          {(c.rows || []).map(([lab, v, col]) => (
            <div key={lab} className="pillar">
              <span>{lab}</span>
              <div className="bar"><div style={{ width: v + '%', background: col }} /></div>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (c.kind === 'pie') {
    const vals = c.values || [], total = vals.reduce((a, b) => a + b, 0) || 1
    let acc = 0
    const seg = vals.map((v, i) => {
      const a0 = acc / total * 2 * Math.PI; acc += v
      const a1 = acc / total * 2 * Math.PI
      const large = a1 - a0 > Math.PI ? 1 : 0
      const x0 = 100 + 80 * Math.sin(a0), y0 = 100 - 80 * Math.cos(a0)
      const x1 = 100 + 80 * Math.sin(a1), y1 = 100 - 80 * Math.cos(a1)
      return <path key={i} d={`M100,100 L${x0},${y0} A80,80 0 ${large} 1 ${x1},${y1} Z`} fill={PALETTE[i % PALETTE.length]} stroke="var(--panel)" strokeWidth="1.5" />
    })
    return (
      <div className="chart-block"><div className="chart-title">{c.title}</div>
        <div className="pie-wrap"><svg viewBox="0 0 200 200" className="pie-svg">{seg}</svg>
          <div className="pie-legend">{(c.labels || []).map((l, i) => <div key={l}><i style={{ background: PALETTE[i % PALETTE.length] }} />{l} <b>{Math.round(vals[i] / total * 100)}%</b></div>)}</div>
        </div>
      </div>
    )
  }
  const labels = c.labels || [], values = (c.values || []).map(Number)
  if (values.length < 1) return null
  const H = 210, M = { l: 46, r: 12, t: 14, b: 40 }
  const iw = W - M.l - M.r, ih = H - M.t - M.b
  const fmtY = v => (c.rupee ? RUPEE + v : v)
  if (c.kind === 'line') {
    const lo = Math.min(...values), hv = Math.max(...values), sp = (hv - lo) || 1
    const yMin = lo - sp * 0.15, yMax = hv + sp * 0.15
    const X = i => M.l + iw * (i / Math.max(1, values.length - 1))
    const Y = v => M.t + ih * (1 - (v - yMin) / ((yMax - yMin) || 1))
    const pts = values.map((v, i) => `${X(i)},${Y(v)}`).join(' ')
    const every = Math.max(1, Math.ceil(values.length / 7))
    return (
      <div className="chart-block"><div className="chart-title">{c.title}</div>
        <svg viewBox={`0 0 ${W} ${H}`} className="trend2-svg" preserveAspectRatio="none">
          {[yMin, (yMin + yMax) / 2, yMax].map((t, k) => (
            <g key={k}><line x1={M.l} y1={Y(t)} x2={W - M.r} y2={Y(t)} stroke="var(--border)" strokeWidth="1" />
              <text x={M.l - 6} y={Y(t) + 3} textAnchor="end" className="t2axis">{fmtY(Math.round(t * 100) / 100)}</text></g>
          ))}
          <polygon points={`${X(0)},${M.t + ih} ${pts} ${X(values.length - 1)},${M.t + ih}`} fill="var(--accent)" opacity="0.12" />
          <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
          {labels.map((l, i) => (i % every === 0 || i === values.length - 1) && (
            <text key={i} x={X(i)} y={H - 8} textAnchor={i === 0 ? 'start' : i === values.length - 1 ? 'end' : 'middle'} className="t2date">{sDate(l)}</text>
          ))}
        </svg>
      </div>
    )
  }
  // bars
  const hv = Math.max(...values, 1), n = values.length
  const bw = Math.min(48, iw / n * 0.62)
  const X = i => M.l + iw * ((i + 0.5) / n)
  const Y = v => M.t + ih * (1 - v / hv)
  return (
    <div className="chart-block"><div className="chart-title">{c.title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend2-svg" preserveAspectRatio="none">
        {[0, hv / 2, hv].map((t, k) => (
          <g key={k}><line x1={M.l} y1={Y(t)} x2={W - M.r} y2={Y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={M.l - 6} y={Y(t) + 3} textAnchor="end" className="t2axis">{Math.round(t * 10) / 10}</text></g>
        ))}
        {values.map((v, i) => (
          <g key={i}>
            <rect x={X(i) - bw / 2} y={Y(v)} width={bw} height={M.t + ih - Y(v)} rx="3" fill={(c.colors && c.colors[i]) || PALETTE[i % PALETTE.length]} />
            <text x={X(i)} y={Y(v) - 4} textAnchor="middle" className="t2pt">{v}</text>
            <text x={X(i)} y={H - 22} textAnchor="middle" className="t2date">{String(labels[i]).slice(0, 14)}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

export default function PublicShare({ token }) {
  const [d, setD] = useState(undefined)   // undefined=loading, null=not found
  useEffect(() => {
    api.shareGet(token).then(setD).catch(() => setD(null))
  }, [token])

  const RS = String.fromCharCode(0x20B9)
  const appUrl = (d && d.url) || 'https://dev-invest.niytri.com'

  return (
    <div className="ps-page">
      <header className="ps-top">
        <a className="ps-brand" href={appUrl}>
          <span className="ps-mark">{RS}</span>
          <b>{(d && d.platform_label) || 'NIYTRI Investment Intelligence'}</b>
        </a>
        <a className="ps-cta" href={appUrl}>Open the app</a>
      </header>

      <main className="ps-main">
        {d === undefined && <p className="hint">Loading shared answer…</p>}
        {d === null && (
          <div className="ps-card">
            <h2>Link unavailable</h2>
            <p className="hint">This shared answer has expired or doesn’t exist.</p>
            <a className="ps-cta" href={appUrl}>Explore NIYTRI Investment Intelligence</a>
          </div>
        )}
        {d && d !== null && (
          <div className="ps-card">
            <p className="ps-intro">{d.intro}</p>
            {d.question && <div className="ps-q"><span>Question</span><p>{d.question}</p></div>}
            <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(d.answer || '') }} />
            {(d.charts || []).map((c, i) => <StaticChart key={i} c={c} />)}
            <div className="ps-actions">
              <a className="ps-cta" href={appUrl}>Get your own insights on Indian stocks</a>
            </div>
            <p className="ps-disc">{d.disclaimer}</p>
          </div>
        )}
      </main>

      <footer className="ps-foot">
        <a href={appUrl}>{appUrl.replace(/^https?:\/\//, '')}</a> · Internal analysis · not investment advice
      </footer>
    </div>
  )
}
