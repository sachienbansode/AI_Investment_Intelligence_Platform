import { useEffect, useState } from 'react'
import Dashboard from './components/Dashboard.jsx'
import Assistant from './components/Assistant.jsx'
import AiIcon from './components/AiIcon.jsx'
import Compare from './components/Compare.jsx'
import { DialogHost, ToastHost, toast } from './dialog.jsx'
import { registerPush } from './native.js'
import { startTableLabels } from './tablelabels.js'
import Scores from './components/Scores.jsx'
import News from './components/News.jsx'
import Watchlist from './components/Watchlist.jsx'
import Portfolio from './components/Portfolio.jsx'
import Alerts from './components/Alerts.jsx'
import Agents from './components/Agents.jsx'
import Admin from './components/Admin.jsx'
import RunAudit from './components/RunAudit.jsx'
import Users from './components/Users.jsx'
import About from './components/About.jsx'
import Profile from './components/Profile.jsx'
import Login from './components/Login.jsx'
import Landing from './components/Landing.jsx'
import StockDetail from './components/StockDetail.jsx'
import { api, getToken, getRefresh, clearSession, refreshSession, onUnauthorized } from './api.js'

const UP = String.fromCharCode(0x25B2)
const DN = String.fromCharCode(0x25BC)
const DOT = String.fromCharCode(0x00B7)

// Icon for every page in the catalog; nav is built from the user's allowed pages.
const ICONS = {
  'Dashboard': '◆', 'AI Assistant': <AiIcon />, 'Stock Scores': '▤', 'Compare': '⇄', 'Market News': '◈',
  'Watchlist': '☆', 'Portfolio': '◐', 'Alerts': '⚑', 'Agents': '⚙', 'Audit': '≣', 'Users': '♟',
  'Admin': '⛨', 'About': 'ⓘ',
}
// Primary tabs shown in the mobile bottom bar; the rest live behind "More".
const MOBILE_TABS = ['Dashboard', 'Stock Scores', 'AI Assistant', 'Compare']
const SHORT_LABEL = { 'AI Assistant': 'Assistant', 'Stock Scores': 'Scores', 'Market News': 'News' }
const isPrimary = name => name === 'NIFTY 50' || name.startsWith('SENSEX')

function Consent({ brand, onAccept, onSignOut }) {
  const [busy, setBusy] = useState(false)
  const [terms, setTerms] = useState(null)
  useEffect(() => { api.publicTerms().then(setTerms).catch(() => setTerms({ html: '' })) }, [])
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 20, zIndex: 100, overflow: 'auto' }}>
      <div style={{ maxWidth: 600, width: '100%', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14, padding: 24 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 20 }}>Accept our Terms & Conditions{terms?.version ? ' · v' + terms.version : ''}</h2>
        <p style={{ color: 'var(--muted)', margin: '0 0 14px', fontSize: 14 }}>Please review and accept to continue using {brand}.</p>
        <div style={{ background: 'var(--panel2)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, maxHeight: '52vh', overflow: 'auto', fontSize: 13.5, lineHeight: 1.6, color: 'var(--text)' }}
             dangerouslySetInnerHTML={{ __html: terms ? terms.html : 'Loading…' }} />
        <p className="hint" style={{ margin: '12px 0 16px' }}>By clicking Accept you agree to the Terms & Conditions above.</p>
        <div style={{ display: 'flex', gap: 10 }}>
          <button disabled={busy || !terms} onClick={async () => { setBusy(true); try { await onAccept() } finally { setBusy(false) } }}>{busy ? 'Please wait…' : 'Accept & continue'}</button>
          <button className="ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
    </div>
  )
}

