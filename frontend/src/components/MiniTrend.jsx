// Interactive single-series score trend: hover anywhere for a crosshair + a
// tooltip with that day's score and date. Uniform scaling; responsive width.
import { useRef, useState } from 'react'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const fmtDate = d => `${d.slice(8, 10)}-${MON[(+d.slice(5, 7) || 1) - 1]}`

export default function MiniTrend({ data, color = 'var(--accent)' }) {
  const pts = (data || []).filter(d => d && d.score != null)
  const wrap = useRef(null)
  const [hi, setHi] = useState(null)
  if (pts.length < 2) return <span className="hint" style={{ fontSize: '.75rem' }}>Not enough history yet.</span>
  const n = pts.length
  const W = 640, H = 200, M = { l: 34, r: 18, t: 22, b: 30 }
  const vals = pts.map(p => p.score)
  const lo = Math.min(...vals), hi2 = Math.max(...vals), span = (hi2 - lo) || 1
  const yMin = lo - span * 0.25, yMax = hi2 + span * 0.25
  const iw = W - M.l - M.r, ih = H - M.t - M.b
  const X = i => M.l + iw * (n === 1 ? 0.5 : i / (n - 1))
  const Y = v => M.t + ih * (1 - (v - yMin) / ((yMax - yMin) || 1))
  const line = pts.map((p, i) => `${X(i)},${Y(p.score)}`).join(' ')
  const area = `${X(0)},${H - M.b} ${line} ${X(n - 1)},${H - M.b}`
  const ticks = [yMin, (yMin + yMax) / 2, yMax]
  const every = Math.max(1, Math.ceil(n / 8))
  const cur = hi != null ? pts[hi] : null

  function move(e) {
    const r = wrap.current.getBoundingClientRect()
    const frac = (e.clientX - r.left) / r.width
    // map to plot area (account for left/right margins in viewBox units)
    const px = frac * W
    const t = (px - M.l) / iw
    setHi(Math.max(0, Math.min(n - 1, Math.round(t * (n - 1)))))
  }

  return (
    <div className="mt-wrap" ref={wrap} onMouseMove={move} onMouseLeave={() => setHi(null)}
         onTouchMove={e => e.touches[0] && move(e.touches[0])}>
      <svg viewBox={`0 0 ${W} ${H}`} className="mini-trend" preserveAspectRatio="none"
           role="img" aria-label="Score history line chart">
        {ticks.map((t, k) => (
          <g key={k}>
            <line x1={M.l} y1={Y(t)} x2={W - M.r} y2={Y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={M.l - 6} y={Y(t) + 3} textAnchor="end" className="mt-axis">{Math.round(t)}</text>
          </g>
        ))}
        <polygon points={area} fill={color} opacity="0.12" />
        <polyline points={line} fill="none" stroke={color} strokeWidth="2"
                  strokeLinejoin="round" strokeLinecap="round" />
        {cur && <line x1={X(hi)} y1={M.t} x2={X(hi)} y2={H - M.b}
                      stroke="var(--border2)" strokeWidth="1" strokeDasharray="3 3" />}
        {pts.map((p, i) => (
          <circle key={p.date} cx={X(i)} cy={Y(p.score)} r={hi === i ? 4.5 : 2.5}
                  fill={color} stroke="var(--panel)" strokeWidth={hi === i ? 1.5 : 0} />
        ))}
        {pts.map((p, i) => (i % every === 0 || i === n - 1) && (
          <text key={'d' + p.date} x={X(i)} y={H - 10}
                textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="mt-date">{fmtDate(p.date)}</text>
        ))}
      </svg>
      {cur && (
        <div className="mt-tip" style={{ left: (X(hi) / W * 100) + '%' }}>
          <b>{cur.score}</b><span>{fmtDate(cur.date)}</span>
        </div>
      )}
    </div>
  )
}
