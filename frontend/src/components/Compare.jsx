import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'
import WatchButton from './WatchButton.jsx'

const DASH = String.fromCharCode(0x2014)   // em dash
const NDASH = String.fromCharCode(0x2013)  // en dash
const RS = String.fromCharCode(0x20B9)     // rupee
const MAX = 5

export default function Compare({ scoreLabel = 'NIYTRI Score' }) {
  const [insts, setInsts] = useState([])
  const [syms, setSyms] = useState(['', ''])
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.instruments().then(d => setInsts(d.instruments || [])).catch(() => {})
  }, [])

  const setAt = (i, v) => setSyms(s => s.map((x, j) => (j === i ? v.toUpperCase() : x)))
  const addField = () => setSyms(s => (s.length < MAX ? [...s, ''] : s))
  const removeField = i => setSyms(s => (s.length > 2 ? s.filter((_, j) => j !== i) : s))

  async function run() {
    const list = [...new Set(syms.map(s => s.trim().toUpperCase()).filter(Boolean))]
    if (list.length < 2) { setErr('Enter at least two different symbols'); return }
    setBusy(true); setErr(''); setRes(null)
    try { setRes(await api.compareMulti(list)) }
    catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function runRandom() {
    setBusy(true); setErr(''); setRes(null)
    try {
      const r = await api.compareRandom()           // returns { a, b, summary }
      setSyms([r.a.symbol, r.b.symbol])
      setRes({ stocks: [r.a, r.b], summary: r.summary })
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  const stocks = res?.stocks || []

  return (
    <div>
      <p className="hint">Side-by-side comparison of up to {MAX} NSE scripts {NDASH} live metrics, the
        platform's {scoreLabel} and an advice-free summary. Informational only, not a recommendation.</p>

      <div className="panel compare-panel">
        <datalist id="cmp-inst">
          {insts.map(i => <option key={i.symbol} value={i.symbol}>{i.name}</option>)}
        </datalist>

        <div className="cmp-fields">
          {syms.map((v, i) => (
            <div className="cmp-field" key={i}>
              <input list="cmp-inst" placeholder={`Stock ${String.fromCharCode(65 + i)}${i < 2 ? (i === 0 ? ' (e.g. RELIANCE)' : ' (e.g. TCS)') : ''}`}
                     value={v} onChange={e => setAt(i, e.target.value)}
                     onKeyDown={e => { if (e.key === 'Enter') run() }} />
              {syms.length > 2 && (
                <button className="cmp-x" title="Remove" onClick={() => removeField(i)}>{String.fromCharCode(0xD7)}</button>
              )}
            </div>
          ))}
          {syms.length < MAX && (
            <button className="ghost sm cmp-add" onClick={addField} title="Add another stock">+ Add stock</button>
          )}
        </div>

        <div className="toolbar" style={{ marginTop: 10 }}>
          <button onClick={run} disabled={busy}>{busy ? 'Comparing…' : 'Compare'}</button>
          <button className="ghost" onClick={runRandom} disabled={busy}
                  title="Compare two random Nifty 500 stocks from the same sector">Compare random (Nifty 500)</button>
        </div>

        {err && <p className="note">{err}</p>}

        {stocks.length > 0 && (() => {
          const px = v => v != null ? RS + Number(v).toLocaleString('en-IN') : DASH
          const mcap = v => v != null ? RS + Math.round(v / 1e7).toLocaleString('en-IN') + ' Cr' : DASH
          const rng = h => h.week52_low != null ? `${h.week52_low} ${NDASH} ${h.week52_high}` : DASH
          const metrics = [
            [scoreLabel, s => s.ai_score ?? DASH],
            ['Last price', s => px(s.last_price)],
            ['Day change', s => s.change_pct != null ? `${s.change_pct}%` : DASH],
            ['P/E', s => s.pe != null ? Number(s.pe).toFixed(1) : DASH],
            ['Market cap', s => mcap(s.market_cap)],
            ['52-week range', s => rng(s)],
            ['Sector', s => s.sector || DASH],
          ]
          return (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table compare-table">
                <thead>
                  <tr>
                    <th>Metric</th>
                    {stocks.map(s => (
                      <th key={s.symbol}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>
                          {s.symbol}<WatchButton symbol={s.symbol} variant="icon" />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {metrics.map(([label, get], i) => (
                    <tr key={i}>
                      <td className="hint">{label}</td>
                      {stocks.map(s => <td key={s.symbol}><strong>{get(s)}</strong></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
              <h4 style={{ marginBottom: 4 }}>Summary</h4>
              <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(res.summary) }} />
            </div>
          )
        })()}
      </div>
    </div>
  )
}
