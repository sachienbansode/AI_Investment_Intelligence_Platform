import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'

const AGENT_LABELS = {
  market_data_agent: 'Market Data Agent',
  financial_data_agent: 'Financial Data Agent',
  news_agent: 'News Agent',
  sentiment_agent: 'Sentiment Agent',
  scoring_agent: 'Scoring Agent',
  explainability_agent: 'Explainability Agent',
  ai_checker_agent: 'AI Checker Agent',
  quality_agent: 'Quality Agent',
  publishing_agent: 'Publishing Agent',
}

const PIPELINE_INFO = [
  { key: 'market_data_agent', name: '1 · Market Data Agent',
    does: 'Fetches a live quote for every script in the scoring universe — price, day change, 52-week range, volume, P/E where available. Runs 8 fetches in parallel with automatic failover: licensed broker feed → NSE → Yahoo.',
    needs: 'The instruments master (DB) — which scripts to score.',
    why: 'First because everything downstream is computed from these numbers; with no quote, a script cannot be scored.' },
  { key: 'financial_data_agent', name: '2 · Financial Data Agent',
    does: 'Enriches each quote with fundamentals (P/E, sector). This is the extension point for corporate filings, earnings and institutional-holdings feeds.',
    needs: 'The quote set from stage 1 — it enriches those objects in place.',
    why: 'Cannot enrich quotes that have not been fetched yet.' },
  { key: 'news_agent', name: '3 · News Agent',
    does: 'Collects and de-duplicates headlines from Indian financial RSS sources (Economic Times, Moneycontrol, LiveMint, Business Standard).',
    needs: 'Nothing from earlier stages — only external news sources.',
    why: 'Technically independent of stages 1–2 and could run in parallel; it is kept in sequence so every run is deterministic and each handoff is auditable in order.' },
  { key: 'sentiment_agent', name: '4 · Sentiment Agent',
    does: 'An LLM reads the collected headlines and counts positive / negative / neutral coverage per script.',
    needs: 'The headlines from stage 3 and the script list from stage 1.',
    why: 'No headlines, nothing to classify — strict dependency on the News Agent.' },
  { key: 'scoring_agent', name: '5 · Scoring Agent',
    does: 'Computes the 8 pillar values — technicals, valuation, momentum and risk from the quote data; news sentiment from stage 4 — and applies the proprietary weighted composite (0–100). Pure deterministic math, no LLM.',
    needs: 'Quotes + fundamentals (1–2) and sentiment counts (4).',
    why: 'It is the convergence point: every pillar input must exist before the composite can be calculated.' },
  { key: 'explainability_agent', name: '6 · Explainability Agent',
    does: 'An LLM writes the bullet-point rationale for each script from its final pillars and quote — 5 scripts at a time in parallel.',
    needs: 'The finished scores from stage 5.',
    why: 'A rationale must describe the final numbers — explaining a score before it exists would invite hallucination.' },
  { key: 'quality_agent', name: '7 · Quality Agent',
    does: 'The automated checker: validates every score and pillar is in range (0–100) and every rationale is present, then marks each record approved or rejected. Rule-based — it cannot be persuaded by an LLM.',
    needs: 'Completed scores (5) and rationales (6).',
    why: 'Maker-checker separation: validation must happen on finished output, by a different agent than the one that produced it.' },
  { key: 'publishing_agent', name: '8 · Publishing Agent',
    does: 'Stores the validated results to the database, replacing that day\'s previous values. Only from here do scores reach the UI, APIs and AI Assistant.',
    needs: 'Quality verdicts from stage 7.',
    why: 'Last by design: nothing unvalidated is ever visible to a customer.' },
]

const CARD_TIPS = Object.fromEntries(PIPELINE_INFO.map(p =>
  [p.key, `${p.does}\n\nDepends on: ${p.needs}`]))

import { fmtIST, fmtDur } from '../fmt.js'
const fmtTime = fmtIST

