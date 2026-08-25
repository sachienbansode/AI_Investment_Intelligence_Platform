import { useState } from 'react'

const W = 760, M = { l: 40, r: 16, t: 24, b: 8 }
const f1 = v => (v == null ? '—' : Number(v).toFixed(1))
function band(v) { return v >= 65 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)' }

export default function TrendChart({ trend, range, setRange, scoreLabel = 'Score' }) {
  const [hi, setHi] = useState(null)
  const daily = (trend && trend.daily) || []
  const n = daily.length

  const Header = (
    <div className="panel-head">
      <h3 title="Daily average score with the min–max range, score-band composition and day-over-day change.">Score Trend</h3>
      <div>
        {[7, 30].map(d => (
          <button key={d} className={`sm ${range === d ? '' : 'ghost'}`}
                  style={{ marginLeft: 6 }} onClick={() => setRange(d)}>{d} days</button>
        ))}
      </div>
    </div>
  )

  if (n === 0) {
    return (
      <div className="panel">
        {Header}
        <p className="hint">No scoring history in this window yet — trends build up as the daily pipeline runs.</p>
      </div>
    )
  }

  const H = 260
  const iw = W - M.l - M.r, ih = H - M.t - M.b - 16
  const avgs = daily.map(d => d.avg_score)
  const mins = daily.map(d => d.min_score ?? d.avg_score)
  const maxs = daily.map(d => d.max_score ?? d.avg_score)
  let yMin = Math.max(0, Math.min(40, Math.floor((Math.min(...mins) - 3) / 5) * 5))
  let yMax = Math.min(100, Math.max(66, Math.ceil((Math.max(...maxs) + 3) / 5) * 5))
  const x = i => M.l + (n === 1 ? iw / 2 : iw * i / (n - 1))
  const y = v => M.t + ih * (1 - (v - yMin) / (yMax - yMin))
  const step = (yMax - yMin) <= 35 ? 5 : 10
  const ticks = []
  for (let t = yMin; t <= yMax + 0.1; t += step) ticks.push(t)

  const labelEvery = Math.ceil(n / 12)
  // Average (score) labels: every point for short windows, and a readable subset
  // (date-axis cadence + latest point) for longer windows like 30 days.
  const showLbl = i => n <= 10 || i % labelEvery === 0 || i === n - 1
  // Min/max range labels only on short windows - on 30 days they clutter the
  // chart, so the 30-day view shows scores only.
  const showMM = n <= 8

  const bandPath = 'M' + maxs.map((v, i) => `${x(i)},${y(v)}`).join(' L ')
    + ' L ' + mins.map((v, i) => `${x(i)},${y(v)}`).reverse().join(' L ') + ' Z'
  const avgLine = avgs.map((v, i) => `${x(i)},${y(v)}`).join(' ')

  const first = daily[0], last = daily[n - 1]
  const change = +(last.avg_score - first.avg_score).toFixed(1)
  const strongest = daily.reduce((a, b) => (b.avg_score > a.avg_score ? b : a))
  const weakest = daily.reduce((a, b) => (b.avg_score < a.avg_score ? b : a))
  const cov = Math.round(daily.reduce((s, d) => s + d.count, 0) / n)
  const dt = d => `${d.date.slice(8)}/${d.date.slice(5, 7)}`

  const h = hi != null ? daily[hi] : null
  const hDelta = hi != null && hi > 0 ? +(daily[hi].avg_score - daily[hi - 1].avg_score).toFixed(1) : null

  return (
    <div className="panel">
      {Header}

      <div className="trend2-summary">
        <div className="t2card"><span className="t2lab">Latest avg</span><span className="t2val" style={{ color: band(last.avg_score) }}>{f1(last.avg_score)}</span></div>
        <div className="t2card"><span className="t2lab">Change ({range}d)</span><span className={'t2val ' + (change >= 0 ? 'up' : 'down')}>{change >= 0 ? '▲ +' : '▼ '}{f1(Math.abs(change))}</span></div>
        <div className="t2card"><span className="t2lab">Strongest day</span><span className="t2val">{f1(strongest.avg_score)}<small> {dt(strongest)}</small></span></div>
        <div className="t2card"><span className="t2lab">Weakest day</span><span className="t2val">{f1(weakest.avg_score)}<small> {dt(weakest)}</small></span></div>
        <div className="t2card"><span className="t2lab">Avg coverage</span><span className="t2val">{cov}<small> scripts</small></span></div>
      </div>

      <div className="trend2-legend">
        <span><i className="lg-line" /> Average</span>
        <span><i className="lg-band" /> Min–max range</span>
        <span><i className="lg-dot" style={{ background: 'var(--green)' }} /> Strong 65+</span>
        <span><i className="lg-dot" style={{ background: 'var(--amber)' }} /> Neutral 50–64</span>
        <span><i className="lg-dot" style={{ background: 'var(--red)' }} /> Weak &lt;50</span>
      </div>

      <div className="trend2-wrap" onMouseLeave={() => setHi(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} className="trend2-svg" preserveAspectRatio="none">
          {ticks.map(t => (
            <g key={t}>
              <line x1={M.l} y1={y(t)} x2={W - M.r} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
              <text x={M.l - 6} y={y(t) + 3} textAnchor="end" className="t2axis">{t}</text>
            </g>
          ))}
          {[50, 65].filter(r => r > yMin && r < yMax).map(r => (
            <g key={r}>
              <line x1={M.l} y1={y(r)} x2={W - M.r} y2={y(r)} stroke={r >= 65 ? 'var(--green)' : 'var(--amber)'} strokeWidth="1" strokeDasharray="4 4" opacity="0.6" />
              <text x={W - M.r} y={y(r) - 3} textAnchor="end" className="t2ref" fill={r >= 65 ? 'var(--green)' : 'var(--amber)'}>{r >= 65 ? 'strong' : 'neutral'} {r}</text>
            </g>
          ))}

          <path className="t2-band" d={bandPath} fill="var(--accent)" opacity="0.12" />
          <polyline className="t2-line" pathLength="1" points={avgLine} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

          {daily.map((d, i) => (
            <g key={d.date}>
              {showMM && <text x={x(i)} y={y(maxs[i]) - 5} textAnchor="middle" className="t2mm">{f1(maxs[i])}</text>}
              {showMM && <text x={x(i)} y={y(mins[i]) + 12} textAnchor="middle" className="t2mm">{f1(mins[i])}</text>}
              <circle cx={x(i)} cy={y(d.avg_score)} r={hi === i ? 5 : 3.5} fill={band(d.avg_score)} stroke="var(--panel)" strokeWidth="1.5" />
              {showLbl(i) && <text x={x(i)} y={y(d.avg_score) - 10} textAnchor="middle" className="t2pt">{f1(d.avg_score)}</text>}
            </g>
          ))}

          {hi != null && <line x1={x(hi)} y1={M.t} x2={x(hi)} y2={M.t + ih} stroke="var(--accent)" strokeWidth="1" opacity="0.5" />}
          {daily.map((d, i) => (
            <rect key={i} x={x(i) - (iw / n) / 2} y={M.t} width={iw / n} height={ih}
                  fill="transparent" onMouseEnter={() => setHi(i)} />
          ))}
        </svg>

        <svg viewBox={`0 0 ${W} 92`} className="trend2-comp" preserveAspectRatio="none">
          {daily.map((d, i) => {
            const st = d.strong || 0, ne = d.neutral || 0, wk = d.weak || 0
            const tot = st + ne + wk || 1
            const bw = Math.min(26, iw / n * 0.72)
            const bh = 56, bx = x(i) - bw / 2
            // guarantee each non-zero band a visible minimum, fill the rest proportionally
            const MIN = 4
            const nz = (st > 0) + (ne > 0) + (wk > 0)
            const avail = Math.max(0, bh - nz * MIN)
            const seg = v => (v > 0 ? MIN + (v / tot) * avail : 0)
            const ws = seg(wk), ns = seg(ne), ss = seg(st)
            const op = hi === i ? 1 : 0.9
            return (
              <g key={d.date} onMouseEnter={() => setHi(i)}>
                <rect x={bx} y={2} width={bw} height={ws} rx="1.5" fill="var(--red)" opacity={op} />
                <rect x={bx} y={2 + ws} width={bw} height={ns} fill="var(--amber)" opacity={op} />
                <rect x={bx} y={2 + ws + ns} width={bw} height={ss} rx="1.5" fill="var(--green)" opacity={op} />
                {(i % labelEvery === 0 || hi === i) && <text x={x(i)} y={74} textAnchor="middle" className="t2date">{dt(d)}</text>}
                {(i % labelEvery === 0 || hi === i) && <text x={x(i)} y={87} textAnchor="middle" className="t2cnt">{d.count}</text>}
              </g>
            )
          })}
        </svg>

        {h && (
          <div className="trend2-tip" style={{ left: `${x(hi) / W * 100}%` }}>
            <div className="t2tip-d">{h.date}</div>
            <div className="t2tip-row"><span>Average</span><b style={{ color: band(h.avg_score) }}>{f1(h.avg_score)}</b></div>
            <div className="t2tip-row"><span>Range</span><b>{f1(h.min_score)} – {f1(h.max_score)}</b></div>
            <div className="t2tip-row"><span>Day change</span><b className={hDelta == null ? '' : hDelta >= 0 ? 'up' : 'down'}>{hDelta == null ? '—' : (hDelta >= 0 ? '+' : '') + f1(hDelta)}</b></div>
            <div className="t2tip-row"><span>Coverage</span><b>{h.count} scripts</b></div>
            <div className="t2tip-bands">
              <span style={{ color: 'var(--green)' }}>{h.strong ?? 0} strong</span>
              <span style={{ color: 'var(--amber)' }}>{h.neutral ?? 0} neutral</span>
              <span style={{ color: 'var(--red)' }}>{h.weak ?? 0} weak</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
