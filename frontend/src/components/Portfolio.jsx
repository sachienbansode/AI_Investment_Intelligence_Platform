import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'

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
  const fileRef = useRef(null)

  useEffect(() => {
    api.instruments().then(d => setAll(d.instruments)).catch(() => {})
    // restore the user's saved holdings
    api.portfolioSaved().then(d => {
      if (d.holdings && d.holdings.length) {
        setRows(d.holdings.map(h => ({ symbol: h.symbol, quantity: h.quantity, avg_price: h.avg_price })))
        setMsg('Loaded your saved portfolio.')
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

  async function analyze() {
    setBusy(true); setErr(''); setMsg(''); setResult(null)
    try {
      const holdings = cleanHoldings()
      if (!holdings.length) throw new Error('Add at least one valid holding')
      await api.savePortfolio(holdings)                 // persist for this user
      setResult(await api.analyzePortfolio(holdings))
    } catch (e) { setErr(e.message) }
    setBusy(false)
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
      <div className="toolbar">
        <button onClick={add}>+ Add holding</button>
        <button onClick={analyze} disabled={busy}>{busy ? 'Analyzing…' : 'Analyze & save portfolio'}</button>
      </div>

      {result && (
        <div className="panel">
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

          <h4>AI insights</h4>
          <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(result.insights) }} />
          <p className="disclaimer">{result.disclaimer}</p>
        </div>
      )}
    </div>
  )
}
