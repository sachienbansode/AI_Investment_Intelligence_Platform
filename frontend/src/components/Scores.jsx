import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { fmtIST } from '../fmt.js'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'

const PILLARS = ['fundamental', 'technical', 'valuation', 'momentum', 'earnings',
                 'news_sentiment', 'institutional', 'risk']

export const SCORE_DEFINITION =
  'AI Score (0–100): a proprietary weighted composite of 8 factors — fundamentals, ' +
  'technicals, valuation, momentum, earnings, news sentiment, institutional ' +
  'activity and risk. Bands: 65+ strong profile, 45–64 neutral, below 45 weak. ' +
  'Generated daily by the AI agent pipeline. Informational only — not investment advice.'

const STATUS_TIP =
  'Quality gate (maker-checker): "approved" = the Quality Agent validated this ' +
  'score (range & completeness checks) or an admin approved it in Admin → Score ' +
  'review. Only approved scores are used by the AI Assistant. "rejected" = failed ' +
  'validation or rejected by an admin.'

function color(v) {
  if (v >= 65) return 'var(--green)'
  if (v >= 45) return 'var(--amber)'
  return 'var(--red)'
}

export default function Scores({ isAdmin, askAI, seed, clearSeed }) {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [open, setOpen] = useState(null)
  const [q, setQ] = useState('')
  const [sector, setSector] = useState('')
  const [sortKey, setSortKey] = useState('score')
  const [sortDir, setSortDir] = useState('desc')
  const [refreshing, setRefreshing] = useState(null)
  const [page, setPage] = useState(0)
  const PAGE_SIZE = 20

  const load = () => api.scores().then(setData).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (seed) { setQ(seed); setOpen(seed); clearSeed && clearSeed() }
  }, [seed]) // eslint-disable-line
  function setSort(key) {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir(key === 'symbol' ? 'asc' : 'desc') }
  }
  const arrow = key => sortKey === key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''

  const [agent, setAgent] = useState(null)
  const wasRunning = useRef(false)
  useEffect(() => {
    let t
    const poll = () => api.agentsStatus().then(d => {
      setAgent(d)
      if (wasRunning.current && !d.running) load()   // auto-reload when a run finishes
      wasRunning.current = d.running
      t = setTimeout(poll, d.running ? 5000 : 60000)
    }).catch(() => { t = setTimeout(poll, 60000) })
    poll()
    return () => clearTimeout(t)
  }, [])

  async function refreshOne(e, symbol) {
    e.stopPropagation()
    setRefreshing(symbol); setErr('')
    try {
      await api.refreshScore(symbol)
      await load()
      setOpen(symbol)
    } catch (ex) { setErr(ex.message) }
    setRefreshing(null)
  }

  const sectors = useMemo(() =>
    [...new Set((data?.scores || []).map(s => s.sector).filter(Boolean))].sort(), [data])

  const filtered = useMemo(() => {
    let r = data?.scores || []
    if (q) r = r.filter(s => s.symbol.toLowerCase().includes(q.toLowerCase()))
    if (sector) r = r.filter(s => s.sector === sector)
    const dir = sortDir === 'desc' ? -1 : 1
    const val = x => sortKey === 'symbol' ? x.symbol
      : sortKey === 'change' ? (x.delta ?? -Infinity) : x.composite_score
    return [...r].sort((a, b) => {
      const va = val(a), vb = val(b)
      return typeof va === 'string' ? dir * va.localeCompare(vb) : dir * (va - vb)
    })
  }, [data, q, sector, sortKey, sortDir])

  useEffect(() => { setPage(0) }, [q, sector, sortKey, sortDir])
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const rows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)

  return (
    <div>
      <div className="panel score-legend" title={SCORE_DEFINITION}>
        <span className="info-i">i</span>
        <span><strong>AI Score</strong> is out of <strong>100</strong> — a proprietary weighted
        blend of 8 factors: fundamentals, technicals, valuation, momentum, earnings,
        news sentiment, institutional activity and risk.&nbsp;
        <span style={{ color: 'var(--green)' }}>■ 65+ strong</span>&nbsp;
        <span style={{ color: 'var(--amber)' }}>■ 45–64 neutral</span>&nbsp;
        <span style={{ color: 'var(--red)' }}>■ &lt;45 weak</span>.
        Hover any column header for its definition.</span>
      </div>

      {agent?.running && (
        <p className="note">⏳ AI scores are updating now — the scoring pipeline is running
          ({agent.active_agents?.join(', ') || 'in progress'}). This table refreshes
          automatically when it completes.</p>
      )}
      {agent && !agent.running && (() => {
        const job = (agent.scheduled_jobs || []).find(j => j.id === 'daily_scoring')
        return job?.next_run
          ? <p className="hint">Next automated scoring update: {fmtIST(job.next_run)} IST.</p> : null
      })()}

      <div className="toolbar">
        <button className="ghost" onClick={load} title="Reload the table">Refresh</button>
        <input placeholder="Search script…" value={q} onChange={e => setQ(e.target.value)} />
        <select value={sector} onChange={e => setSector(e.target.value)}
                title="Filter by sector from the instruments master">
          <option value="">All sectors</option>
          {sectors.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {data?.score_date && <span className="hint">as of {data.score_date}</span>}
      </div>

      {err && <p className="note">{err}</p>}
      {filtered.length === 0 && <p className="hint">No scores yet for the current filter —
        newly imported scripts get scores on the next pipeline run (admins can trigger it
        from the Agents page).</p>}

      <table className="data-table">
        <thead><tr>
          <th title="Click to sort by script symbol" style={{ cursor: 'pointer' }} onClick={() => setSort('symbol')}>Script{arrow('symbol')}</th>
          <th title="Sector classification from the instruments master">Sector</th>
          <th title="Click to sort by AI score" style={{ cursor: 'pointer' }} onClick={() => setSort('score')}>AI Score / 100{arrow('score')} <span className="info-i">i</span></th>
          <th title="Δ Change = change in the AI score vs the previous scoring day, shown as points and %. Click to sort." style={{ cursor: 'pointer' }} onClick={() => setSort('change')}>Δ Change{arrow('change')}</th>
          <th title={STATUS_TIP}>Status <span className="info-i">i</span></th>
          <th title="Re-score this script now with a fresh live quote">Refresh</th>
        </tr></thead>
        <tbody>
          {rows.map(s => (
            <Fragment key={s.symbol}>
              <tr className="row-click" onClick={() => setOpen(open === s.symbol ? null : s.symbol)}>
                <td><strong>{s.symbol}</strong></td>
                <td className="hint">{s.sector || '—'}</td>
                <td><span className="score" style={{ background: color(s.composite_score) }}>{s.composite_score}</span></td>
                <td title={s.drivers?.length ? 'Drivers: ' + s.drivers.join(', ') : 'No previous score to compare'}>
                  {s.delta != null
                    ? <span className={s.delta > 0 ? 'up' : s.delta < 0 ? 'down' : 'hint'}>
                        {s.delta > 0 ? '▲' : s.delta < 0 ? '▼' : '–'} {Math.abs(s.delta)}
                        {s.prev_score ? ` (${s.delta > 0 ? '+' : s.delta < 0 ? '−' : ''}${Math.abs(s.delta / s.prev_score * 100).toFixed(1)}%)` : ''}
                      </span>
                    : <span className="hint">new</span>}
                </td>
                <td><span title={STATUS_TIP} className={`tag ${s.quality_status === 'approved' ? 'positive' : s.quality_status === 'rejected' ? 'negative' : ''}`}>{s.quality_status}</span></td>
                <td><button className="ghost sm" disabled={refreshing === s.symbol}
                            title="Re-score now with a fresh live quote and explain the change"
                            onClick={e => refreshOne(e, s.symbol)}>
                  {refreshing === s.symbol ? '…' : '↻'}</button></td>
              </tr>
              {open === s.symbol && (
                <tr>
                  <td colSpan={6}>
                    <div className="card-body">
                      {s.delta != null && (
                        <p className="explain" style={{ marginTop: 0 }}>
                          <strong className={s.delta > 0 ? 'up' : s.delta < 0 ? 'down' : 'hint'}>
                            {s.delta > 0 ? '▲ Up' : s.delta < 0 ? '▼ Down' : '– Unchanged'} {Math.abs(s.delta)} points
                            {s.prev_score ? ` (${s.delta > 0 ? '+' : s.delta < 0 ? '−' : ''}${Math.abs(s.delta / s.prev_score * 100).toFixed(1)}%)` : ''}
                          </strong> vs {s.prev_date} (was {s.prev_score}). Change = AI-score movement vs the previous scoring day.
                          {s.drivers?.length > 0 && <> Main drivers: {s.drivers.join(', ')}.</>}
                        </p>
                      )}
                      {PILLARS.map(p => (
                        <div key={p} className="pillar"
                             title={`${p.replace('_', ' ')} pillar score (0-100)`}>
                          <span>{p.replace('_', ' ')}</span>
                          <div className="bar"><div style={{ width: `${s.pillar_scores[p]}%`, background: color(s.pillar_scores[p]) }} /></div>
                          <span>{Math.round(s.pillar_scores[p])}</span>
                        </div>
                      ))}
                      <div className="explain md"
                           dangerouslySetInnerHTML={{ __html: mdToHtml(s.explanation) }} />
                      {askAI && (
                        <button className="ghost sm" style={{ marginTop: 8 }}
                                title="Open the AI Assistant pre-loaded with this script's score context"
                                onClick={e => { e.stopPropagation(); askAI(`Tell me about the AI score for ${s.symbol} — what's driving it and what changed recently?`) }}>
                          💬 Ask AI about this score</button>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>

      {filtered.length > PAGE_SIZE && (
        <div className="toolbar" style={{ justifyContent: 'center' }}>
          <button className="ghost sm" disabled={page === 0} onClick={() => setPage(0)}>« First</button>
          <button className="ghost sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
          <span className="hint">page {page + 1} of {pageCount} · {filtered.length} scripts</span>
          <button className="ghost sm" disabled={page >= pageCount - 1} onClick={() => setPage(p => p + 1)}>Next ›</button>
          <button className="ghost sm" disabled={page >= pageCount - 1} onClick={() => setPage(pageCount - 1)}>Last »</button>
        </div>
      )}
    </div>
  )
}
