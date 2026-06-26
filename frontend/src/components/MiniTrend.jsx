// Responsive single-series score trend with score + date labels.
// Uniform scaling (preserveAspectRatio meet) so it never distorts on mobile.
export default function MiniTrend({ data, color = 'var(--accent)' }) {
  const pts = (data || []).filter(d => d && d.score != null)
  if (pts.length < 2) return <span className="hint" style={{ fontSize: '.75rem' }}>Not enough history yet.</span>
  const W = 640, H = 150, M = { l: 30, r: 16, t: 22, b: 30 }
  const vals = pts.map(p => p.score)
  const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1
  const yMin = lo - span * 0.18, yMax = hi + span * 0.18
  const iw = W - M.l - M.r, ih = H - M.t - M.b
  const X = i => M.l + iw * (pts.length === 1 ? 0.5 : i / (pts.length - 1))
  const Y = v => M.t + ih * (1 - (v - yMin) / ((yMax - yMin) || 1))
  const line = pts.map((p, i) => `${X(i)},${Y(p.score)}`).join(' ')
  const area = `${X(0)},${H - M.b} ${line} ${X(pts.length - 1)},${H - M.b}`
  const dt = d => `${d.slice(8)}/${d.slice(5, 7)}`
  const dateEvery = Math.ceil(pts.length / 8)        // thin out x labels
  const scoreEvery = pts.length <= 10 ? 1 : Math.ceil(pts.length / 10)
  const ticks = [yMin, (yMin + yMax) / 2, yMax]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mini-trend" role="img"
         aria-label="Score history line chart">
      {ticks.map((t, k) => (
        <g key={k}>
          <line x1={M.l} y1={Y(t)} x2={W - M.r} y2={Y(t)} stroke="var(--border)" strokeWidth="1" />
          <text x={M.l - 5} y={Y(t) + 3} textAnchor="end" className="mt-axis">{Math.round(t)}</text>
        </g>
      ))}
      <polygon points={area} fill={color} opacity="0.10" />
      <polyline points={line} fill="none" stroke={color} strokeWidth="2"
                strokeLinejoin="round" strokeLinecap="round" />
      {pts.map((p, i) => (
        <g key={p.date}>
          <circle cx={X(i)} cy={Y(p.score)} r="2.8" fill={color} />
          {(i % scoreEvery === 0 || i === pts.length - 1) &&
            <text x={X(i)} y={Y(p.score) - 7} textAnchor="middle" className="mt-score">{p.score}</text>}
          {(i % dateEvery === 0 || i === pts.length - 1) &&
            <text x={X(i)} y={H - 9} textAnchor="middle" className="mt-date">{dt(p.date)}</text>}
        </g>
      ))}
    </svg>
  )
}
