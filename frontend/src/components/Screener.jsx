import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'

// NIYTRI Screeners: natural-language screening over the connected market data.

// Round numeric cells to max 2 decimals; leave text as-is.
const NUMRE = /^-?\d*\.?\d+(?:[eE][-+]?\d+)?$/
function fmtCell(v) {
  if (v === null || v === undefined || v === '') return '—'
  const s = String(v).trim()
  if (NUMRE.test(s)) {
    const n = Number(s)
    if (!isFinite(n)) return s
    return Number.isInteger(n)
      ? n.toLocaleString('en-IN')
      : n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
  }
  return s
}
const isNum = v => v != null && v !== '' && NUMRE.test(String(v).trim())
const prettyHead = c => String(c || '').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase())

const SCREEN_STEPS = [
  'Understanding your request',
  'Planning a read-only query over the connected data',
  'Running the screen',
  'Summarising the matches',
]
function Screening() {
  const [i, setI] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setI(x => Math.min(x + 1, SCREEN_STEPS.length - 1)), 1500)
    return () => clearInterval(t)
  }, [])
  return (
    <div className="panel load-card">
      <div className="load-bar"><span /></div>
      <div className="load-steps">
        {SCREEN_STEPS.map((s, k) => (
          <div key={k} className={'load-step' + (k < i ? ' done' : k === i ? ' active' : '')}>
            <span className="load-ic">{k < i ? '✓' : ''}</span>{s}…
          </div>
        ))}
      </div>
      <p className="hint" style={{ margin: '4px 0 0' }}>Screens run live over the connected market data —
        complex prompts can take a few seconds.</p>
    </div>
  )
}

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

      {busy && <Screening />}
      {err && !busy && <p className="note">{err}</p>}

      {res && !res.error && !busy && (
        <div className="panel">
          {res.summary && <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(res.summary) }} />}
          {res.source && <p className="hint" style={{ marginTop: 4 }}>Source: <b>{res.source}</b>{res.assumptions ? ' · ' + res.assumptions : ''}</p>}
          {res.rows?.length > 0 ? (
            <>
              <div className="hint" style={{ margin: '4px 0 6px' }}>{res.rows.length} result{res.rows.length === 1 ? '' : 's'}</div>
              <div className="md-table-wrap md-scroll" style={{ maxHeight: 460, overflowY: 'auto' }}>
                <table className="md-table">
                  <thead><tr>{res.columns.map(c => <th key={c}>{prettyHead(c)}</th>)}</tr></thead>
                  <tbody>
                    {res.rows.map((r, i) => (
                      <tr key={i}>{res.columns.map(c => (
                        <td key={c} style={isNum(r[c]) ? { textAlign: 'right' } : undefined}>{fmtCell(r[c])}</td>
                      ))}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (!res.fallback && <p className="hint">No matching rows.</p>)}
          {res.disclaimer && <p className="disclaimer">{res.disclaimer}</p>}
        </div>
      )}
    </div>
  )
}
