import { useState } from 'react'
import { api, setToken } from '../api.js'

export default function Login({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const r = await api.login(email, password)
      setToken(r.access_token)
      onLogin(r.user)
    } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <img src="/niytri-logo.svg" alt="NIYTRI" className="login-logo"
             style={{ width: '100%', maxWidth: 260, margin: '0 auto 6px', display: 'block' }} />
        <h2 style={{ textAlign: 'center', fontSize: '1.05rem' }}>AI Investment Intelligence</h2>
        <p className="hint" style={{ textAlign: 'center' }}>Sign in to continue</p>
        <input type="email" placeholder="Email" value={email} required
               onChange={e => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" value={password} required
               onChange={e => setPassword(e.target.value)} />
        {err && <p className="note">{err}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Sign in'}</button>
        <p className="hint">No account? Contact your administrator.</p>
        <p className="disclaimer">AI outputs are informational only — not investment advice.</p>
        <p className="disclaimer" style={{ textAlign: 'center', borderTop: 'none', paddingTop: 0 }}>
          © {new Date().getFullYear()} NIYTRI Technologies. All rights reserved.</p>
      </form>
    </div>
  )
}
