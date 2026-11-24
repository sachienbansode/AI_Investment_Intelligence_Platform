// Shared NIYTRI Score history block used on both the Stock Scores page and the
// Watchlist: date-range toggle (1M/3M/6M/1Y), a min/max/now + LTP/% stat line,
// and the interactive MiniTrend chart (hover for score, LTP and % change).
import { useEffect, useState } from 'react'
import { api } from '../api.js'
import MiniTrend from './MiniTrend.jsx'

const RS = String.fromCharCode(0x20B9)                 // rupee sign
const RANGES = [[30, '1M'], [90, '3M'], [180, '6M'], [365, '1Y']]

export default function ScoreHistoryPanel({ symbol, scoreLabel = 'NIYTRI Score' }) {
  const [range, setRange] = useState(90)
  const [hist, setHist] = useState(null)               // null = loading, [] = none
  const [tab, setTab] = useState('score')              // 'score' | 'price'

  useEffect(() => {
    let alive = true
    setHist(null)
    api.scoreHistory(symbol, range)
      .then(d => { if (alive) setHist(d.history || []) })
      .catch(() => { if (alive) setHist([]) })
    return () => { alive = false }
  }, [symbol, range])

  if (hist === null) return <p className="hint" style={{ margin: '6px 0' }}>Loading {scoreLabel} history…</p>
  if (hist.length < 2) return <p className="hint" style={{ margin: '6px 0' }}>Not enough {scoreLabel} history yet.</p>

  const isPrice = tab === 'price'
  const hasPrice = hist.some(h => h.ltp != null)
  const svals = hist.map(h => h.score)
  const sLo = Math.min(...svals), sHv = Math.max(...svals)
  const pvals = hist.filter(h => h.ltp != null).map(h => h.ltp)
  const pLo = pvals.length ? Math.min(...pvals) : null, pHv = pvals.length ? Math.max(...pvals) : null
  const last = hist[hist.length - 1]

  return (
    <div className="score-hist">
      <div className="score-hist-head">
        <span className="sh-tabs">
          <button className={'sm sh-tab' + (tab === 'score' ? ' on' : '')} onClick={() => setTab('score')}>{scoreLabel}</button>
          {hasPrice && <button className={'sm sh-tab' + (tab === 'price' ? ' on' : '')} onClick={() => setTab('price')}>Price</button>}
          <span className="hint" style={{ marginLeft: 8 }}>· {hist.length} runs</span>
        </span>
        <span className="sh-range">
          {RANGES.map(([d, l]) => (
            <button key={d} className={`sm ${range === d ? '' : 'ghost'}`}
                    onClick={() => setRange(d)}>{l}</button>
          ))}
        </span>
      </div>
      <div className="score-hist-head sh-stats">
        {isPrice
          ? <span>Price: min <b>{RS}{pLo}</b> · max <b>{RS}{pHv}</b> · now <b>{last.ltp != null ? RS + last.ltp : '—'}</b></span>
          : <span>{scoreLabel}: min <b>{sLo}</b> · max <b>{sHv}</b> · now <b>{last.score}</b></span>}
        <span>
          {last.ltp != null && <>LTP <b>{RS}{last.ltp}</b></>}
          {last.pct != null && <b className={last.pct >= 0 ? 'up' : 'down'} style={{ marginLeft: 8 }}>
            {last.pct >= 0 ? '▲' : '▼'} {Math.abs(last.pct)}%</b>}
        </span>
      </div>
      <MiniTrend data={hist} metric={isPrice ? 'ltp' : 'score'}
                 color={isPrice ? 'var(--blue)' : 'var(--accent)'} scoreLabel={scoreLabel} />
    </div>
  )
}
