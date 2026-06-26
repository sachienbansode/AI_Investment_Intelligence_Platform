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
import Agents from './components/Agents.jsx'
import Admin from './components/Admin.jsx'
import RunAudit from './components/RunAudit.jsx'
import About from './components/About.jsx'
import Login from './components/Login.jsx'
import { api, getToken, getRefresh, clearSession, refreshSession, onUnauthorized } from './api.js'

const UP = String.fromCharCode(0x25B2)
const DN = String.fromCharCode(0x25BC)
const DOT = String.fromCharCode(0x00B7)

// Icon for every page in the catalog; nav is built from the user's allowed pages.
const ICONS = {
  'Dashboard': '◆', 'AI Assistant': <AiIcon />, 'Stock Scores': '▤', 'Compare': '⇄', 'Market News': '◈',
  'Watchlist': '☆', 'Portfolio': '◐', 'Agents': '⚙', 'Audit': '≣',
  'Admin': '⛨', 'About': 'ⓘ',
}
// Primary tabs shown in the mobile bottom bar; the rest live behind "More".
const MOBILE_TABS = ['Dashboard', 'Stock Scores', 'AI Assistant', 'Compare']
const SHORT_LABEL = { 'AI Assistant': 'Assistant', 'Stock Scores': 'Scores', 'Market News': 'News' }
const isPrimary = name => name === 'NIFTY 50' || name.startsWith('SENSEX')

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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])
  useEffect(() => { localStorage.setItem('navCollapsed', collapsed ? '1' : '0') }, [collapsed])
  useEffect(() => { const o = startTableLabels(); return () => o.disconnect() }, [])

  function selectTab(name) { setTab(name); setNavOpen(false) }
  function askAI(question) { setChatSeed(question); setTab('AI Assistant') }
  function openScore(symbol) { setScoreSeed(symbol); setTab('Stock Scores'); setNavOpen(false) }
  function openSector(sec) { setSectorSeed(sec); setTab('Stock Scores'); setNavOpen(false) }

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
    if (user && pages.length && !pages.includes(tab)) setTab(pages[0])
  }, [user]) // eslint-disable-line

  useEffect(() => {
    if (!user) return
    const loadIndices = () => api.indices().then(d => setIndices(d.indices || [])).catch(() => {})
    loadIndices()
    api.health().then(setHealth).catch(() => {})
    registerPush(t => api.registerDevice(t, 'native').catch(() => {}))  // native only; no-op on web
    const t = setInterval(loadIndices, 45000)   // live NSE/BSE ticker refresh
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
  if (!user) return <Login onLogin={setUser} brand={brand} />

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
            </button>
          ))}
        </nav>
        <div className="sidenav-foot">
          <div className="user-pill" title={user.email}>
            <span className="avatar">{(user.full_name || user.email)[0].toUpperCase()}</span>
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
          <div className="ticker-rows">
            {[['NSE', indices.filter(i => !i.index.includes('(BSE)') && !i.index.includes('(GL)'))],
              ['BSE', indices.filter(i => i.index.includes('(BSE)'))],
              ['GLOBAL', indices.filter(i => i.index.includes('(GL)'))]]
              .filter(([, list]) => list.length > 0)
              .map(([exch, list]) => (
                <div key={exch} className="ticker">
                  <span className="exch-badge">{exch}</span>
                  {[...list].sort((a, b) => isPrimary(b.index) - isPrimary(a.index)).map(i => (
                    <span key={i.index} className={'tk-item' + (isPrimary(i.index) ? ' primary-index' : '')}>
                      <b>{i.index.replace(' (BSE)', '').replace(' (GL)', '')}</b>
                      <span className="tk-val">{i.last?.toLocaleString('en-IN')}</span>
                      <em className={i.pct_change >= 0 ? 'up' : 'down'}>{(i.pct_change > 0 ? UP : DN)} {Math.abs(i.pct_change)}%</em>
                    </span>
                  ))}
                </div>
              ))}
          </div>
          <div className="topbar-right">
            {health && (
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

        <main>
          <h2 className="page-title">{tab}</h2>
          {tab === 'Dashboard' && can('Dashboard') && <Dashboard go={setTab} openScore={openScore} openSector={openSector} scoreLabel={brand.score_label} />}
          {tab === 'AI Assistant' && can('AI Assistant') && <Assistant seed={chatSeed} clearSeed={() => setChatSeed(null)} />}
          {tab === 'Stock Scores' && can('Stock Scores') && <Scores isAdmin={user.is_admin} askAI={askAI} seed={scoreSeed} clearSeed={() => setScoreSeed(null)} sectorSeed={sectorSeed} clearSectorSeed={() => setSectorSeed(null)} scoreLabel={brand.score_label} platformLabel={brand.platform_label} />}
          {tab === 'Compare' && can('Compare') && <Compare scoreLabel={brand.score_label} />}
          {tab === 'Market News' && can('Market News') && <News />}
          {tab === 'Watchlist' && can('Watchlist') && <Watchlist scoreLabel={brand.score_label} />}
          {tab === 'Portfolio' && can('Portfolio') && <Portfolio />}
          {tab === 'About' && can('About') && <About />}
          {tab === 'Agents' && can('Agents') && <Agents />}
          {tab === 'Audit' && can('Audit') && <RunAudit />}
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
