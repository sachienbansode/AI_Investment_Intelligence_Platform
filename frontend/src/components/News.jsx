import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtIST, fmtDate } from '../fmt.js'
import { api } from '../api.js'
import Pager from './Pager.jsx'

const RANGES = [
  { k: 'all', label: 'Any time' },
  { k: '1', label: 'Today' },
  { k: '3', label: 'Last 3 days' },
  { k: '7', label: 'Last 7 days' },
  { k: '30', label: 'Last 30 days' },
]

export default function News() {
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [page, setPage] = useState(0)
  const [q, setQ] = useState('')
  const [range, setRange] = useState('all')
  const [sent, setSent] = useState('all')
  const [src, setSrc] = useState('all')
  const [sector, setSector] = useState('all')

  async function load(refresh = false) {
    setBusy(true); setErr('')
    try {
      const d = await api.news(refresh, 100)
      setItems(d.items || [])
      setPage(0)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }
  useEffect(() => { load() }, [])

  const [agent, setAgent] = useState(null)
  const wasRunning = useRef(false)
  useEffect(() => {
    let t
    const poll = () => api.agentsStatus().then(d => {
      setAgent(d)
      if (wasRunning.current && !d.running) load()
      wasRunning.current = d.running
      t = setTimeout(poll, d.running ? 5000 : 60000)
    }).catch(() => { t = setTimeout(poll, 60000) })
    poll()
    return () => clearTimeout(t)
  }, [])

  // Filter options derived from what's actually loaded.
  const sources = useMemo(() => [...new Set(items.map(n => n.source).filter(Boolean))].sort(), [items])
  const sectors = useMemo(() => [...new Set(items.flatMap(n => n.impacted_sectors || []).filter(Boolean))].sort(), [items])
  const hasSentiment = useMemo(() => items.some(n => n.sentiment), [items])

  const query = q.trim().toLowerCase()
  const cutoff = range === 'all' ? null : Date.now() - Number(range) * 86400000
  const filtered = items.filter(n => {
    if (query) {
      const hay = [n.title, n.summary_short, n.summary_detailed, n.source,
        ...(n.impacted_stocks || []), ...(n.impacted_sectors || [])]
        .filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(query)) return false
    }
    if (sent !== 'all' && n.sentiment !== sent) return false
    if (src !== 'all' && n.source !== src) return false
    if (sector !== 'all' && !(n.impacted_sectors || []).includes(sector)) return false
    if (cutoff != null) {
      const t = Date.parse(n.published)
      if (!Number.isNaN(t) && t < cutoff) return false   // keep items with no/unparseable date
    }
    return true
  })
  const activeFilters = (query ? 1 : 0) + (range !== 'all') + (sent !== 'all') + (src !== 'all') + (sector !== 'all')
  useEffect(() => { setPage(0) }, [q, range, sent, src, sector])
  const clearAll = () => { setQ(''); setRange('all'); setSent('all'); setSrc('all'); setSector('all') }

  return (
    <div>
      <div className="toolbar">
        <input type="search" value={q} placeholder="Search news — title, summary, source, stock or sector…"
               onChange={e => setQ(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
        <button className="ghost" onClick={() => load(true)} disabled={busy}>↻ Refresh</button>
      </div>

      <div className="news-filters">
        <label>Date
          <select value={range} onChange={e => setRange(e.target.value)}>
            {RANGES.map(r => <option key={r.k} value={r.k}>{r.label}</option>)}
          </select>
        </label>
        {hasSentiment && (
          <label>Sentiment
            <select value={sent} onChange={e => setSent(e.target.value)}>
              <option value="all">All</option>
              <option value="positive">Positive</option>
              <option value="neutral">Neutral</option>
              <option value="negative">Negative</option>
            </select>
          </label>
        )}
        <label>Source
          <select value={src} onChange={e => setSrc(e.target.value)}>
            <option value="all">All sources</option>
            {sources.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        {sectors.length > 0 && (
          <label>Sector
            <select value={sector} onChange={e => setSector(e.target.value)}>
              <option value="all">All sectors</option>
              {sectors.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
        {activeFilters > 0 && <button className="ghost sm" onClick={clearAll}>Clear filters</button>}
      </div>

      {activeFilters > 0 && <p className="hint">{filtered.length} of {items.length} item{filtered.length === 1 ? '' : 's'} match.</p>}
      {busy && <p className="hint">Loading…</p>}
      {agent?.running && (
        <p className="note">⏳ Market news is being refreshed now (the agent pipeline is running).
          New items will appear automatically.</p>
      )}
      {agent && !agent.running && (() => {
        const job = (agent.scheduled_jobs || []).find(j => j.id === 'news_refresh')
        return job?.next_run
          ? <p className="hint">News auto-refreshes in the background · next update {fmtIST(job.next_run)} IST.</p> : null
      })()}
      {err && <p className="note">{err}</p>}
      {!busy && filtered.length === 0 && items.length > 0 && (
        <p className="hint">No news matches these filters. <button className="link-btn" onClick={clearAll}>Clear filters</button></p>
      )}
      {filtered.slice(page * 10, page * 10 + 10).map((n, i) => (
        <article key={i} className="news-item">
          <h3><a href={n.link} target="_blank" rel="noreferrer">{n.title}</a></h3>
          <div className="meta">
            {n.source} {n.published && `· ${fmtDate(n.published)}`}
            {n.sentiment && <span className={`tag ${n.sentiment}`}>{n.sentiment}</span>}
          </div>
          {n.summary_short && <p>{n.summary_short}</p>}
          {n.summary_detailed && <details><summary>Detailed summary</summary><p>{n.summary_detailed}</p></details>}
          <div className="tags">
            {(n.impacted_stocks || []).map(s => <span key={s} className="tag stock">{s}</span>)}
            {(n.impacted_sectors || []).map(s => <span key={s} className="tag sector">{s}</span>)}
          </div>
        </article>
      ))}
      <Pager page={page} setPage={setPage} total={filtered.length} size={10} label="news items" />
    </div>
  )
}
