import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'
import AiIcon from './AiIcon.jsx'
import { confirmDialog } from '../dialog.jsx'

const LANGS = { en: 'English', hi: 'हिन्दी', bn: 'বাংলা', ta: 'தமிழ்', gu: 'ગુજરાતી', mr: 'मराठी' }
const newSession = () => 'chat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

const SUGGESTIONS = [
  'What are the top 2 stocks as per your internal AI scores?',
  'What moved IT stocks today?',
  'Explain RELIANCE’s AI score',
  'What is a P/E ratio?',
  'Summarize today’s market news',
]

export default function Assistant({ seed, clearSeed }) {
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState(newSession())
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [lang, setLang] = useState('en')
  const [busy, setBusy] = useState(false)
  const bottom = useRef(null)

  const loadSessions = () => api.chatSessions().then(d => setSessions(d.sessions)).catch(() => {})
  useEffect(() => { loadSessions() }, [])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])
  useEffect(() => {
    if (seed) { send(seed); clearSeed?.() }
  }, [seed])  // eslint-disable-line react-hooks/exhaustive-deps

  async function openSession(id) {
    setSessionId(id)
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
    setMessages(m => [...m, { role: 'user', text: q }])
    setBusy(true)
    try {
      const r = await api.ask(q, sessionId, lang)
      setMessages(m => [...m, {
        role: 'assistant', text: r.answer, sources: r.sources,
        confidence: r.confidence, provider: r.provider,
      }])
      loadSessions()
    } catch (e) {
      setMessages(m => [...m, { role: 'assistant', text: 'Error: ' + e.message }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <button className="new-chat-btn" onClick={startNew}>+ New chat</button>
        <div className="session-head">
          <span className="session-list-title">Recent chats</span>
          {sessions.length > 0 && (
            <button className="link-btn" title="Delete all conversations"
                    onClick={clearAll}>Clear</button>
          )}
        </div>
        <div className="session-list">
          {sessions.length === 0 && <div className="session-empty">No conversations yet</div>}
          {sessions.map(s => (
            <div key={s.session_id}
                 className={'session-item' + (s.session_id === sessionId ? ' active' : '')}
                 title={s.title || '(empty)'}
                 onClick={() => openSession(s.session_id)}>
              <span className="session-title">{s.title || '(empty)'}</span>
              <button className="session-del" title="Delete chat"
                      onClick={e => deleteSession(e, s.session_id)}>{String.fromCharCode(0xD7)}</button>
            </div>
          ))}
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
              <h3>Ask me about markets, scores & news</h3>
              <p className="hint">Grounded in live quotes, the platform's AI scores and today's news.</p>
              <div className="chip-row">
                {SUGGESTIONS.map(s => (
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
                {m.role === 'assistant' && m.confidence != null && (
                  <div className="meta">
                    <span title="How much grounded context (quotes, scores, news) backed this answer">
                      Confidence {(m.confidence * 100).toFixed(0)}%</span>
                    {m.sources?.length > 0 && (
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
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

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
    </div>
  )
}
