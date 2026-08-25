import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { fmtDate } from '../fmt.js'
import { SCORE_DEFINITION } from './Scores.jsx'
import Pager from './Pager.jsx'
import ScoreHistoryPanel from './ScoreHistoryPanel.jsx'

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
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(null)   // symbol whose score-history is open
  const [hi, setHi] = useState(0)
  const boxRef = useRef(null)

  const load = () => api.watchlist().then(d => setRows(d.watchlist)).catch(e => setErr(e.message))
  useEffect(() => {
    load()
    api.instruments().then(d => setAll(d.instruments)).catch(() => {})
  }, [])
  useEffect(() => {
    const away = e => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away)
  }, [])

  const matches = useMemo(() => {
    const t = pick.trim().toLowerCase()
    if (!t) return []
    return all.filter(i => i.symbol.toLowerCase().includes(t) || (i.name || '').toLowerCase().includes(t))
      .sort((a, b) => (a.symbol.toLowerCase().startsWith(t) ? 0 : 1) - (b.symbol.toLowerCase().startsWith(t) ? 0 : 1))
      .slice(0, 8)
  }, [all, pick])

  async function add(sym) {
    const s = (typeof sym === 'string' ? sym : pick).trim().toUpperCase()
    if (!s) return
    setBusy(true); setErr(''); setOpen(false)
    try { await api.watchAdd(s); setPick(''); await load() }
    catch (e) { setErr(e.message) }
    setBusy(false)
  }
  function choose(sym) { setOpen(false); add(sym) }
  function onKey(e) {
    if (e.key === 'Escape') { setOpen(false); return }
    if (!matches.length) { if (e.key === 'Enter') add(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); choose(matches[hi].symbol) }
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
      <style>{`
        .wl-combo{position:relative;flex:1 1 260px;min-width:0}
        .wl-combo input{width:100%}
        .wl-drop{position:absolute;top:calc(100% + 4px);left:0;right:0;z-index:40;background:var(--panel);
          border:1px solid var(--border2);border-radius:10px;box-shadow:0 16px 40px rgba(0,0,0,.25);overflow:hidden;max-height:320px;overflow-y:auto}
        .wl-opt{display:flex;gap:10px;align-items:baseline;padding:9px 12px;cursor:pointer}
        .wl-opt.hi{background:var(--panel2)}
        .wl-opt b{min-width:74px}
        .wl-opt span{color:var(--muted);font-size:.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      `}</style>
      <div className="toolbar">
        <div className="wl-combo" ref={boxRef}>
          <input value={pick} placeholder="Search script by symbol or name…" autoComplete="off"
                 onChange={e => { setPick(e.target.value); setOpen(true); setHi(0) }}
                 onFocus={() => setOpen(true)} onKeyDown={onKey} />
          {open && matches.length > 0 && (
            <div className="wl-drop">
              {matches.map((m, i) => (
                <div key={m.symbol} className={'wl-opt' + (i === hi ? ' hi' : '')}
                     onMouseEnter={() => setHi(i)} onMouseDown={() => choose(m.symbol)}>
                  <b>{m.symbol}</b><span>{m.name}</span>
                </div>
              ))}
            </div>
          )}
        </div>
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
        <table className="data-table wl-table">
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
                <Fragment key={r.symbol}>
                <tr>
                  <td>
                    <strong title="Click for NIYTRI Score history" style={{ cursor: 'pointer' }}
                            onClick={() => setExpanded(x => (x === r.symbol ? null : r.symbol))}>
                      {r.symbol} <span className="hint" style={{ fontWeight: 400 }}>{expanded === r.symbol ? '▲' : '▾'}</span>
                    </strong>
                    {(r.name || r.sector) && <div className="script-name">{[r.name, r.sector].filter(Boolean).join(' \u00b7 ')}</div>}
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
                           style={{ fontSize: '.8em', marginTop: 1 }}
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
                {expanded === r.symbol && (
                  <tr>
                    <td colSpan={8}>
                      <div className="card-body">
                        <p className="explain" style={{ marginTop: 0 }}>
                          <strong>P/E:</strong> {r.pe != null ? Number(r.pe).toFixed(1) : '—'}{'  \u00b7  '}<strong>Market cap:</strong> {fmtCr(r.market_cap)}
                        </p>
                        <ScoreHistoryPanel symbol={r.symbol} scoreLabel={scoreLabel} />
                      </div>
                    </td>
                  </tr>
                )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}
      <Pager page={page} setPage={setPage} total={view.length} label="scripts" />
    </div>
  )
}
