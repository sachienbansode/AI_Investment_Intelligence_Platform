import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'

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
  const [insts, setInsts] = useState([])
  const [showCmp, setShowCmp] = useState(false)
  const [cmp, setCmp] = useState({ a: '', b: '' })
  const [cmpRes, setCmpRes] = useState(null)
  const [cmpBusy, setCmpBusy] = useState(false)
  const [cmpErr, setCmpErr] = useState('')
  const bottom = useRef(null)

  const loadSessions = () => api.chatSessions().then(d => setSessions(d.sessions)).catch(() => {})
  useEffect(() => { loadSessions(); api.instruments().then(d => setInsts(d.instruments || [])).catch(() => {}) }, [])
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

  async function runCompare() {
    const a = cmp.a.trim().toUpperCase(), b = cmp.b.trim().toUpperCase()
    if (!a || !b) { setCmpErr('Enter two symbols'); return }
    if (a === b) { setCmpErr('Choose two different symbols'); return }
    setCmpBusy(true); setCmpErr(''); setCmpRes(null)
    try { setCmpRes(await api.compare(a, b, lang)) }
    catch (e) { setCmpErr(e.message) }
    setCmpBusy(false)
  }

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <button className="new-chat-btn" onClick={startNew}>+ New chat</button>
        <div className="session-list-title">Recent chats</div>
        <div className="session-list">
          {sessions.length === 0 && <div className="session-empty">No conversations yet</div>}
          {sessions.map(s => (
            <div key={s.session_id}
                 className={'session-item' + (s.session_id === sessionId ? ' active' : '')}
                 title={s.title || '(empty)'}
                 onClick={() => openSession(s.session_id)}>
              {s.title || '(empty)'}
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
          <button className={'ghost sm' + (showCmp ? ' active' : '')} style={{ marginLeft: 'auto' }}
                  title="Compare two stocks side by side" onClick={() => setShowCmp(v => !v)}>
            {String.fromCharCode(0x21C4)} Compare stocks</button>
        </div>

        {showCmp && (
          <div className="panel compare-panel">
            <datalist id="cmp-inst">
              {insts.map(i => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}
            </datalist>
            <div className="toolbar">
              <input list="cmp-inst" placeholder="Stock A (e.g. RELIANCE)" value={cmp.a}
                     onChange={e => setCmp({ ...cmp, a: e.target.value.toUpperCase() })} />
              <span className="hint">vs</span>
              <input list="cmp-inst" placeholder="Stock B (e.g. TCS)" value={cmp.b}
                     onChange={e => setCmp({ ...cmp, b: e.target.value.toUpperCase() })} />
              <button onClick={runCompare} disabled={cmpBusy}>{cmpBusy ? 'Comparing…' : 'Compare'}</button>
            </div>
            {cmpErr && <p className="note">{cmpErr}</p>}
            {cmpRes && (() => {
              const A = cmpRes.a, B = cmpRes.b
              const px = v => v != null ? String.fromCharCode(0x20B9) + Number(v).toLocaleString('en-IN') : '—'
              const rng = h => h.week52_low != null ? `${h.week52_low} – ${h.week52_high}` : '—'
              const rows = [
                ['AI score', A.ai_score ?? '—', B.ai_score ?? '—'],
                ['Last price', px(A.last_price), px(B.last_price)],
                ['Day change', A.change_pct != null ? `${A.change_pct}%` : '—', B.change_pct != null ? `${B.change_pct}%` : '—'],
                ['P/E', A.pe ?? '—', B.pe ?? '—'],
                ['52-week range', rng(A), rng(B)],
                ['Sector', A.sector || '—', B.sector || '—'],
              ]
              return (
                <div>
                  <table className="data-table compare-table">
                    <thead><tr><th>Metric</th><th>{A.symbol}</th><th>{B.symbol}</th></tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i}><td className="hint">{r[0]}</td><td><strong>{r[1]}</strong></td><td><strong>{r[2]}</strong></td></tr>
                      ))}
                    </tbody>
                  </table>
                  <h4 style={{ marginBottom: 4 }}>AI comparison</h4>
                  <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(cmpRes.summary) }} />
                  <p className="disclaimer">{cmpRes.disclaimer}</p>
                </div>
              )
            })()}
          </div>
        )}

        <div className="chat-window">
          {messages.length === 0 && (
            <div className="chat-empty">
              <div className="chat-empty-mark">✦</div>
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
              {m.role === 'assistant' && <span className="msg-avatar">✦</span>}
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
              <span className="msg-avatar">✦</span>
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
