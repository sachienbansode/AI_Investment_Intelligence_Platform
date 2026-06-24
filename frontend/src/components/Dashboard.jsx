import { useEffect, useState } from 'react'
import { api } from '../api.js'
import TrendChart from './TrendChart.jsx'
import Sparkline from './Sparkline.jsx'

function scoreColor(v) {
  if (v >= 65) return 'var(--green)'
  if (v >= 45) return 'var(--amber)'
  return 'var(--red)'
}

// Smooth red -> orange -> green scale so clustered scores still show clear
// gradation on the heatmap and trend bars (the 3 bands above are kept for the
// semantic score badges elsewhere).
function heatColor(v) {
  const t = Math.max(0, Math.min(1, (v - 35) / 35))
  const hue = Math.round(8 + t * 122)
  return `hsl(${hue}, 60%, 42%)`
}

export default function Dashboard({ go, openScore, scoreLabel = 'NITRI Score' }) {
  const [scores, setScores] = useState(null)
  const [news, setNews] = useState([])
  const [watch, setWatch] = useState([])
  const [trend, setTrend] = useState(null)
  const [range, setRange] = useState(7)
  const [idx, setIdx] = useState('Nifty 500 (all)')
  const [consts, setConsts] = useState({})

  useEffect(() => {
    api.scores().then(setScores).catch(() => {})
    api.news().then(d => setNews((d.items || []).slice(0, 5))).catch(() => {})
    api.watchlist().then(d => setWatch(d.watchlist || [])).catch(() => {})
    api.indexConstituents().then(setConsts).catch(() => {})
  }, [])
  useEffect(() => {
    const all = scores?.scores || []
    let syms = ''
    if (idx !== 'Nifty 500 (all)') {
      const inIdx = s => idx.startsWith('Sector: ') ? s.sector === idx.slice(8)
        : (Array.isArray(consts[idx]) ? consts[idx].includes(s.symbol) : true)
      const list = all.filter(inIdx).map(s => s.symbol)
      if (list.length) syms = list.join(',')
    }
    api.trends(range, syms).then(setTrend).catch(() => {})
  }, [range, idx, scores, consts])

  const list = scores?.scores || []
  const allSectors = [...new Set(list.map(s => s.sector).filter(Boolean))].sort()
  const idxOptions = ['Nifty 500 (all)', ...Object.keys(consts).filter(k => Array.isArray(consts[k])),
                      ...allSectors.map(s => 'Sector: ' + s)]
  const inIndex = s => idx === 'Nifty 500 (all)' ? true
    : idx.startsWith('Sector: ') ? s.sector === idx.slice(8)
    : (Array.isArray(consts[idx]) ? consts[idx].includes(s.symbol) : true)
  const flist = list.filter(inIndex)
  const fsyms = new Set(flist.map(s => s.symbol))
  const avg = flist.length ? (flist.reduce((a, s) => a + s.composite_score, 0) / flist.length).toFixed(1) : '—'
  const top = [...flist].sort((a, b) => b.composite_score - a.composite_score).slice(0, 5)
  const approved = flist.filter(s => s.quality_status === 'approved').length
  const gainers = (trend?.gainers || []).filter(m => fsyms.has(m.symbol))
  const losers = (trend?.losers || []).filter(m => fsyms.has(m.symbol))
  const maxDelta = Math.max(1, ...[...gainers, ...losers].map(m => Math.abs(m.delta)))
  const sectorStats = Object.entries(flist.reduce((m, s) => {
    const k = s.sector || 'Other'; (m[k] = m[k] || []).push(s.composite_score); return m
  }, {})).map(([sector, arr]) => ({
    sector, count: arr.length, avg: arr.reduce((a, b) => a + b, 0) / arr.length,
  })).sort((a, b) => b.avg - a.avg)

  return (
    <div>
      <div className="toolbar" style={{ marginTop: 0 }}>
        <span className="hint">Index</span>
        <select value={idx} onChange={e => setIdx(e.target.value)}
                title="Filter the dashboard by index or sector">
          {idxOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        {idx !== 'Nifty 500 (all)' && <span className="hint">{flist.length} scripts</span>}
      </div>
      <div className="kpi-row">
        <div className="kpi" title="Number of scripts scored by the AI pipeline on the latest scoring date">
          <span className="kpi-label">Scripts scored</span>
          <span className="kpi-value">{flist.length || '—'}</span>
          <span className="kpi-sub">{scores?.score_date || ''}</span></div>
        <div className="kpi" title="Mean AI composite score (0–100) across all scored scripts. The score is a proprietary weighted blend of 8 factors: fundamentals, technicals, valuation, momentum, earnings, news sentiment, institutional activity and risk.">
          <span className="kpi-label">Average {scoreLabel}</span>
          <span className="kpi-value">{avg}</span>
          <span className="kpi-sub">out of 100</span></div>
        <div className="kpi" title="Scores that passed the Quality Agent's validation (or admin review). Only approved scores are used by the AI Assistant.">
          <span className="kpi-label">Quality approved</span>
          <span className="kpi-value">{list.length ? approved : '—'}</span>
          <span className="kpi-sub">maker-checker</span></div>
        <div className="kpi" title="Scripts you follow in your personal watchlist">
          <span className="kpi-label">Your watchlist</span>
          <span className="kpi-value">{watch.length}</span>
          <span className="kpi-sub">scripts followed</span></div>
      </div>

      <TrendChart trend={trend} range={range} setRange={setRange} scoreLabel={scoreLabel} />

      {sectorStats.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3 title="Average AI score per sector across all scored scripts. Greener = stronger average. Click a tile to open Stock Scores.">Sector strength</h3>
            <button className="ghost sm" onClick={() => go('Stock Scores')}>View all →</button>
          </div>
          <div className="sector-bars">
            {sectorStats.map(s => (
              <div key={s.sector} className="sbar-row row-click"
                   title={`${s.sector}: average ${s.avg.toFixed(1)}/100 across ${s.count} script(s)`}
                   onClick={() => go('Stock Scores')}>
                <span className="sbar-name">{s.sector}</span>
                <div className="sbar-track"><div className="sbar-fill" style={{ width: `${s.avg}%`, background: heatColor(s.avg) }} /></div>
                <span className="sbar-val" style={{ color: heatColor(s.avg) }}>{s.avg.toFixed(1)}</span>
                <span className="sbar-cnt">{s.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}


      {trend && (gainers.length > 0 || losers.length > 0) && (
        <div className="grid2">
          <div className="panel">
            <h4 title={`Change = AI-score movement over the selected ${range}-day window, shown as points and %. Informational analytics, not recommendations.`}>▲ Top score gainers ({range}d)</h4>
            {gainers.length === 0 && <p className="hint">No gainers in window.</p>}
            {gainers.map(m => (
              <div key={m.symbol} className="move-row row-click"
                   title={`${m.from} → ${m.to} · open in Stock Scores`} onClick={() => openScore && openScore(m.symbol)}>
                <strong>{m.symbol}</strong>
                <Sparkline values={[m.from, m.to]} width={62} height={24} color="var(--green)" />
                <div className="move-track"><div className="move-fill" style={{ width: `${Math.abs(m.delta) / maxDelta * 100}%`, background: 'var(--green)' }} /></div>
                <span className="up">▲ {m.delta} ({m.from ? '+' + (m.delta / m.from * 100).toFixed(1) + '%' : '—'})</span>
              </div>
            ))}
          </div>
          <div className="panel">
            <h4 title={`Change = AI-score movement over the selected ${range}-day window, shown as points and %.`}>▼ Top score decliners ({range}d)</h4>
            {losers.length === 0 && <p className="hint">No decliners in window.</p>}
            {losers.map(m => (
              <div key={m.symbol} className="move-row row-click"
                   title={`${m.from} → ${m.to} · open in Stock Scores`} onClick={() => openScore && openScore(m.symbol)}>
                <strong>{m.symbol}</strong>
                <Sparkline values={[m.from, m.to]} width={62} height={24} color="var(--red)" />
                <div className="move-track"><div className="move-fill" style={{ width: `${Math.abs(m.delta) / maxDelta * 100}%`, background: 'var(--red)' }} /></div>
                <span className="down">▼ {Math.abs(m.delta)} ({m.from ? '−' + Math.abs(m.delta / m.from * 100).toFixed(1) + '%' : '—'})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid2">
        <div className="panel">
          <div className="panel-head">
            <h3>Top {scoreLabel}</h3>
            <button className="ghost sm" onClick={() => go('Stock Scores')}>View all →</button>
          </div>
          {top.length === 0 && <p className="hint">No scores yet — run the pipeline from Stock Scores.</p>}
          {top.map(s => (
            <div key={s.symbol} className="rank-row row-click" title="Open in Stock Scores"
                 onClick={() => openScore && openScore(s.symbol)}>
              <strong>{s.symbol}</strong>
              <span className="hint">{s.sector}{s.last_price != null ? ' · ₹' + Number(s.last_price).toLocaleString('en-IN') : ''}</span>
              <div className="bar slim"><div style={{ width: `${s.composite_score}%`, background: scoreColor(s.composite_score) }} /></div>
              <span className="score sm" style={{ background: scoreColor(s.composite_score) }}>{s.composite_score}</span>
            </div>
          ))}
        </div>

        <div className="panel">
          <div className="panel-head">
            <h3>Latest market news</h3>
            <button className="ghost sm" onClick={() => go('Market News')}>View all →</button>
          </div>
          {news.length === 0 && <p className="hint">Loading news…</p>}
          {news.map((n, i) => (
            <div key={i} className="mini-news">
              <a href={n.link} target="_blank" rel="noreferrer">{n.title}</a>
              <div className="hint">{n.source}
                {n.sentiment && <span className={`tag ${n.sentiment}`}>{n.sentiment}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {watch.length > 0 && (
        <div className="panel">
          <div className="panel-head">
            <h3>Your watchlist</h3>
            <button className="ghost sm" onClick={() => go('Watchlist')}>Manage →</button>
          </div>
          <div className="watch-strip">
            {watch.map(w => (
              <div key={w.symbol} className="watch-chip row-click" title="Open in Stock Scores"
                   onClick={() => openScore && openScore(w.symbol)}>
                <strong>{w.symbol}</strong>
                <span>{w.last_price != null ? `₹${w.last_price.toLocaleString('en-IN')}` : '—'}</span>
                <span className={w.change_pct >= 0 ? 'up' : 'down'}>
                  {w.change_pct != null ? `${w.change_pct > 0 ? '+' : ''}${w.change_pct}%` : ''}</span>
                {w.ai_score != null && <span className="score sm" style={{ background: scoreColor(w.ai_score) }}>{w.ai_score}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
