import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { confirmDialog, alertDialog, toast } from '../dialog.jsx'
import Pager from './Pager.jsx'
import { fmtIST } from '../fmt.js'

export default function Admin() {
  const [view, setView] = useState('stats')
  return (
    <div>
      <div className="toolbar">
        {['stats', 'llm', 'audit', 'chataudit', 'feedback', 'review', 'research', 'users', 'roles', 'instruments', 'integrations', 'settings'].map(v => (
          <button key={v} className={view === v ? '' : 'ghost'} onClick={() => setView(v)}>
            {{ stats: 'Usage stats', llm: 'LLM billing', audit: 'Audit log', chataudit: 'Chat audit',
               feedback: 'Assistant quality', review: 'Score review', research: 'Research (RAG)', users: 'Users',
               roles: 'Roles', instruments: 'Instruments', integrations: 'Integrations',
               settings: 'Settings' }[v]}
          </button>
        ))}
      </div>
      {view === 'stats' && <Stats />}
      {view === 'llm' && <LlmBilling />}
      {view === 'audit' && <Audit />}
      {view === 'chataudit' && <ChatAudit />}
      {view === 'feedback' && <Feedback />}
      {view === 'review' && <Review />}
      {view === 'research' && <Research />}
      {view === 'users' && <Users />}
      {view === 'roles' && <Roles />}
      {view === 'instruments' && <Instruments />}
      {view === 'integrations' && <Integrations />}
      {view === 'settings' && <Settings />}
    </div>
  )
}

const inr = v => '₹' + (v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })

const ALL_PROVIDERS = ['anthropic', 'openai', 'gemini']
const MODEL_OPTIONS = {
  anthropic: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8',
              'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4-turbo'],
  gemini: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-2.0-flash'],
}

