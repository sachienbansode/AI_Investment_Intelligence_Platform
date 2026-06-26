import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { fmtDate } from '../fmt.js'
import { SCORE_DEFINITION } from './Scores.jsx'
import Pager from './Pager.jsx'

const scoreColor = v =>
  v == null ? 'var(--muted)' : v >= 65 ? 'var(--green)' : v >= 45 ? 'var(--amber)' : 'var(--red)'
const fmtCr = v =>
  v == null ? '—' : '₹' + Math.round(v / 1e7).toLocaleString('en-IN') + ' Cr'
const band = v => v == null ? '' : v >= 65 ? 'Strong' : v >= 45 ? 'Neutral' : 'Weak'

export default function Watchlist({ scoreLabel = 'NIYTRI Score' }) {
  const [rows, setRows] = useState([])
  const [all, setAll] = useState([])
  const [pick, setPick] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [page, setPage] = useState(0)
  const [q, setQ] = useState('')
  const [sector, setSector] = useState('')
  const [sortKey, setSortKey] = useState('ai_score')
  const [sortDir, setSortDir] = useState('desc')

  const load = () => api.watchlist().then(d => setRows(d.watchlist)).catch(e => setErr(e.message))
  useEffect(() => {
    load()
    api.instruments().then(d => setAll(d.instruments)).catch(() => {})
  }, [])

  async function add() {
    const sym = pick.trim().toUpperCase()
    if (!sym) return
    setBusy(true); setErr('')
    try { await api.watchAdd(sym); setPick(''); await load() }
    catch (e) { setErr(e.message) }
    setBusy(false)
  }
  async function remove(sym) {
    try { await api.watchRemove(sym); await load() } catch (e) { setErr(e.message) }
  }

  function setSort(key) {
    if (sortKey === key) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir(key === 'symbol' || key === 'sector' ? 'asc' : 'desc') }
    setPage(0)
  }
  const arrow = key => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  const sectors = useMemo(
    () => [...new Set(rows.map(r => r.sector).filter(Boolean))].sort(), [rows])

  const view = useMemo(() => {
    let r = rows
    if (q) {
      const t = q.toLowerCase()
      r = r.filter(x => x.symbol.toLowerCase().includes(t) || (x.name || '').toLowerCase().includes(t))
    }
    if (sector) r = r.filter(x => x.sector === sector)
    const dir = sortDir === 'asc' ? 1 : -1
    r = [...r].sort((a, b) => {
      const va = a[sortKey], vb = b[sortKey]
      if (va == null && vb == null) return 0
      if (va == null) return 1          // nulls always last
      if (vb == null) return -1
      if (typeof va === 'string') return va.localeCompare(vb) * dir
      return (va - vb) * dir
    })
    return r
  }, [rows, q, sector, sortKey, sortDir])

  const scored = rows.filter(r => r.ai_score != null)
  const avg = scored.length
    ? Math.round(scored.reduce((a, r) => a + r.ai_score, 0) / scored.length * 10) / 10 : null
  const gainers = rows.filter(r => (r.change_pct ?? 0) > 0).length
  const th = (key, label, title) => (
    <th title={title} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }} onClick={() => setSort(key)}>
      {label}{arrow(key)}</th>)

  return (
    <div>
      <div className="toolbar">
        <input list="inst-list" value={pick} placeholder="Add script (e.g. RELIANCE)"
               onChange={e => setPick(e.target.value)}
               onKeyDown={e => e.key === 'Enter' && add()} />
        <datalist id="inst-list">
          {all.map(i => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}
        </datalist>
        <button onClick={add} disabled={busy || !pick.trim()}>Add</button>
        <button className="ghost" onClick={load}>Refresh</button>
      </div>

      {err && <p className="note">{err}</p>}
      {rows.length === 0 && <p className="hint">Your watchlist is empty — add scripts above.</p>}

      {rows.length > 0 && (
        <div className="kpi-row" style={{ marginBottom: 14 }}>
          <div className="kpi"><span className="kpi-label">Scripts</span>
            <span className="kpi-value">{rows.length}</span></div>
          <div className="kpi" title="Average AI score across watchlist scripts that have a score">
            <span className="kpi-label">Avg {scoreLabel}</span>
            <span className="kpi-value" style={{ color: scoreColor(avg) }}>{avg ?? '—'}</span></div>
          <div className="kpi" title="Scripts trading up today"><span className="kpi-label">Up today</span>
            <span className="kpi-value up">{gainers}/{rows.length}</span></div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="toolbar">
          <input placeholder="Filter by symbol or name…" value={q}
                 onChange={e => { setQ(e.target.value); setPage(0) }} />
          <select value={sector} onChange={e => { setSector(e.target.value); setPage(0) }}
                  title="Filter by sector">
            <option value="">All sectors</option>
            {sectors.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <span className="hint">{view.length} of {rows.length} shown · click a column to sort</span>
        </div>
      )}

      {rows.length > 0 && view.length === 0 && <p className="hint">No scripts match the filter.</p>}

      {view.length > 0 && (
        <table className="data-table">
          <thead><tr>
            {th('symbol', 'Script', 'NSE symbol / company — click to sort')}
            {th('last_price', 'Price (LTP)', 'Last traded price — click to sort')}
            {th('change_pct', 'Day %', 'Percent change vs previous close — click to sort')}
            <th title={SCORE_DEFINITION} style={{ cursor: 'pointer', whiteSpace: 'nowrap' }}
                onClick={() => setSort('ai_score')}>{scoreLabel}{arrow('ai_score')} <span className="info-i">i</span></th>
            {th('pe', 'P/E', 'Trailing P/E — click to sort')}
            {th('market_cap', 'Mkt cap', 'Market capitalisation — click to sort')}
            {th('score_date', 'Score date', 'Date the AI score was generated — click to sort')}
            <th />
          </tr></thead>
          <tbody>
            {view.slice(page * 20, page * 20 + 20).map(r => {
              const up = (r.change_pct ?? 0) >= 0
              const d = r.score_delta
              const dpct = (d != null && r.prev_score) ? (d / r.prev_score * 100) : null
              return (
                <tr key={r.symbol}>
                  <td>
                    <div><strong>{r.symbol}</strong></div>
                    {r.name && <div className="hint" style={{ fontSize: '.82em' }}>{r.name}</div>}
                    {r.sector && <span className="tag" style={{ marginTop: 4 }}>{r.sector}</span>}
                  </td>
                  <td style={{ fontWeight: 600 }}>
                    {r.last_price != null ? '₹' + r.last_price.toLocaleString('en-IN') : '—'}</td>
                  <td className={r.change_pct == null ? 'hint' : up ? 'up' : 'down'}>
                    {r.change_pct != null ? `${up ? '▲ +' : '▼ '}${r.change_pct}%` : '—'}</td>
                  <td>
                    {r.ai_score != null
                      ? <span className="score" style={{ background: scoreColor(r.ai_score) }}
                              title={band(r.ai_score)}>{r.ai_score}</span>
                      : <span className="hint">—</span>}
                    {d != null && (
                      <div className={d > 0 ? 'up' : d < 0 ? 'down' : 'hint'}
                           style={{ fontSize: '.82em', marginTop: 4 }}
                           title="Change vs previous scoring day">
                        {d > 0 ? '▲' : d < 0 ? '▼' : '–'} {Math.abs(d)}
                        {dpct != null ? ` (${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(dpct).toFixed(1)}%)` : ''}
                      </div>)}
                  </td>
                  <td>{r.pe != null ? Number(r.pe).toFixed(1) : '—'}</td>
                  <td>{fmtCr(r.market_cap)}</td>
                  <td>{fmtDate(r.score_date)}</td>
                  <td><button className="ghost sm" onClick={() => remove(r.symbol)}>Remove</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <Pager page={page} setPage={setPage} total={view.length} label="scripts" />
    </div>
  )
}
