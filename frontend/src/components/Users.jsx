import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'
import { toast } from '../dialog.jsx'

const iso = d => d.toISOString().slice(0, 10)
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return iso(d) }
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
// dd-MMM-yyyy everywhere.
const fmtD = s => { if (!s) return '—'; const d = new Date(s); if (isNaN(d)) return String(s); return String(d.getDate()).padStart(2, '0') + '-' + MON[d.getMonth()] + '-' + d.getFullYear() }
const fmtDT = s => { if (!s) return '—'; const d = new Date(s); if (isNaN(d)) return String(s); const hh = String(d.getHours()).padStart(2, '0'); const mm = String(d.getMinutes()).padStart(2, '0'); return fmtD(s) + ' ' + hh + ':' + mm }

function Stat({ label, value, sub }) {
  return <div className="ua-stat"><div className="ua-stat-v">{value}</div><div className="ua-stat-l">{label}</div>{sub && <div className="ua-stat-s">{sub}</div>}</div>
}

const PER = 10
function Pager({ page, total, onPage }) {
  const pages = Math.max(1, Math.ceil(total / PER))
  if (pages <= 1) return null
  return (
    <div className="ua-pager">
      <button className="ghost sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>‹ Prev</button>
      <span>Page {page} of {pages} · {total} total</span>
      <button className="ghost sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next ›</button>
    </div>
  )
}

