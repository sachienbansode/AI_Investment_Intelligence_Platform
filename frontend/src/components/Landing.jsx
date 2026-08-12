import { useEffect, useMemo, useRef, useState } from 'react'
import { api, setSession } from '../api.js'

// Public marketing landing + auth. Faithful to the approved mockup (v5): dark brand
// gradient, Inter, hero preview chart, icon feature cards, steps, join auth card.
// The logged-in application is unchanged; this only replaces the pre-auth screen.

const GoogleG = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
)

const FEATURES = [
  ['k1', 'AI Assistant', 'Chat with an analyst that never sleeps. Ask about any stock, your portfolio, the market or a score — grounded in live data and answered in plain English or your language.',
    <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />],
  ['k2', 'Explainable NIYTRI Score', 'Every NSE stock rated 0–100 daily across 8 factors — fundamentals, technicals, valuation, momentum, earnings, sentiment, institutions and risk — each with a clear reason, never a black box.',
    <><path d="M4 20a8 8 0 1 1 16 0" /><path d="M12 20V9" /><path d="M12 9l4.5 3.3" /></>],
  ['k3', 'Smart Alerts', 'Follow the stocks you care about and get notified the moment one crosses into Strong, slips to Weak, or moves sharply — with a one-line explanation of what drove the change.',
    <><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></>],
  ['k4', 'Portfolio X-Ray', 'Upload your holdings and instantly see a health score, concentration and sector risk, and estimated P&L — understand what you actually own, not just what you bought.',
    <path d="M21 12a9 9 0 1 1-9-9v9z" />],
  ['k5', 'Delayed Price Charts', 'Clean price charts with the key stats — P/E, market cap, 52-week range — sitting right beside the AI score, so you get the full picture on one screen.',
    <><path d="M3 17l5-5 4 3 5-7" /><path d="M15 8h5v5" /></>],
  ['k6', 'Market News AI', "The day's market news, summarised and sentiment-tagged, and automatically linked to the stocks and sectors each headline actually moves.",
    <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 8h8M7 12h8M7 16h5" /></>],
]
const STEPS = [
  ['Create Your Account', "Sign up in seconds with Google or email — or redeem a friend's invite code to skip the queue."],
  ['Follow Your Stocks', 'Add the stocks you care about to a watchlist, or upload your whole portfolio in one tap.'],
  ['Ask & Act', 'Let the AI explain any score, headline or risk in plain language — and ping you the moment things change.'],
]

// Seeded random-walk preview chart (matches the approved mockup exactly).
function usePreviewChart() {
  return useMemo(() => {
    const W = 360, H = 160, padT = 14, padB = 22, padL = 6, padR = 52, n = 64
    let seed = 42
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    let v = 1180; const vals = []
    for (let i = 0; i < n; i++) { v += (rnd() - 0.46) * 22 + Math.sin(i / 7) * 4; vals.push(v) }
    const prev = vals[0], last = vals[n - 1]
    const min = Math.min(...vals), max = Math.max(...vals), rng = (max - min) || 1
    const X = i => padL + (W - padL - padR) * (i / (n - 1))
    const Y = val => padT + (H - padT - padB) * (1 - (val - min) / rng)
    const up = last >= prev
    const line = up ? '#22D3EE' : '#ff5d8f'
    let d = 'M' + X(0) + ',' + Y(vals[0])
    for (let i = 1; i < n; i++) { const cx = (X(i - 1) + X(i)) / 2; d += ' Q' + X(i - 1) + ',' + Y(vals[i - 1]) + ' ' + cx + ',' + ((Y(vals[i - 1]) + Y(vals[i])) / 2) }
    d += ' T' + X(n - 1) + ',' + Y(vals[n - 1])
    const gy = [0.15, 0.4, 0.65, 0.9].map(f => padT + (H - padT - padB) * f)
    const grid = gy.map(y => '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#1b2340" stroke-width="1"/>').join('')
    const yl = [max, (max + min) / 2, min].map(val => '<text x="' + (W - padR + 8) + '" y="' + (Y(val) + 4).toFixed(1) + '" fill="#6f7c9c" font-size="10">₹' + Math.round(val) + '</text>').join('')
    const dates = ['4 wk', '3 wk', '2 wk', '1 wk', 'now']
    const xl = dates.map((t, i) => '<text x="' + X(i / (dates.length - 1) * (n - 1)).toFixed(1) + '" y="' + (H - 6) + '" fill="#6f7c9c" font-size="10" text-anchor="' + (i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle') + '">' + t + '</text>').join('')
    const inner =
      '<defs><linearGradient id="lpfl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + line + '" stop-opacity=".22"/><stop offset="1" stop-color="' + line + '" stop-opacity="0"/></linearGradient></defs>' +
      grid +
      '<line x1="' + padL + '" y1="' + Y(prev).toFixed(1) + '" x2="' + (W - padR) + '" y2="' + Y(prev).toFixed(1) + '" stroke="#454f73" stroke-width="1" stroke-dasharray="4 4"/>' +
      '<path d="' + d + ' L' + (W - padR) + ',' + (H - padB) + ' L' + padL + ',' + (H - padB) + ' Z" fill="url(#lpfl)"/>' +
      '<path d="' + d + '" fill="none" stroke="' + line + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + (W - padR).toFixed(1) + '" cy="' + Y(last).toFixed(1) + '" r="3.5" fill="' + line + '"/>' +
      '<rect x="' + (W - padR + 2) + '" y="' + (Y(last) - 11).toFixed(1) + '" width="46" height="20" rx="6" fill="' + line + '"/>' +
      '<text x="' + (W - padR + 25) + '" y="' + (Y(last) + 3).toFixed(1) + '" fill="#08101f" font-size="11" font-weight="700" text-anchor="middle">₹' + Math.round(last) + '</text>' +
      yl + xl
    return { inner, up, last: Math.round(last) }
  }, [])
}

export default function Landing({ onLogin }) {
  const [info, setInfo] = useState(null)
  const [view, setView] = useState('signin')
  const [full_name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [invite, setInvite] = useState('')
  const [err, setErr] = useState('')
  const [ok, setOk] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null)   // email-verification pending
  const gbtn = useRef(null)
  const chart = usePreviewChart()

  useEffect(() => { api.registrationInfo().then(setInfo).catch(() => setInfo({ mode: 'invite_only' })) }, [])

  // Complete email verification if the page was opened from the emailed link.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const token = p.get('verify')
    if (!token) { if (p.get('invite')) setInvite(p.get('invite')) ; return }
    api.verifyEmail(token)
      .then(r => { setSession(r); onLogin(r.user) })
      .catch(() => { setErr('This verification link is invalid or has already been used.'); setView('signin') })
      .finally(() => { window.history.replaceState({}, '', window.location.pathname) })
  }, [])

  // Google Identity Services (only when a client id is configured).
  useEffect(() => {
    if (!info || !info.google_enabled || !info.google_client_id) return
    function render() {
      if (!window.google || !gbtn.current) return
      window.google.accounts.id.initialize({
        client_id: info.google_client_id,
        callback: async (resp) => {
          setBusy(true); setErr('')
          try { const r = await api.googleAuth(resp.credential, invite.trim() || null); setSession(r); onLogin(r.user) }
          catch (ex) { setErr(ex.message) } finally { setBusy(false) }
        },
      })
      gbtn.current.innerHTML = ''
      window.google.accounts.id.renderButton(gbtn.current,
        { theme: 'filled_black', size: 'large', shape: 'pill', width: 330, text: 'continue_with' })
    }
    if (window.google) { render(); return }
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.defer = true
    s.onload = render; document.head.appendChild(s)
  }, [info, view, invite, pending])

  const mode = info ? info.mode : 'invite_only'
  const inviteRequired = mode === 'invite_only'
  const closed = mode === 'closed'

  async function doLogin(e) {
    e.preventDefault(); setBusy(true); setErr(''); setOk('')
    try { const r = await api.login(email, password); setSession(r); onLogin(r.user) }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  async function doRegister(e) {
    e.preventDefault(); setErr(''); setOk('')
    if (!full_name.trim()) return setErr('Please enter your full name.')
    if (password.length < 6) return setErr('Password must be at least 6 characters.')
    if (password !== confirm) return setErr('Passwords do not match.')
    if (inviteRequired && !invite.trim()) return setErr('An invite code is required to join the beta.')
    setBusy(true)
    try {
      const r = await api.register({ email, password, full_name, invite_code: invite.trim() || null })
      if (r && r.needs_verification) setPending({ email, delivered: r.delivered, verify_link: r.verify_link, resent: r.resent })
      else { setSession(r); onLogin(r.user) }
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  async function doWaitlist(e) {
    e.preventDefault(); setBusy(true); setErr(''); setOk('')
    try {
      const r = await api.waitlist(email)
      setOk(r && r.status === 'exists'
        ? "You're already on the waitlist — currently #" + r.position + " of " + r.total + "."
        : "You're on the list! You're #" + (r?.position || '?') + " in line — we'll email you when a seat opens.")
    } catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  async function doResend() {
    setBusy(true); setErr(''); setOk('')
    try { await api.resendVerification(pending.email); setOk('Verification email re-sent.') }
    catch (ex) { setErr(ex.message) } finally { setBusy(false) }
  }
  function goAuth(v) { setView(v); setPending(null); setTimeout(() => { const el = document.getElementById('lp-auth'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, 0) }

  const googleOn = info && info.google_enabled
  const waitlistOn = closed || (info && info.waitlist_enabled)

  return (
    <div className="lp">
      <style>{CSS}</style>
      <div className="lp-wrap">

        <section className="lp-hero">
          <div className="lp-hero-l">
            <span className="lp-ribbon">{String.fromCharCode(0x2726)} {inviteRequired ? 'Invite-Only Beta — Grab Your Seat' : 'Now In Beta'}</span>
            <h1>Invest Smarter,<br /><span className="lp-grad">Your Way.</span></h1>
            <p>NIYTRI is your AI investing companion for Indian markets — it scores every NSE stock daily,
              explains the “why” in plain language, watches your portfolio, and answers your questions in
              English or your language.</p>
            <div className="lp-cta-row">
              {googleOn
                ? <button className="lp-btn lp-btn-google" onClick={() => goAuth('signin')}><GoogleG /> Continue With Google</button>
                : <button className="lp-btn lp-btn-login" onClick={() => goAuth('signin')}>Log In</button>}
              <button className="lp-btn lp-btn-grad" onClick={() => goAuth(closed ? 'waitlist' : 'signup')}>{closed ? 'Join Waitlist' : 'Sign Up Free'}</button>
            </div>
            <div className="lp-chips"><span><b>Explainable</b> AI</span><span><b>NSE &amp; BSE</b></span><span><b>Delayed</b> Charts</span><span><b>SEBI</b>-Compliant</span></div>
          </div>

          <div className="lp-preview">
            <div className="lp-pv-top">
              <div><div className="lp-nm">RELIANCE</div><div className="lp-pvsub">Reliance Industries Ltd · {String.fromCharCode(0x20B9)}{chart.last.toLocaleString('en-IN')} <span className="lp-up">{String.fromCharCode(0x25B2)} 0.42%</span></div></div>
              <div className="lp-score">72</div>
            </div>
            <div className="lp-ranges"><span className="lp-rg">1D</span><span className="lp-rg">1W</span><span className="lp-rg on">1M</span><span className="lp-rg">6M</span><span className="lp-rg">1Y</span></div>
            <svg viewBox="0 0 360 160" width="100%" height="160" style={{ display: 'block' }} dangerouslySetInnerHTML={{ __html: chart.inner }} />
            <div className="lp-bubble">“Why Is RELIANCE Strong?” — it leads on <b>value</b> and <b>price trend</b>, while earnings momentum stays neutral.</div>
          </div>
        </section>

        <section className="lp-sec">
          <h2>Your Edge, <span className="lp-grad">In One Place</span></h2>
          <div className="lp-subh">A quick look at what you get. Sign in to explore the full platform.</div>
          <div className="lp-cards">
            {FEATURES.map(([k, t, d, icon]) => (
              <div className="lp-card" key={t}>
                <div className={'lp-ic ' + k}><svg viewBox="0 0 24 24">{icon}</svg></div>
                <h3>{t}</h3><p>{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="lp-sec">
          <h2>Start In <span className="lp-grad">30 Seconds</span></h2>
          <div className="lp-steps">
            {STEPS.map(([t, d], i) => (
              <div className="lp-step" key={t}><div className="lp-num">{i + 1}</div><h3>{t}</h3><p>{d}</p></div>
            ))}
          </div>
        </section>

        <section className="lp-sec">
          <div className="lp-join">
            <h2>Ready To <span className="lp-grad">Invest Smarter?</span></h2>
            <p>{inviteRequired ? 'Join the invite-only beta today.' : 'Create your free account today.'}</p>

            <div className="lp-auth" id="lp-auth">
              {pending ? (
                <div className="lp-verify">
                  <div className="lp-verify-ic">{String.fromCharCode(0x2709)}</div>
                  <h3>{pending.resent ? 'Check your inbox again' : 'Confirm your email'}</h3>
                  <p className="lp-vtext">We sent a verification link to <b>{pending.email}</b>. Click it to activate your account and log in.</p>
                  {!pending.delivered && pending.verify_link && (
                    <p className="lp-invite">Email delivery isn't set up yet. <a className="lp-grad" href={pending.verify_link}>Click here to verify →</a></p>
                  )}
                  {!pending.delivered && !pending.verify_link && (
                    <p className="lp-invite">We couldn't send the email right now — try resend or contact support.</p>
                  )}
                  <button className="lp-btn lp-btn-grad lp-full" disabled={busy} onClick={doResend}>{busy ? 'Please wait…' : 'Resend Email'}</button>
                  <p className="lp-invite"><a className="lp-grad" onClick={() => { setPending(null); setView('signin') }}>← Back to log in</a></p>
                  {err && <p className="lp-err">{err}</p>}
                  {ok && <p className="lp-ok">{ok}</p>}
                </div>
              ) : (
                <>
                  <div className="lp-tabs">
                    <button className={view === 'signin' ? 'on' : ''} onClick={() => setView('signin')}>Log In</button>
                    {!closed && <button className={view === 'signup' ? 'on' : ''} onClick={() => setView('signup')}>Sign Up</button>}
                    {waitlistOn && <button className={view === 'waitlist' ? 'on' : ''} onClick={() => setView('waitlist')}>Waitlist</button>}
                  </div>

                  {googleOn && view !== 'waitlist' && (
                    <><div className="lp-google" ref={gbtn} /><div className="lp-or">— or —</div></>
                  )}

                  {view === 'signin' && (
                    <form onSubmit={doLogin}>
                      <input className="lp-field" type="email" placeholder="name@email.com" value={email} required onChange={e => setEmail(e.target.value)} />
                      <input className="lp-field" type="password" placeholder="Password" value={password} required onChange={e => setPassword(e.target.value)} />
                      <button className="lp-btn lp-btn-grad lp-full" disabled={busy}>{busy ? 'Please wait…' : 'Log In'}</button>
                    </form>
                  )}

                  {view === 'signup' && !closed && (
                    <form onSubmit={doRegister}>
                      <input className="lp-field" placeholder="Full name" value={full_name} required onChange={e => setName(e.target.value)} />
                      <input className="lp-field" type="email" placeholder="name@email.com" value={email} required onChange={e => setEmail(e.target.value)} />
                      <input className="lp-field" type="password" placeholder="Create a password (min 6 chars)" value={password} required minLength={6} onChange={e => setPassword(e.target.value)} />
                      <input className="lp-field" type="password" placeholder="Confirm password" value={confirm} required onChange={e => setConfirm(e.target.value)} />
                      <input className="lp-field" placeholder={inviteRequired ? 'Invite code (required)' : 'Invite code (optional)'} value={invite} required={inviteRequired} onChange={e => setInvite(e.target.value)} />
                      <button className="lp-btn lp-btn-grad lp-full" disabled={busy}>{busy ? 'Please wait…' : 'Create Account'}</button>
                      {inviteRequired && waitlistOn &&
                        <div className="lp-invite">No code? <a className="lp-grad" onClick={() => setView('waitlist')}>Join the waitlist →</a></div>}
                    </form>
                  )}

                  {view === 'waitlist' && (
                    <form onSubmit={doWaitlist}>
                      <p className="lp-vtext">Beta is invite-only right now. Leave your email and we'll reach out when a seat opens.</p>
                      <input className="lp-field" type="email" placeholder="name@email.com" value={email} required onChange={e => setEmail(e.target.value)} />
                      <button className="lp-btn lp-btn-grad lp-full" disabled={busy}>{busy ? 'Please wait…' : 'Join Waitlist'}</button>
                    </form>
                  )}

                  {err && <p className="lp-err">{err}</p>}
                  {ok && <p className="lp-ok">{ok}</p>}
                  <div className="lp-invite">Members invite up to <b style={{ color: '#cfd6ea' }}>5 friends</b>.</div>
                </>
              )}
            </div>
          </div>
        </section>

        <footer className="lp-foot">© {new Date().getFullYear()} NIYTRI Technologies · Informational analytics, not investment advice · Prices delayed · Markets carry risk.</footer>
      </div>
    </div>
  )
}

const CSS = "@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');" + `
.lp{--bg:#080b14;--bg2:#0e1322;--card:#111726;--line:#1e2740;--ink:#eef2fb;--mut:#9aa6c2;
  --cy:#22D3EE;--pu:#7C5CFC;--pk:#EC4899;--grad:linear-gradient(90deg,#22D3EE,#7C5CFC 52%,#EC4899);
  position:fixed;inset:0;overflow-y:auto;z-index:50;color:var(--ink);line-height:1.6;
  font-family:'Inter',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;-webkit-font-smoothing:antialiased;
  background:radial-gradient(900px 520px at 12% -8%,rgba(124,92,252,.16),transparent 60%),
             radial-gradient(820px 480px at 92% 6%,rgba(34,211,238,.12),transparent 60%),var(--bg)}
.lp *{box-sizing:border-box}
.lp-wrap{max-width:1140px;margin:0 auto;padding:0 26px}
.lp-grad{background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.lp-btn{border:none;border-radius:14px;padding:14px 24px;font-weight:600;font-size:15px;cursor:pointer;font-family:inherit;transition:.15s}
.lp-btn-grad{background:var(--grad);color:#08101f;font-weight:700;box-shadow:0 10px 30px rgba(124,92,252,.35)}
.lp-btn-grad:hover{filter:brightness(1.06)}
.lp-btn-google{background:#fff;color:#20242e;display:inline-flex;gap:11px;align-items:center;justify-content:center;font-weight:600}
.lp-btn-login{background:transparent;border:1px solid var(--line);color:#dbe2f2}
.lp-btn-login:hover{border-color:#33406a;color:#fff}
.lp-full{width:100%;margin-top:6px}
.lp-hero{display:grid;grid-template-columns:1.05fr .95fr;gap:50px;align-items:center;padding:52px 0 30px}
.lp-ribbon{display:inline-flex;gap:9px;align-items:center;background:rgba(124,92,252,.14);border:1px solid rgba(124,92,252,.35);
  color:#ccc2ff;border-radius:999px;padding:8px 16px;font-size:13px;font-weight:600;margin-bottom:24px}
.lp-hero h1{font-size:clamp(42px,5.8vw,66px);line-height:1.03;font-weight:900;letter-spacing:-1.5px}
.lp-hero p{color:var(--mut);font-size:19px;margin:22px 0 30px;max-width:540px}
.lp-cta-row{display:flex;gap:13px;flex-wrap:wrap}
.lp-chips{margin-top:26px;display:flex;gap:22px;flex-wrap:wrap;color:#7f8bab;font-size:14px}.lp-chips b{color:#cfd6ea;font-weight:600}
.lp-preview{background:linear-gradient(180deg,#141b2e,#0f1524);border:1px solid var(--line);border-radius:26px;padding:22px;box-shadow:0 40px 90px rgba(0,0,0,.55)}
.lp-pv-top{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}
.lp-nm{font-weight:700;font-size:19px}.lp-pvsub{color:var(--mut);font-size:13px}.lp-up{color:#5fe3ad;font-weight:600}
.lp-score{background:linear-gradient(135deg,#22D3EE,#12b981);color:#052a20;font-weight:800;border-radius:14px;padding:10px 16px;font-size:22px}
.lp-ranges{display:flex;gap:6px;margin:2px 0 8px}
.lp-rg{font-size:12px;color:#8794b3;border:1px solid var(--line);border-radius:8px;padding:4px 10px}
.lp-rg.on{color:#08101f;background:var(--cy);border-color:transparent;font-weight:700}
.lp-bubble{background:rgba(124,92,252,.12);border:1px solid rgba(124,92,252,.28);border-radius:16px;padding:14px 16px;font-size:14.5px;color:#e6e9f7;margin-top:14px}
.lp-sec{padding:56px 0}
.lp-sec h2{font-size:clamp(30px,3.8vw,44px);font-weight:800;text-align:center;letter-spacing:-.5px}
.lp-subh{color:var(--mut);text-align:center;margin:14px auto 38px;max-width:640px;font-size:18px}
.lp-cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
.lp-card{border-radius:20px;padding:28px;border:1px solid var(--line);background:var(--card);transition:.18s}
.lp-card:hover{transform:translateY(-6px);border-color:#33406a}
.lp-ic{width:54px;height:54px;border-radius:16px;display:flex;align-items:center;justify-content:center;margin-bottom:18px}
.lp-ic svg{width:27px;height:27px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.lp-card h3{font-size:20px;margin-bottom:10px;font-weight:700}
.lp-card p{color:var(--mut);font-size:15px}
.k1{background:rgba(124,92,252,.16);color:#b7a8ff}.k2{background:rgba(18,185,129,.16);color:#5fe3ad}
.k3{background:rgba(236,72,153,.16);color:#ff8bc2}.k4{background:rgba(34,211,238,.16);color:#66e2f5}
.k5{background:rgba(59,130,246,.16);color:#8fb6ff}.k6{background:rgba(245,165,36,.16);color:#ffce7a}
.lp-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
.lp-step{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:28px;text-align:center}
.lp-num{width:48px;height:48px;border-radius:15px;margin:0 auto 16px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#08101f;font-size:19px;background:var(--grad)}
.lp-step h3{font-size:21px;font-weight:700;margin-bottom:10px}
.lp-step p{color:#c2cbe3;font-size:15.5px;line-height:1.65;max-width:280px;margin:0 auto}
.lp-join{background:linear-gradient(120deg,rgba(34,211,238,.12),rgba(124,92,252,.14) 55%,rgba(236,72,153,.12));border:1px solid var(--line);border-radius:28px;padding:52px 24px;text-align:center}
.lp-join>p{color:var(--mut);margin-top:8px}
.lp-auth{background:var(--bg2);border:1px solid var(--line);border-radius:20px;padding:26px;max-width:420px;margin:26px auto 0;text-align:center}
.lp-tabs{display:flex;gap:6px;background:#0b1120;border:1px solid var(--line);border-radius:12px;padding:5px;margin-bottom:18px}
.lp-tabs button{flex:1;background:transparent;border:0;color:var(--mut);font-weight:600;padding:9px;border-radius:8px;cursor:pointer;font-family:inherit;font-size:14px}
.lp-tabs button.on{background:var(--grad);color:#08101f}
.lp-google{display:flex;justify-content:center;min-height:44px}
.lp-field{width:100%;background:#0b1120;border:1px solid var(--line);border-radius:12px;padding:14px;color:var(--ink);margin:6px 0;font-size:15px;font-family:inherit}
.lp-field:focus{outline:none;border-color:var(--pu);box-shadow:0 0 0 3px rgba(124,92,252,.2)}
.lp-or{color:#6f7c9c;font-size:13px;margin:14px 0}
.lp-invite{margin-top:16px;font-size:13px;color:var(--mut)}
.lp-invite a{cursor:pointer;font-weight:600;text-decoration:none}
.lp-vtext{color:var(--mut);font-size:14.5px;margin-bottom:8px}
.lp-verify-ic{font-size:34px;margin-bottom:6px}
.lp-verify h3{font-size:20px;font-weight:700;margin-bottom:8px}
.lp-err{color:#ff9a9a;font-size:13.5px;margin-top:12px}
.lp-ok{color:#6ee7b7;font-size:13.5px;margin-top:12px}
.lp-foot{color:#6f7c9c;font-size:13px;text-align:center;padding:38px 0;border-top:1px solid var(--line);margin-top:24px}
@media(max-width:840px){.lp-hero{grid-template-columns:1fr;padding-top:34px}.lp-cards,.lp-steps{grid-template-columns:1fr}}
`
