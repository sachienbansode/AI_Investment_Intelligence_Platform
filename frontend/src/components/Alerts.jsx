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
  const [prefs, setPrefs] = useState(null)
  const [showPrefs, setShowPrefs] = useState(false)
  const [savingPrefs, setSavingPrefs] = useState(false)

  const load = () => api.alerts({ unread: unreadOnly, limit: 50 })
    .then(setData).catch(e => setErr(String(e.message || e)))
  useEffect(() => { load() }, [unreadOnly])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.alertPrefs().then(setPrefs).catch(() => {}) }, [])

  async function markAll() {
    try { await api.markAlertsRead({ all: true }); await load(); onSeen && onSeen() }
    catch (e) { toast('Failed: ' + (e.message || e)) }
  }
  async function open(a) {
    if (!a.is_read) { try { await api.markAlertsRead({ ids: [a.id] }); onSeen && onSeen() } catch {} }
    if (openScore) openScore(a.symbol); else if (go) go('Stock Scores')
  }
  async function mute(e, sym) {
    e.stopPropagation()
    try {
      const p = await api.muteAlertSymbol(sym, true); setPrefs(p)
      toast(sym + ' muted'); await load()
    } catch (er) { toast('Failed: ' + (er.message || er)) }
  }
  async function unmute(sym) {
    try { const p = await api.muteAlertSymbol(sym, false); setPrefs(p) } catch {}
  }
  async function savePrefs() {
    setSavingPrefs(true)
    try {
      const body = {
        enabled: prefs.enabled, bands: prefs.bands, jumps: prefs.jumps,
        min_jump: prefs.min_jump === '' || prefs.min_jump == null ? null : Number(prefs.min_jump),
      }
      const p = await api.saveAlertPrefs(body); setPrefs(p); toast('Preferences saved')
    } catch (e) { toast('Save failed: ' + (e.message || e)) } finally { setSavingPrefs(false) }
  }
  const setP = (k, v) => setPrefs(p => ({ ...p, [k]: v }))

  const items = data?.items || []
  return (
    <div>
      <div className="panel-head">
        <h3>Alerts {data?.unread ? <span className="tag">{data.unread} new</span> : null}</h3>
        <div>
          <button className={'sm ' + (showPrefs ? '' : 'ghost')} onClick={() => setShowPrefs(s => !s)}>Preferences</button>
          <button className={'sm ' + (unreadOnly ? '' : 'ghost')} style={{ marginLeft: 6 }}
                  onClick={() => setUnreadOnly(u => !u)}>{unreadOnly ? 'Showing unread' : 'Unread only'}</button>
          <button className="ghost sm" style={{ marginLeft: 6 }} onClick={markAll} disabled={!data?.unread}>Mark all read</button>
        </div>
      </div>
      <p className="hint" style={{ marginTop: 2 }}>
        Raised when a script in your watchlist or portfolio crosses a score band or moves sharply.
        Informational only, not investment advice.</p>
      {err && <p className="note">{err}</p>}

      {showPrefs && prefs && (
        <div className="panel" style={{ marginTop: 10 }}>
          <h4>Alert preferences</h4>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', margin: '8px 0' }}>
            <label><input type="checkbox" checked={!!prefs.enabled} onChange={e => setP('enabled', e.target.checked)} /> Enable my alerts</label>
            <label><input type="checkbox" checked={!!prefs.bands} onChange={e => setP('bands', e.target.checked)} /> Band crossings</label>
            <label><input type="checkbox" checked={!!prefs.jumps} onChange={e => setP('jumps', e.target.checked)} /> Sharp moves</label>
            <label>Min move (pts)&nbsp;
              <input type="number" min="0" step="0.5" style={{ width: 90 }}
                     value={prefs.min_jump ?? ''} placeholder="default"
                     onChange={e => setP('min_jump', e.target.value)} /></label>
            <button onClick={savePrefs} disabled={savingPrefs}>{savingPrefs ? 'Saving…' : 'Save'}</button>
          </div>
          <div className="hint" style={{ marginBottom: 4 }}>Muted scripts (no alerts):</div>
          {(prefs.muted_symbols || []).length === 0
            ? <span className="hint">None</span>
            : (prefs.muted_symbols || []).map(sym => (
                <span key={sym} className="tag" style={{ marginRight: 6, marginBottom: 6, display: 'inline-block' }}>
                  {sym} <a href="#" onClick={e => { e.preventDefault(); unmute(sym) }} style={{ marginLeft: 4 }}>✕</a>
                </span>))}
        </div>
      )}

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
                <button className="ghost sm alert-mute" title="Mute this script"
                        onClick={e => mute(e, a.symbol)}>Mute</button>
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
