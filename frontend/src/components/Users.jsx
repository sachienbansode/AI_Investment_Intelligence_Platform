import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'

const iso = d => d.toISOString().slice(0, 10)
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
const fmtDT = s => { if (!s) return '—'; try { return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) } catch { return s } }
const fmtD = s => { if (!s) return '—'; try { return new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) } catch { return s } }

function Stat({ label, value, sub }) {
  return <div className="ua-stat"><div className="ua-stat-v">{value}</div><div className="ua-stat-l">{label}</div>{sub && <div className="ua-stat-s">{sub}</div>}</div>
}

// Compact SVG bar chart for daily new-user growth.
function Growth({ data }) {
  if (!data || !data.length) return <div className="hint">No data in range.</div>
  const W = 720, H = 150, pad = 22
  const max = Math.max(1, ...data.map(d => d.count))
  const bw = (W - pad * 2) / data.length
  return (
    <svg viewBox={'0 0 ' + W + ' ' + H} width="100%" height="150" style={{ display: 'block' }}>
      {[0.5, 1].map((f, i) => <line key={i} x1={pad} x2={W - pad} y1={pad + (H - pad * 2) * (1 - f)} y2={pad + (H - pad * 2) * (1 - f)} stroke="var(--border)" />)}
      {data.map((d, i) => {
        const h = (H - pad * 2) * (d.count / max)
        return <rect key={i} x={pad + i * bw + 1} y={H - pad - h} width={Math.max(1, bw - 2)} height={h} rx="2" fill="var(--accent)">
          <title>{d.date}: {d.count}</title>
        </rect>
      })}
      <text x={pad} y={H - 4} fill="var(--muted)" fontSize="10">{data[0].date}</text>
      <text x={W - pad} y={H - 4} fill="var(--muted)" fontSize="10" textAnchor="end">{data[data.length - 1].date}</text>
      <text x={pad} y={pad - 6} fill="var(--muted)" fontSize="10">peak {max}/day</text>
    </svg>
  )
}

function Split({ title, a, b, av, bv, ac = 'var(--green)', bc = 'var(--accent)' }) {
  const tot = (av + bv) || 1
  return (
    <div className="ua-split">
      <div className="ua-split-h">{title}</div>
      <div className="ua-bar"><i style={{ width: (av / tot * 100) + '%', background: ac }} /><i style={{ width: (bv / tot * 100) + '%', background: bc }} /></div>
      <div className="ua-split-l"><span><b style={{ color: ac }}>■</b> {a} {av}</span><span><b style={{ color: bc }}>■</b> {b} {bv}</span></div>
    </div>
  )
}

