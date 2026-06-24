// Tiny inline line chart. Auto-colors green/red by net direction unless a color
// is given. Renders nothing meaningful for <2 points.
export default function Sparkline({ values, width = 130, height = 34, color, fillOpacity = 0.14, showEnd = true }) {
  const vals = (values || []).map(Number).filter(v => !Number.isNaN(v))
  if (vals.length < 2) return <span className="hint" style={{ fontSize: '.7rem' }}>—</span>
  const lo = Math.min(...vals), hi = Math.max(...vals), span = (hi - lo) || 1
  const px = 3, py = 4
  const X = i => px + (width - 2 * px) * (i / (vals.length - 1))
  const Y = v => py + (height - 2 * py) * (1 - (v - lo) / span)
  const line = vals.map((v, i) => `${X(i)},${Y(v)}`).join(' ')
  const area = `${X(0)},${height - py} ${line} ${X(vals.length - 1)},${height - py}`
  const first = vals[0], last = vals[vals.length - 1]
  const c = color || (last >= first ? 'var(--green)' : 'var(--red)')
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="spark" preserveAspectRatio="none">
      <polygon points={area} fill={c} opacity={fillOpacity} />
      <polyline points={line} fill="none" stroke={c} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {showEnd && <circle cx={X(vals.length - 1)} cy={Y(last)} r="2.6" fill={c} />}
    </svg>
  )
}
