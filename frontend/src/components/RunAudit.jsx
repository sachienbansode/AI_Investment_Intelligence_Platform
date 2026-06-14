import { Fragment, useEffect, useState } from 'react'
import { api } from '../api.js'
import Pager from './Pager.jsx'

const LIMIT = 20

export default function RunAudit() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState(null)
  const [exporting, setExporting] = useState(false)

  const load = () => api.pipelineRuns({ search, status, limit: LIMIT, offset: page * LIMIT })
    .then(setData).catch(e => setErr(e.message))
  useEffect(() => { load() }, [search, status, page])

  async function download() {
    if (!data || data.total === 0) {
      setErr('No runs recorded yet — nothing to download. Run the scoring pipeline first; every completed run is saved here automatically.')
      return
    }
    setExporting(true); setErr('')
    try { await api.downloadExport({ search, status }) }
    catch (e) { setErr(e.message) }
    setExporting(false)
  }

  if (err && !data) return <p className="note">{err}</p>
  if (!data) return <p className="hint">Loading…</p>

  return (
    <div>
      <p className="hint">Every pipeline run is recorded with a unique Run ID, full
        per-agent timings and outcomes. All times are IST.</p>

      <div className="toolbar">
        <input placeholder="Search Run ID…" value={search}
               onChange={e => { setSearch(e.target.value); setPage(0) }} />
        <select value={status} onChange={e => { setStatus(e.target.value); setPage(0) }}
                title="Filter by run outcome">
          <option value="">All statuses</option>
          <option value="completed">completed</option>
          <option value="partial">partial</option>
        </select>
        <button onClick={download} disabled={exporting}
                title="Download the filtered run history as an Excel workbook (Runs + Agent details sheets)">
          {exporting ? 'Preparing…' : '⬇ Download Excel'}</button>
        <button className="ghost" onClick={load}>Refresh</button>
      </div>
      {err && <p className="note">{err}</p>}
      {data.rows.length === 0 && <p className="hint">No recorded runs yet — runs are
        persisted from now on each time the pipeline finishes.</p>}

      <table className="data-table">
        <thead><tr>
          <th title="Unique identifier assigned to each pipeline run">Run ID</th>
          <th title="Run start time (IST)">Started (IST)</th>
          <th title="Run end time (IST)">Finished (IST)</th>
          <th title="Total wall-clock duration in seconds">Duration</th>
          <th title="completed = all 8 agents succeeded; partial = at least one agent failed">Status</th>
          <th title="Number of scripts in this run's scoring universe">Scripts</th>
          <th />
        </tr></thead>
        <tbody>
          {data.rows.map(r => (
            <Fragment key={r.run_id}>
              <tr className="row-click"
                  onClick={() => setOpen(open === r.run_id ? null : r.run_id)}>
                <td><code>{r.run_id}</code></td>
                <td>{r.started_ist}</td>
                <td>{r.finished_ist}</td>
                <td>{r.duration_s != null ? `${r.duration_s}s` : '—'}</td>
                <td><span className={`tag ${r.status === 'completed' ? 'positive' : 'negative'}`}>{r.status}</span></td>
                <td>{r.symbols_count}</td>
                <td className="hint">{open === r.run_id ? '▲' : '▼'}</td>
              </tr>
              {open === r.run_id && (
                <tr>
                  <td colSpan={7}>
                    <table className="audit-table" style={{ margin: '6px 0' }}>
                      <thead><tr><th>Agent</th><th>Status</th><th>Started (IST)</th>
                        <th>Finished (IST)</th><th>Detail</th></tr></thead>
                      <tbody>
                        {r.agents.map(a => (
                          <tr key={a.name}>
                            <td>{a.name}</td>
                            <td><span className={`tag ${a.status}`}>{a.status}</span></td>
                            <td className="hint">{a.started_ist || '—'}</td>
                            <td className="hint">{a.finished_ist || '—'}</td>
                            <td className="hint">{a.detail}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
      <Pager page={page} setPage={setPage} total={data.total} label="runs" />
    </div>
  )
}
