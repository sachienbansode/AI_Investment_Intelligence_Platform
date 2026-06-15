import { useState } from 'react'
import { api, setToken } from '../api.js'

const card = { background: '#0c1226', border: '1px solid #1e2b50', color: '#e8edf7',
  boxShadow: '0 12px 48px rgba(0,0,0,.55)', width: 'min(380px, 92vw)' }
const field = { background: '#121a33', border: '1px solid #2a3a63', color: '#fff' }
const muted = { color: '#9fb0d6' }
const faint = { color: '#6e7fb0' }

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
    <div className="login-wrap"
         style={{ background: 'radial-gradient(1000px 560px at 30% -5%, rgba(79,142,247,.20), #070b16)' }}>
      <form className="login-card" style={card} onSubmit={submit}>
        <img src="/niytri-login.png" alt="NIYTRI"
             onError={e => { e.currentTarget.onerror = null; e.currentTarget.src = '/niytri-logo.svg' }}
             style={{ width: '100%', maxWidth: 290, display: 'block', margin: '0 auto 10px', borderRadius: 10 }} />
        <p style={{ ...muted, textAlign: 'center', margin: 0, fontWeight: 600 }}>AI Investment Intelligence Platform</p>
        <p style={{ ...muted, textAlign: 'center', margin: '2px 0 4px', fontSize: '.9rem' }}>Sign in to continue</p>
        <input type="email" placeholder="Email" value={email} required style={field}
               onChange={e => setEmail(e.target.value)} />
        <input type="password" placeholder="Password" value={password} required style={field}
               onChange={e => setPassword(e.target.value)} />
        {err && <p className="note">{err}</p>}
        <button type="submit" disabled={busy}>{busy ? 'Please wait…' : 'Sign in'}</button>
        <p style={{ ...muted, textAlign: 'center', fontSize: '.85rem', margin: '4px 0 0' }}>No account? Contact your administrator.</p>
        <p style={{ ...faint, textAlign: 'center', fontSize: '.72rem', margin: '10px 0 0', borderTop: '1px solid #1e2b50', paddingTop: 10 }}>
          AI outputs are informational only — not investment advice.</p>
        <p style={{ ...faint, textAlign: 'center', fontSize: '.72rem', margin: '2px 0 0' }}>
          © {new Date().getFullYear()} NIYTRI Technologies. All rights reserved.</p>
      </form>
    </div>
  )
}
