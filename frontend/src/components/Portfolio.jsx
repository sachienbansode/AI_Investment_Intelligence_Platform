import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'

const RS = String.fromCharCode(0x20B9)
const bandColor = v => v == null ? 'var(--muted)' : v >= 65 ? 'var(--green)' : v >= 50 ? 'var(--amber)' : 'var(--red)'
const PIE = ['#f94c00', '#ff8a3d', '#12a06b', '#c07d0a', '#4f8ef7', '#7c5cfc', '#e0503f', '#2f6fe0']
const inr = v => RS + Math.round(v).toLocaleString('en-IN')

// Compact donut + legend for sector allocation.
function PieMini({ data }) {
  const total = data.reduce((a, [, v]) => a + v, 0) || 1
  let acc = 0
  const R = 70, r0 = 40, C = 80
  const segs = data.map(([lab, v], i) => {
    const a0 = acc / total * 2 * Math.PI; acc += v
    const a1 = acc / total * 2 * Math.PI
    const large = a1 - a0 > Math.PI ? 1 : 0
    const p = (rad, ang) => [C + rad * Math.sin(ang), C - rad * Math.cos(ang)]
    const [x0, y0] = p(R, a0), [x1, y1] = p(R, a1), [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0)
    return <path key={i} d={`M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${large} 0 ${x3},${y3} Z`}
                 fill={PIE[i % PIE.length]} stroke="var(--panel)" strokeWidth="1" />
  })
  return (
    <div className="pie-wrap">
      <svg viewBox="0 0 160 160" className="pie-svg">{segs}</svg>
      <div className="pie-legend">
        {data.map(([lab, v], i) => (
          <div key={lab}><i style={{ background: PIE[i % PIE.length] }} />{lab} <b>{v}%</b></div>
        ))}
      </div>
    </div>
  )
}

// Horizontal score bars for each holding (coloured by NIYTRI band).
function HoldingScoreBars({ holdings }) {
  const scored = holdings.filter(h => h.score != null)
  if (!scored.length) return <p className="hint">No NIYTRI Scores available for these holdings yet.</p>
  return (
    <div className="pillar-chart">
      {scored.map(h => (
        <div key={h.symbol} className="pillar">
          <span>{h.symbol}</span>
          <div className="bar"><div style={{ width: h.score + '%', background: bandColor(h.score) }} /></div>
          <span>{h.score}</span>
        </div>
      ))}
    </div>
  )
}

