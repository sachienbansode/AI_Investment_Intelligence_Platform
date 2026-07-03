import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { fmtIST } from '../fmt.js'
import { toast } from '../dialog.jsx'

const UP = String.fromCharCode(0x25B2)
const DN = String.fromCharCode(0x25BC)
const bandColor = b => b === 'strong' ? 'var(--green)' : b === 'weak' ? 'var(--red)' : 'var(--amber)'
const isUp = k => k === 'band_up' || k === 'jump'

export default function Alerts({ go, openScore, onSeen }) {
  const [data, setData] = useState(null)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [err, setErr] = useState('')

  const load = () => api.alerts({ unread: unreadOnly, limit: 50 })
    .then(setData).catch(e => setErr(String(e.message || e)))
  useEffect(() => { load() }, [unreadOnly])   // eslint-disable-line react-hooks/exhaustive-deps

  async function markAll() {
    try { await api.markAlertsRead({ all: true }); await load(); onSeen && onSeen() }
    catch (e) { toast('Failed: ' + (e.message || e)) }
  }
  async function open(a) {
    if (!a.is_read) {
      try { await api.markAlertsRead({ ids: [a.id] }); onSeen && onSeen() } catch {}
    }
    if (openScore) openScore(a.symbol)
    else if (go) go('Stock Scores')
  }

  const items = data?.items || []
  return (
    <div>
      <div className="panel-head">
        <h3>Alerts {data?.unread ? <span className="tag">{data.unread} new</span> : null}</h3>
        <div>
          <button className={'sm ' + (unreadOnly ? '' : 'ghost')} onClick={() => setUnreadOnly(u => !u)}>
            {unreadOnly ? 'Showing unread' : 'Unread only'}</button>
          <button className="ghost sm" style={{ marginLeft: 6 }} onClick={markAll} disabled={!data?.unread}>
            Mark all read</button>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 2 }}>
        Raised when a script in your watchlist or portfolio crosses a score band or moves sharply.
        Informational only, not investment advice.</p>
      {err && <p className="note">{err}</p>}
      <div className="panel" style={{ marginTop: 10 }}>
        {items.length === 0 && <p className="hint">No alerts yet.</p>}
        {items.map(a => (
          <div key={a.id} className={'alert-row row-click' + (a.is_read ? '' : ' unread')}
               title="Open in Stock Scores" onClick={() => open(a)}>
            <span className="alert-ico" style={{ color: isUp(a.kind) ? 'var(--green)' : 'var(--red)' }}>
              {isUp(a.kind) ? UP : DN}</span>
            <div className="alert-body">
              <div className="alert-top">
                <strong>{a.symbol}</strong>
                <span className="score sm" style={{ background: bandColor(a.to_band) }}>{a.to_score}</span>
                <span className={'alert-delta ' + (a.delta >= 0 ? 'up' : 'down')}>
                  {a.delta >= 0 ? '+' : ''}{a.delta}</span>
                <span className="hint alert-src">{a.source}</span>
                {!a.is_read && <span className="alert-dot" />}
              </div>
              <div className="alert-msg">{a.message}</div>
              <div className="hint alert-time">{a.score_date}{a.created_at ? ' · ' + fmtIST(a.created_at) : ''}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
