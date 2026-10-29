import { useState } from 'react'

// Tiny inline line chart with hover: shows the value at the hovered point.
// Auto-colors green/red by net direction unless a color is given.
// `label` (optional) prefixes the tooltip value, e.g. label="Score".
export default function Sparkline({ values, width = 130, height = 34, color, fillOpacity = 0.14, showEnd = true, label = '', fmt }) {
  const [hi, setHi] = useState(null)
  const vals = (values || []).map(Number).filter(v => !Number.isNaN(v))
  if (vals.length < 2) return <span className="hint" style={{ fontSize: '.7rem' }}>—</span>
  const lo = Math.min(...vals), hi2 = Math.max(...vals), span = (hi2 - lo) || 1
  const px = 3, py = 4
  const X = i => px + (width - 2 * px) * (i / (vals.length - 1))
  const Y = v => py + (height - 2 * py) * (1 - (v - lo) / span)
  const line = vals.map((v, i) => `${X(i)},${Y(v)}`).join(' ')
  const area = `${X(0)},${height - py} ${line} ${X(vals.length - 1)},${height - py}`
  const first = vals[0], last = vals[vals.length - 1]
  const c = color || (last >= first ? 'var(--green)' : 'var(--red)')
  const fv = v => (fmt ? fmt(v) : (Math.round(v * 100) / 100).toLocaleString('en-IN'))
  return (
    <span className="spark-wrap" style={{ width, height }} onMouseLeave={() => setHi(null)}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="spark" preserveAspectRatio="none">
        <polygon points={area} fill={c} opacity={fillOpacity} />
        <polyline points={line} fill="none" stroke={c} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
        {showEnd && hi == null && <circle cx={X(vals.length - 1)} cy={Y(last)} r="2.6" fill={c} />}
        {hi != null && <line x1={X(hi)} x2={X(hi)} y1={py} y2={height - py} stroke="var(--muted)" strokeWidth="1" opacity="0.6" />}
        {hi != null && <circle cx={X(hi)} cy={Y(vals[hi])} r="3" fill={c} stroke="var(--panel)" strokeWidth="1.2" />}
        {vals.map((v, i) => (
          <rect key={i} x={X(i) - (width / vals.length) / 2} y={0} width={Math.max(2, width / vals.length)} height={height}
                fill="transparent" onMouseEnter={() => setHi(i)} />
        ))}
      </svg>
      {hi != null && (
        <span className="spark-tip" style={{ left: `${X(hi) / width * 100}%` }}>
          {label ? label + ' ' : ''}{fv(vals[hi])}
        </span>
      )}
    </span>
  )
}