export default function Users() {
  const [from, setFrom] = useState(daysAgo(29))
  const [to, setTo] = useState(iso(new Date()))
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const [q, setQ] = useState('')
  const [srcFilter, setSrcFilter] = useState('all')

  function load() {
    setLoading(true); setErr('')
    api.userActivity(from, to).then(setData).catch(e => setErr(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const rows = useMemo(() => {
    if (!data) return []
    const term = q.trim().toLowerCase()
    return data.users.filter(u =>
      (srcFilter === 'all' || u.source === srcFilter) &&
      (!term || u.email.toLowerCase().includes(term) || (u.full_name || '').toLowerCase().includes(term) || (u.signup_ip || '').includes(term))
    )
  }, [data, q, srcFilter])

  const quick = [['7d', 6], ['30d', 29], ['90d', 89]]

  return (
    <div className="ua">
      <style>{CSS}</style>
      <div className="ua-toolbar panel">
        <div className="ua-range">
          <label>From <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)} /></label>
          <label>To <input type="date" value={to} min={from} max={iso(new Date())} onChange={e => setTo(e.target.value)} /></label>
          <button onClick={load} disabled={loading}>{loading ? 'Loading…' : 'Apply'}</button>
          <div className="ua-quick">{quick.map(([l, n]) => <button key={l} className="ghost sm" onClick={() => { setFrom(daysAgo(n)); setTo(iso(new Date())); setTimeout(load, 0) }}>{l}</button>)}</div>
        </div>
        {data && <div className="hint">Range: {data.range.from} → {data.range.to}</div>}
      </div>

      {err && <div className="panel"><p className="note">{err}</p></div>}

      {data && (<>
        <div className="ua-stats">
          <Stat label="Total users" value={data.totals.users} />
          <Stat label={'New (' + data.range.from.slice(5) + '–' + data.range.to.slice(5) + ')'} value={data.totals.new_in_range} />
          <Stat label="Verified" value={data.totals.verified} sub={data.totals.unverified + ' unverified'} />
          <Stat label="Admins" value={data.totals.admins} />
          <Stat label="Invites sent" value={data.invites.sent} sub={data.invites.sent_in_range + ' in range'} />
          <Stat label="Invites joined" value={data.invites.joined} sub={data.invites.delivered + ' emailed'} />
          <Stat label="Waitlist" value={data.waitlist.count} />
        </div>

        <div className="ua-grid2">
          <div className="panel">
            <div className="ua-h">New users per day</div>
            <Growth data={data.growth} />
          </div>
          <div className="panel">
            <div className="ua-h">Acquisition (in range)</div>
            <Split title="Self-registered vs invited" a="Self" b="Invited" av={data.acquisition_range.self} bv={data.acquisition_range.invited} />
            <Split title="Google vs email" a="Google" b="Email" av={data.acquisition_range.google} bv={data.acquisition_range.email} ac="#4285F4" bc="var(--accent)" />
            <Split title="Verified vs unverified" a="Verified" b="Unverified" av={data.acquisition_range.verified} bv={data.acquisition_range.unverified} ac="var(--green)" bc="var(--amber)" />
          </div>
        </div>

        <div className="ua-grid2">
          <div className="panel">
            <div className="ua-h">Top inviters</div>
            {data.invites.top_inviters.length ? (
              <table className="ua-table"><thead><tr><th>Member</th><th>Invites</th><th>Joined</th></tr></thead>
                <tbody>{data.invites.top_inviters.map((t, i) => <tr key={i}><td>{t.user}</td><td>{t.invites}</td><td>{t.joined}</td></tr>)}</tbody>
              </table>
            ) : <div className="hint">No invites yet.</div>}
          </div>
          <div className="panel">
            <div className="ua-h">Waitlist ({data.waitlist.count})</div>
            {data.waitlist.recent.length ? (
              <div className="ua-wl">{data.waitlist.recent.map((w, i) => <div key={i} className="ua-wl-row"><span>{w.email}</span><span className="hint">{fmtD(w.created_at)}</span></div>)}</div>
            ) : <div className="hint">Waitlist is empty.</div>}
          </div>
        </div>

        <div className="panel">
          <div className="ua-h ua-users-h">
            <span>Users ({rows.length})</span>
            <div className="ua-filters">
              <select value={srcFilter} onChange={e => setSrcFilter(e.target.value)}>
                <option value="all">All sources</option><option value="self">Self</option>
                <option value="invited">Invited</option><option value="google">Google</option>
              </select>
              <input placeholder="Search name / email / IP" value={q} onChange={e => setQ(e.target.value)} />
            </div>
          </div>
          <div className="ua-scroll">
            <table className="ua-table">
              <thead><tr><th>Name</th><th>Email</th><th>Source</th><th>Verified</th><th>Joined</th><th>Signup IP</th><th>Last login</th><th>Last IP</th></tr></thead>
              <tbody>
                {rows.map(u => (
                  <tr key={u.id}>
                    <td>{u.full_name || '—'}{u.is_admin && <span className="ua-adm">admin</span>}</td>
                    <td>{u.email}</td>
                    <td><span className={'ua-src ua-' + u.source}>{u.source}</span></td>
                    <td>{u.email_verified ? <span className="ua-yes">✓</span> : <span className="ua-no">✗</span>}</td>
                    <td>{fmtD(u.created_at)}</td>
                    <td className="ua-mono">{u.signup_ip || '—'}</td>
                    <td>{fmtDT(u.last_login_at)}</td>
                    <td className="ua-mono">{u.last_ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </>)}

      {!data && !err && <div className="panel"><p className="hint">Loading user activity…</p></div>}
    </div>
  )
}

const CSS = `
.ua{display:grid;gap:14px}
.ua-toolbar{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px}
.ua-range{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ua-range label{color:var(--muted);font-size:.85rem;display:flex;gap:6px;align-items:center}
.ua-range input[type=date]{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:6px 8px;color:var(--text)}
.ua-quick{display:flex;gap:6px}
.ua-stats{display:grid;grid-template-columns:repeat(7,1fr);gap:12px}
.ua-stat{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px}
.ua-stat-v{font-size:26px;font-weight:800;line-height:1}
.ua-stat-l{color:var(--muted);font-size:12px;margin-top:6px}
.ua-stat-s{color:var(--faint);font-size:11px;margin-top:2px}
.ua-grid2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ua-h{font-weight:700;margin-bottom:10px}
.ua-split{margin-bottom:14px}
.ua-split-h{color:var(--muted);font-size:12.5px;margin-bottom:5px}
.ua-bar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:var(--panel2)}
.ua-bar i{display:block;height:100%}
.ua-split-l{display:flex;justify-content:space-between;font-size:12px;color:var(--muted);margin-top:5px}
.ua-table{width:100%;border-collapse:collapse;font-size:13px}
.ua-table th{text-align:left;color:var(--muted);font-weight:600;padding:7px 10px;border-bottom:1px solid var(--border);position:sticky;top:0;background:var(--panel)}
.ua-table td{padding:7px 10px;border-bottom:1px solid var(--border)}
.ua-mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:var(--muted)}
.ua-scroll{max-height:520px;overflow:auto}
.ua-users-h{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.ua-filters{display:flex;gap:8px}
.ua-filters select,.ua-filters input{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:6px 9px;color:var(--text);font-size:13px}
.ua-src{font-size:11px;font-weight:600;padding:2px 8px;border-radius:999px;text-transform:capitalize}
.ua-self{background:rgba(79,142,247,.15);color:var(--accent)}
.ua-invited{background:rgba(34,160,107,.15);color:var(--green)}
.ua-google{background:rgba(66,133,244,.15);color:#4285F4}
.ua-adm{margin-left:6px;font-size:10px;font-weight:700;color:var(--amber);border:1px solid var(--amber);border-radius:5px;padding:0 5px}
.ua-yes{color:var(--green);font-weight:700}.ua-no{color:var(--faint)}
.ua-wl{display:grid;gap:6px;max-height:260px;overflow:auto}
.ua-wl-row{display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)}
@media(max-width:900px){.ua-stats{grid-template-columns:repeat(3,1fr)}.ua-grid2{grid-template-columns:1fr}}
`