export default function Agents() {
  const [s, setS] = useState(null)
  const [err, setErr] = useState('')
  const timer = useRef(null)

  async function load() {
    try {
      const d = await api.agentsStatus()
      setS(d); setErr('')
      clearTimeout(timer.current)
      timer.current = setTimeout(load, d.running ? 2000 : 15000)
    } catch (e) { setErr(e.message) }
  }
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [forceFull, setForceFull] = useState(false)
  async function runScoring() {
    setBusy('score'); setMsg('')
    try {
      const r = await api.runScoring(forceFull)
      setMsg(`Scoring started - ${r.mode || 'running'}. Watch the agents below.`)
      load()
    } catch (e) { setMsg(e.message) }
    setBusy('')
  }
  async function refreshNews() {
    setBusy('news'); setMsg('')
    try { await api.refreshNewsNow(); setMsg('News refreshed.') }
    catch (e) { setMsg(e.message) }
    setBusy('')
  }

  useEffect(() => { load(); return () => clearTimeout(timer.current) }, [])

  if (err) return <p className="note">{err}</p>
  if (!s) return <p className="hint">Loading…</p>

  const run = s.current || s.last
  const runningCount = s.active_agents.length

  return (
    <div>
      <div className="agent-banner panel">
        <div>
          <span className={`pulse ${s.running ? 'on' : ''}`} />
          <strong>{s.running
            ? `Pipeline running — ${runningCount} bot${runningCount === 1 ? '' : 's'} active: ${s.active_agents.map(a => AGENT_LABELS[a] || a).join(', ')}`
            : 'Pipeline idle'}</strong>
        </div>
        <div className="hint">
          {s.running && run
            ? `Run ${run.run_id} · ${run.symbols.length} scripts · started ${fmtTime(run.started)}`
            : s.last ? `Last run ${s.last.run_id} (${s.last.status}) · ${s.last.symbols.length} scripts` : 'No runs yet'}
        </div>
      </div>

      <div className="panel">
        <div className="toolbar" style={{ margin: 0 }}>
          <button onClick={runScoring} disabled={!!busy || s.running}>
            {busy === 'score' ? 'Starting…' : 'Run scoring pipeline'}</button>
          <button className="ghost" onClick={refreshNews} disabled={!!busy}>
            {busy === 'news' ? 'Refreshing…' : 'Refresh news'}</button>
          <label className="hint" title="Re-score every script in scope, even ones already scored today (higher cost). Off = only missing/failed scripts are re-run.">
            <input type="checkbox" checked={forceFull} onChange={e => setForceFull(e.target.checked)} /> Force full re-score
          </label>
          {msg && <span className="hint">{msg}</span>}
        </div>
        <p className="hint" style={{ marginTop: 8 }}>Run the full agentic scoring pipeline on
          demand, or pull the latest market news now. Scoring is disabled while a run is in progress.</p>
      </div>

      {run && (
        <div className="agent-grid">
          {run.agents.map(a => (
            <div key={a.name} className={`agent-card ${a.status}`} title={CARD_TIPS[a.name]}>
              <div className="agent-head">
                <strong>{AGENT_LABELS[a.name] || a.name}</strong>
                <span className={`tag ${a.status}`}>{a.status}</span>
              </div>
              <div className="hint">{a.detail || (a.status === 'pending' ? 'waiting…' : 'working…')}</div>
              {a.progress && a.progress.total > 0 && (
                <div className="bar slim" style={{ marginTop: 8 }}
                     title={`${a.progress.done} of ${a.progress.total} done`}>
                  <div style={{ width: `${Math.round(a.progress.done / a.progress.total * 100)}%`,
                                background: 'var(--accent)' }} />
                </div>
              )}
              <div className="agent-times">
                {fmtTime(a.started)} {a.finished ? `→ ${fmtTime(a.finished)} (${fmtDur(a.started, a.finished)})` : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      <details className="panel pipeline-info" style={{ marginTop: 16 }}>
        <summary><strong>How the pipeline works</strong> — what each stage does and why the order matters</summary>
        <p className="hint" style={{ marginTop: 10 }}>
          The 8 agents form a dependency chain: each consumes the previous stage's output,
          which is why they run in sequence — you can't score before you have data, can't
          explain before you score, and can't publish before validation. Parallelism happens
          <em> inside</em> stages (8 quote fetchers, 5 concurrent rationale writers), and every
          handoff is written to the audit log so any published score can be traced end-to-end.
        </p>
        <div className="pipeline-steps">
          {PIPELINE_INFO.map(p => (
            <div key={p.key} className="pipeline-step">
              <h4>{p.name}</h4>
              <p><strong>What it does:</strong> {p.does}</p>
              <p><strong>Needs:</strong> {p.needs}</p>
              <p><strong>Why this position:</strong> {p.why}</p>
            </div>
          ))}
        </div>
      </details>

      <div className="grid2" style={{ marginTop: 16 }}>
        <div className="panel">
          <h4>Scheduled bots</h4>
          <ul>
            {s.scheduled_jobs.map(j => (
              <li key={j.id}><strong>{j.id}</strong> — {j.frequency}<br />
                <span className="hint">next run: {fmtIST(j.next_run)} IST</span></li>
            ))}
          </ul>
          <h4>Engines</h4>
          <ul>
            <li>LLM providers: {s.llm_providers.join(', ')}</li>
            <li>Market data: {s.market_data_providers.join(', ')}</li>
          </ul>
        </div>
        <div className="panel">
          <h4>Run history</h4>
          {s.history.length === 0 && <p className="hint">No completed runs this session.</p>}
          <ul>
            {s.history.map(h => (
              <li key={h.run_id}>
                {h.run_id} · {h.status} · {h.symbols_count} scripts · {fmtTime(h.started)} ({fmtDur(h.started, h.finished)})
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}
