import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'

// NIYTRI Screeners: natural-language screening over the connected market data.
export default function Screener() {
  const [sug, setSug] = useState({ themes: [], prompts: [] })
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')

  useEffect(() => { api.screenerSuggestions().then(setSug).catch(() => {}) }, [])

  async function run(prompt) {
    const p = (prompt ?? q).trim()
    if (!p || busy) return
    setQ(p); setBusy(true); setErr(''); setRes(null)
    try {
      const r = await api.runScreener(p)
      if (r.error) setErr(r.error)
      setRes(r)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div>
      <p className="hint">Describe what you want to find in plain English — e.g. “energy stocks with
        improving margins amid rising oil prices”. Screens run over the connected market data.
        Information only, not investment advice.</p>

      <div className="chat-input" style={{ marginBottom: 12 }}>
        <textarea value={q} rows={2}
                  onChange={e => setQ(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run() } }}
                  placeholder="Describe your screen…  (Shift+Enter for a new line)" disabled={busy} />
        <button onClick={() => run()} disabled={busy || !q.trim()}>{busy ? 'Screening…' : 'Screen'}</button>
      </div>

      {sug.themes?.length > 0 && (
        <>
          <div className="followup-label">Themes</div>
          <div className="chip-row" style={{ margin: '6px 0 10px' }}>
            {sug.themes.map(t => <button key={t} className="chip" disabled={busy} onClick={() => run(t)}>{t}</button>)}
          </div>
        </>
      )}
      {sug.prompts?.length > 0 && (
        <>
          <div className="followup-label">Try a prompt</div>
          <div className="chip-row" style={{ margin: '6px 0 14px' }}>
            {sug.prompts.map(t => <button key={t} className="chip" disabled={busy} onClick={() => run(t)}>{t}</button>)}
          </div>
        </>
      )}

      {err && <p className="note">{err}</p>}

      {res && !res.error && (
        <div className="panel">
          {res.summary && <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(res.summary) }} />}
          {res.source && <p className="hint" style={{ marginTop: 4 }}>Source: <b>{res.source}</b>{res.assumptions ? ' · ' + res.assumptions : ''}</p>}
          {res.rows?.length > 0 ? (
            <div className="md-table-wrap">
              <table className="md-table">
                <thead><tr>{res.columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                <tbody>
                  {res.rows.map((r, i) => (
                    <tr key={i}>{res.columns.map(c => <td key={c}>{r[c] === null || r[c] === undefined ? '—' : String(r[c])}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="hint">No matching rows.</p>}
          {res.disclaimer && <p className="disclaimer">{res.disclaimer}</p>}
        </div>
      )}
    </div>
  )
}
