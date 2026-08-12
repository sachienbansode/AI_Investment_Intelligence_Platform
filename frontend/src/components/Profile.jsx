import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { toast } from '../dialog.jsx'

export default function Profile({ user, onUpdated }) {
  const [name, setName] = useState(user?.full_name || '')
  const [avatar, setAvatar] = useState(user?.avatar || '')
  const [saving, setSaving] = useState(false)
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [cf, setCf] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [prefs, setPrefs] = useState(null); const [prefBusy, setPrefBusy] = useState(false)
  const [inv, setInv] = useState(null); const [emails, setEmails] = useState(['','','','','']); const [invBusy, setInvBusy] = useState(false)

  useEffect(() => { api.alertPrefs().then(setPrefs).catch(() => {}) }, [])
  const loadInv = () => api.myInvites().then(setInv).catch(() => {})
  useEffect(() => { loadInv() }, [])

  function pickFile(e) {
    const f = e.target.files?.[0]; if (!f) return
    if (f.size > 500 * 1024) { toast('Image too large (max 500KB)'); return }
    const r = new FileReader(); r.onload = () => setAvatar(String(r.result)); r.readAsDataURL(f)
  }
  async function saveProfile() {
    setSaving(true)
    try { const u = await api.updateProfile({ full_name: name, avatar }); onUpdated && onUpdated(u); toast('Profile saved') }
    catch (e) { toast('Save failed: ' + (e.message || e)) } finally { setSaving(false) }
  }
  async function removePhoto() {
    setAvatar('')
    try { const u = await api.updateProfile({ avatar: '' }); onUpdated && onUpdated(u) } catch {}
  }
  async function savePw() {
    if (nw.length < 6) { toast('New password must be at least 6 characters'); return }
    if (nw !== cf) { toast('New passwords do not match'); return }
    setPwBusy(true)
    try { await api.changePassword({ current_password: cur, new_password: nw }); toast('Password changed'); setCur(''); setNw(''); setCf('') }
    catch (e) { toast('Failed: ' + (e.message || e)) } finally { setPwBusy(false) }
  }
  const setPref = (k, v) => setPrefs(p => ({ ...p, [k]: v }))
  async function savePrefs() {
    setPrefBusy(true)
    try {
      const body = { enabled: prefs.enabled, bands: prefs.bands, jumps: prefs.jumps,
        min_jump: prefs.min_jump === '' || prefs.min_jump == null ? null : Number(prefs.min_jump) }
      const p = await api.saveAlertPrefs(body); setPrefs(p); toast('Preferences saved')
    } catch (e) { toast('Save failed: ' + (e.message || e)) } finally { setPrefBusy(false) }
  }
  async function unmute(sym) { try { const p = await api.muteAlertSymbol(sym, false); setPrefs(p) } catch {} }

  async function sendInv() {
    const re = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
    const list = emails.map(e => e.trim()).filter(Boolean)
    if (!list.length) { toast('Enter at least one email'); return }
    if (list.some(e => !re.test(e))) { toast('One or more emails look invalid'); return }
    setInvBusy(true)
    try {
      const r = await api.sendInvites(list)
      const okN = (r.sent || []).length
      const skip = (r.skipped || []).length
      toast(okN ? (r.emailed ? `Sent ${okN} invite(s)` : `Recorded ${okN} invite(s) — share your code`)
                : (skip ? 'Nothing sent — see below' : 'No invites sent'))
      setEmails(['', '', '', '', '']); await loadInv()
    } catch (e) { toast('Failed: ' + (e.message || e)) } finally { setInvBusy(false) }
  }
  const initial = (name || user?.email || '?')[0].toUpperCase()
  return (
    <div className="profile-wrap">
      <div className="panel">
        <h3>My profile</h3>
        <div className="profile-top">
          <div className="profile-ava">
            {avatar ? <img src={avatar} alt="avatar" /> : <span className="avatar lg">{initial}</span>}
          </div>
          <div>
            <label className="btn-file">Upload photo<input type="file" accept="image/*" onChange={pickFile} hidden /></label>
            {avatar && <button className="ghost sm" style={{ marginLeft: 8 }} onClick={removePhoto}>Remove</button>}
            <div className="hint" style={{ marginTop: 6 }}>PNG or JPG, up to 500KB.</div>
          </div>
        </div>
        <div className="profile-fields">
          <label>Full name<input value={name} onChange={e => setName(e.target.value)} maxLength={80} /></label>
          <label>Email<input value={user?.email || ''} disabled title="Email is your login and can't be changed here" /></label>
          <label>Role<input value={user?.is_admin ? 'Administrator' : 'User'} disabled /></label>
          {user?.created_at && <label>Member since<input value={new Date(user.created_at).toLocaleDateString()} disabled /></label>}
        </div>
        <button onClick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</button>
      </div>

      <div className="panel">
        <h3>Change password</h3>
        <div className="profile-fields">
          <label>Current password<input type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" /></label>
          <label>New password<input type="password" value={nw} onChange={e => setNw(e.target.value)} autoComplete="new-password" /></label>
          <label>Confirm new password<input type="password" value={cf} onChange={e => setCf(e.target.value)} autoComplete="new-password" /></label>
        </div>
        <button onClick={savePw} disabled={pwBusy || !cur || !nw}>{pwBusy ? 'Updating…' : 'Update password'}</button>
      </div>

      {inv && (
        <div className="panel">
          <h3>Invite Friends</h3>
          <p className="hint" style={{ marginTop: 2 }}>
            You have <b style={{ color: 'var(--text)' }}>{inv.remaining}</b> of {inv.max} invites left.
            Enter up to {inv.remaining} email{inv.remaining === 1 ? '' : 's'} and we’ll send them an invite.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '8px 0 12px' }}>
            <span className="hint">Your code</span>
            <code>{inv.code}</code>
            <button className="ghost sm" onClick={() => { navigator.clipboard?.writeText(inv.code); toast('Code copied') }}>Copy code</button>
          </div>
          {inv.remaining > 0 ? (
            <div>
              {emails.slice(0, inv.remaining).map((v, i) => {
                const bad = v.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())
                return (
                  <input key={i} className="field" type="email" placeholder={"friend" + (i + 1) + "@email.com"}
                    value={v} style={{ borderColor: bad ? 'var(--red)' : undefined }}
                    onChange={e => setEmails(a => a.map((x, j) => j === i ? e.target.value : x))} />
                )
              })}
              <button onClick={sendInv} disabled={invBusy} style={{ marginTop: 8 }}>{invBusy ? 'Sending…' : 'Send invites'}</button>
            </div>
          ) : <p className="hint">You’ve used all your invites. Thanks for spreading the word!</p>}
          {(inv.invitations || []).length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div className="hint" style={{ marginBottom: 6 }}>Invited</div>
              {inv.invitations.map(it => (
                <span key={it.email} className="tag" style={{ marginRight: 6, marginBottom: 6, display: 'inline-block' }}>
                  {it.email} · <b style={{ color: it.status === 'joined' ? 'var(--green)' : 'var(--muted)' }}>{it.status}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {prefs && (
        <div className="panel">
          <h3>Alert preferences</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', margin: '8px 0' }}>
            <label><input type="checkbox" checked={!!prefs.enabled} onChange={e => setPref('enabled', e.target.checked)} /> Enable my alerts</label>
            <label><input type="checkbox" checked={!!prefs.bands} onChange={e => setPref('bands', e.target.checked)} /> Band crossings</label>
            <label><input type="checkbox" checked={!!prefs.jumps} onChange={e => setPref('jumps', e.target.checked)} /> Sharp moves</label>
            <label>Min move (pts)&nbsp;<input type="number" min="0" step="0.5" style={{ width: 90 }} value={prefs.min_jump ?? ''} placeholder="default" onChange={e => setPref('min_jump', e.target.value)} /></label>
            <button onClick={savePrefs} disabled={prefBusy}>{prefBusy ? 'Saving…' : 'Save'}</button>
          </div>
          <div className="hint" style={{ marginBottom: 4 }}>Muted scripts:</div>
          {(prefs.muted_symbols || []).length === 0 ? <span className="hint">None</span>
            : (prefs.muted_symbols || []).map(sym => (
                <span key={sym} className="tag" style={{ marginRight: 6, marginBottom: 6, display: 'inline-block' }}>
                  {sym} <a href="#" onClick={e => { e.preventDefault(); unmute(sym) }} style={{ marginLeft: 4 }}>✕</a></span>))}
        </div>
      )}
    </div>
  )
}