function Maintenance({ message, brand, onSignOut }) {
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--bg)', color: 'var(--text)', padding: 24, textAlign: 'center', zIndex: 100 }}>
      <div style={{ maxWidth: 440 }}>
        {brand?.logo
          ? <img src={brand.logo} alt="" style={{ maxHeight: 64, marginBottom: 18, objectFit: 'contain' }} />
          : <div style={{ fontSize: 46, marginBottom: 12 }}>{String.fromCharCode(0x1F6E0)}</div>}
        <h2 style={{ margin: '0 0 10px', fontSize: 24 }}>We'll be right back</h2>
        <p style={{ color: 'var(--muted)', lineHeight: 1.6, margin: '0 0 20px' }}>
          {message || 'The app is temporarily down for maintenance. Please check back shortly.'}</p>
        <button className="ghost" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [tab, setTab] = useState('Dashboard')
  const [indices, setIndices] = useState([])
  const [health, setHealth] = useState(null)
  const [chatSeed, setChatSeed] = useState(null)
  const [scoreSeed, setScoreSeed] = useState(null)
  const [sectorSeed, setSectorSeed] = useState(null)
  const [brand, setBrand] = useState({ logo: '', score_label: 'NIYTRI Score', platform_label: 'NIYTRI AI' })
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('theme') ||
    (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('navCollapsed') === '1')
  const [navOpen, setNavOpen] = useState(false)
  const [alertUnread, setAlertUnread] = useState(0)
  const [stockSym, setStockSym] = useState(null)

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])
  useEffect(() => { localStorage.setItem('navCollapsed', collapsed ? '1' : '0') }, [collapsed])
  useEffect(() => {
    if (!user) return
    const f = () => api.alertsUnread().then(d => setAlertUnread(d.unread || 0)).catch(() => {})
    f(); const t = setInterval(f, 60000); return () => clearInterval(t)
  }, [user])
  useEffect(() => { const o = startTableLabels(); return () => o.disconnect() }, [])

  function selectTab(name) { setTab(name); setNavOpen(false) }
  function askAI(question) { setChatSeed(question); setTab('AI Assistant') }
  function openScore(symbol) { setScoreSeed(symbol); setTab('Stock Scores'); setNavOpen(false) }
  function openSector(sec) { setSectorSeed(sec); setTab('Stock Scores'); setNavOpen(false) }
  function openStock(sym) { setStockSym(sym); setTab('Stock'); setNavOpen(false) }

  useEffect(() => { api.branding().then(d => setBrand(d || { logo: '' })).catch(() => {}) }, [])
  useEffect(() => {
    if (!brand.logo) return
    let link = document.querySelector("link[rel='icon']")
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
    link.href = brand.logo
  }, [brand.logo])

  useEffect(() => {
    onUnauthorized(() => setUser(null))
    const boot = async () => {
      // Have a session? Validate the access token; if it's expired, the api
      // layer will silently refresh on the 401 and retry.
      if (getToken() || getRefresh()) {
        try { setUser(await api.me()) } catch { clearSession() }
      }
      setAuthChecked(true)
    }
    boot()
  }, [])

  const pages = user?.pages || []
  // Keep the active tab within the user's allowed pages.
  useEffect(() => {
    if (user && pages.length && !pages.includes(tab) && tab !== 'Profile') setTab(pages[0])
  }, [user]) // eslint-disable-line

  useEffect(() => {
    if (!user) return
    const loadIndices = () => api.indices().then(d => setIndices(d.indices || [])).catch(() => {})
    const loadHealth = () => api.health().then(setHealth).catch(() => {})
    loadIndices(); loadHealth()
    registerPush(t => api.registerDevice(t, 'native').catch(() => {}))  // native only; no-op on web
    const t = setInterval(() => { loadIndices(); loadHealth() }, 45000)   // live ticker + maintenance status
    return () => clearInterval(t)
  }, [user])

  // Session policy. The server now enforces this too: the short access token is
  // silently refreshed while the user is ACTIVE; once idle past the window we
  // stop refreshing, so the refresh token expires server-side and the session
  // is dead regardless of the browser. Tokens live in sessionStorage, so
  // closing the tab/browser also ends the session.
  useEffect(() => {
    if (!user) return
    const IDLE_MS = 60 * 60 * 1000          // 1h idle window (matches server)
    const REFRESH_MS = 10 * 60 * 1000       // refresh access well before its 15m TTL
    let last = Date.now()
    let lastRefresh = Date.now()
    const bump = () => { last = Date.now() }
    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click']
    events.forEach(e => window.addEventListener(e, bump, { passive: true }))
    const expire = () => {
      clearSession(); setUser(null); setTab('Dashboard')
      try { toast('Signed out after 1 hour of inactivity. Please log in again.') } catch {}
    }
    const tick = async () => {
      const idle = Date.now() - last
      if (idle >= IDLE_MS) { expire(); return }
      // Refresh only while active — keeps an idle session from being kept alive.
      if (Date.now() - lastRefresh >= REFRESH_MS) {
        lastRefresh = Date.now()
        const ok = await refreshSession()
        if (!ok) expire()   // refresh token dead server-side -> hard logout
      }
    }
    const iv = setInterval(tick, 30000)
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - last >= IDLE_MS) expire()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      events.forEach(e => window.removeEventListener(e, bump))
      clearInterval(iv); document.removeEventListener('visibilitychange', onVis)
    }
  }, [user])

  if (!authChecked) return null
  if (!user) return <Landing onLogin={setUser} />
  if (health && health.maintenance_mode && !user.is_admin)
    return <Maintenance message={health.maintenance_message} brand={brand}
                        onSignOut={() => { clearSession(); setUser(null) }} />
  if (user.tos_ok === false)
    return <Consent brand={brand.platform_label || 'NIYTRI AI'}
                    onAccept={async () => { await api.acceptTerms(); try { setUser(await api.me()) } catch {} }}
                    onSignOut={() => { clearSession(); setUser(null) }} />

  const nav = pages.map(name => ({ name, icon: ICONS[name] || String.fromCharCode(0x2022) }))
  const can = name => pages.includes(name)

  function logout() { clearSession(); setUser(null); setTab('Dashboard') }

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${navOpen ? ' nav-open' : ''}${tab === 'AI Assistant' ? ' chat-active' : ''}`}>
      <div className="nav-backdrop" onClick={() => setNavOpen(false)} />
      <aside className="sidenav">
        <div className="brand">
          {brand.logo
            ? <img src={brand.logo} alt="Logo" className="brand-mark" style={{ background: 'none', padding: 0, objectFit: 'contain', borderRadius: 8 }} />
            : <span className="brand-mark">{String.fromCharCode(0x20B9)}</span>}
          <div className="brand-name">Investment<br />Intelligence</div>
          <button className="collapse-btn" onClick={() => setCollapsed(c => !c)}
                  title={collapsed ? 'Expand menu' : 'Minimize menu'}>
            {collapsed ? String.fromCharCode(0x00BB) : String.fromCharCode(0x00AB)}
          </button>
        </div>
        <nav>
          {nav.map(n => (
            <button key={n.name} className={tab === n.name ? 'active' : ''}
                    title={n.name} onClick={() => selectTab(n.name)}>
              <span className="nav-icon">{n.icon}</span>
              <span className="nav-label">{n.name}</span>
              {n.name === 'Alerts' && alertUnread > 0 && <span className="nav-badge">{alertUnread}</span>}
            </button>
          ))}
        </nav>
        <div className="sidenav-foot">
          <div className="user-pill row-click" title="View profile" onClick={() => selectTab('Profile')}>
            {user.avatar
              ? <span className="avatar"><img src={user.avatar} alt="" /></span>
              : <span className="avatar">{(user.full_name || user.email)[0].toUpperCase()}</span>}
            <div>
              <div className="user-name">{user.full_name || user.email.split('@')[0]}</div>
              <div className="hint">{user.is_admin ? 'Administrator' : 'User'}</div>
            </div>
          </div>
          <button className="ghost sm" onClick={logout}>Sign out</button>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <button className="hamburger icon-btn" onClick={() => setNavOpen(o => !o)} title="Menu">
            {String.fromCharCode(0x2630)}
          </button>
          <div className="ticker-marquee">
            {(() => {
              const tick = [
                ...indices.filter(i => !i.index.includes('(BSE)') && !i.index.includes('(GL)')),
                ...indices.filter(i => i.index.includes('(BSE)')),
                ...indices.filter(i => i.index.includes('(GL)')),
              ]
              if (!tick.length) return null
              // Duplicate the list so the CSS translateX(-50%) loop is seamless.
              return (
                <div className="ticker-track" style={{ animationDuration: Math.max(26, tick.length * 3.5) + 's' }}>
                  {[...tick, ...tick].map((i, idx) => {
                    const exch = i.index.includes('(BSE)') ? 'BSE' : i.index.includes('(GL)') ? 'GL' : 'NSE'
                    return (
                      <span key={idx} className={'tk-item' + (isPrimary(i.index) ? ' primary-index' : '')} aria-hidden={idx >= tick.length}>
                        <span className="tk-exch">{exch}</span>
                        <b>{i.index.replace(' (BSE)', '').replace(' (GL)', '')}</b>
                        <span className="tk-val">{i.last?.toLocaleString('en-IN')}</span>
                        <em className={i.pct_change >= 0 ? 'up' : 'down'}>{(i.pct_change > 0 ? UP : DN)} {Math.abs(i.pct_change)}%</em>
                      </span>
                    )
                  })}
                </div>
              )
            })()}
          </div>
          <div className="topbar-right">
            {user.is_admin && health && health.show_active_model && health.active_provider && (
              <div className="active-model" title="AI model currently answering">
                {String.fromCharCode(0x26A1)} {health.active_provider}{health.active_model ? ' ' + DOT + ' ' + health.active_model : ''}
              </div>
            )}
            {user.is_admin && health && (
              <div className="status" title="Active engines">
                <span className="dot ok" /> {health.llm_providers.join(' ' + DOT + ' ')} | {health.market_data_providers.join(' ' + DOT + ' ')}
              </div>
            )}
            <button className="icon-btn" title="Toggle theme"
                    onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}>
              {theme === 'dark' ? String.fromCharCode(0x2600) : String.fromCharCode(0x263E)}
            </button>
          </div>
        </header>

        {health && health.maintenance_mode && user.is_admin && (
          <div style={{ background: 'var(--amber)', color: '#1a1200', padding: '8px 26px', fontSize: '.85rem', fontWeight: 600 }}>
            {String.fromCharCode(0x26A0)} Maintenance mode is ON — non-admin users are blocked from the app.{' '}
            <a style={{ color: '#1a1200', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => selectTab('Admin')}>Manage in Admin</a>
          </div>
        )}

        <main>
          <h2 className="page-title">{tab === 'Stock' ? (stockSym || 'Stock') + ' Details' : tab}</h2>
          {tab === 'Dashboard' && can('Dashboard') && <Dashboard go={setTab} openScore={openScore} openSector={openSector} scoreLabel={brand.score_label} />}
          {tab === 'AI Assistant' && can('AI Assistant') && <Assistant seed={chatSeed} clearSeed={() => setChatSeed(null)} go={setTab} />}
          {tab === 'Stock Scores' && can('Stock Scores') && <Scores isAdmin={user.is_admin} askAI={askAI} seed={scoreSeed} clearSeed={() => setScoreSeed(null)} sectorSeed={sectorSeed} clearSectorSeed={() => setSectorSeed(null)} scoreLabel={brand.score_label} platformLabel={brand.platform_label} />}
          {tab === 'Compare' && can('Compare') && <Compare scoreLabel={brand.score_label} />}
          {tab === 'Market News' && can('Market News') && <News />}
          {tab === 'Watchlist' && can('Watchlist') && <Watchlist scoreLabel={brand.score_label} />}
          {tab === 'Portfolio' && can('Portfolio') && <Portfolio />}
          {tab === 'Alerts' && can('Alerts') && <Alerts go={setTab} openScore={openScore} onSeen={() => api.alertsUnread().then(d => setAlertUnread(d.unread || 0)).catch(() => {})} />}
          {tab === 'About' && can('About') && <About />}
          {tab === 'Profile' && <Profile user={user} onUpdated={u => setUser(u)} />}
          {tab === 'Stock' && <StockDetail symbol={stockSym} openStock={openStock} askAI={askAI} scoreLabel={brand.score_label} />}
          {tab === 'Agents' && can('Agents') && <Agents />}
          {tab === 'Audit' && can('Audit') && <RunAudit />}
          {tab === 'Users' && can('Users') && <Users />}
          {tab === 'Admin' && can('Admin') && <Admin />}
        </main>

        <footer>
          AI-generated content for information only - not investment advice. Investments in
          securities markets are subject to market risks. Consult a SEBI-registered
          investment adviser before investing.
        </footer>
      </div>
      <nav className="bottom-nav">
        {MOBILE_TABS.filter(can).map(name => (
          <button key={name} className={tab === name ? 'active' : ''}
                  onClick={() => selectTab(name)}>
            <span className="bn-icon">{ICONS[name] || String.fromCharCode(0x2022)}</span>
            <span className="bn-label">{SHORT_LABEL[name] || name}</span>
          </button>
        ))}
        <button className={navOpen ? 'active' : ''} onClick={() => setNavOpen(true)}>
          <span className="bn-icon">{String.fromCharCode(0x2630)}</span>
          <span className="bn-label">More</span>
        </button>
      </nav>
      <DialogHost />
      <ToastHost />
    </div>
  )
}
