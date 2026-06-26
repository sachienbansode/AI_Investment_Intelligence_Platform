import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'
import AiIcon from './AiIcon.jsx'
import { confirmDialog, toast } from '../dialog.jsx'

const LANGS = { en: 'English', hi: 'हिन्दी', bn: 'বাংলা', ta: 'தமிழ்', gu: 'ગુજરાતી', mr: 'मराठी' }
const newSession = () => 'chat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

const SUGGESTIONS = [
  'What are the top 2 stocks as per your internal AI scores?',
  'What moved IT stocks today?',
  'Explain RELIANCE’s AI score',
  'What is a P/E ratio?',
  'Summarize today’s market news',
]

// General-knowledge prompts — at least one of these is always offered after a
// reply, so follow-ups aren't all about the platform's scores.
const GENERAL_Q = [
  'What is a P/E ratio?',
  'How do I read a stock’s 52-week range?',
  'What does market capitalisation mean?',
  'What is market volatility?',
  'How does the Nifty 50 index work?',
  'What is the difference between large-cap and small-cap?',
]

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }
function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]] } return a }

// Words that look like tickers but aren't, so we don't build stock follow-ups for them.
const NOT_TICKERS = new Set(['AI', 'PE', 'P', 'E', 'NSE', 'BSE', 'IT', 'US', 'USD', 'INR', 'CEO',
  'IPO', 'GDP', 'ETF', 'NAV', 'EPS', 'ROE', 'PB', 'FII', 'DII', 'SIP', 'NPA', 'AGM', 'ATH',
  'EBITDA', 'YOY', 'QOQ', 'NIYTRI', 'NITRI', 'AND', 'THE', 'FOR'])

