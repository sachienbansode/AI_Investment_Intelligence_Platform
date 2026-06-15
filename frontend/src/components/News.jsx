import { useEffect, useState } from 'react'
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

  return (
    <div>
      <div className="toolbar">
        <button onClick={() => load(true)} disabled={busy}>{busy ? 'Loading…' : 'Refresh news'}</button>
      </div>
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
