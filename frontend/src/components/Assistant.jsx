import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'
import AiIcon from './AiIcon.jsx'
import ChartBlock from './ChartBlock.jsx'
import { confirmDialog, toast } from '../dialog.jsx'

const LANGS = { en: 'English', hi: 'हिन्दी', bn: 'বাংলা', ta: 'தமிழ்', gu: 'ગુજરાતી', mr: 'मराठी' }
const newSession = () => 'chat-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

const SUGGESTIONS = [
  'Help me build a starter portfolio',
  'Suggest top strong stocks across sectors',
  'What are the top 2 stocks as per your internal AI scores?',
  'What moved IT stocks today?',
  'Explain RELIANCE’s AI score',
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
  'EBITDA', 'YOY', 'QOQ', 'NIYTRI', 'NITRI', 'AND', 'THE', 'FOR',
  // statistical abbreviations the assistant prints (e.g. "avg", "max") that can
  // collide with a real ticker symbol - don't build stock follow-ups for these.
  'AVG', 'AVERAGE', 'MIN', 'MAX', 'SUM', 'TOP', 'BOTTOM', 'MEAN', 'MEDIAN', 'TOTAL', 'SCORE',
  // common macro / English words that also happen to be real NSE tickers
  // (e.g. DOLLAR = Dollar Industries) - avoid false stock follow-ups from prose.
  'GLOBAL', 'DOLLAR', 'GOLD', 'SILVER', 'OIL', 'CRUDE', 'BRENT', 'INDIA', 'FED',
  'RATE', 'RATES', 'WAR', 'RBI', 'SEBI'])

// One-shot input request from the assistant: option chips (select), a text box
// (input), or both (mixed). Clicking a chip or submitting sends it as the reply.
function ClarifyBox({ clarify, onSend, disabled }) {
  const [val, setVal] = useState('')
  const { q, type = 'select', options = [] } = clarify || {}
  const showChips = (type === 'select' || type === 'mixed') && options.length > 0
  const showInput = type === 'input' || type === 'mixed'
  const go = v => { const t = String(v || '').trim(); if (t) { onSend(t); setVal('') } }
  return (
    <div className="clarify">
      {q && <div className="clarify-q">{q}</div>}
      {showChips && (
        <div className="chip-row">
          {options.map(o => (
            <button key={o} className="chip" disabled={disabled} onClick={() => go(o)}>{o}</button>
          ))}
        </div>
      )}
      {showInput && (
        <div className="clarify-input">
          <input value={val} placeholder="Type your answer…" disabled={disabled}
                 onChange={e => setVal(e.target.value)}
                 onKeyDown={e => e.key === 'Enter' && go(val)} />
          <button className="sm" disabled={disabled || !val.trim()} onClick={() => go(val)}>Send</button>
        </div>
      )}
    </div>
  )
}

function _summary(a) {
  return String(a || '').replace(/[*>#`_]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180)
}

// Per-answer share menu: WhatsApp / Email / copy public link / download PDF.
// Every channel carries the app intro + public URL (created lazily on first use).
function ShareMenu({ question, answer, charts }) {
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState(null)
  const [busy, setBusy] = useState(false)
  const ensure = async () => {
    if (link) return link
    const r = await api.shareCreate(question || '', answer || '', charts || [])
    setLink(r); return r
  }
  const text = r => (r.intro || '') + '\n\n' + _summary(answer) + '\n\n' + r.url
  const wrap = async fn => { setBusy(true); try { await fn() } catch (e) { toast(e.message || 'Share failed', { type: 'error' }) } finally { setBusy(false); setOpen(false) } }
  const onWhatsApp = () => wrap(async () => { const r = await ensure(); window.open('https://wa.me/?text=' + encodeURIComponent(text(r)), '_blank') })
  const onEmail = () => wrap(async () => { const r = await ensure(); window.location.href = 'mailto:?subject=' + encodeURIComponent('From NIYTRI AI') + '&body=' + encodeURIComponent(text(r)) })
  const onCopy = () => wrap(async () => { const r = await ensure(); try { await navigator.clipboard.writeText(r.url); toast('Public link copied') } catch { toast(r.url) } })
  const onPdf = () => wrap(async () => { await api.sharePdf(question || '', answer || '') })
  return (
    <div className="share-wrap">
      <button className="fb-btn share-btn" title="Share" aria-label="Share"
              onClick={() => setOpen(o => !o)} disabled={busy}>
        {busy ? '…' : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
          </svg>
        )}
      </button>
      {open && (
        <div className="share-menu">
          <button onClick={onWhatsApp}>WhatsApp</button>
          <button onClick={onEmail}>Email</button>
          <button onClick={onCopy}>Copy link</button>
          <button onClick={onPdf}>Download PDF</button>
        </div>
      )}
    </div>
  )
}

// Share the WHOLE chat session (public expiring link / WhatsApp / Email / PDF).
function SessionShareMenu({ sessionId, hasMessages }) {
  const [open, setOpen] = useState(false)
  const [link, setLink] = useState(null)
  const [busy, setBusy] = useState(false)
  const ensure = async () => { if (link) return link; const r = await api.shareSession(sessionId); setLink(r); return r }
  const text = r => (r.intro || '') + '\n\n' + r.url
  const wrap = async fn => { setBusy(true); try { await fn() } catch (e) { toast(e.message || 'Share failed', { type: 'error' }) } finally { setBusy(false); setOpen(false) } }
  const onWhatsApp = () => wrap(async () => { const r = await ensure(); window.open('https://wa.me/?text=' + encodeURIComponent(text(r)), '_blank') })
  const onEmail = () => wrap(async () => { const r = await ensure(); window.location.href = 'mailto:?subject=' + encodeURIComponent('My NIYTRI AI chat') + '&body=' + encodeURIComponent(text(r)) })
  const onCopy = () => wrap(async () => { const r = await ensure(); try { await navigator.clipboard.writeText(r.url); toast('Chat link copied') } catch { toast(r.url) } })
  const onPdf = () => wrap(async () => { await api.shareSessionPdf(sessionId) })
  if (!hasMessages) return null
  return (
    <div className="share-wrap">
      <button className="sm ghost share-btn" title="Share this chat" aria-label="Share chat"
              onClick={() => setOpen(o => !o)} disabled={busy}>
        {busy ? '\u2026' : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
            <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
          </svg>
        )}
      </button>
      {open && (
        <div className="share-menu down">
          <button onClick={onWhatsApp}>WhatsApp</button>
          <button onClick={onEmail}>Email</button>
          <button onClick={onCopy}>Copy link</button>
          <button onClick={onPdf}>Download PDF</button>
        </div>
      )}
    </div>
  )
}