export default function Portfolio() {
  const [rows, setRows] = useState([{ symbol: 'RELIANCE', quantity: 10, avg_price: 2500 }])
  const [all, setAll] = useState([])
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [summary, setSummary] = useState(null)   // upload validation summary
  const [uploading, setUploading] = useState(false)
  const [tplBusy, setTplBusy] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [showEditor, setShowEditor] = useState(true)   // collapse holdings editor after analysis
  const [shareOpen, setShareOpen] = useState(false)
  const [shareBusy, setShareBusy] = useState(false)
  const shareLink = useRef(null)
  const reportRef = useRef(null)
  const fileRef = useRef(null)

  useEffect(() => {
    api.instruments().then(d => setAll(d.instruments)).catch(() => {})
    // restore the user's saved holdings
    api.portfolioSaved().then(d => {
      if (d.holdings && d.holdings.length) {
        const saved = d.holdings.map(h => ({ symbol: h.symbol, quantity: h.quantity, avg_price: h.avg_price }))
        setRows(saved)
        setMsg('Loaded your saved portfolio — showing your last analysis.')
        runAnalysis(saved, { persist: false })   // restore the prior analysis view
      }
    }).catch(() => {})
  }, [])

  const update = (i, k, v) => setRows(r => r.map((row, j) => j === i ? { ...row, [k]: v } : row))
  const add = () => setRows(r => [...r, { symbol: '', quantity: 1, avg_price: 0 }])
  const remove = i => setRows(r => r.filter((_, j) => j !== i))

  function cleanHoldings() {
    return rows
      .filter(r => r.symbol && r.quantity > 0 && r.avg_price > 0)
      .map(r => ({ symbol: r.symbol.toUpperCase(), quantity: +r.quantity, avg_price: +r.avg_price }))
  }

  async function runAnalysis(holdings, { persist = true } = {}) {
    setBusy(true); setErr(''); setResult(null)
    try {
      if (!holdings.length) throw new Error('Add at least one valid holding')
      if (persist) await api.savePortfolio(holdings)    // persist for this user
      setResult(await api.analyzePortfolio(holdings))
      shareLink.current = null                          // new analysis -> new share link
      setShowEditor(false)                              // collapse editor, focus the report
      setTimeout(() => reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  // ---- share this analysis (public link / WhatsApp / Email / PDF) -----------
  function shareText() {
    const ps = result?.portfolio_score || {}, v = result?.verdict || {}
    let md = `> ${v.label || 'Portfolio analysis'} — health **${result.health_score}/100**`
    if (ps.weighted_score != null) md += `, NIYTRI Score **${ps.weighted_score}**`
    md += '.\n\n'
    if (v.strengths?.length) md += '**Strengths**\n' + v.strengths.map(s => '- ' + s).join('\n') + '\n\n'
    if (v.watchouts?.length) md += '**Watch-outs**\n' + v.watchouts.map(s => '- ' + s).join('\n') + '\n\n'
    if (result.holdings?.length) {
      md += '| Symbol | Weight | P&L | NIYTRI |\n|---|---|---|---|\n'
      md += result.holdings.map(h => `| ${h.symbol} | ${h.weight_pct}% | ${h.pnl_pct}% | ${h.score ?? '—'} |`).join('\n') + '\n'
    }
    return md
  }
  function shareCharts() {
    const charts = []
    const sec = Object.entries(result.sector_exposure || {}).sort((a, b) => b[1] - a[1])
    if (sec.length) charts.push({ src: 'data', kind: 'pie', real: true, title: 'Sector Allocation', x: sec.map(s => s[0]), y: sec.map(s => s[1]) })
    const scored = (result.holdings || []).filter(h => h.score != null)
    if (scored.length) charts.push({ src: 'data', kind: 'bar', real: true, title: 'NIYTRI Score by Holding', x: scored.map(h => h.symbol), y: scored.map(h => h.score) })
    return charts
  }
  async function ensureShare() {
    if (shareLink.current) return shareLink.current
    const r = await api.shareCreate('My portfolio analysis', shareText(), shareCharts())
    shareLink.current = r; return r
  }
  const shareWrap = async fn => { setShareBusy(true); try { await fn() } catch (e) { setErr(e.message) } finally { setShareBusy(false); setShareOpen(false) } }
  const shareWhatsApp = () => shareWrap(async () => { const r = await ensureShare(); window.open('https://wa.me/?text=' + encodeURIComponent((r.intro || '') + '\n\n' + r.url), '_blank') })
  const shareEmail = () => shareWrap(async () => { const r = await ensureShare(); window.location.href = 'mailto:?subject=' + encodeURIComponent('My portfolio analysis') + '&body=' + encodeURIComponent((r.intro || '') + '\n\n' + r.url) })
  const shareCopy = () => shareWrap(async () => { const r = await ensureShare(); try { await navigator.clipboard.writeText(r.url) } catch {} })

  async function analyze() {
    setMsg('')
    await runAnalysis(cleanHoldings())
  }

  async function onUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true); setErr(''); setMsg(''); setSummary(null)
    try {
      setSummary(await api.portfolioUpload(file))
    } catch (ex) { setErr(ex.message) }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function downloadTemplate() {
    setTplBusy(true); setErr('')
    try { await api.downloadPortfolioTemplate() } catch (e) { setErr(e.message) }
    setTplBusy(false)
  }

  async function downloadPdf() {
    setPdfBusy(true); setErr('')
    try {
      const holdings = cleanHoldings()
      if (!holdings.length) throw new Error('Add at least one valid holding')
      await api.downloadPortfolioPdf(holdings)
    } catch (e) { setErr(e.message) }
    setPdfBusy(false)
  }

  function continueWithMatched() {
    setRows(summary.matched.map(h => ({ symbol: h.symbol, quantity: h.quantity, avg_price: h.avg_price })))
    setSummary(null)
    setMsg(`Loaded ${summary.matched.length} matched holding(s). Review and click Analyze.`)
  }

  return (
    <div>
      <p className="hint">Add holdings manually, or upload a CSV/Excel of your portfolio. In
        production this connects to the customer's holdings via the broker back office with consent.
        Your holdings are saved to your account and restored on your next visit.</p>

      <div className="toolbar">
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" onChange={onUpload} />
        <button className="ghost" disabled={uploading} onClick={() => fileRef.current?.click()}>
          {uploading ? 'Reading…' : 'Upload portfolio (CSV/Excel)'}</button>
        <button className="ghost" disabled={tplBusy} onClick={downloadTemplate}
                title="Download a CSV of all NIFTY500 scripts with current LTP pre-filled in avg_price — edit quantities and re-upload">
          {tplBusy ? 'Preparing…' : 'Download CSV template (all scripts + LTP)'}</button>
        <span className="hint">Columns: <code>symbol, quantity, avg_price</code></span>
      </div>
      {err && <p className="note">{err}</p>}
      {msg && <p className="hint">{msg}</p>}

      {summary && (
        <div className="panel">
          <h4>Upload summary</h4>
          <p className="hint">{summary.counts.matched} of {summary.counts.total} holdings matched the
            instruments master (NIFTY500). {summary.counts.unmatched > 0 &&
            `${summary.counts.unmatched} could not be matched and will be skipped.`}</p>
          {summary.unmatched.length > 0 && (
            <table className="data-table">
              <thead><tr><th>Symbol</th><th>Qty</th><th>Avg price</th><th>Why skipped</th></tr></thead>
              <tbody>
                {summary.unmatched.map((u, i) => (
                  <tr key={i}><td><strong>{u.symbol || '—'}</strong></td><td>{u.quantity}</td>
                    <td>{u.avg_price}</td><td className="down">{u.reason}</td></tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="toolbar">
            <button onClick={continueWithMatched} disabled={summary.counts.matched === 0}>
              Continue with {summary.counts.matched} matched holding(s)</button>
            <button className="ghost" onClick={() => setSummary(null)}>Cancel</button>
          </div>
        </div>
      )}

      {showEditor && (
        <>
          <datalist id="pf-inst">
            {all.map(i => <option key={i.symbol} value={i.symbol}>{i.name} · {i.sector}</option>)}
          </datalist>

          <table className="holdings">
            <thead><tr>
              <th title="NSE trading symbol — type to search the instruments master">Symbol (NSE)</th>
              <th title="Number of shares you hold">Qty</th>
              <th title="Your average buy price per share in rupees">Avg price ₹</th>
              <th />
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><input list="pf-inst" value={r.symbol} placeholder="Type to search…"
                             onChange={e => update(i, 'symbol', e.target.value.toUpperCase())} /></td>
                  <td><input type="number" value={r.quantity} onChange={e => update(i, 'quantity', e.target.value)} /></td>
                  <td><input type="number" value={r.avg_price} onChange={e => update(i, 'avg_price', e.target.value)} /></td>
                  <td><button className="ghost" onClick={() => remove(i)} title="Remove this holding">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="toolbar"><button onClick={add}>+ Add holding</button></div>
        </>
      )}

      <div className="toolbar">
        {result && (
          <button className="ghost" onClick={() => setShowEditor(s => !s)}>
            {showEditor ? '▲ Hide holdings' : `▾ Edit holdings (${rows.length})`}</button>
        )}
        <button onClick={analyze} disabled={busy}>{busy ? 'Analyzing…' : 'Analyze & save portfolio'}</button>
        {result && (
          <button className="ghost" onClick={downloadPdf} disabled={pdfBusy}
                  title="Download a shareable PDF of this analysis for your client">
            {pdfBusy ? 'Preparing PDF…' : '⤓ Export as PDF'}</button>
        )}
        {result && (
          <div className="share-wrap">
            <button className="ghost share-btn" title="Share analysis" aria-label="Share" disabled={shareBusy}
                    onClick={() => setShareOpen(o => !o)}>
              {shareBusy ? '…' : (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                  <line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" />
                </svg>
              )}
            </button>
            {shareOpen && (
              <div className="share-menu down">
                <button onClick={shareWhatsApp}>WhatsApp</button>
                <button onClick={shareEmail}>Email</button>
                <button onClick={shareCopy}>Copy link</button>
                <button onClick={() => { setShareOpen(false); downloadPdf() }}>Download PDF</button>
              </div>
            )}
          </div>
        )}
      </div>

      {result && (
        <div className="panel" ref={reportRef}>
          <h3 title="Portfolio health out of 100. Starts at 100; loses points for concentration and lack of diversification — see the deduction breakdown below.">
            Health score: {result.health_score}/100 <span className="info-i">i</span></h3>

          {result.status && (
            <div className="toolbar" style={{ margin: '0 0 8px' }}>
              <span className={`tag ${result.status === 'green' ? 'positive' : result.status === 'red' ? 'negative' : 'pending'}`}>
                {result.status === 'green' ? '● ' : result.status === 'red' ? '● ' : '● '}{result.status_label}</span>
              {result.pnl && result.pnl.invested != null && (
                <span className={result.pnl.pnl >= 0 ? 'up' : 'down'}
                      title="Approximate — based on the latest available prices vs your average cost">
                  Est. P&L: {result.pnl.pnl >= 0 ? '+' : '−'}₹{Math.abs(Math.round(result.pnl.pnl)).toLocaleString('en-IN')} ({result.pnl.pnl_pct}%)
                </span>
              )}
              {result.pnl && result.pnl.invested != null && (
                <span className="hint">Invested ₹{Math.round(result.pnl.invested).toLocaleString('en-IN')} · Current ₹{Math.round(result.pnl.current_value).toLocaleString('en-IN')}</span>
              )}
            </div>
          )}
          {result.headline && <p className="hint" style={{ marginTop: 0, marginBottom: 12 }}>{result.headline}</p>}

          {result.portfolio_score && result.portfolio_score.weighted_score != null && (
            <div className="pf-scorecard">
              <div className="pf-score-big" style={{ background: bandColor(result.portfolio_score.weighted_score) }}>
                {result.portfolio_score.weighted_score}
                <small>NIYTRI Score</small>
              </div>
              <div className="pf-score-meta">
                <div className="pf-score-label" style={{ color: bandColor(result.portfolio_score.weighted_score) }}>
                  {result.portfolio_score.band === 'strong' ? 'Strong quality' : result.portfolio_score.band === 'weak' ? 'Weak quality' : 'Neutral quality'}
                </div>
                <div className="pf-bandbar" title="Share of portfolio value by NIYTRI Score band">
                  {['strong', 'neutral', 'weak'].map(b => {
                    const w = result.portfolio_score.band_weight_pct?.[b] || 0
                    const c = b === 'strong' ? 'var(--green)' : b === 'neutral' ? 'var(--amber)' : 'var(--red)'
                    return w > 0 ? <span key={b} style={{ width: w + '%', background: c }} title={`${b}: ${w}%`} /> : null
                  })}
                </div>
                <div className="hint">
                  Strong <b>{result.portfolio_score.band_weight_pct?.strong || 0}%</b> ·
                  Neutral <b>{result.portfolio_score.band_weight_pct?.neutral || 0}%</b> ·
                  Weak <b>{result.portfolio_score.band_weight_pct?.weak || 0}%</b> · Coverage {result.portfolio_score.coverage_pct}%
                </div>
              </div>
            </div>
          )}

          {result.verdict && (result.verdict.strengths?.length > 0 || result.verdict.watchouts?.length > 0) && (
            <div className="pf-verdict">
              <div className="pf-vcol">
                <h4 className="up">Strengths</h4>
                <ul>{(result.verdict.strengths || []).map((t, i) =>
                  <li key={i} dangerouslySetInnerHTML={{ __html: mdToHtml(t).replace(/^<p>|<\/p>$/g, '') }} />)}
                  {(!result.verdict.strengths || !result.verdict.strengths.length) && <li className="hint">—</li>}
                </ul>
              </div>
              <div className="pf-vcol">
                <h4 className="down">Watch-outs</h4>
                <ul>{(result.verdict.watchouts || []).map((t, i) =>
                  <li key={i} dangerouslySetInnerHTML={{ __html: mdToHtml(t).replace(/^<p>|<\/p>$/g, '') }} />)}
                  {(!result.verdict.watchouts || !result.verdict.watchouts.length) && <li className="hint">—</li>}
                </ul>
              </div>
            </div>
          )}

          {result.deductions?.length > 0 && (
            <div className="deductions">
              <h4 title="Exactly why points were deducted from 100">Why this score? <span className="info-i">i</span></h4>
              <ul>
                {result.deductions.map((d, i) => (
                  <li key={i}><span className="down">−{d.points}</span> {d.reason}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid2">
            <div>
              <h4 title="How spread out your portfolio is. Effective holdings = 1/HHI; equal-weight portfolios equal their holding count.">Diversification <span className="info-i">i</span></h4>
              <ul>
                <li>Holdings: {result.diversification.num_holdings}</li>
                <li>Sectors: {result.diversification.num_sectors}</li>
                <li>Effective holdings: {result.diversification.effective_holdings}</li>
              </ul>
              <h4 title="HHI (Herfindahl-Hirschman Index) = sum of squared holding weights. 0–0.15 low, 0.15–0.30 moderate, above 0.30 high.">Concentration risk: {result.concentration_risk.level} <span className="info-i">i</span></h4>
              <ul>
                <li>Top holding: {result.concentration_risk.top_holding} ({result.concentration_risk.top_holding_weight_pct}%)</li>
                <li>HHI: {result.concentration_risk.herfindahl_index}</li>
              </ul>
            </div>
            <div>
              <h4 title="Percentage of portfolio value per sector (from your input, the data feed, or the instruments master)">Sector exposure <span className="info-i">i</span></h4>
              <ul>
                {Object.entries(result.sector_exposure).map(([s, p]) => <li key={s}>{s}: {p}%</li>)}
              </ul>
            </div>
          </div>

          <div className="grid2" style={{ marginTop: 6 }}>
            <div>
              <h4>Sector allocation</h4>
              {Object.keys(result.sector_exposure || {}).length > 0
                ? <PieMini data={Object.entries(result.sector_exposure).sort((a, b) => b[1] - a[1])} />
                : <p className="hint">No sector data.</p>}
            </div>
            <div>
              <h4 title="Each holding's latest NIYTRI Score (green ≥65, amber 50–64, red <50)">NIYTRI Score by holding</h4>
              {result.holdings ? <HoldingScoreBars holdings={result.holdings} /> : null}
            </div>
          </div>

          {result.holdings?.length > 0 && (
            <>
              <h4>Holdings</h4>
              <div className="md-table-wrap">
                <table className="md-table">
                  <thead><tr><th>Symbol</th><th style={{ textAlign: 'right' }}>Weight</th>
                    <th style={{ textAlign: 'right' }}>Value</th><th style={{ textAlign: 'right' }}>P&L</th>
                    <th>Sector</th><th style={{ textAlign: 'right' }}>NIYTRI Score</th></tr></thead>
                  <tbody>
                    {result.holdings.map(h => (
                      <tr key={h.symbol}>
                        <td><strong>{h.symbol}</strong></td>
                        <td style={{ textAlign: 'right' }}>{h.weight_pct}%</td>
                        <td style={{ textAlign: 'right' }}>{inr(h.value)}</td>
                        <td style={{ textAlign: 'right' }} className={h.pnl_pct >= 0 ? 'up' : 'down'}>
                          {h.pnl_pct >= 0 ? '+' : ''}{h.pnl_pct}%</td>
                        <td>{h.sector}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: bandColor(h.score) }}>
                          {h.score != null ? h.score : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          <h4>AI insights</h4>
          <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(result.insights) }} />
          <p className="disclaimer">{result.disclaimer}</p>
        </div>
      )}
    </div>
  )
}
