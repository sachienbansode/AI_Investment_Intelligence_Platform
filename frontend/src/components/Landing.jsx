import { useEffect, useRef, useState } from 'react'
import { api, setSession } from '../api.js'

// Public marketing landing + auth (email login / sign-up / Google / waitlist).
// The logged-in application is unchanged; this only replaces the pre-auth screen.
export default function Landing({ onLogin }) {
  const [info, setInfo] = useState(null)          // registration-info
  const [view, setView] = useState('signin')      // signin | signup | waitlist
  const [full_name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const gbtn = useRef(null)

  useEffect(() => { api.registrationInfo().then(setInfo).catch(() => setInfo({ mode: 'invite_only' })) }, [])

  // Google Identity Services (only if an OAuth client id is configured).
  useEffect(() => {
    if (!info || !info.google_enabled || !info.google_client_id) return
    function render() {
      if (!window.google || !gbtn.current) return
      window.google.accounts.id.initialize({
        client_id: info.google_client_id,
        callback: async (resp) => {
          setBusy(true); setErr('')
          try {
            const r = await api.googleAuth(resp.credential, invite.trim() || null)
            setSession(r); onLogin(r.user)
          } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
        },
      })
      gbtn.current.innerHTML = ''
      window.google.accounts.id.renderButton(gbtn.current,
        { theme: 'filled_black', size: 'large', shape: 'pill', width: 320, text: 'continue_with' })
    }
    if (window.google) { render(); return }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true
    s.onload = render; document.head.appendChild(s)
  }, [info, view, invite])

  const mode = info ? info.mode : 'invite_only'
  const inviteRequired = mode === 'invite_only'
  const closed = mode === 'closed'

  async function doLogin(e) {
    e.preventDefault(); setBusy(true); setErr(''); setOk('')
    try { const r = await api.login(email, password); setSession(r); onLogin(r.user) }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  async function doRegister(e) {
    e.preventDefault(); setBusy(true); setErr(''); setOk('')
    try {
      const r = await api.register({ email, password, full_name, invite_code: invite.trim() || null })
      setSession(r); onLogin(r.user)
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  async function doWaitlist(e) {
    e.preventDefault(); setBusy(true); setErr(''); setOk('')
    try { await api.waitlist(email); setOk("You're on the list! We'll email you when a seat opens.") }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }

  const features = [
    ['NIYTRI Score', 'A transparent 0–100 signal per stock, built from eight weighted pillars — fundamentals, earnings, momentum, sentiment and more.'],
    ['Data Lense Assistant', 'Ask anything in plain language. Grounded in live quotes, approved scores, fresh news and your own broker research.'],
    ['News Intelligence', 'Market news distilled into short, sourced summaries with impacted stocks, sectors and sentiment — updated through the day.'],
    ['Portfolio Health', 'Upload your holdings for a clear health score, concentration and sector checks, and a Red / Amber / Green readout.'],
    ['Score Alerts', 'Get notified the moment a watchlist stock crosses a score band — no more refreshing to catch a change.'],
    ['Open Partner API', 'Plug NIYTRI intelligence into your own apps and dashboards with a clean, documented, key-based API.'],
  ]
  const steps = [
    ['Grab Your Seat', 'Sign up with a personal invite code from a member, or join the waitlist for the next batch.'],
    ['Explore The Intelligence', 'Track scores, ask the assistant, scan news and check your portfolio — all in one clean workspace.'],
    ['Invite Your Circle', 'Every member gets a handful of invites to share. Bring the people whose calls you actually trust.'],
  ]

  return (
    <div className="lp">
      <style>{CSS}</style>

      <header className="lp-nav">
        <div className="lp-brand">
          <img src="/niytri-logo.svg" alt="NIYTRI" onError={e => { e.currentTarget.src = '/niytri-logo.png' }} />
        </div>
        <div className="lp-navbtns">
          <button className="lp-ghost" onClick={() => { setView('signin'); scrollAuth() }}>Log In</button>
          <button className="lp-cta" onClick={() => { setView(closed ? 'waitlist' : 'signup'); scrollAuth() }}>
            {closed ? 'Join Waitlist' : 'Get Started'}</button>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-hero-copy">
          <span className="lp-pill">{inviteRequired ? 'Invite-Only Beta' : 'Now In Beta'}</span>
          <h1>Invest Smarter,<br /><span className="lp-grad">Your Way</span></h1>
          <p className="lp-sub">
            NIYTRI turns market noise into clear, transparent intelligence — AI scores, a
            grounded assistant, news and portfolio health, all in one place. Information and
            analytics, never buy-or-sell advice.</p>
          <ul className="lp-hl">
            <li>Transparent 0–100 stock scores</li>
            <li>Ask-anything Data Lense assistant</li>
            <li>Portfolio health &amp; score alerts</li>
          </ul>
        </div>

        <div className="lp-auth" id="lp-auth">
          <div className="lp-tabs">
            <button className={view === 'signin' ? 'on' : ''} onClick={() => setView('signin')}>Log In</button>
            {!closed && <button className={view === 'signup' ? 'on' : ''} onClick={() => setView('signup')}>Sign Up</button>}
            {(closed || (info && info.waitlist_enabled)) &&
              <button className={view === 'waitlist' ? 'on' : ''} onClick={() => setView('waitlist')}>Waitlist</button>}
          </div>

          {view === 'signin' && (
            <form onSubmit={doLogin} className="lp-form">
              <input type="email" placeholder="Email" value={email} required onChange={e => setEmail(e.target.value)} />
              <input type="password" placeholder="Password" value={password} required onChange={e => setPassword(e.target.value)} />
              <button className="lp-submit" disabled={busy}>{busy ? 'Please wait…' : 'Log In'}</button>
            </form>
          )}

          {view === 'signup' && !closed && (
            <form onSubmit={doRegister} className="lp-form">
              <input placeholder="Full name" value={full_name} onChange={e => setName(e.target.value)} />
              <input type="email" placeholder="Email" value={email} required onChange={e => setEmail(e.target.value)} />
              <input type="password" placeholder="Create a password" value={password} required onChange={e => setPassword(e.target.value)} />
              <input placeholder={inviteRequired ? 'Invite code (required)' : 'Invite code (optional)'}
                     value={invite} required={inviteRequired} onChange={e => setInvite(e.target.value)} />
              <button className="lp-submit" disabled={busy}>{busy ? 'Please wait…' : 'Create Account'}</button>
              {inviteRequired && (info && info.waitlist_enabled) &&
                <p className="lp-mini">No code? <a onClick={() => setView('waitlist')}>Join the waitlist →</a></p>}
            </form>
          )}

          {view === 'waitlist' && (
            <form onSubmit={doWaitlist} className="lp-form">
              <p className="lp-mini">Beta is invite-only right now. Leave your email and we'll reach out when a seat opens.</p>
              <input type="email" placeholder="Email" value={email} required onChange={e => setEmail(e.target.value)} />
              <button className="lp-submit" disabled={busy}>{busy ? 'Please wait…' : 'Join Waitlist'}</button>
            </form>
          )}

          {view !== 'waitlist' && info && info.google_enabled && (
            <>
              <div className="lp-or"><span>or</span></div>
              <div className="lp-google" ref={gbtn} />
            </>
          )}

          {err && <p className="lp-err">{err}</p>}
          {ok && <p className="lp-ok">{ok}</p>}
        </div>
      </section>

      <section className="lp-sec">
        <h2>Everything You Need, In One Clear View</h2>
        <div className="lp-grid">
          {features.map(([t, d]) => (
            <div className="lp-card" key={t}><h3>{t}</h3><p>{d}</p></div>
          ))}
        </div>
      </section>

      <section className="lp-sec lp-steps-sec">
        <h2>How The Invite-Only Beta Works</h2>
        <div className="lp-steps">
          {steps.map(([t, d], i) => (
            <div className="lp-step" key={t}>
              <div className="lp-num">{i + 1}</div>
              <h3>{t}</h3><p>{d}</p>
            </div>
          ))}
        </div>
        <div className="lp-cta-row">
          <button className="lp-cta lg" onClick={() => { setView(closed ? 'waitlist' : 'signup'); scrollAuth() }}>
            {closed ? 'Join The Waitlist' : 'Grab Your Seat'}</button>
        </div>
      </section>

      <footer className="lp-foot">
        <img src="/niytri-mark.svg" alt="" onError={e => { e.currentTarget.style.display = 'none' }} />
        <p className="lp-disc">
          NIYTRI provides AI-generated market information and analytics for informational
          purposes only — not investment advice. Investments are subject to market risks.</p>
        <p className="lp-copy">© {new Date().getFullYear()} NIYTRI Technologies. All rights reserved.</p>
      </footer>
    </div>
  )
}

function scrollAuth() {
  const el = document.getElementById('lp-auth')
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

const CSS = `
.lp{--b1:#22D3EE;--b2:#7C5CFC;--b3:#EC4899;--bg:#0B0F1A;--panel:#121826;--panel2:#0F1524;
  --line:#1E2637;--tx:#E8ECF4;--mut:#94A3B8;
  position:fixed;inset:0;overflow-y:auto;background:
  radial-gradient(1100px 600px at 85% -10%,rgba(124,92,252,.22),transparent 60%),
  radial-gradient(900px 500px at 0% 10%,rgba(34,211,238,.14),transparent 55%),var(--bg);
  color:var(--tx);font-family:Inter,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;z-index:50}
.lp *{box-sizing:border-box}
.lp-nav{display:flex;align-items:center;justify-content:space-between;padding:18px 6vw;position:sticky;top:0;
  background:rgba(11,15,26,.72);backdrop-filter:blur(10px);border-bottom:1px solid var(--line);z-index:5}
.lp-brand img{height:30px;display:block}
.lp-navbtns{display:flex;gap:10px}
.lp-ghost{background:transparent;color:var(--tx);border:1px solid var(--line);padding:9px 16px;border-radius:999px;font-weight:600;cursor:pointer}
.lp-ghost:hover{border-color:var(--b2)}
.lp-cta{border:0;color:#0B0F1A;font-weight:700;padding:10px 18px;border-radius:999px;cursor:pointer;
  background:linear-gradient(90deg,var(--b1),var(--b2) 55%,var(--b3));box-shadow:0 8px 24px rgba(124,92,252,.35)}
.lp-cta:hover{filter:brightness(1.06)}
.lp-cta.lg{padding:14px 30px;font-size:16px}
.lp-hero{display:grid;grid-template-columns:1.1fr .9fr;gap:48px;align-items:center;padding:64px 6vw 40px;max-width:1200px;margin:0 auto}
.lp-pill{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;
  color:var(--b1);border:1px solid rgba(34,211,238,.4);padding:6px 12px;border-radius:999px;background:rgba(34,211,238,.08)}
.lp-hero-copy h1{font-size:56px;line-height:1.04;margin:18px 0 14px;font-weight:800;letter-spacing:-1px}
.lp-grad{background:linear-gradient(90deg,var(--b1),var(--b2) 50%,var(--b3));-webkit-background-clip:text;background-clip:text;color:transparent}
.lp-sub{color:var(--mut);font-size:17px;line-height:1.6;max-width:520px}
.lp-hl{list-style:none;padding:0;margin:22px 0 0;display:grid;gap:10px}
.lp-hl li{position:relative;padding-left:26px;color:var(--tx);font-weight:500}
.lp-hl li:before{content:"";position:absolute;left:0;top:6px;width:14px;height:14px;border-radius:50%;
  background:linear-gradient(90deg,var(--b1),var(--b3))}
.lp-auth{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--line);
  border-radius:20px;padding:26px;box-shadow:0 24px 60px rgba(0,0,0,.45)}
.lp-tabs{display:flex;gap:6px;background:#0B1220;border:1px solid var(--line);border-radius:12px;padding:5px;margin-bottom:18px}
.lp-tabs button{flex:1;background:transparent;border:0;color:var(--mut);font-weight:600;padding:9px;border-radius:8px;cursor:pointer}
.lp-tabs button.on{background:linear-gradient(90deg,var(--b1),var(--b2) 60%,var(--b3));color:#0B0F1A}
.lp-form{display:grid;gap:12px}
.lp-form input{background:#0B1220;border:1px solid var(--line);border-radius:11px;padding:13px 14px;color:var(--tx);font-size:15px;outline:none}
.lp-form input:focus{border-color:var(--b2);box-shadow:0 0 0 3px rgba(124,92,252,.2)}
.lp-submit{margin-top:4px;border:0;color:#0B0F1A;font-weight:700;font-size:15px;padding:13px;border-radius:11px;cursor:pointer;
  background:linear-gradient(90deg,var(--b1),var(--b2) 55%,var(--b3))}
.lp-submit:hover{filter:brightness(1.06)}
.lp-submit:disabled{opacity:.6;cursor:default}
.lp-mini{color:var(--mut);font-size:13px;margin:2px 0 0;text-align:center}
.lp-mini a{color:var(--b1);cursor:pointer;text-decoration:none}
.lp-or{display:flex;align-items:center;gap:12px;color:var(--mut);font-size:12px;margin:16px 0}
.lp-or:before,.lp-or:after{content:"";flex:1;height:1px;background:var(--line)}
.lp-google{display:flex;justify-content:center;min-height:44px}
.lp-err{color:#FCA5A5;font-size:13px;margin:12px 0 0;text-align:center}
.lp-ok{color:#6EE7B7;font-size:13px;margin:12px 0 0;text-align:center}
.lp-sec{max-width:1200px;margin:0 auto;padding:56px 6vw}
.lp-sec h2{font-size:34px;font-weight:800;text-align:center;letter-spacing:-.5px;margin:0 0 36px}
.lp-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.lp-card{background:linear-gradient(180deg,var(--panel),var(--panel2));border:1px solid var(--line);border-radius:16px;padding:24px;transition:.18s}
.lp-card:hover{transform:translateY(-4px);border-color:var(--b2)}
.lp-card h3{margin:0 0 8px;font-size:18px;font-weight:700}
.lp-card p{margin:0;color:var(--mut);line-height:1.55;font-size:14.5px}
.lp-steps-sec{background:rgba(255,255,255,.02);border-top:1px solid var(--line);border-bottom:1px solid var(--line);max-width:none}
.lp-steps{max-width:1080px;margin:0 auto;display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.lp-step{text-align:center;padding:10px}
.lp-num{width:46px;height:46px;margin:0 auto 14px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-weight:800;color:#0B0F1A;background:linear-gradient(90deg,var(--b1),var(--b3))}
.lp-step h3{margin:0 0 8px;font-size:18px}
.lp-step p{margin:0;color:var(--mut);line-height:1.55;font-size:14.5px}
.lp-cta-row{text-align:center;margin-top:36px}
.lp-foot{text-align:center;padding:44px 6vw 56px;border-top:1px solid var(--line)}
.lp-foot img{height:28px;opacity:.85;margin-bottom:14px}
.lp-disc{color:var(--mut);font-size:12.5px;max-width:640px;margin:0 auto 8px;line-height:1.5}
.lp-copy{color:#64748B;font-size:12px;margin:0}
@media(max-width:900px){.lp-hero{grid-template-columns:1fr;padding-top:36px}.lp-hero-copy h1{font-size:40px}
  .lp-grid,.lp-steps{grid-template-columns:1fr}.lp-sec h2{font-size:26px}}
`