// SVG bar chart for new-user growth. Long ranges auto-aggregate to weekly buckets
// so bars stay readable; labels use dd-MMM-yyyy.
function Growth({ data }) {
  const { bars, weekly } = useMemo(() => {
    if (!data || !data.length) return { bars: [], weekly: false }
    if (data.length <= 45) return { bars: data.map(d => ({ label: d.date, count: d.count })), weekly: false }
    const out = []
    for (let i = 0; i < data.length; i += 7) {
      const chunk = data.slice(i, i + 7)
      out.push({ label: chunk[0].date, count: chunk.reduce((s, d) => s + d.count, 0) })
    }
    return { bars: out, weekly: true }
  }, [data])
  if (!bars.length) return <div className="hint">No data in range.</div>
  const W = 720, H = 160, padL = 30, padR = 12, padT = 16, padB = 26
  const plotW = W - padL - padR, plotH = H - padT - padB
  const max = Math.max(1, ...bars.map(b => b.count))
  const bw = plotW / bars.length
  const ticks = [0, Math.ceil(max / 2), max]
  return (
    <div>
      <svg viewBox={'0 0 ' + W + ' ' + H} width="100%" height="160" style={{ display: 'block' }}>
        <defs><linearGradient id="uag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--accent)" /><stop offset="1" stopColor="var(--accent2)" /></linearGradient></defs>
        {ticks.map((t, i) => {
          const y = padT + plotH * (1 - t / max)
          return <g key={i}><line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--border)" /><text x={padL - 6} y={y + 3} fill="var(--muted)" fontSize="10" textAnchor="end">{t}</text></g>
        })}
        {bars.map((b, i) => {
          const h = plotH * (b.count / max)
          return <rect key={i} x={padL + i * bw + Math.max(1, bw * 0.15)} y={padT + plotH - h}
            width={Math.max(2, bw * 0.7)} height={h} rx="2" fill="url(#uag)">
            <title>{fmtD(b.label)}{weekly ? ' (week)' : ''}: {b.count}</title></rect>
        })}
        <text x={padL} y={H - 8} fill="var(--muted)" fontSize="10">{fmtD(bars[0].label)}</text>
        <text x={W - padR} y={H - 8} fill="var(--muted)" fontSize="10" textAnchor="end">{fmtD(bars[bars.length - 1].label)}</text>
      </svg>
      <div className="hint" style={{ marginTop: 2 }}>Peak {max} {weekly ? 'per week' : 'per day'}{weekly ? ' · weekly buckets' : ''}</div>
    </div>
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

function TreeNode({ id, nodes, kids, depth }) {
  const [open, setOpen] = useState(depth < 2)
  const n = nodes[id]
  if (!n) return null
  const ch = kids[id] || []
  return (
    <div>
      <div className="rt-row" style={{ paddingLeft: 6 + depth * 20 }}>
        {ch.length
          ? <button className="rt-tog" onClick={() => setOpen(o => !o)}>{open ? '▾' : '▸'}</button>
          : <span className="rt-dot">•</span>}
        <span className="rt-name">{n.name}{n.is_admin && <span className="ua-adm">admin</span>}</span>
        <span className="rt-email">{n.email}</span>
        {n.direct > 0 && <span className="rt-badge">{n.direct} direct · {n.network} network</span>}
      </div>
      {open && ch.map(k => <TreeNode key={k} id={k} nodes={nodes} kids={kids} depth={depth + 1} />)}
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
  const [uPage, setUPage] = useState(1)
  const [wlQ, setWlQ] = useState('')
  const [wlPage, setWlPage] = useState(1)

  const [tree, setTree] = useState(null)
  function load() {
    setLoading(true); setErr('')
    api.userActivity(from, to).then(setData).catch(e => setErr(e.message)).finally(() => setLoading(false))
  }
  useEffect(() => { load(); api.referralTree().then(setTree).catch(() => {}) }, [])

  const ref = useMemo(() => {
    if (!tree) return null
    const nodes = {}; tree.nodes.forEach(n => { nodes[n.id] = n })
    const kids = {}
    tree.nodes.forEach(n => { if (n.inviter_id) (kids[n.inviter_id] = kids[n.inviter_id] || []).push(n.id) })
    Object.values(kids).forEach(arr => arr.sort((a, b) => (nodes[b].network - nodes[a].network)))
    const rootsWithNet = tree.roots.filter(id => (nodes[id]?.network || 0) > 0)
      .sort((a, b) => nodes[b].network - nodes[a].network)
    return { nodes, kids, rootsWithNet }
  }, [tree])

  async function wlRemove(email) {
    try { await api.waitlistRemove(email); toast('Removed from waitlist'); load() } catch (e) { toast('Failed: ' + e.message) }
  }
  async function wlInvite(email) {
    try { const r = await api.waitlistInvite(email); toast(r.delivered ? 'Approved — invite emailed to ' + email : 'Approved — code ' + r.code + ' (email not sent)'); load() }
    catch (e) { toast('Failed: ' + e.message) }
  }
  async function wlClear() {
    if (!confirm('Clear the entire waitlist? This cannot be undone.')) return
    try { const r = await api.waitlistClearAll(); toast('Cleared ' + r.removed + ' entries'); load() } catch (e) { toast('Failed: ' + e.message) }
  }

  const rows = useMemo(() => {
    if (!data) return []
    const term = q.trim().toLowerCase()
    return data.users.filter(u =>
      (srcFilter === 'all' || u.source === srcFilter) &&
      (!term || u.email.toLowerCase().includes(term) || (u.full_name || '').toLowerCase().includes(term) || (u.signup_ip || '').includes(term))
    )
  }, [data, q, srcFilter])

  useEffect(() => { setUPage(1) }, [q, srcFilter, data])
  const pagedUsers = rows.slice((uPage - 1) * PER, uPage * PER)

  const wlRows = useMemo(() => {
    const list = data?.waitlist?.list || []
    const term = wlQ.trim().toLowerCase()
    return term ? list.filter(w => w.email.toLowerCase().includes(term)) : list
  }, [data, wlQ])
  useEffect(() => { setWlPage(1) }, [wlQ, data])
  const pagedWl = wlRows.slice((wlPage - 1) * PER, wlPage * PER)

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
        {data && <div className="hint">Range: {fmtD(data.range.from)} → {fmtD(data.range.to)}</div>}
      </div>

      {err && <div className="panel"><p className="note">{err}</p></div>}

      {data && (<>
        <div className="ua-stats">
          <Stat label="Total users" value={data.totals.users} />
          <Stat label="New in range" value={data.totals.new_in_range} sub={fmtD(data.range.from) + ' – ' + fmtD(data.range.to)} />
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
            <div className="ua-h ua-users-h">
              <span>Waitlist ({data.waitlist.count})</span>
              <div className="ua-filters">
                <input placeholder="Search email" value={wlQ} onChange={e => setWlQ(e.target.value)} />
                {data.waitlist.count > 0 && <button className="ghost sm" onClick={wlClear}>Clear all</button>}
              </div>
            </div>
            {wlRows.length ? (
              <div className="ua-wl">{pagedWl.map((w, i) => (
                <div key={i} className="ua-wl-row">
                  <span>{w.email}<span className="hint" style={{ marginLeft: 8 }}>{fmtD(w.created_at)}</span></span>
                  <span className="ua-wl-act">
                    <button className="sm" title="Approve: email them an invite code and remove from waitlist" onClick={() => wlInvite(w.email)}>Approve</button>
                    <button className="ghost sm" title="Remove from waitlist" onClick={() => wlRemove(w.email)}>Remove</button>
                  </span>
                </div>
              ))}</div>
            ) : <div className="hint">{wlQ ? 'No matching emails.' : 'Waitlist is empty.'}</div>}
            <Pager page={wlPage} total={wlRows.length} onPage={setWlPage} />
            <div className="hint" style={{ marginTop: 8 }}>Entries auto-clear when the person signs up.</div>
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
                {pagedUsers.map(u => (
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
          <Pager page={uPage} total={rows.length} onPage={setUPage} />
        </div>
      </>)}

      {ref && (
        <div className="ua-grid2">
          <div className="panel">
            <div className="ua-h">Top referrers — who brought the most</div>
            {tree.leaderboard.length ? (
              <table className="ua-table">
                <thead><tr><th>#</th><th>Member</th><th>Direct</th><th>Network</th></tr></thead>
                <tbody>{tree.leaderboard.map((n, i) => (
                  <tr key={n.id}>
                    <td>{i + 1}</td>
                    <td>{n.name}<div className="hint" style={{ fontSize: '.72rem' }}>{n.email}</div></td>
                    <td><b>{n.direct}</b></td>
                    <td>{n.network}</td>
                  </tr>))}</tbody>
              </table>
            ) : <div className="hint">No referrals yet.</div>}
          </div>
          <div className="panel">
            <div className="ua-h">Referral tree</div>
            {ref.rootsWithNet.length ? (
              <div className="rt-wrap">{ref.rootsWithNet.map(id => <TreeNode key={id} id={id} nodes={ref.nodes} kids={ref.kids} depth={0} />)}</div>
            ) : <div className="hint">No invited sign-ups yet.</div>}
            <div className="hint" style={{ marginTop: 8 }}>Members with at least one referral. <b>Direct</b> = they invited · <b>Network</b> = whole downstream.</div>
          </div>
        </div>
      )}

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
.ua-wl-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)}
.ua-wl-act{display:flex;gap:6px;flex:0 0 auto}
.ua-wl-act button{padding:4px 10px;font-size:12px}
.ua-pager{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:12px;color:var(--muted);font-size:12.5px}
.ua-pager button{padding:5px 12px;font-size:12.5px}
.rt-wrap{max-height:520px;overflow:auto}
.rt-row{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px}
.rt-tog{background:none;border:none;color:var(--accent);cursor:pointer;font-size:12px;width:18px;padding:0}
.rt-dot{width:18px;text-align:center;color:var(--faint)}
.rt-name{font-weight:600;white-space:nowrap}
.rt-email{color:var(--muted);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.rt-badge{flex:0 0 auto;font-size:11px;color:var(--accent);background:rgba(79,142,247,.12);padding:2px 8px;border-radius:999px}
@media(max-width:900px){.ua-stats{grid-template-columns:repeat(3,1fr)}.ua-grid2{grid-template-columns:1fr}}
`
