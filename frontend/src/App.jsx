import { useEffect, useState } from 'react'
import Dashboard from './components/Dashboard.jsx'
import Assistant from './components/Assistant.jsx'
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

const UP = String.fromCharCode(0x25B2)    // up triangle
const DN = String.fromCharCode(0x25BC)    // down triangle
const DOT = String.fromCharCode(0x00B7)   // middle dot

const NAV = [
  { name: 'Dashboard', icon: '◆' },
  { name: 'AI Assistant', icon: '✦' },
  { name: 'Stock Scores', icon: '▤' },
  { name: 'Market News', icon: '◈' },
  { name: 'Watchlist', icon: '☆' },
  { name: 'Portfolio', icon: '◐' },
]
const isPrimary = name => name === 'NIFTY 50' || name.startsWith('SENSEX')

const ADMIN_NAV = [
  { name: 'Agents', icon: '⚙' },
  { name: 'Audit', icon: '≣' },
  { name: 'Admin', icon: '⛨' },
]

export default function App() {
  const [user, setUser] = useState(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [tab, setTab] = useState('Dashboard')
  const [indices, setIndices] = useState([])
  const [health, setHealth] = useState(null)
  const [chatSeed, setChatSeed] = useState(null)
  const [theme, setTheme] = useState(() =>
    localStorage.getItem('theme') ||
    (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'))
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('navCollapsed') === '1')
  const [navOpen, setNavOpen] = useState(false)  // mobile drawer

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])
  useEffect(() => { localStorage.setItem('navCollapsed', collapsed ? '1' : '0') }, [collapsed])

  function askAI(question) {
    setChatSeed(question)
    setTab('AI Assistant')
  }
  function selectTab(name) { setTab(name); setNavOpen(false) }

  useEffect(() => {
    onUnauthorized(() => setUser(null))
    if (getToken()) {
      api.me().then(u => { setUser(u); setAuthChecked(true) })
        .catch(() => { setToken(null); setAuthChecked(true) })
    } else setAuthChecked(true)
  }, [])

  useEffect(() => {
    if (!user) return
    api.indices().then(d => setIndices(d.indices || [])).catch(() => {})
    api.health().then(setHealth).catch(() => {})
  }, [user])

  if (!authChecked) return null
  if (!user) return <Login onLogin={setUser} />

  const nav = [...NAV, ...(user.is_admin ? ADMIN_NAV : []),
               { name: 'About', icon: 'ⓘ' }]  // always last in the menu

  function logout() {
    setToken(null); setUser(null); setTab('Dashboard')
  }

  const themeToggle = (
    <button className="icon-btn" onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )

  return (
    <div className={`shell${collapsed ? ' collapsed' : ''}${navOpen ? ' nav-open' : ''}`}>
      <div className="nav-backdrop" onClick={() => setNavOpen(false)} />
      <aside className="sidenav">
        <div className="brand">
          <span className="brand-mark">Ai</span>
          <div className="brand-name">Investment<br />Intelligence</div>
          <button className="collapse-btn" onClick={() => setCollapsed(c => !c)}
                  title={collapsed ? 'Expand menu' : 'Minimize menu'}>
            {collapsed ? '»' : '«'}
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
          <button className="hamburger icon-btn" onClick={() => setNavOpen(o => !o)}
                  title="Menu">{'☰'}</button>
          <div className="ticker-rows">
            {[['NSE', indices.filter(i => !i.index.includes('(BSE)'))],
              ['BSE', indices.filter(i => i.index.includes('(BSE)'))]]
              .filter(([, list]) => list.length > 0)
              .map(([exch, list]) => (
                <div key={exch} className="ticker">
                  <span className="exch-badge">{exch}</span>
                  {[...list]
                    .sort((a, b) => isPrimary(b.index) - isPrimary(a.index))
                    .map(i => (
                      <span key={i.index}
                            className={`${i.pct_change >= 0 ? 'up' : 'down'}${isPrimary(i.index) ? ' primary-index' : ''}`}>
                        <b>{i.index.replace(' (BSE)', '')}</b> {i.last?.toLocaleString('en-IN')}
                        <em>{(i.pct_change > 0 ? UP : DN)} {Math.abs(i.pct_change)}%</em>
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
            {themeToggle}
          </div>
        </header>

        <main>
          <h2 className="page-title">{tab}</h2>
          {tab === 'Dashboard' && <Dashboard go={setTab} />}
          {tab === 'AI Assistant' && <Assistant seed={chatSeed} clearSeed={() => setChatSeed(null)} />}
          {tab === 'Stock Scores' && <Scores isAdmin={user.is_admin} askAI={askAI} />}
          {tab === 'Market News' && <News />}
          {tab === 'Watchlist' && <Watchlist />}
          {tab === 'Portfolio' && <Portfolio />}
          {tab === 'About' && <About />}
          {tab === 'Agents' && user.is_admin && <Agents />}
          {tab === 'Audit' && user.is_admin && <RunAudit />}
          {tab === 'Admin' && user.is_admin && <Admin />}
        </main>

        <footer>
          AI-generated content for information only - not investment advice. Investments in
          securities markets are subject to market risks. Consult a SEBI-registered
          investment adviser before investing.
        </footer>
      </div>
    </div>
  )
}
