import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { toast } from '../dialog.jsx'

// Admin: connect external data sources (SQL DB / REST API) the screener can read.
export default function DataSources() {
  const [list, setList] = useState([])
  const [form, setForm] = useState({ name: '', kind: 'db', url: '', base_url: '' })
  const [busy, setBusy] = useState('')
  const [sql, setSql] = useState({})
  const [out, setOut] = useState({})
  const load = () => api.dataSources().then(d => setList(d.sources || [])).catch(() => {})
  useEffect(() => { load() }, [])

  async function add() {
    if (!form.name.trim()) return
    const config = form.kind === 'db' ? { url: form.url } : { base_url: form.base_url }
    setBusy('add')
    try { await api.dataSourceCreate({ name: form.name.trim(), kind: form.kind, config }); setForm({ name: '', kind: 'db', url: '', base_url: '' }); toast('Source added'); load() }
    catch (e) { toast(e.message, { type: 'error' }) }
    setBusy('')
  }
  async function test(id) {
    setBusy(id + 'test')
    try { const r = await api.dataSourceTest(id); toast(r.ok ? ('Connected · ' + (r.dialect || r.status || 'ok')) : ('Failed: ' + (r.error || '')), { type: r.ok ? 'success' : 'error' }) }
    catch (e) { toast(e.message, { type: 'error' }) }
    setBusy('')
  }
  async function introspect(id) {
    setBusy(id + 'intro')
    try { const r = await api.dataSourceIntrospect(id); toast('Schema read: ' + ((r.schema?.tables || []).length) + ' tables'); load() }
    catch (e) { toast(e.message, { type: 'error' }) }
    setBusy('')
  }
  async function toggle(d) {
    const enabling = !d.enabled
    const ok = window.confirm(
      `${enabling ? 'Enable' : 'Disable'} data source “${d.name}”?\n\n` +
      `The screener and assistant will ${enabling ? 'START' : 'STOP'} using it.`)
    if (!ok) return
    try {
      await api.dataSourceUpdate(d.id, { name: d.name, kind: d.kind, config: {}, enabled: enabling, note: d.note })
      toast(enabling ? 'Source enabled' : 'Source disabled', { type: 'success' }); load()
    } catch (e) { toast(e.message, { type: 'error' }) }
  }
  async function runSql(id) {
    setBusy(id + 'sql')
    try { const r = await api.dataSourceQuery(id, sql[id] || '', 50); setOut(o => ({ ...o, [id]: r })) }
    catch (e) { setOut(o => ({ ...o, [id]: { error: e.message } })) }
    setBusy('')
  }

  return (
    <div>
      <div className="panel">
        <h4>Add a data source</h4>
        <p className="hint">Connect your market database (or a REST API). The screener and assistant can
          then read it. Connections are <strong>read-only</strong> (SELECT only).</p>
        <div className="toolbar">
          <input placeholder="Name (e.g. CMOTS Market DB)" value={form.name}
                 onChange={e => setForm({ ...form, name: e.target.value })} />
          <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
            <option value="db">SQL Database</option>
            <option value="api">REST API</option>
          </select>
          {form.kind === 'db'
            ? <input style={{ flex: 1, minWidth: 320 }} placeholder="postgresql+psycopg2://user:pass@host:5432/dbname"
                     value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} />
            : <input style={{ flex: 1, minWidth: 320 }} placeholder="https://api.example.com"
                     value={form.base_url} onChange={e => setForm({ ...form, base_url: e.target.value })} />}
          <button onClick={add} disabled={busy === 'add'}>{busy === 'add' ? 'Adding…' : '+ Add source'}</button>
        </div>
      </div>

      {list.map(d => (
        <div className="panel" key={d.id}>
          <div className="panel-head">
            <h4>{d.name} <span className="hint">· {d.kind.toUpperCase()} · {d.tables} {d.kind === 'db' ? 'tables' : 'fields'}</span></h4>
            <label className="hint"><input type="checkbox" checked={d.enabled} onChange={() => toggle(d)} /> enabled</label>
          </div>
          <p className="hint" style={{ wordBreak: 'break-all' }}>{d.config?.url || d.config?.base_url}</p>
          <div className="toolbar">
            <button className="ghost sm" onClick={() => test(d.id)} disabled={busy === d.id + 'test'}>Test</button>
            <button className="ghost sm" onClick={() => introspect(d.id)} disabled={busy === d.id + 'intro'}>Read schema</button>
          </div>
          {d.kind === 'db' && (
            <>
              <div className="toolbar" style={{ marginTop: 8 }}>
                <input style={{ flex: 1, minWidth: 320, fontFamily: 'monospace' }} placeholder="SELECT … (read-only test)"
                       value={sql[d.id] || ''} onChange={e => setSql(s => ({ ...s, [d.id]: e.target.value }))} />
                <button className="ghost sm" onClick={() => runSql(d.id)} disabled={busy === d.id + 'sql'}>Run</button>
              </div>
              {out[d.id]?.error && <p className="note">{out[d.id].error}</p>}
              {out[d.id]?.rows && (
                <div className="md-table-wrap" style={{ marginTop: 8 }}>
                  <table className="md-table">
                    <thead><tr>{out[d.id].columns.map(c => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>{out[d.id].rows.slice(0, 20).map((r, i) => <tr key={i}>{out[d.id].columns.map(c => <td key={c}>{String(r[c] ?? '—')}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      ))}
      {list.length === 0 && <p className="hint">No data sources yet — add one above.</p>}
    </div>
  )
}
