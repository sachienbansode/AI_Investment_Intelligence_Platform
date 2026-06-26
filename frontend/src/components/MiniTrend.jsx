// Responsive single-series score trend. Shows every point's score + date
// (dd-MMM), edge labels anchored inward so nothing clips. Uniform scaling so it
// never distorts on mobile.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDate = d => `${d.slice(8, 10)}-${MON[(+d.slice(5, 7) || 1) - 1]}`

export default function MiniTrend({ data, color = 'var(--accent)' }) {
  const pts = (data || []).filter(d => d && d.score != null)
  if (pts.length < 2) return <span className="hint" style={{ fontSize: '.75rem' }}>Not enough history yet.</span>
  const n = pts.length
  const W = Math.max(560, n * 52), H = 180, M = { l: 36, r: 24, t: 28, b: 40 }
  const vals = pts.map(p => p.score)
  const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1
  const yMin = lo - span * 0.2, yMax = hi + span * 0.2
  const iw = W - M.l - M.r, ih = H - M.t - M.b
  const X = i => M.l + iw * (n === 1 ? 0.5 : i / (n - 1))
  const Y = v => M.t + ih * (1 - (v - yMin) / ((yMax - yMin) || 1))
  const line = pts.map((p, i) => `${X(i)},${Y(p.score)}`).join(' ')
  const area = `${X(0)},${H - M.b} ${line} ${X(n - 1)},${H - M.b}`
  const anchor = i => (i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle')
  const ticks = [yMin, (yMin + yMax) / 2, yMax]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mini-trend" role="img"
         aria-label="Score history line chart">
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={M.l} y1={Y(t)} x2={W - M.r} y2={Y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={M.l - 6} y={Y(t) + 3} textAnchor="end" className="mt-axis">{Math.round(t)}</text>
        </g>
      ))}
      <polygon points={area} fill={color} opacity="0.10" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={p.date}>
          <circle cx={X(i)} cy={Y(p.score)} r="3" fill={color} />
          <text x={X(i)} y={Y(p.score) - 8} textAnchor={anchor(i)} className="mt-score">{p.score}</text>
          <text x={X(i)} y={H - 12} textAnchor={anchor(i)} className="mt-date">{fmtDate(p.date)}</text>
        </g>
      ))}
    </svg>
  )
}