export default function Assistant({ seed, clearSeed }) {
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState(newSession())
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [lang, setLang] = useState('en')
  const [busy, setBusy] = useState(false)
  const [suggestions, setSuggestions] = useState([])
  const [followups, setFollowups] = useState([])
  const [symSet, setSymSet] = useState(new Set())
  const [histOpen, setHistOpen] = useState(false)
  const [rated, setRated] = useState({})
  const bottom = useRef(null)

  const loadSessions = () => api.chatSessions().then(d => setSessions(d.sessions)).catch(() => {})
  useEffect(() => {
    loadSessions()
    api.chatSuggestions().then(d => setSuggestions(d.suggestions || [])).catch(() => {})
    api.instruments().then(d => setSymSet(new Set((d.instruments || []).map(i => i.symbol.toUpperCase())))).catch(() => {})
  }, [])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy, followups])
  useEffect(() => {
    if (seed) { send(seed); clearSeed?.() }
  }, [seed])  // eslint-disable-line react-hooks/exhaustive-deps

  async function rate(i, val) {
    if (rated[i]) return
    setRated(r => ({ ...r, [i]: val }))
    const ans = messages[i]?.text || ''
    const q = (i > 0 && messages[i - 1]?.role === 'user') ? messages[i - 1].text : ''
    try {
      await api.sendFeedback(val, { session_id: sessionId, question: q, answer: ans, provider: messages[i]?.provider || '' })
      toast('Thanks for the feedback')
    } catch {}
  }

  // Only treat a token as a stock when it's a REAL instrument symbol.
  function validSymbol(text) {
    if (!text) return null
    const cands = (String(text).toUpperCase().match(/\b[A-Z][A-Z&-]{2,14}\b/g) || [])
      .filter(w => !NOT_TICKERS.has(w))
    for (const w of cands) if (symSet.has(w)) return w
    return null
  }
  function symbolFromSources(sources) {
    if (!Array.isArray(sources)) return null
    for (const s of sources) {
      const sym = s && s.symbol ? String(s.symbol).toUpperCase() : ''
      if (sym && (symSet.size === 0 || symSet.has(sym))) return sym
    }
    return null
  }

  // Up to 5 follow-ups related to the previous answer. Stock-specific only when a
  // real symbol was involved; otherwise topic-aware (news/market) or general.
  function buildFollowups(question, answer, sources) {
    const sym = symbolFromSources(sources) || validSymbol(question) || validSymbol(answer)
    if (sym) {
      const ctx = shuffle([
        `What's driving ${sym}'s score?`,
        `How does ${sym} compare to its sector?`,
        `Latest news on ${sym}`,
        `Is ${sym} cheap or expensive on valuation?`,
        `What changed in ${sym}'s score recently?`,
      ]).slice(0, 4)
      return [...ctx, pick(GENERAL_Q)]
    }
    const ql = (String(question) + ' ' + String(answer)).toLowerCase()
    if (/\b(news|market|today|sector|sectors|nifty|sensex|index|indices|gainer|loser|sentiment)\b/.test(ql)) {
      return shuffle([
        'Which sectors are strongest today?',
        'Top 5 stocks by AI score',
        'What are today’s biggest decliners by score?',
        'How is overall market sentiment in the news?',
        pick(GENERAL_Q),
      ]).slice(0, 5)
    }
    const dataPool = shuffle((suggestions.length ? suggestions : SUGGESTIONS).filter(q => !GENERAL_Q.includes(q)))
    const out = [...dataPool.slice(0, 3), pick(GENERAL_Q)]
    return out.filter((v, i, a) => a.indexOf(v) === i).slice(0, 5)
  }

  async function openSession(id) {
    setSessionId(id)
    setFollowups([])
    try {
      const d = await api.chatHistory(id)
      setMessages(d.messages.map(m => ({
        role: m.role, text: m.content,
        confidence: m.meta?.confidence, provider: m.meta?.provider,
      })))
    } catch { setMessages([]) }
  }

  function startNew() {
    setSessionId(newSession())
    setMessages([])
    setFollowups([])
  }

  async function clearAll() {
    if (!(await confirmDialog('Clear all chat history? This cannot be undone.', { title: 'Clear chat history', confirmText: 'Clear all', danger: true }))) return
    try { await api.clearChats(); setSessions([]); startNew() } catch {}
  }

  async function deleteSession(e, id) {
    e.stopPropagation()
    try {
      await api.deleteSession(id)
      if (id === sessionId) startNew()
      loadSessions()
    } catch {}
  }

  async function send(text) {
    const q = (text ?? input).trim()
    if (!q || busy) return
    setInput('')
    setFollowups([])
    setMessages(m => [...m, { role: 'user', text: q }])
    setBusy(true)
    try {
      const r = await api.ask(q, sessionId, lang)
      setMessages(m => [...m, {
        role: 'assistant', text: r.answer, sources: r.sources,
        confidence: r.confidence, provider: r.provider,
      }])
      setFollowups(buildFollowups(q, r.answer, r.sources))
      loadSessions()
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', text: 'Error: ' + e.message }])
    } finally {
      setBusy(false)
    }
  }

  const lastIsAssistant = messages.length > 0 && messages[messages.length - 1].role === 'assistant'

  function SessionRows({ onOpen }) {
    return (
      <>
        {sessions.length === 0 && <div className="session-empty">No conversations yet</div>}
        {sessions.map(s => (
          <div key={s.session_id}
               className={'session-item' + (s.session_id === sessionId ? ' active' : '')}
               title={s.title || '(empty)'}
               onClick={() => onOpen(s.session_id)}>
            <span className="session-title">{s.title || '(empty)'}</span>
            <button className="session-del" title="Delete chat"
                    onClick={e => deleteSession(e, s.session_id)}>{String.fromCharCode(0xD7)}</button>
          </div>
        ))}
      </>
    )
  }

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <button className="new-chat-btn" onClick={startNew}>+ New chat</button>
        <button className="sm mobile-only hist-btn" title="Recent chats"
                onClick={() => { loadSessions(); setHistOpen(true) }}>{String.fromCharCode(0x2630)} Recent chats{sessions.length ? ` (${sessions.length})` : ''}</button>
        <div className="session-head">
          <span className="session-list-title">Recent chats</span>
          {sessions.length > 0 && (
            <button className="link-btn" title="Delete all conversations"
                    onClick={clearAll}>Clear</button>
          )}
        </div>
        <div className="session-list">
          <SessionRows onOpen={openSession} />
        </div>
      </aside>

      <div className="chat">
        <div className="chat-toolbar">
          <label title="The assistant replies in this language">Language:&nbsp;
            <select value={lang} onChange={e => setLang(e.target.value)}>
              {Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
        </div>

        <div className="chat-window">
          {messages.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-mark"><AiIcon /></div>
              <h3>Ask me about markets, scores &amp; news</h3>
              <p className="hint">Grounded in live quotes, the platform's AI scores and today's news.</p>
              <div className="chip-row">
                {(suggestions.length ? suggestions : SUGGESTIONS).map(s => (
                  <button key={s} className="chip" onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m, i) => (
            <div key={i} className={'msg ' + m.role}>
              {m.role === 'assistant' && <span className="msg-avatar"><AiIcon /></span>}
              <div className="bubble">
                {m.role === 'assistant'
                  ? <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }} />
                  : <p>{m.text}</p>}
                {m.role === 'assistant' && m.sources?.length > 0 && (
                  <div className="meta">
                    <details>
                      <summary>Sources ({m.sources.length})</summary>
                      <ul>
                        {m.sources.map((s, j) => (
                          <li key={j}>
                            {s.type}{s.symbol ? `: ${s.symbol}` : ''}
                            {s.link ? <> — <a href={s.link} target="_blank" rel="noreferrer">{s.title || s.link}</a></> : s.title ? ` — ${s.title}` : ''}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                )}
                {m.role === 'assistant' && !m.text.startsWith('Error:') && (
                  <div className="fb-row">
                    {rated[i]
                      ? <span className="fb-thanks">Thanks for the feedback</span>
                      : <>
                          <span className="fb-q">Was this helpful?</span>
                          <button className="fb-btn" onClick={() => rate(i, 1)}>Yes</button>
                          <button className="fb-btn" onClick={() => rate(i, -1)}>No</button>
                        </>}
                  </div>
                )}
              </div>
            </div>
          ))}

          {!busy && lastIsAssistant && followups.length > 0 && (
            <div className="followups">
              <span className="followup-label">Try next</span>
              <div className="chip-row">
                {followups.map(s => <button key={s} className="chip" onClick={() => send(s)}>{s}</button>)}
              </div>
            </div>
          )}

          {busy && (
            <div className="msg assistant">
              <span className="msg-avatar"><AiIcon /></span>
              <div className="bubble typing"><span /><span /><span /></div>
            </div>
          )}
          <div ref={bottom} />
        </div>

        <div className="chat-input">
          <input value={input} onChange={e => setInput(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && send()}
                 placeholder="Ask anything — e.g. top stocks by AI score…" disabled={busy} />
          <button onClick={() => send()} disabled={busy || !input.trim()}>Send</button>
        </div>
      </div>

      {histOpen && (
        <div className="hist-drawer-backdrop" onClick={() => setHistOpen(false)}>
          <div className="hist-drawer" onClick={e => e.stopPropagation()}>
            <div className="session-head">
              <span className="session-list-title">Recent chats</span>
              <div style={{ display: 'flex', gap: 8 }}>
                {sessions.length > 0 && (
                  <button className="link-btn" onClick={clearAll}>Clear all</button>
                )}
                <button className="link-btn" onClick={() => setHistOpen(false)}>Close</button>
              </div>
            </div>
            <div className="session-list">
              <SessionRows onOpen={id => { openSession(id); setHistOpen(false) }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
