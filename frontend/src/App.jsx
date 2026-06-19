import { useEffect, useState } from 'react'
import Dashboard from './components/Dashboard.jsx'
import Assistant from './components/Assistant.jsx'
import AiIcon from './components/AiIcon.jsx'
import Compare from './components/Compare.jsx'
import { DialogHost, ToastHost } from './dialog.jsx'
import Scores from './components/Scores.jsx'
import News from './components/News.jsx'
import Watchlist from './components/Watchlist.jsx'
import Portfolio from './components/Portfolio.jsx'
import Agents from './components/Agents.jsx'
import Admin from './components/Admin.jsx'
import RunAudit from './components/RunAudit.jsx'
import About from './components/About.jsx'
import Login from './components/Login.jsx'
import { api, getToken, setToken, onUnauthorized } from './api.js'

const UP = String.fromCharCode(0x25B2)
const DN = String.fromCharCode(0x25BC)
const DOT = String.fromCharCode(0x00B7)

// Icon for every page in the catalog; nav is built from the user's allowed pages.
const ICONS = {
  'Dashboard': '◆', 'AI Assistant': <AiIcon />, 'Stock Scores': '▤', 'Compare': '⇄', 'Market News': '◈',
  'Watchlist': '☆', 'Portfolio': '◐', 'Agents': '⚙', 'Audit': '≣',
  'Admin': '⛨', 'About': 'ⓘ',
}
const isPrimary = name => name === 'NIFTY 50' || name.startsWith('SENSEX')

export default function App() {
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [tab, setTab] = useState('Dashboard')
  const [indices, setIndices] = useState([])
  const [health, setHealth] = useState(null)
  const [chatSeed, setChatSeed] = useState(null)
  const [scoreSeed, setScoreSeed] = useState(null)
  const [brand, setBrand] = useState({ logo: '' })
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

  function selectTab(name) { setTab(name); setNavOpen(false) }
  function askAI(question) { setChatSeed(question); setTab('AI Assistant') }
  function openScore(symbol) { setScoreSeed(symbol); setTab('Stock Scores'); setNavOpen(false) }

  useEffect(() => { api.branding().then(d => setBrand(d || { logo: '' })).catch(() => {}) }, [])
  useEffect(() => {
    if (!brand.logo) return
    let link = document.querySelector("link[rel='icon']")
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link) }
    link.href = brand.logo
  }, [brand.logo])

  useEffect(() => {
    onUnauthorized(() => setUser(null))
    if (getToken()) {
      api.me().then(u => { setUser(u); setAuthChecked(true) })
        .catch(() => { setToken(null); setAuthChecked(true) })
    } else setAuthChecked(true)
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
    const t = setInterval(loadIndices, 45000)   // live NSE/BSE ticker refresh
    return () => clearInterval(t)
  }, [user])

  if (!authChecked) return null
  if (!user) return <Login onLogin={setUser} brand={brand} />

  const nav = pages.map(name => ({ name, icon: ICONS[name] || String.fromCharCode(0x2022) }))
  const can = name => pages.includes(name)

  function logout() { setToken(null); setUser(null); setTab('Dashboard') }

  const scoreLabel = brand.score_label || 'NITRI Score'
  const tickerPos = brand.ticker_position || 'top'
  const tickerEl = (
    <div className="ticker-rows">
      {[['NSE', indices.filter(i => !i.index.includes('(BSE)') && !i.index.includes('(GL)'))],
        ['BSE', indices.filter(i => i.index.includes('(BSE)'))],
        ['GLOBAL', indices.filter(i => i.index.includes('(GL)'))]]
        .filter(([, list]) => list.length > 0)
        .map(([exch, list]) => (
          <div key={exch} className="ticker">
            <span className="exch-badge">{exch}</span>
            {[...list].sort((a, b) => isPrimary(b.index) - isPrimary(a.index)).map(i => (
              <span key={i.index} className={`${i.pct_change >= 0 ? 'up' : 'down'}${isPrimary(i.index) ? ' primary-index' : ''}`}>
                <b>{i.index.replace(' (BSE)', '').replace(' (GL)', '')}</b> {i.last?.toLocaleString('en-IN')}
                <em>{(i.pct_change > 0 ? UP : DN)} {Math.abs(i.pct_change)}%</em>
              </span>
            ))}
          </div>
        ))}
    </div>
  )

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${navOpen ? ' nav-open' : ''}`} data-ticker={tickerPos}>
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
          {tickerPos === 'top' && tickerEl}
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
        {tickerPos === 'right' && <aside className="ticker-rail">{tickerEl}</aside>}

        <main>
          <h2 className="page-title">{tab}</h2>
          {tab === 'Dashboard' && can('Dashboard') && <Dashboard go={setTab} openScore={openScore} scoreLabel={scoreLabel} />}
          {tab === 'AI Assistant' && can('AI Assistant') && <Assistant seed={chatSeed} clearSeed={() => setChatSeed(null)} />}
          {tab === 'Stock Scores' && can('Stock Scores') && <Scores isAdmin={user.is_admin} askAI={askAI} seed={scoreSeed} clearSeed={() => setScoreSeed(null)} scoreLabel={scoreLabel} />}
          {tab === 'Compare' && can('Compare') && <Compare scoreLabel={scoreLabel} />}
          {tab === 'Market News' && can('Market News') && <News />}
          {tab === 'Watchlist' && can('Watchlist') && <Watchlist scoreLabel={scoreLabel} />}
          {tab === 'Portfolio' && can('Portfolio') && <Portfolio />}
          {tab === 'About' && can('About') && <About />}
          {tab === 'Agents' && can('Agents') && <Agents />}
          {tab === 'Audit' && can('Audit') && <RunAudit />}
          {tab === 'Admin' && can('Admin') && <Admin />}
        </main>
        {tickerPos === 'bottom' && <div className="ticker-bar">{tickerEl}</div>}

        <footer>
          AI-generated content for information only - not investment advice. Investments in
          securities markets are subject to market risks. Consult a SEBI-registered
          investment adviser before investing.
        </footer>
      </div>
      <DialogHost />
      <ToastHost />
    </div>
  )
}
