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
        <h2>AI Investment Intelligence</h2>
        <p className="hint">Sign in to continue</p>
        <input type="email" placeholder="Email" value={email} required
               onChange={e => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" value={password} required
               onChange={e => setPassword(e.target.value)} />
        {err && <p className="note">{err}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Sign in'}</button>
        <p className="hint">No account? Contact your administrator.</p>
        <p className="disclaimer">AI outputs are informational only — not investment advice.</p>
      </form>
    </div>
  )
}
