import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'

export default function Portfolio() {
  const [rows, setRows] = useState([{ symbol: 'RELIANCE', quantity: 10, avg_price: 2500 }])
  const [all, setAll] = useState([])
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.instruments().then(d => setAll(d.instruments)).catch(() => {})
  }, [])

  const update = (i, k, v) => setRows(r => r.map((row, j) => j === i ? { ...row, [k]: v } : row))
  const add = () => setRows(r => [...r, { symbol: '', quantity: 1, avg_price: 0 }])
  const remove = i => setRows(r => r.filter((_, j) => j !== i))

  async function analyze() {
    setBusy(true); setErr(''); setResult(null)
    try {
      const holdings = rows
        .filter(r => r.symbol && r.quantity > 0 && r.avg_price > 0)
        .map(r => ({ symbol: r.symbol.toUpperCase(), quantity: +r.quantity, avg_price: +r.avg_price }))
      if (!holdings.length) throw new Error('Add at least one valid holding')
      setResult(await api.analyzePortfolio(holdings))
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div>
      <p className="hint">Search and add your holdings (demo). In production this connects to the
        customer's holdings via the broker back office with consent.</p>

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
        <button onClick={analyze} disabled={busy}>{busy ? 'Analyzing…' : 'Analyze portfolio'}</button>
      </div>
      {err && <p className="note">{err}</p>}

      {result && (
        <div className="panel">
          <h3 title="Portfolio health out of 100. Starts at 100; loses points for concentration and lack of diversification — see the deduction breakdown below.">
            Health score: {result.health_score}/100 <span className="info-i">i</span></h3>

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
