import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { mdToHtml } from '../md.js'

const DASH = String.fromCharCode(0x2014)   // em dash
const NDASH = String.fromCharCode(0x2013)  // en dash
const RS = String.fromCharCode(0x20B9)     // rupee

export default function Compare() {
  const [insts, setInsts] = useState([])
  const [cmp, setCmp] = useState({ a: '', b: '' })
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    api.instruments().then(d => setInsts(d.instruments || [])).catch(() => {})
  }, [])

  async function run() {
    const a = cmp.a.trim().toUpperCase(), b = cmp.b.trim().toUpperCase()
    if (!a || !b) { setErr('Enter two symbols'); return }
    if (a === b) { setErr('Choose two different symbols'); return }
    setBusy(true); setErr(''); setRes(null)
    try { setRes(await api.compare(a, b)) }
    catch (e) { setErr(e.message) }
    setBusy(false)
  }

  return (
    <div>
      <p className="hint">Side-by-side comparison of two NSE scripts — live metrics, the
        platform's AI score and an advice-free summary. Informational only, not a recommendation.</p>

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
          <button onClick={run} disabled={busy}>{busy ? 'Comparing…' : 'Compare'}</button>
        </div>
        {err && <p className="note">{err}</p>}
        {res && (() => {
          const A = res.a, B = res.b
          const px = v => v != null ? RS + Number(v).toLocaleString('en-IN') : DASH
          const rng = h => h.week52_low != null ? `${h.week52_low} ${NDASH} ${h.week52_high}` : DASH
          const rows = [
            ['AI score', A.ai_score ?? DASH, B.ai_score ?? DASH],
            ['Last price', px(A.last_price), px(B.last_price)],
            ['Day change', A.change_pct != null ? `${A.change_pct}%` : DASH, B.change_pct != null ? `${B.change_pct}%` : DASH],
            ['P/E', A.pe ?? DASH, B.pe ?? DASH],
            ['52-week range', rng(A), rng(B)],
            ['Sector', A.sector || DASH, B.sector || DASH],
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
              <h4 style={{ marginBottom: 4 }}>Summary</h4>
              <div className="md" dangerouslySetInnerHTML={{ __html: mdToHtml(res.summary) }} />
              <p className="disclaimer">{res.disclaimer}</p>
            </div>
          )
        })()}
      </div>
    </div>
  )
}
