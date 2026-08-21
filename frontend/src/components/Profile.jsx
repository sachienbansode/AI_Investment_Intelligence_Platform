import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { toast } from '../dialog.jsx'

// Password policy (mirrors the backend): 8+ chars with a letter, number and special char.
export function pwError(pw) {
  pw = pw || ''
  if (pw.length < 8) return 'Password must be at least 8 characters.'
  if (!/[A-Za-z]/.test(pw)) return 'Password must include a letter.'
  if (!/\d/.test(pw)) return 'Password must include a number.'
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Password must include a special character (e.g. ! @ # $ %).'
  return null
}
const PW_RULES = [
  ['At least 8 characters', p => (p || '').length >= 8],
  ['A letter', p => /[A-Za-z]/.test(p || '')],
  ['A number', p => /\d/.test(p || '')],
  ['A special character (! @ # $ %)', p => /[^A-Za-z0-9]/.test(p || '')],
]

export default function Profile({ user, onUpdated }) {
  const [name, setName] = useState(user?.full_name || '')
  const [avatar, setAvatar] = useState(user?.avatar || '')
  const [saving, setSaving] = useState(false)
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [cf, setCf] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [prefs, setPrefs] = useState(null); const [prefBusy, setPrefBusy] = useState(false)
  const [inv, setInv] = useState(null); const [emails, setEmails] = useState(['']); const [invBusy, setInvBusy] = useState(false)
  const [shareCode, setShareCode] = useState('')

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
    const perr = pwError(nw)
    if (perr) { toast(perr); return }
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
      setEmails(['']); await loadInv()
    } catch (e) { toast('Failed: ' + (e.message || e)) } finally { setInvBusy(false) }
  }
  async function genCode() {
    try { const r = await api.createInviteCode(); setShareCode(r.code); await loadInv(); toast('New one-time code created') }
    catch (e) { toast('Failed: ' + (e.message || e)) }
  }
  async function resendInv(email) {
    try {
      const r = await api.resendInvite(email)
      toast(r.already_member ? 'They’ve already joined 🎉'
        : (r.delivered ? 'Invite re-sent to ' + email : 'Couldn’t send — check email settings'))
      await loadInv()
    } catch (e) { toast('Failed: ' + (e.message || e)) }
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
        <div className="profile-fields" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <label style={{ gridColumn: '1 / -1' }}>Current password<input type="password" value={cur} onChange={e => setCur(e.target.value)} autoComplete="current-password" /></label>
          <label>New password<input type="password" value={nw} onChange={e => setNw(e.target.value)} autoComplete="new-password" /></label>
          <label>Confirm new password<input type="password" value={cf} onChange={e => setCf(e.target.value)} autoComplete="new-password"
            style={{ borderColor: cf && cf !== nw ? 'var(--red)' : undefined }} /></label>
        </div>
        <ul style={{ listStyle: 'none', padding: 0, margin: '2px 0 12px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px' }}>
          {PW_RULES.map(([label, test]) => {
            const okr = test(nw)
            return <li key={label} style={{ fontSize: 12.5, color: !nw ? 'var(--muted)' : (okr ? 'var(--green)' : 'var(--muted)') }}>{okr ? '✓' : '○'} {label}</li>
          })}
          {cf && cf !== nw && <li style={{ fontSize: 12.5, color: 'var(--red)', gridColumn: '1 / -1' }}>✗ Passwords don’t match</li>}
        </ul>
        <button onClick={savePw} disabled={pwBusy || !cur || !nw}>{pwBusy ? 'Updating…' : 'Update password'}</button>
      </div>

      {inv && (
        <div className="panel">
          <h3>Invite Friends</h3>
          <p className="hint" style={{ marginTop: 2 }}>
            You’ve used <b style={{ color: 'var(--text)' }}>{inv.used ?? inv.sent}</b> of {inv.max} ·{' '}
            <b style={{ color: 'var(--text)' }}>{inv.remaining}</b> remaining.
            Add one at a time, or up to {inv.remaining} at once.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '8px 0 12px' }}>
            <button className="ghost sm" onClick={genCode} disabled={inv.remaining <= 0}>Create a shareable code</button>
            {shareCode && <>
              <code>{shareCode}</code>
              <button className="ghost sm" onClick={() => { navigator.clipboard?.writeText(shareCode); toast('Code copied') }}>Copy</button>
              <span className="hint">one-time — works once</span>
            </>}
          </div>
          {inv.remaining > 0 ? (
            <div>
              {emails.map((v, i) => {
                const bad = v.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim())
                return (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <input className="field" type="email" placeholder={"friend" + (i + 1) + "@email.com"}
                      value={v} style={{ flex: 1, borderColor: bad ? 'var(--red)' : undefined, margin: 0 }}
                      onChange={e => setEmails(a => a.map((x, j) => j === i ? e.target.value : x))} />
                    {emails.length > 1 && (
                      <button className="ghost sm" title="Remove" style={{ flex: '0 0 auto' }}
                        onClick={() => setEmails(a => a.filter((_, j) => j !== i))}>✕</button>
                    )}
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}>
                <button className="ghost sm" disabled={emails.length >= inv.remaining}
                  onClick={() => setEmails(a => [...a, ''])}>+ Add another</button>
                <button onClick={sendInv} disabled={invBusy} style={{ marginLeft: 'auto' }}>
                  {invBusy ? 'Sending…' : 'Send ' + (emails.filter(e => e.trim()).length <= 1 ? 'invite' : emails.filter(e => e.trim()).length + ' invites')}
                </button>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>
                {emails.length >= inv.remaining ? 'You’ve reached your invite limit.' : 'You can add up to ' + inv.remaining + ' in total.'}
              </div>
            </div>
          ) : <p className="hint">You’ve used all your invites. Thanks for spreading the word!</p>}
          {(inv.invitations || []).length > 0 && (
            <div style={{ marginTop: 18 }}>
              <div className="hint" style={{ marginBottom: 8, fontWeight: 600 }}>Invited ({inv.invitations.length})</div>
              <div style={{ display: 'grid', gap: 8 }}>
                {inv.invitations.map(it => {
                  const st = it.status
                  const pill = st === 'joined' ? { bg: 'rgba(34,160,107,.14)', c: 'var(--green)', t: 'Joined' }
                    : st === 'sent' ? { bg: 'var(--panel2)', c: 'var(--muted)', t: 'Sent' }
                    : { bg: 'rgba(212,146,15,.16)', c: 'var(--amber)', t: 'Shared' }
                  return (
                    <div key={it.code || it.email} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--panel)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.email}</div>
                        {it.code && <code style={{ fontSize: '.7rem', color: 'var(--faint)', letterSpacing: '.5px' }}>{it.code}</code>}
                      </div>
                      <span style={{ fontSize: '.72rem', fontWeight: 700, color: pill.c, background: pill.bg, padding: '3px 11px', borderRadius: 999, flex: '0 0 auto' }}>{pill.t}</span>
                      {st !== 'joined' && <button className="ghost sm" style={{ flex: '0 0 auto' }} onClick={() => resendInv(it.email)}>Resend</button>}
                    </div>
                  )
                })}
              </div>
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
