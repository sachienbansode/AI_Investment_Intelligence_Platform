import { useEffect, useRef, useState } from 'react'
import { fmtIST } from '../fmt.js'
import { api } from '../api.js'
import Pager from './Pager.jsx'

export default function News() {
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [page, setPage] = useState(0)

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
      if (wasRunning.current && !d.running) load()   // reload when a pipeline run finishes
      wasRunning.current = d.running
      t = setTimeout(poll, d.running ? 5000 : 60000)
    }).catch(() => { t = setTimeout(poll, 60000) })
    poll()
    return () => clearTimeout(t)
  }, [])

  return (
    <div>
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
      {items.slice(page * 10, page * 10 + 10).map((n, i) => (
        <article key={i} className="news-item">
          <h3><a href={n.link} target="_blank" rel="noreferrer">{n.title}</a></h3>
          <div className="meta">
            {n.source} {n.published && `· ${n.published}`}
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
      <Pager page={page} setPage={setPage} total={items.length} size={10} label="news items" />
    </div>
  )
}