export default function Assistant({ seed, clearSeed, go }) {
  const [sessions, setSessions] = useState([])
  const [sessionId, setSessionId] = useState(newSession())
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const taRef = useRef(null)
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

  // In-answer links like [Portfolio page](#page:Portfolio) navigate within the app.
  function onContentClick(e) {
    const a = e.target.closest && e.target.closest('a.md-pagelink')
    if (a) { e.preventDefault(); const pg = a.getAttribute('data-page'); if (pg && go) go(pg) }
  }

  // Extract REAL instrument symbols in priority order: the answer's sources
  // (server-verified) first, then the question, then the answer text. Statistical
  // abbreviations / non-tickers are excluded (see NOT_TICKERS).
  function symbolsFrom(question, answer, sources) {
    const out = []
    // Case-SENSITIVE: only pick tokens already in UPPERCASE in the text (how real
    // tickers appear). This stops lowercase prose words like "dollar"/"global"
    // from matching same-spelled tickers (DOLLAR, GLOBAL).
    const addText = t => {
      for (const w of (String(t || '').match(/\b[A-Z][A-Z&-]{2,14}\b/g) || [])) {
        if (!NOT_TICKERS.has(w) && symSet.has(w) && !out.includes(w)) out.push(w)
      }
    }
    if (Array.isArray(sources)) {
      for (const s of sources) {
        const sym = s && s.symbol ? String(s.symbol).toUpperCase() : ''
        if (sym && !NOT_TICKERS.has(sym) && (symSet.size === 0 || symSet.has(sym))
          && !out.includes(sym)) out.push(sym)
      }
    }
    addText(question)
    addText(answer)
    return out
  }

  // Normalise a question for de-duplication (so a follow-up never echoes the
  // question just asked, or another follow-up).
  const normQ = q => String(q || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

  // Build up to 5 varied, de-duplicated follow-ups tailored to the previous
  // answer - portfolio / comparison / single-stock / valuation / score / news /
  // sector aware - always ending with exactly one general-knowledge prompt, and
  // never repeating the question that was just asked.
  function buildFollowups(question, answer, sources) {
    const ql = (String(question) + ' ' + String(answer)).toLowerCase()
    const syms = symbolsFrom(question, answer, sources)
    const has = re => re.test(ql)
    const cand = []

    const isPortfolio = has(/\b(portfolio|holdings?|my (stocks?|shares?|positions?|investments?))\b/)
    const isWatchlist = has(/\bwatch ?list\b/)
    const isCompare = syms.length >= 2 && has(/\b(compare|vs\.?|versus|better|stronger|which)\b/)
    const isValuation = has(/\b(valuation|cheap|expensive|p\/e|pe ratio|over ?valued|under ?valued|p\/b)\b/)
    const isScore = has(/\b(score|scores|rating|rank|ranking|top|bottom|best|worst)\b/)
    const isNews = has(/\b(news|headline|announce|moved|gain|drop|surge|fell|rose|order win|results?|earnings)\b/)
    const isSector = has(/\b(sector|sectors|industry|banking|pharma|auto|fmcg|metal|energy|psu)\b/)
    const isIndex = has(/\b(nifty|sensex|index|indices|market today|market sentiment)\b/)

    if (isPortfolio) {
      cand.push(
        'How concentrated is my portfolio by sector?',
        'Which of my holdings have the weakest scores?',
        'Which of my holdings look expensive on valuation?',
        "What are my portfolio's biggest strengths and risks?",
        'How did my holdings move over the last 5 days?')
    }
    if (isWatchlist) {
      cand.push(
        'Which of my watchlist stocks score highest?',
        'Any notable news on my watchlist today?',
        'Which watchlist stocks improved their score recently?')
    }
    if (isCompare) {
      const [a, b] = syms
      cand.push(
        `Which is stronger overall: ${a} or ${b}?`,
        `How do ${a} and ${b} differ on valuation?`,
        `Compare ${a} and ${b} on their scores`,
        `Latest news on ${a}`,
        `Latest news on ${b}`)
    }
    // Per-symbol follow-ups for up to 2 symbols, skipping the angle already asked.
    for (const sym of syms.slice(0, 2)) {
      const perSym = [
        `What's driving ${sym}'s score?`,
        `How does ${sym} compare to its sector?`,
        `Latest news on ${sym}`,
        `Is ${sym} cheap or expensive on valuation?`,
        `What changed in ${sym}'s score recently?`,
        `What are ${sym}'s key fundamentals?`,
      ]
      const drop = re => { const k = perSym.findIndex(q => re.test(q)); if (k >= 0) perSym.splice(k, 1) }
      if (isValuation) drop(/valuation/)
      if (isNews) drop(/Latest news/)
      if (isScore) drop(/driving .* score/)
      cand.push(...shuffle(perSym).slice(0, 3))
    }
    if (isSector || isIndex) {
      cand.push(
        'Which sectors are strongest right now?',
        'Top 5 stocks by score',
        'What are today’s biggest decliners by score?',
        'How is overall market sentiment in the news?')
    }
    if (isNews && syms.length === 0) {
      cand.push(
        'Summarise today’s market news',
        'What moved the market today?',
        'Which stocks does today’s news impact most?')
    }
    // Fallback when nothing specific matched.
    if (cand.length === 0) {
      const pool = (suggestions.length ? suggestions : SUGGESTIONS).filter(q => !GENERAL_Q.includes(q))
      cand.push(...shuffle(pool),
        'Top 5 stocks by score', 'Summarise today’s market news',
        'Which stocks are below 50 on score?')
    }

    // De-duplicate, drop anything equal to the asked question, cap to 4, then
    // append exactly one fresh general-knowledge prompt.
    const askedN = normQ(question)
    const seen = new Set()
    const picks = []
    for (const q of cand) {
      const n = normQ(q)
      if (!n || n === askedN || seen.has(n) || GENERAL_Q.includes(q)) continue
      seen.add(n); picks.push(q)
      if (picks.length >= 4) break
    }
    const gen = shuffle(GENERAL_Q).find(g => !seen.has(normQ(g)) && normQ(g) !== askedN) || GENERAL_Q[0]
    picks.push(gen)
    return picks.slice(0, 5)
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
    if (taRef.current) taRef.current.style.height = 'auto'
    setFollowups([])
    setMessages(m => [...m, { role: 'user', text: q }])
    setBusy(true)
    try {
      const r = await api.ask(q, sessionId, lang)
      setMessages(m => [...m, {
        role: 'assistant', text: r.answer, sources: r.sources,
        confidence: r.confidence, provider: r.provider, clarify: r.clarify,
        charts: r.charts,
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
          <SessionShareMenu sessionId={sessionId} hasMessages={messages.some(m => m.role === 'assistant')} />
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
                  ? <div className="md" onClick={onContentClick} dangerouslySetInnerHTML={{ __html: mdToHtml(m.text) }} />
                  : <p>{m.text}</p>}
                {m.role === 'assistant' && m.charts?.length > 0 &&
                  m.charts.map((c, ci) => <ChartBlock key={ci} spec={c} />)}
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
                {m.role === 'assistant' && m.clarify && (
                  <ClarifyBox clarify={m.clarify} onSend={send} disabled={busy} />
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
                    <ShareMenu question={i > 0 ? messages[i - 1].text : ''} answer={m.text} charts={m.charts} />
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
          <textarea ref={taRef} value={input} rows={1}
                 onChange={e => { setInput(e.target.value); const t = e.target; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 140) + 'px' }}
                 onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                 placeholder="Ask anything — Shift+Enter for a new line…" disabled={busy} />
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
