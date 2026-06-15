import { useEffect, useState } from 'react'
import { api } from '../api.js'

function scoreColor(v) {
  if (v >= 65) return 'var(--green)'
  if (v >= 45) return 'var(--amber)'
  return 'var(--red)'
}

export default function Dashboard({ go, openScore }) {
  const [scores, setScores] = useState(null)
  const [news, setNews] = useState([])
  const [watch, setWatch] = useState([])
  const [trend, setTrend] = useState(null)
  const [range, setRange] = useState(7)

  useEffect(() => {
    api.scores().then(setScores).catch(() => {})
    api.news().then(d => setNews((d.items || []).slice(0, 5))).catch(() => {})
    api.watchlist().then(d => setWatch(d.watchlist || [])).catch(() => {})
  }, [])
  useEffect(() => {
    api.trends(range).then(setTrend).catch(() => {})
  }, [range])

  const list = scores?.scores || []
  const avg = list.length ? (list.reduce((a, s) => a + s.composite_score, 0) / list.length).toFixed(1) : '—'
  const top = [...list].sort((a, b) => b.composite_score - a.composite_score).slice(0, 5)
  const approved = list.filter(s => s.quality_status === 'approved').length
  const maxAvg = Math.max(60, ...(trend?.daily || []).map(d => d.avg_score))

  return (
    <div>
      <div className="kpi-row">
        <div className="kpi" title="Number of scripts scored by the AI pipeline on the latest scoring date">
          <span className="kpi-label">Scripts scored</span>
          <span className="kpi-value">{list.length || '—'}</span>
          <span className="kpi-sub">{scores?.score_date || ''}</span></div>
        <div className="kpi" title="Mean AI composite score (0–100) across all scored scripts. The score is a proprietary weighted blend of 8 factors: fundamentals, technicals, valuation, momentum, earnings, news sentiment, institutional activity and risk.">
          <span className="kpi-label">Average AI score</span>
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

      <div className="panel">
        <div className="panel-head">
          <h3 title="Average AI score per scoring run day. Bar height = average score; hover for date, average and coverage.">Score trend</h3>
          <div>
            {[7, 30].map(d => (
              <button key={d} className={`sm ${range === d ? '' : 'ghost'}`}
                      style={{ marginLeft: 6 }} onClick={() => setRange(d)}>{d} days</button>
            ))}
          </div>
        </div>
        {(!trend || trend.daily.length === 0) &&
          <p className="hint">No scoring history in this window yet — trends build up as
            the daily pipeline runs.</p>}
        {trend && trend.daily.length > 0 && (
          <div className="trend-chart">
            {trend.daily.map(d => (
              <div key={d.date} className="trend-col"
                   title={`${d.date} · avg ${d.avg_score}/100 · ${d.count} scripts`}>
                <div className="trend-bar"
                     style={{ height: `${Math.max(4, d.avg_score / maxAvg * 100)}%`,
                              background: scoreColor(d.avg_score) }} />
                <span className="trend-label">{d.date.slice(8)}/{d.date.slice(5, 7)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {trend && (trend.gainers.length > 0 || trend.losers.length > 0) && (
        <div className="grid2">
          <div className="panel">
            <h4 title={`Biggest AI-score increases over the selected ${range}-day window (informational analytics, not recommendations)`}>▲ Top score gainers ({range}d)</h4>
            {trend.gainers.length === 0 && <p className="hint">No gainers in window.</p>}
            {trend.gainers.map(m => (
              <div key={m.symbol} className="rank-row row-click" style={{ gridTemplateColumns: '110px 1fr 90px' }}
                   title="Open in Stock Scores" onClick={() => openScore && openScore(m.symbol)}>
                <strong>{m.symbol}</strong>
                <span className="hint">{m.from} → {m.to}</span>
                <span className="up">▲ {m.delta}</span>
              </div>
            ))}
          </div>
          <div className="panel">
            <h4 title={`Biggest AI-score decreases over the selected ${range}-day window`}>▼ Top score decliners ({range}d)</h4>
            {trend.losers.length === 0 && <p className="hint">No decliners in window.</p>}
            {trend.losers.map(m => (
              <div key={m.symbol} className="rank-row row-click" style={{ gridTemplateColumns: '110px 1fr 90px' }}
                   title="Open in Stock Scores" onClick={() => openScore && openScore(m.symbol)}>
                <strong>{m.symbol}</strong>
                <span className="hint">{m.from} → {m.to}</span>
                <span className="down">▼ {Math.abs(m.delta)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid2">
        <div className="panel">
          <div className="panel-head">
            <h3>Top AI scores</h3>
            <button className="ghost sm" onClick={() => go('Stock Scores')}>View all →</button>
          </div>
          {top.length === 0 && <p className="hint">No scores yet — run the pipeline from Stock Scores.</p>}
          {top.map(s => (
            <div key={s.symbol} className="rank-row row-click" title="Open in Stock Scores"
                 onClick={() => openScore && openScore(s.symbol)}>
              <strong>{s.symbol}</strong>
              <span className="hint">{s.sector}</span>
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