function LlmBilling() {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.llmUsage().then(setD).catch(e => setErr(e.message)) }, [])
  if (err) return <p className="note">{err}</p>
  if (!d) return <p className="hint">Loading…</p>
  return (
    <div>
      <p className="hint">{d.note} As of {d.as_of_ist} IST.</p>

      <div className="kpi-row">
        <div className="kpi" title="Total LLM calls made this calendar month (from the audit trail)">
          <span className="kpi-label">MTD calls · {d.month}</span>
          <span className="kpi-value">{d.mtd.calls.toLocaleString('en-IN')}</span></div>
        <div className="kpi" title="Actual estimated spend month-to-date at your configured rates">
          <span className="kpi-label">MTD cost (actual)</span>
          <span className="kpi-value">{inr(d.mtd.cost_inr)}</span></div>
        <div className="kpi" title="Spend today (IST)">
          <span className="kpi-label">Today</span>
          <span className="kpi-value">{inr(d.mtd.today_cost_inr)}</span></div>
        <div className="kpi" title="Straight-line projection: MTD cost ÷ days elapsed × days in month">
          <span className="kpi-label">Month estimate</span>
          <span className="kpi-value">{inr(d.month_estimate_inr)}</span></div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h4 title="Token utilization and cost per LLM provider, month-to-date">By provider (MTD)</h4>
          <table className="data-table">
            <thead><tr><th>Provider</th><th>Calls</th><th>Tokens in</th><th>Tokens out</th><th>Cost (INR)</th></tr></thead>
            <tbody>
              {Object.entries(d.by_provider).map(([k, v]) => (
                <tr key={k}><td><strong>{k}</strong></td><td>{v.calls}</td>
                  <td>{v.input_tokens.toLocaleString('en-IN')}</td>
                  <td>{v.output_tokens.toLocaleString('en-IN')}</td>
                  <td>{inr(v.cost_inr)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h4 title="Which pipeline stage / feature consumes the spend: explainability, sentiment, ask_ai (chat), news_summarization, portfolio_insights, rescore">By pipeline stage (MTD)</h4>
          <table className="data-table">
            <thead><tr><th>Stage</th><th>Calls</th><th>Tokens in</th><th>Tokens out</th><th>Cost (INR)</th></tr></thead>
            <tbody>
              {Object.entries(d.by_stage).sort((a, b) => b[1].cost_inr - a[1].cost_inr).map(([k, v]) => (
                <tr key={k}><td><strong>{k}</strong></td><td>{v.calls}</td>
                  <td>{v.input_tokens.toLocaleString('en-IN')}</td>
                  <td>{v.output_tokens.toLocaleString('en-IN')}</td>
                  <td>{inr(v.cost_inr)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h4 title="USD per 1 million tokens; editable via Settings (llm_pricing). USD→INR rate applied to all.">Rates in use</h4>
        <table className="data-table">
          <thead><tr><th>Provider</th><th>Input $/1M tok</th><th>Output $/1M tok</th></tr></thead>
          <tbody>
            {Object.entries(d.pricing).filter(([k]) => k !== 'usd_inr').map(([k, v]) => (
              <tr key={k}><td><strong>{k}</strong></td>
                <td>${v.input_usd_per_mtok}</td><td>${v.output_usd_per_mtok}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="hint">USD→INR rate: ₹{d.pricing.usd_inr}. Edit rates via Admin → Settings
          isn't exposed as a form yet — update key <code>llm_pricing</code> through
          PUT /api/v1/admin/settings, or ask me to add a rate editor.</p>
      </div>
    </div>
  )
}

function Integrations() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [test, setTest] = useState(null)
  const [testing, setTesting] = useState(false)
  useEffect(() => { api.integrations().then(setData).catch(e => setErr(e.message)) }, [])

  async function runTest() {
    setTesting(true); setTest(null)
    try { setTest(await api.llmTest()) } catch (e) { setErr(e.message) }
    setTesting(false)
  }

  if (err) return <p className="note">{err}</p>
  if (!data) return <p className="hint">Loading…</p>
  return (
    <div>
      <p className="hint">{data.note}</p>

      <div className="panel">
        <div className="panel-head">
          <h4 style={{ margin: 0 }}>LLM providers</h4>
          <button className="ghost sm" onClick={runTest} disabled={testing}
                  title="Send a tiny test prompt to each configured provider to confirm the keys/models actually work">
            {testing ? 'Testing…' : 'Test AI connectivity'}</button>
        </div>
        {test && (
          <div className="deductions" style={{ marginTop: 0 }}>
            <h4>{test.any_provider_working ? '✓ At least one provider is working'
                                            : '✗ No provider is working — the AI Assistant will fail'}</h4>
            <ul>
              {test.results.map(r => (
                <li key={r.provider}>
                  <span className={r.ok ? 'up' : 'down'}>{r.ok ? '✓' : '✗'}</span>{' '}
                  <strong>{r.provider}</strong> ({r.model}) — {r.detail}
                </li>
              ))}
            </ul>
            <p className="hint">{test.note}</p>
          </div>
        )}
        <table className="data-table">
          <thead><tr>
            <th title="AI model provider">Provider</th>
            <th title="Model used for completions">Model</th>
            <th title="API endpoint (public knowledge, no secret)">Endpoint</th>
            <th title="Your firm's API key — masked; the full key never leaves the server">API key</th>
            <th title="Whether a key is present in backend/.env">Status</th>
          </tr></thead>
          <tbody>
            {data.llm_providers.map(p => (
              <tr key={p.name}>
                <td><strong>{p.name}</strong></td>
                <td>{p.model}</td>
                <td className="hint">{p.endpoint}</td>
                <td><code>{p.api_key_masked || '—'}</code></td>
                <td><span className={`tag ${p.configured ? 'positive' : 'pending'}`}>
                  {p.configured ? 'configured' : 'not configured'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h4>Market data sources</h4>
        <table className="data-table">
          <thead><tr>
            <th>Source</th>
            <th title="Public endpoints need no key; licensed feeds need your broker API keys">Type</th>
            <th title="Full endpoint URLs — public endpoints carry no secrets">Endpoints</th>
            <th title="Your API key, masked">API key</th>
            <th>Status</th>
          </tr></thead>
          <tbody>
            {data.market_data.map(m => (
              <tr key={m.name}>
                <td><strong>{m.name}</strong></td>
                <td className="hint">{m.type}</td>
                <td className="hint" style={{ fontSize: '.75rem' }}>
                  {m.endpoints.map(e => <div key={e}>{e}</div>)}</td>
                <td><code>{m.api_key_masked || '—'}</code></td>
                <td><span className={`tag ${m.configured ? 'positive' : 'pending'}`}>
                  {m.configured ? 'active' : 'not configured'}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h4>News feeds (public RSS)</h4>
        <table className="data-table">
          <thead><tr><th>Source</th><th>Feed URL</th></tr></thead>
          <tbody>
            {data.news_feeds.map(f => (
              <tr key={f.url}>
                <td><strong>{f.name}</strong></td>
                <td className="hint">{f.url}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Instruments() {
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [importing, setImporting] = useState(false)
  const [form, setForm] = useState({ symbol: '', name: '', sector: '' })
  const [filter, setFilter] = useState('')
  const [page, setPage] = useState(0)
  const load = () => api.adminInstruments().then(setRows).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])

  async function add(e) {
    e.preventDefault(); setErr('')
    try {
      await api.addInstrument(form.symbol, form.name, form.sector)
      setForm({ symbol: '', name: '', sector: '' }); load()
    } catch (ex) { setErr(ex.message) }
  }

  async function doImport(fn, label) {
    setImporting(true); setErr(''); setMsg('')
    try {
      const r = await fn()
      setMsg(`${label}: ${r.added} added, ${r.updated} updated — ${r.total_instruments} total. ${r.note}`)
      load()
    } catch (ex) { setErr(ex.message) }
    setImporting(false)
  }
  const importN50 = () => doImport(api.importNifty50, 'NIFTY 50 import')
  const importN500 = () => doImport(api.importNifty500, 'NIFTY 500 import')
  const importNseAll = () => doImport(api.importNseAll, 'Full NSE import')
  async function toggle(id, field) {
    try { await api.toggleInstrument(id, field); load() } catch (ex) { setErr(ex.message) }
  }

  const visible = rows.filter(r => !filter ||
    r.symbol.toLowerCase().includes(filter.toLowerCase()) ||
    (r.name || '').toLowerCase().includes(filter.toLowerCase()))
  const inUniverse = rows.filter(r => r.in_scoring_universe && r.is_active).length

  return (
    <div>
      <form className="panel" onSubmit={add}>
        <h4>Add script</h4>
        <div className="toolbar">
          <input placeholder="NSE symbol *" required value={form.symbol}
                 onChange={e => setForm({ ...form, symbol: e.target.value.toUpperCase() })} />
          <input placeholder="Company name" value={form.name}
                 onChange={e => setForm({ ...form, name: e.target.value })} />
          <input placeholder="Sector" value={form.sector}
                 onChange={e => setForm({ ...form, sector: e.target.value })} />
          <button type="submit">Add</button>
        </div>
      </form>
      {err && <p className="note">{err}</p>}
      {msg && <p className="hint">{msg}</p>}
      <div className="toolbar">
        <button onClick={importN50} disabled={importing}
                title="Import the NIFTY 50 constituents (tagged NIFTY50, scored daily)">
          {importing ? 'Importing…' : 'Import NIFTY 50'}</button>
        <button onClick={importN500} disabled={importing}
                title="Import the NIFTY 500 constituents (tagged NIFTY500, scored daily)">
          {importing ? 'Importing…' : 'Import NIFTY 500'}</button>
        <button className="ghost" onClick={importNseAll} disabled={importing}
                title="Import the FULL NSE equity master (tagged NSE). Added outside daily scoring (scored on-demand) to control cost.">
          {importing ? 'Importing…' : 'Import all NSE'}</button>
        <input placeholder="Filter…" value={filter}
               onChange={e => { setFilter(e.target.value); setPage(0) }} />
        <span className="hint">{rows.length} scripts · {inUniverse} in scoring universe</span>
      </div>
      <table className="data-table">
        <thead><tr>
          <th title="NSE trading symbol">Symbol</th>
          <th title="Company name">Name</th>
          <th title="Sector used for portfolio analytics and score filtering">Sector</th>
          <th title="Active = visible to users (assistant, watchlists, portfolio). Inactive scripts are hidden everywhere.">Active</th>
          <th title="Included in the daily AI scoring pipeline. Turn off to keep the script visible but unscored.">Scored daily</th>
        </tr></thead>
        <tbody>
          {visible.slice(page * 20, page * 20 + 20).map(r => (
            <tr key={r.id}>
              <td><strong>{r.symbol}</strong></td>
              <td>{r.name}</td>
              <td className="hint">{r.sector}</td>
              <td><button className="ghost" onClick={() => toggle(r.id, 'is_active')}>
                {r.is_active ? '✓ active' : '✗ inactive'}</button></td>
              <td><button className="ghost" onClick={() => toggle(r.id, 'in_scoring_universe')}>
                {r.in_scoring_universe ? '✓ yes' : '✗ no'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={page} setPage={setPage} total={visible.length} label="scripts" />
    </div>
  )
}

function Settings() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [weights, setWeights] = useState(null)
  const [llm, setLlm] = useState(null)
  const load = () => api.settings().then(d => {
    setData(d); setWeights({ ...d.settings.scoring_weights })
    setLlm({ order: [...(d.settings.llm_provider_order || [])],
             strategy: d.settings.llm_strategy || 'failover',
             models: { ...(d.settings.llm_models || {}) },
             enabled: { ...(d.settings.llm_enabled || {}) } })
  }).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])

  async function save(key, value) {
    setErr(''); setMsg('')
    try {
      const r = await api.updateSetting(key, value)
      setMsg(`Saved ${key}. ${r.note || ''}`)
      toast(r.note || `Saved ${key}.`)
      load()
    } catch (ex) { setErr(ex.message); toast(ex.message, { type: 'error' }) }
  }

  async function uploadLogo(e) {
    const f = e.target.files?.[0]; if (!f) return
    setErr(''); setMsg('')
    try { await api.uploadBrandLogo(f); setMsg('Logo uploaded — it applies app-wide after users reload.'); load() }
    catch (ex) { setErr(ex.message) }
  }
  async function removeLogo() {
    setErr(''); setMsg('')
    try { await api.clearBrandLogo(); setMsg('Logo removed — reverts to the default icon.'); load() }
    catch (ex) { setErr(ex.message) }
  }

  function moveProv(idx, dir) {
    const o = [...llm.order]; const j = idx + dir
    if (j < 0 || j >= o.length) return
    ;[o[idx], o[j]] = [o[j], o[idx]]; setLlm({ ...llm, order: o })
  }
  function removeProv(prov) { setLlm({ ...llm, order: llm.order.filter(x => x !== prov) }) }
  function addProv(prov) { if (prov && !llm.order.includes(prov)) setLlm({ ...llm, order: [...llm.order, prov] }) }
  function toggleEnabled(prov) { setLlm({ ...llm, enabled: { ...llm.enabled, [prov]: llm.enabled[prov] === false } }) }
  async function saveLLM() {
    setErr(''); setMsg('')
    try {
      if (!llm.order.length) throw new Error('Enable at least one provider')
      if (!llm.order.some(p => llm.enabled[p] !== false))
        throw new Error('At least one provider must stay enabled (checkbox on)')
      await api.updateSetting('llm_provider_order', llm.order)
      await api.updateSetting('llm_strategy', llm.strategy)
      await api.updateSetting('llm_models', llm.models)
      await api.updateSetting('llm_enabled', Object.fromEntries(llm.order.map(p => [p, llm.enabled[p] !== false])))
      setMsg('LLM routing saved.'); toast('LLM routing saved.'); load()
    } catch (ex) { setErr(ex.message); toast(ex.message, { type: 'error' }) }
  }

  if (!data) return err ? <p className="note">{err}</p> : <p className="hint">Loading…</p>
  const s = data.settings
  const wSum = weights ? Object.values(weights).reduce((a, b) => a + Number(b || 0), 0) : 0

  return (
    <div>
      {err && <p className="note">{err}</p>}
      {msg && <p className="hint">{msg}</p>}

      <div className="panel">
        <h4 title="Upload your company logo. It replaces the default icon as the app logo (login + sidebar) and the browser favicon for everyone.">Branding — logo &amp; favicon</h4>
        <p className="hint">PNG, SVG, JPG or WebP, up to 600 KB. Applies app-wide once users reload.</p>
        <div className="toolbar">
          <input type="file" accept="image/png,image/svg+xml,image/jpeg,image/webp,image/gif" onChange={uploadLogo} />
          {s.brand_logo ? <button className="ghost" onClick={removeLogo}>Remove logo</button> : null}
        </div>
        {s.brand_logo
          ? <img src={s.brand_logo} alt="Current logo"
                 style={{ maxWidth: 220, maxHeight: 80, marginTop: 8, background: '#0a0d13', borderRadius: 8, padding: 6, objectFit: 'contain' }} />
          : <p className="hint">No custom logo — using the default ₹ icon.</p>}
      </div>

      <div className="panel">
        <h4 title="Names shown across the app. 'App AI name' is the platform brand used in the assistant's Basis tag; 'Score label' renames the composite score everywhere (dashboard, tables, compare).">
          Display names <span className="info-i">i</span></h4>
        <div className="weights-grid">
          <label>App AI name
            <input id="set-platform-label" defaultValue={s.platform_label} maxLength={40} />
          </label>
          <label>Score label
            <input id="set-score-label" defaultValue={s.score_label} maxLength={40} />
          </label>
        </div>
        <div className="toolbar">
          <button onClick={() => save('platform_label', document.getElementById('set-platform-label').value.trim())}>Save app name</button>
          <button onClick={() => save('score_label', document.getElementById('set-score-label').value.trim())}>Save score label</button>
        </div>
        <p className="hint">Applies app-wide after users reload. Defaults: <strong>NIYTRI AI</strong> / <strong>NIYTRI Score</strong>.</p>
      </div>

      <div className="panel">
        <h4>Scoring weights <span className="hint">(must sum to 1.0 — current: {wSum.toFixed(2)})</span></h4>
        <div className="weights-grid">
          {weights && Object.entries(weights).map(([k, v]) => (
            <label key={k}>{k.replace('_', ' ')}
              <input type="number" step="0.01" min="0" max="1" value={v}
                     onChange={e => setWeights({ ...weights, [k]: Number(e.target.value) })} />
            </label>
          ))}
        </div>
        <button disabled={Math.abs(wSum - 1) > 0.001}
                onClick={() => save('scoring_weights', weights)}>Save weights</button>
      </div>

      <div className="panel">
        <h4 title="The chatbot's persona and behaviour. SEBI compliance guardrails (no buy/sell advice, grounding rules) are enforced in code and cannot be removed here.">
          Chatbot prompt <span className="info-i">i</span></h4>
        <textarea id="set-prompt" defaultValue={s.assistant_system_prompt}
                  rows={6} style={{ width: '100%' }} />
        <div className="toolbar">
          <button onClick={() =>
            save('assistant_system_prompt', document.getElementById('set-prompt').value)}>
            Save prompt</button>
          <button className="ghost" onClick={() =>
            save('assistant_system_prompt', data.defaults.assistant_system_prompt)}>
            Reset to default</button>
        </div>
      </div>

      <div className="panel">
        <h4 title="Governance controls for how AI scores are validated and published">
          Maker-checker & AI checker</h4>
        <div className="toolbar">
          <label title="When ON, the daily pipeline publishes scores as 'pending'. A human admin must approve each in Score review before it reaches users or the assistant.">
            <input type="checkbox" defaultChecked={!!s.strict_maker_checker}
                   onChange={e => save('strict_maker_checker', e.target.checked)} />
            {' '}Strict maker-checker (human approval required before publishing)
          </label>
        </div>
        <div className="toolbar">
          <label title="When ON, a second LLM (a different provider when more than one is configured) independently reviews every rationale for compliance and factual consistency before the Quality Agent decides. Flagged scores are rejected.">
            <input type="checkbox" defaultChecked={!!s.ai_checker_enabled}
                   onChange={e => save('ai_checker_enabled', e.target.checked)} />
            {' '}Independent AI checker (second model reviews each rationale)
          </label>
        </div>
        <p className="hint">Strict mode holds new scores as <em>pending</em> until approved
          in Admin → Score review. The AI checker adds one LLM call per script per run.</p>
      </div>

      <div className="panel">
        <h4 title="When ON, the app also shows major global indices (S&P 500, Nasdaq, Dow, FTSE, Nikkei, Hang Seng) in the ticker and pulls global market news into the News feed on the next refresh.">
          Global markets <span className="info-i">i</span></h4>
        <div className="toolbar">
          <label title="Adds global indices to the ticker and global news to the News feed (applied on the next news refresh).">
            <input type="checkbox" defaultChecked={!!s.global_markets_enabled}
                   onChange={e => save('global_markets_enabled', e.target.checked)} />
            {' '}Enable global indices &amp; global news
          </label>
        </div>
        <p className="hint">Indices appear in a <strong>GLOBAL</strong> ticker row immediately;
          global news joins the feed on the next scheduled refresh (or after Refresh News in Agents).</p>
      </div>

      <div className="panel">
        <h4 title="Cache the stable part of each request (the assistant's system prompt + compliance rules) at the model provider so it isn't reprocessed every time.">
          Prompt caching <span className="info-i">i</span></h4>
        <div className="deductions" style={{ marginTop: 0 }}>
          <p style={{ margin: 0 }}><strong>How prompt caching works.</strong> Every assistant
            request repeats a large, unchanging prefix - the system prompt plus the SEBI compliance
            rules. With caching ON, the provider stores that prefix after the first call and reuses
            it for later calls instead of re-reading it, so answers come back faster and the repeated
            input tokens are billed at a steep discount (the cache lives for a few minutes and
            refreshes on each hit). It only activates once the cached prefix is long enough -
            otherwise it is a harmless no-op. Turn it OFF to send every request fresh. Changes apply
            live, no restart.</p>
          <p style={{ margin: '8px 0 0' }}>
            <strong>Anthropic</strong> - explicit caching: the system prompt is tagged{' '}
            <code>cache_control: ephemeral</code>.{' '}
            <strong>OpenAI</strong> - automatic for prompts over ~1024 tokens; we send a stable
            cache key to raise hit rates.{' '}
            <strong>Gemini</strong> - context caching of the system instruction (2.5 models also
            cache implicitly). Cached-token usage is recorded for billing estimates.</p>
        </div>
        <div className="toolbar">
          <label title="Cache the stable system prefix across providers to cut repeated input-token cost and latency.">
            <input type="checkbox" defaultChecked={!!s.prompt_caching_enabled}
                   onChange={e => save('prompt_caching_enabled', e.target.checked)} />
            {' '}Enable prompt caching (Anthropic, OpenAI &amp; Gemini)
          </label>
        </div>
      </div>

      {llm && (
      <div className="panel">
        <h4>LLM routing</h4>
        <div className="deductions" style={{ marginTop: 0 }}>
          <p style={{ margin: 0 }}><strong>How it works.</strong> <strong>Failover</strong> — the
            assistant calls providers in the priority order below and uses the first that responds;
            if one errors, is rate-limited or down, it automatically falls through to the next, and
            only fails if every provider fails. <strong>Round robin</strong> — rotates requests across
            the enabled providers to spread load (still falling over on error). Changes apply live, no restart.</p>
        </div>

        <div className="toolbar">
          <span style={{ minWidth: 90 }}>Strategy</span>
          <select value={llm.strategy} onChange={e => setLlm({ ...llm, strategy: e.target.value })}>
            <option value="failover">Failover (priority order)</option>
            <option value="round_robin">Round robin (spread load)</option>
          </select>
        </div>

        <h4 style={{ fontSize: '.9rem', margin: '14px 0 4px' }}>Provider priority &amp; model</h4>
        {llm.order.map((prov, idx) => {
          const opts = MODEL_OPTIONS[prov].includes(llm.models[prov])
            ? MODEL_OPTIONS[prov] : [llm.models[prov], ...MODEL_OPTIONS[prov]].filter(Boolean)
          return (
            <div className="toolbar" key={prov} style={{ margin: '4px 0' }}>
              <span style={{ minWidth: 24 }}>{idx + 1}.</span>
              <label title="Turn this provider off to exclude it from routing (compare model performance) without deleting its key">
                <input type="checkbox" checked={llm.enabled[prov] !== false}
                       onChange={() => toggleEnabled(prov)} />{' '}on
              </label>
              <strong style={{ minWidth: 96, textTransform: 'capitalize',
                       opacity: llm.enabled[prov] === false ? 0.45 : 1 }}>{prov}</strong>
              <button className="ghost sm" disabled={idx === 0} title="Move up"
                      onClick={() => moveProv(idx, -1)}>↑</button>
              <button className="ghost sm" disabled={idx === llm.order.length - 1} title="Move down"
                      onClick={() => moveProv(idx, 1)}>↓</button>
              <button className="ghost sm" disabled={llm.order.length === 1} title="Remove from rotation"
                      onClick={() => removeProv(prov)}>Remove</button>
              <span style={{ minWidth: 44 }} className="hint">model</span>
              <select value={llm.models[prov] || opts[0]}
                      onChange={e => setLlm({ ...llm, models: { ...llm.models, [prov]: e.target.value } })}>
                {opts.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          )
        })}
        {ALL_PROVIDERS.filter(p => !llm.order.includes(p)).length > 0 && (
          <div className="toolbar">
            <span className="hint" style={{ minWidth: 90 }}>Add provider</span>
            <select value="" onChange={e => addProv(e.target.value)}>
              <option value="">— select —</option>
              {ALL_PROVIDERS.filter(p => !llm.order.includes(p)).map(p =>
                <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
        )}
        <div className="toolbar"><button onClick={saveLLM}>Save routing</button></div>
        <p className="hint">Tip: put a fast, cheap model first (e.g. Anthropic
          <code> claude-haiku-4-5-20251001 </code>) for snappier chat, and keep a second provider
          enabled so failover can cover an outage.</p>
      </div>
      )}

      <div className="panel">
        <h4>Scheduler & limits</h4>
        {[['daily_scoring_hour', 'Daily scoring hour (0-23)'],
          ['news_refresh_minutes', 'News refresh interval (min)'],
          ['max_news_items', 'Max news items per refresh'],
          ['assistant_history_messages', 'Assistant memory (messages)'],
          ['assistant_max_tokens', 'Assistant max tokens']].map(([key, label]) => (
          <div key={key} className="toolbar">
            <span style={{ minWidth: 240 }}>{label}</span>
            <input type="number" defaultValue={s[key]} id={`set-${key}`} style={{ width: 90 }} />
            <button className="ghost" onClick={() =>
              save(key, Number(document.getElementById(`set-${key}`).value))}>Save</button>
          </div>
        ))}
        <p className="hint">Schedule changes (scoring hour, news interval) apply immediately -
          no restart needed. The confirmation appears at the top of this Settings tab.</p>
      </div>
    </div>
  )
}

function Stats() {
  const [s, setS] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.stats().then(setS).catch(e => setErr(e.message)) }, [])
  if (err) return <p className="note">{err}</p>
  if (!s) return <p className="hint">Loading…</p>
  return (
    <div className="panel">
      <div className="grid2">
        <div>
          <h4>LLM usage</h4>
          <ul>
            <li>Total calls: {s.llm_calls_total}</li>
            {Object.entries(s.llm_calls_by_provider).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
            <li>Tokens in/out: {s.tokens.input.toLocaleString()} / {s.tokens.output.toLocaleString()}</li>
          </ul>
          <h4>By task</h4>
          <ul>{Object.entries(s.llm_calls_by_task).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
        </div>
        <div>
          <h4>Platform</h4>
          <ul>
            <li>Users: {s.users}</li>
            <li>Logins: {s.logins}</li>
            <li>Pipeline runs: {s.pipeline_runs}</li>
            <li>Scores stored: {s.scores_stored}</li>
          </ul>
          {s.last_pipeline && <p className="hint">Last pipeline: {s.last_pipeline.scored?.join(', ') || '—'}</p>}
        </div>
      </div>
    </div>
  )
}

function Audit() {
  const [data, setData] = useState(null)
  const [event, setEvent] = useState('')
  const [page, setPage] = useState(0)
  const [err, setErr] = useState('')
  const LIMIT = 20
  useEffect(() => {
    api.audit(event, LIMIT, page * LIMIT).then(setData).catch(e => setErr(e.message))
  }, [event, page])
  if (err) return <p className="note">{err}</p>
  if (!data) return <p className="hint">Loading…</p>
  return (
    <div>
      <div className="toolbar">
        <select value={event} onChange={e => { setEvent(e.target.value); setPage(0) }}>
          <option value="">All events ({data.total})</option>
          {data.events.map(ev => <option key={ev} value={ev}>{ev}</option>)}
        </select>
        <button className="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
        <span>page {page + 1}</span>
        <button className="ghost" disabled={(page + 1) * LIMIT >= data.total}
                onClick={() => setPage(p => p + 1)}>Next ›</button>
      </div>
      <table className="audit-table">
        <thead><tr>
          <th title="When the event occurred (IST). Every LLM call, agent run, login and admin action is logged immutably for SEBI audit.">Time (IST)</th>
          <th title="Event type, e.g. llm_call, pipeline_start, login_success, score_review">Event</th>
          <th title="Structured event payload (provider, model, user, symbols, etc.)">Details</th>
        </tr></thead>
        <tbody>
          {data.records.map(r => (
            <tr key={r.audit_id}>
              <td>{fmtIST(r.ts)}</td>
              <td><span className="tag">{r.event}</span></td>
              <td className="audit-detail">
                {Object.entries(r).filter(([k]) => !['audit_id', 'ts', 'time', 'event'].includes(k))
                  .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`).join('  ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Review() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [fDate, setFDate] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fSymbol, setFSymbol] = useState('')
  const [page, setPage] = useState(0)
  const LIMIT = 20

  const load = () => api.scoresHistory({
    score_date: fDate, status: fStatus, symbol: fSymbol,
    limit: LIMIT, offset: page * LIMIT,
  }).then(setData).catch(e => setErr(e.message))
  useEffect(() => { load() }, [fDate, fStatus, fSymbol, page])

  async function decide(id, status) {
    try { await api.reviewScore(id, status); toast(`Score ${status}.`); load() }
    catch (e) { setErr(e.message); toast(e.message, { type: 'error' }) }
  }

  async function decideAll(setStatus) {
    const scope = [fDate && `run ${fDate}`, fStatus && `status "${fStatus}"`, fSymbol && `symbol "${fSymbol}"`]
      .filter(Boolean).join(', ') || 'ALL runs and statuses'
    if (!(await confirmDialog(`Set status to "${setStatus}" for every score matching: ${scope}? This applies across all pages and cannot be undone.`, { title: setStatus === 'approved' ? 'Approve all' : 'Reject all', confirmText: setStatus === 'approved' ? 'Approve all' : 'Reject all', danger: setStatus === 'rejected' }))) return
    try {
      const r = await api.reviewScoresBulk(setStatus, { score_date: fDate, status: fStatus, symbol: fSymbol })
      setErr(''); load()
      await alertDialog(`Updated ${r.updated} score(s).`, { title: 'Done' })
    } catch (e) { setErr(e.message) }
  }

  if (err) return <p className="note">{err}</p>
  if (!data) return <p className="hint">Loading…</p>

  return (
    <div>
      <p className="hint">Maker-checker audit: the pipeline's Quality Agent auto-validates
        each score; admins can override below. Every decision is attributed and audit-logged.
        Only approved scores are served to users. Human-reviewed scores so far:
        <strong> {data.human_reviewed_total}</strong>.</p>

      <div className="watch-strip" style={{ margin: '12px 0' }}>
        {data.summary.map(s => (
          <div key={s.score_date}
               className="watch-chip"
               style={{ cursor: 'pointer', borderColor: fDate === s.score_date ? 'var(--accent)' : undefined }}
               title="Click to filter this run date"
               onClick={() => { setFDate(fDate === s.score_date ? '' : s.score_date); setPage(0) }}>
            <strong>{s.score_date}</strong>
            <span className="up">✓ {s.approved}</span>
            <span className="down">✗ {s.rejected}</span>
            {s.pending > 0 && <span className="hint">⏳ {s.pending}</span>}
          </div>
        ))}
      </div>

      <div className="toolbar">
        <select value={fStatus} onChange={e => { setFStatus(e.target.value); setPage(0) }}
                title="Filter by quality status">
          <option value="">All statuses</option>
          <option value="approved">approved</option>
          <option value="rejected">rejected</option>
          <option value="pending">pending</option>
        </select>
        <button className="ghost sm" onClick={() => decideAll('approved')}
                title="Approve every score matching the current filter (all pages, not just this one)">✓ Approve all</button>
        <button className="ghost sm" onClick={() => decideAll('rejected')}
                title="Reject every score matching the current filter (all pages, not just this one)">✗ Reject all</button>
        <input placeholder="Symbol…" value={fSymbol}
               onChange={e => { setFSymbol(e.target.value); setPage(0) }} />
        <button className="ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
        <span className="hint">page {page + 1} · {data.total} records</span>
        <button className="ghost" disabled={(page + 1) * LIMIT >= data.total}
                onClick={() => setPage(p => p + 1)}>Next ›</button>
      </div>

      <table className="data-table">
        <thead><tr>
          <th title="NSE symbol">Script</th>
          <th title="Run date of this score">Run date</th>
          <th title="Composite AI score out of 100">Score</th>
          <th title="approved = served to users; rejected = blocked; pending = awaiting human approval (strict maker-checker)">Status</th>
          <th title="Independent AI checker verdict: pass or flag (with reason). Uses a different model than the rationale writer when available.">AI check</th>
          <th title="Who made the decision: the automated Quality Agent or a named admin">Reviewed by</th>
          <th title="When the human review happened (blank for automated decisions)">Reviewed at</th>
          <th title="Override the decision (recorded under your email)">Action</th>
        </tr></thead>
        <tbody>
          {data.rows.map(r => (
            <tr key={r.id}>
              <td><strong>{r.symbol}</strong></td>
              <td>{r.score_date}</td>
              <td>{r.composite_score}</td>
              <td><span className={`tag ${r.quality_status === 'approved' ? 'positive' : r.quality_status === 'rejected' ? 'negative' : 'pending'}`}>{r.quality_status}</span></td>
              <td title={r.ai_review ? `${r.ai_review.reason || ''}${r.ai_review.checker_provider ? ' — ' + r.ai_review.checker_provider + (r.ai_review.independent ? ' (independent)' : ' (same model)') : ''}` : 'AI checker was off for this run'}>
                {r.ai_review
                  ? <span className={`tag ${r.ai_review.verdict === 'flag' ? 'negative' : 'positive'}`}>
                      {r.ai_review.verdict === 'flag' ? '⚑ flag' : '✓ pass'}</span>
                  : <span className="hint">—</span>}
              </td>
              <td className="hint">{r.reviewed_by}</td>
              <td className="hint">{r.reviewed_at ? fmtIST(r.reviewed_at) : '—'}</td>
              <td>
                <button className="ghost sm" onClick={() => decide(r.id, 'approved')}>✓</button>{' '}
                <button className="ghost sm" onClick={() => decide(r.id, 'rejected')}>✗</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Research() {
  const [docs, setDocs] = useState(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState(null)
  const [meta, setMeta] = useState({ title: '', source: '' })
  const [paste, setPaste] = useState({ title: '', source: '', text: '' })

  const load = () => api.research().then(d => { setDocs(d.documents); setNote(d.note) })
    .catch(e => setErr(e.message))
  useEffect(() => { load() }, [])

  async function upload(e) {
    e.preventDefault(); setErr(''); setMsg(''); setBusy(true)
    try {
      if (!file) throw new Error('Choose a .pdf, .txt or .md file first')
      const r = await api.researchUpload(file, meta.title, meta.source)
      setMsg(`Ingested "${r.title}" — ${r.chunks} chunks (${r.embedding_method}).`)
      setFile(null); setMeta({ title: '', source: '' }); load()
    } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }

  async function addText(e) {
    e.preventDefault(); setErr(''); setMsg(''); setBusy(true)
    try {
      const r = await api.researchText(paste.title, paste.text, paste.source)
      setMsg(`Ingested "${r.title}" — ${r.chunks} chunks (${r.embedding_method}).`)
      setPaste({ title: '', source: '', text: '' }); load()
    } catch (ex) { setErr(ex.message) }
    setBusy(false)
  }

  async function remove(id) {
    if (!(await confirmDialog('Delete this research document and its embeddings?', { title: 'Delete document', confirmText: 'Delete', danger: true }))) return
    try { await api.researchDelete(id); load() } catch (ex) { setErr(ex.message) }
  }

  return (
    <div>
      <p className="hint">{note || 'Broker research uploaded here grounds the AI assistant as cited reference material.'}</p>
      {err && <p className="note">{err}</p>}
      {msg && <p className="hint">{msg}</p>}

      <div className="grid2">
        <form className="panel" onSubmit={upload}>
          <h4>Upload a document <span className="hint">(.pdf, .txt, .md — max 20 MB)</span></h4>
          <div className="toolbar">
            <input type="file" accept=".pdf,.txt,.md"
                   onChange={e => setFile(e.target.files[0] || null)} />
          </div>
          <div className="toolbar">
            <input placeholder="Title (defaults to filename)" value={meta.title}
                   onChange={e => setMeta({ ...meta, title: e.target.value })} />
            <input placeholder="Source / desk (optional)" value={meta.source}
                   onChange={e => setMeta({ ...meta, source: e.target.value })} />
          </div>
          <button type="submit" disabled={busy}>{busy ? 'Ingesting…' : 'Upload & index'}</button>
        </form>

        <form className="panel" onSubmit={addText}>
          <h4>…or paste text</h4>
          <div className="toolbar">
            <input placeholder="Title *" required value={paste.title}
                   onChange={e => setPaste({ ...paste, title: e.target.value })} />
            <input placeholder="Source (optional)" value={paste.source}
                   onChange={e => setPaste({ ...paste, source: e.target.value })} />
          </div>
          <textarea rows={5} placeholder="Paste research note text…" value={paste.text}
                    style={{ width: '100%' }}
                    onChange={e => setPaste({ ...paste, text: e.target.value })} />
          <button type="submit" disabled={busy || !paste.text}>Index text</button>
        </form>
      </div>

      <div className="panel">
        <h4>Indexed documents {docs && <span className="hint">({docs.length})</span>}</h4>
        {!docs ? <p className="hint">Loading…</p> : docs.length === 0
          ? <p className="hint">No research documents yet. Upload one above to ground the assistant.</p>
          : (
          <table className="data-table">
            <thead><tr>
              <th title="Document title">Title</th>
              <th title="Research desk / analyst / source">Source</th>
              <th title="Number of text chunks embedded for retrieval">Chunks</th>
              <th title="Embedding backend used (OpenAI when a key is set, else a local fallback)">Embedding</th>
              <th title="Admin who uploaded it">Uploaded by</th>
              <th />
            </tr></thead>
            <tbody>
              {docs.map(d => (
                <tr key={d.id}>
                  <td><strong>{d.title}</strong></td>
                  <td className="hint">{d.source || '—'}</td>
                  <td>{d.chunk_count}</td>
                  <td className="hint">{d.embedding_method}</td>
                  <td className="hint">{d.uploaded_by}</td>
                  <td><button className="ghost sm" onClick={() => remove(d.id)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Users() {
  const [rows, setRows] = useState([])
  const [err, setErr] = useState('')
  const [page, setPage] = useState(0)
  const [roles, setRoles] = useState([])
  const [form, setForm] = useState({ email: '', password: '', full_name: '', role_id: '' })
  const load = () => {
    api.users().then(setRows).catch(e => setErr(e.message))
    api.roles().then(setRoles).catch(() => {})
  }
  useEffect(() => { load() }, [])
  async function changeRole(id, rid) {
    try { await api.setUserRole(id, rid ? Number(rid) : null); load() } catch (ex) { setErr(ex.message) }
  }

  async function create(e) {
    e.preventDefault()
    setErr('')
    try {
      const rid = form.role_id ? Number(form.role_id) : null
      const isAdmin = !!roles.find(r => r.id === rid && r.is_admin)
      await api.createUser(form.email, form.password, form.full_name, isAdmin, rid)
      setForm({ email: '', password: '', full_name: '', role_id: '' })
      load()
    } catch (ex) { setErr(ex.message) }
  }

  async function toggle(id) {
    try { await api.toggleUser(id); load() } catch (ex) { setErr(ex.message) }
  }

  return (
    <div>
      <form className="panel user-form" onSubmit={create}>
        <h4>Create user</h4>
        <div className="toolbar">
          <input placeholder="Email" type="email" required value={form.email}
                 onChange={e => setForm({ ...form, email: e.target.value })} />
          <input placeholder="Full name" value={form.full_name}
                 onChange={e => setForm({ ...form, full_name: e.target.value })} />
          <input placeholder="Password (min 8)" type="password" required minLength={8}
                 value={form.password}
                 onChange={e => setForm({ ...form, password: e.target.value })} />
          <select value={form.role_id} onChange={e => setForm({ ...form, role_id: e.target.value })}
                  title="Role controls which pages this user can access">
            <option value="">No role (default User access)</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}{r.is_admin ? ' (admin)' : ''}</option>)}
          </select>
          <button type="submit">Create</button>
        </div>
      </form>
      {err && <p className="note">{err}</p>}
      <table className="audit-table">
        <thead><tr>
          <th title="Internal user ID">ID</th>
          <th title="Login email">Email</th>
          <th title="Display name">Name</th>
          <th title="admin = full access; user = standard access">Role</th>
          <th title="Disabled users cannot log in">Active</th>
          <th title="Account creation time">Created</th>
          <th />
        </tr></thead>
        <tbody>
          {rows.slice(page * 20, page * 20 + 20).map(u => (
            <tr key={u.id}>
              <td>{u.id}</td><td>{u.email}</td><td>{u.full_name}</td>
              <td>
                <select value={u.role_id || ''} onChange={e => changeRole(u.id, e.target.value)}>
                  <option value="">{u.is_admin ? 'admin (legacy)' : 'No role'}</option>
                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </td>
              <td>{u.is_active ? 'yes' : 'no'}</td>
              <td>{fmtIST(u.created_at)}</td>
              <td><button className="ghost" onClick={() => toggle(u.id)}>
                {u.is_active ? 'Disable' : 'Enable'}</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={page} setPage={setPage} total={rows.length} label="users" />
    </div>
  )
}

function Roles() {
  const [roles, setRoles] = useState([])
  const [pages, setPages] = useState([])
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [form, setForm] = useState({ id: null, name: '', pages: [], is_admin: false })
  const load = () => {
    api.roles().then(setRoles).catch(e => setErr(e.message))
    api.pagesCatalog().then(d => setPages(d.pages || [])).catch(() => {})
  }
  useEffect(() => { load() }, [])
  function edit(r) { setForm({ id: r.id, name: r.name, pages: [...(r.pages || [])], is_admin: r.is_admin }) }
  function reset() { setForm({ id: null, name: '', pages: [], is_admin: false }) }
  function togglePage(p) {
    setForm(f => ({ ...f, pages: f.pages.includes(p) ? f.pages.filter(x => x !== p) : [...f.pages, p] }))
  }
  async function submit(e) {
    e.preventDefault(); setErr(''); setMsg('')
    try {
      if (form.id) { await api.updateRole(form.id, form.name, form.pages, form.is_admin); setMsg('Role updated.') }
      else { await api.createRole(form.name, form.pages, form.is_admin); setMsg('Role created.') }
      reset(); load()
    } catch (ex) { setErr(ex.message) }
  }
  async function remove(r) {
    if (!(await confirmDialog(`Delete role "${r.name}"?`, { title: 'Delete role', confirmText: 'Delete', danger: true }))) return
    try { await api.deleteRole(r.id); load() } catch (ex) { setErr(ex.message) }
  }

  return (
    <div>
      {err && <p className="note">{err}</p>}
      {msg && <p className="hint">{msg}</p>}
      <form className="panel" onSubmit={submit}>
        <h4>{form.id ? `Edit role: ${form.name}` : 'Create role'}</h4>
        <div className="toolbar">
          <input placeholder="Role name *" required value={form.name}
                 onChange={e => setForm({ ...form, name: e.target.value })} />
          <label title="Admin roles unlock Agents, Audit, Admin and all admin actions">
            <input type="checkbox" checked={form.is_admin}
                   onChange={e => setForm({ ...form, is_admin: e.target.checked })} /> admin role
          </label>
        </div>
        <div className="weights-grid">
          {pages.map(p => (
            <label key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.pages.includes(p)} onChange={() => togglePage(p)} /> {p}
            </label>
          ))}
        </div>
        <div className="toolbar">
          <button type="submit">{form.id ? 'Save changes' : 'Create role'}</button>
          {form.id && <button type="button" className="ghost" onClick={reset}>Cancel</button>}
        </div>
        <p className="hint">Page access controls which menu items a user with this role sees.
          Admin roles additionally unlock Agents / Audit / Admin and all admin actions.</p>
      </form>

      <table className="data-table">
        <thead><tr><th>Role</th><th>Admin</th><th>Pages</th><th>Users</th><th /></tr></thead>
        <tbody>
          {roles.map(r => (
            <tr key={r.id}>
              <td><strong>{r.name}</strong></td>
              <td>{r.is_admin ? <span className="tag positive">admin</span> : <span className="hint">no</span>}</td>
              <td className="hint">{(r.pages || []).join(', ') || '—'}</td>
              <td>{r.users}</td>
              <td>
                <button className="ghost sm" onClick={() => edit(r)}>Edit</button>{' '}
                <button className="ghost sm" onClick={() => remove(r)} disabled={r.users > 0}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ChatAudit() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  const [email, setEmail] = useState('')
  const [page, setPage] = useState(0)
  const LIMIT = 20
  const load = () => api.chatAudit({ user_email: email, limit: LIMIT, offset: page * LIMIT })
    .then(setData).catch(e => setErr(e.message))
  useEffect(() => { load() }, [page]) // eslint-disable-line
  if (err) return <p className="note">{err}</p>
  if (!data) return <p className="hint">Loading…</p>
  return (
    <div>
      <p className="hint">Every question and AI response is logged here — user, time, the LLM
        provider that answered, confidence and latency — for compliance audit.</p>
      <div className="toolbar">
        <input placeholder="Filter by user email…" value={email}
               onChange={e => setEmail(e.target.value)}
               onKeyDown={e => { if (e.key === 'Enter') { setPage(0); load() } }} />
        <button className="ghost" onClick={() => { setPage(0); load() }}>Search</button>
        <span className="hint">{data.total} messages</span>
      </div>
      <table className="audit-table">
        <thead><tr>
          <th title="When the message was recorded (IST)">Time (IST)</th>
          <th title="Who sent it">User</th>
          <th title="user question or assistant answer">Role</th>
          <th title="Message / response text">Message</th>
          <th title="LLM provider that produced the answer (recorded for audit; hidden from end users)">Provider</th>
          <th title="Grounding confidence">Conf.</th>
          <th title="Response latency (ms)">ms</th>
        </tr></thead>
        <tbody>
          {data.rows.map(r => (
            <tr key={r.id}>
              <td>{fmtIST(r.time)}</td>
              <td className="hint">{r.user}</td>
              <td><span className="tag">{r.role}</span></td>
              <td className="audit-detail" style={{ whiteSpace: 'normal', maxWidth: 460 }}>{r.content}</td>
              <td className="hint">{r.provider || '—'}</td>
              <td>{r.confidence != null ? (r.confidence * 100).toFixed(0) + '%' : '—'}</td>
              <td className="hint">{r.latency_ms ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pager page={page} setPage={setPage} total={data.total} label="messages" />
    </div>
  )
}

function Feedback() {
  const [data, setData] = useState(null)
  const [rating, setRating] = useState(-1)
  const [err, setErr] = useState('')
  const load = () => api.chatFeedback(rating ? { rating } : {}).then(setData).catch(e => setErr(e.message))
  useEffect(() => { load() }, [rating])  // eslint-disable-line
  if (err) return <p className="note">{err}</p>
  if (!data) return <p className="hint">Loading…</p>
  const total = data.up + data.down
  return (
    <div>
      <p className="hint">User ratings on assistant answers. Review the <strong>Not helpful</strong>
        ones to spot patterns and improve grounding/prompts &mdash; fix categories, not single chats.</p>
      <div className="kpi-row">
        <div className="kpi"><span className="kpi-label">Helpful</span><span className="kpi-value">{data.up}</span></div>
        <div className="kpi"><span className="kpi-label">Not helpful</span><span className="kpi-value">{data.down}</span></div>
        <div className="kpi"><span className="kpi-label">Satisfaction</span>
          <span className="kpi-value">{total ? Math.round(data.up / total * 100) + '%' : '—'}</span></div>
      </div>
      <div className="toolbar">
        <span className="hint">Show</span>
        <select value={rating} onChange={e => setRating(Number(e.target.value))}>
          <option value={-1}>Not helpful (to fix)</option>
          <option value={1}>Helpful</option>
          <option value={0}>All</option>
        </select>
        <button className="ghost sm" onClick={load}>Refresh</button>
      </div>
      {data.items.length === 0 && <p className="hint">No feedback in this view yet.</p>}
      {data.items.map(it => (
        <div key={it.id} className="panel">
          <div className="card-head">
            <strong>{it.rating === 1 ? 'Helpful' : 'Not helpful'}</strong>
            <span className="hint">{fmtIST(it.at)}{it.provider ? ' \u00b7 ' + it.provider : ''}</span>
          </div>
          <p style={{ margin: '6px 0 2px' }}><strong>Q:</strong> {it.question || '—'}</p>
          <p className="hint" style={{ whiteSpace: 'pre-wrap' }}><strong>A:</strong> {it.answer || '—'}</p>
        </div>
      ))}
    </div>
  )
}
