// Per-stock NIYTRI Score history — styled like the Score Trend chart: hover a
// crosshair anywhere for a tooltip box showing the NIYTRI Score, the end-of-day
// LTP and the day-over-day % change. The line plots the score; LTP/% appear in
// the tooltip and in the caller's stat header. Reuses the trend2-* styles.
import { useState } from 'react'

const RS = String.fromCharCode(0x20B9)                 // rupee sign (avoid literal glyph)
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDate = d => `${d.slice(8, 10)}-${MON[(+d.slice(5, 7) || 1) - 1]}-${d.slice(2, 4)}`
const band = v => (v >= 65 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)')

export default function MiniTrend({ data, color = 'var(--accent)', scoreLabel = 'NIYTRI Score' }) {
  const [hi, setHi] = useState(null)
  const pts = (data || []).filter(d => d && d.score != null)
  const n = pts.length
  if (n < 2) return <span className="hint" style={{ fontSize: '.75rem' }}>Not enough history yet.</span>

  const W = 760, H = 220, M = { l: 40, r: 16, t: 22, b: 28 }
  const iw = W - M.l - M.r, ih = H - M.t - M.b
  const vals = pts.map(p => p.score)
  const lo = Math.min(...vals), hv = Math.max(...vals), span = (hv - lo) || 1
  const yMin = lo - span * 0.25, yMax = hv + span * 0.25
  const X = i => M.l + (n === 1 ? iw / 2 : iw * i / (n - 1))
  const Y = v => M.t + ih * (1 - (v - yMin) / ((yMax - yMin) || 1))
  const line = pts.map((p, i) => `${X(i)},${Y(p.score)}`).join(' ')
  const area = `${X(0)},${M.t + ih} ${line} ${X(n - 1)},${M.t + ih}`
  const ticks = [yMin, (yMin + yMax) / 2, yMax]
  const every = Math.max(1, Math.ceil(n / 8))
  const h = hi != null ? pts[hi] : null

  return (
    <div className="trend2-wrap" onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="trend2-svg" preserveAspectRatio="none"
           role="img" aria-label="NIYTRI Score history line chart">
        {ticks.map((t, k) => (
          <g key={k}>
            <line x1={M.l} y1={Y(t)} x2={W - M.r} y2={Y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={M.l - 6} y={Y(t) + 3} textAnchor="end" className="t2axis">{Math.round(t)}</text>
          </g>
        ))}
        <polygon points={area} fill={color} opacity="0.12" />
        <polyline className="t2-line" points={line} fill="none" stroke={color} strokeWidth="2.5"
                  strokeLinejoin="round" strokeLinecap="round" />
        {hi != null && <line x1={X(hi)} y1={M.t} x2={X(hi)} y2={M.t + ih}
                             stroke={color} strokeWidth="1" opacity="0.5" strokeDasharray="3 3" />}
        {pts.map((p, i) => (
          <circle key={p.date} cx={X(i)} cy={Y(p.score)} r={hi === i ? 5 : 2.6}
                  fill={band(p.score)} stroke="var(--panel)" strokeWidth={hi === i ? 1.5 : 0} />
        ))}
        {pts.map((p, i) => (i % every === 0 || i === n - 1) && (
          <text key={'d' + p.date} x={X(i)} y={H - 8}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}
                className="t2date">{fmtDate(p.date)}</text>
        ))}
        {pts.map((p, i) => (
          <rect key={'r' + p.date} x={X(i) - iw / n / 2} y={M.t} width={iw / n} height={ih}
                fill="transparent" onMouseEnter={() => setHi(i)} />
        ))}
      </svg>
      {h && (
        <div className="trend2-tip" style={{ left: `${X(hi) / W * 100}%` }}>
          <div className="t2tip-d">{fmtDate(h.date)}</div>
          <div className="t2tip-row"><span>{scoreLabel}</span><b style={{ color: band(h.score) }}>{h.score}</b></div>
          <div className="t2tip-row"><span>LTP</span><b>{h.ltp != null ? RS + h.ltp : '—'}</b></div>
          <div className="t2tip-row"><span>Change</span>
            <b className={h.pct == null ? '' : h.pct >= 0 ? 'up' : 'down'}>
              {h.pct == null ? '—' : (h.pct >= 0 ? '+' : '') + h.pct + '%'}</b></div>
        </div>
      )}
    </div>
  )
}
