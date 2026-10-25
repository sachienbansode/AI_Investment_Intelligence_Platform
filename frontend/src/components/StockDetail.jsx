import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { idxTag, mdToHtml } from '../md.js'

// ── Global stock search (topbar). Loads the instrument universe once, filters by
//    symbol OR company name, opens the detail page. ──────────────────────────
export function StockSearch({ onPick }) {
  const [q, setQ] = useState('')
  const [all, setAll] = useState([])
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  const box = useRef(null)

  useEffect(() => {
    api.instruments().then(d => setAll(d.instruments || [])).catch(() => {})
  }, [])
  useEffect(() => {
    function away(e) { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', away); return () => document.removeEventListener('mousedown', away)
  }, [])

  const term = q.trim().toLowerCase()
  const matches = !term ? [] : all.filter(i =>
    i.symbol.toLowerCase().includes(term) || (i.name || '').toLowerCase().includes(term)
  ).sort((a, b) => {
    const as = a.symbol.toLowerCase().startsWith(term) ? 0 : 1
    const bs = b.symbol.toLowerCase().startsWith(term) ? 0 : 1
    return as - bs
  }).slice(0, 8)

  function pick(sym) { setQ(''); setOpen(false); onPick(sym) }
  function onKey(e) {
    if (!matches.length) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi(h => Math.min(h + 1, matches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(matches[hi].symbol) }
    else if (e.key === 'Escape') setOpen(false)
  }

  return (
    <div className="stk-search" ref={box}>
      <span className="stk-search-ic">{String.fromCharCode(0x1F50D)}</span>
      <input value={q} placeholder="Search stocks…" aria-label="Search stocks"
             onFocus={() => setOpen(true)} onChange={e => { setQ(e.target.value); setOpen(true); setHi(0) }}
             onKeyDown={onKey} />
      {open && matches.length > 0 && (
        <div className="stk-drop">
          {matches.map((m, i) => (
            <div key={m.symbol} className={'stk-opt' + (i === hi ? ' hi' : '')}
                 onMouseEnter={() => setHi(i)} onMouseDown={() => pick(m.symbol)}>
              <b>{m.symbol}</b><span>{m.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const RANGES = ['1D', '1W', '1M', '3M', '6M', '1Y', '3Y']

function fmt(v, opt = {}) {
  if (v == null || v === '' || Number.isNaN(v)) return '—'
  const n = Number(v)
  if (opt.pct) return n.toFixed(2) + '%'
  if (opt.cr) return n >= 1e7 ? (n / 1e7).toLocaleString('en-IN', { maximumFractionDigits: 0 }) + ' Cr'
                              : n.toLocaleString('en-IN')
  if (opt.int) return Math.round(n).toLocaleString('en-IN')
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
}

// The score explanation comes as one run-on string with inline " - " bullet
// separators; split each onto its own line so markdown renders real bullets.
function fmtExplanation(t) {
  return String(t || '')
    .replace(/\s*-\s+(?=\*\*|[A-Z0-9])/g, '\n- ')
    .replace(/^\s*\n/, '')
    .trim()
}

function band(score) { return score == null ? 'na' : score >= 65 ? 'g' : score >= 45 ? 'a' : 'r' }

// Interactive price chart (matches the dashboard chart: value axis, crosshair,
// hover tooltip). Points are { c: close, t?: date/label }.
function PriceChart({ points, prevClose, up, labelFor }) {
  const [hi, setHi] = useState(null)
  if (!points || points.length < 2) return <div className="sd-nochart">No price data for this range.</div>
  const W = 760, H = 280, M = { l: 52, r: 14, t: 16, b: 10 }
  const iw = W - M.l - M.r, ih = H - M.t - M.b
  const cs = points.map(p => p.c)
  let lo = Math.min(...cs), hiV = Math.max(...cs)
  if (prevClose != null) { lo = Math.min(lo, prevClose); hiV = Math.max(hiV, prevClose) }
  const padv = (hiV - lo) * 0.08 || 1
  lo -= padv; hiV += padv
  const span = (hiV - lo) || 1
  const x = i => M.l + (i * iw) / (points.length - 1)
  const y = c => M.t + ih * (1 - (c - lo) / span)
  const line = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.c).toFixed(1)).join(' ')
  const area = line + ' L' + x(points.length - 1).toFixed(1) + ' ' + (M.t + ih) + ' L' + x(0).toFixed(1) + ' ' + (M.t + ih) + ' Z'
  const col = up ? 'var(--green)' : 'var(--red)'
  const rupee = String.fromCharCode(0x20B9)
  const fmtp = v => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })
  const ticks = []; const steps = 4
  for (let k = 0; k <= steps; k++) ticks.push(lo + span * k / steps)
  const h = hi != null ? points[hi] : null
  const hChg = h && prevClose != null && prevClose ? ((h.c - prevClose) / prevClose * 100) : null
  return (
    <div className="sd-chart2-wrap" onMouseLeave={() => setHi(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="sd-chart2" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sdfill2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={col} stopOpacity="0.20" />
            <stop offset="100%" stopColor={col} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((t, k) => (
          <g key={k}>
            <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeWidth="1" />
            <text x={M.l - 7} y={y(t) + 3} textAnchor="end" className="sd-axis">{rupee}{fmtp(t)}</text>
          </g>
        ))}
        {prevClose != null && (
          <line x1={M.l} x2={W - M.r} y1={y(prevClose)} y2={y(prevClose)}
                stroke="var(--muted)" strokeWidth="1" strokeDasharray="4 4" />
        )}
        <path d={area} fill="url(#sdfill2)" />
        <path d={line} fill="none" stroke={col} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />
        {hi != null && <line x1={x(hi)} x2={x(hi)} y1={M.t} y2={M.t + ih} stroke={col} strokeWidth="1" opacity="0.5" />}
        {hi != null && <circle cx={x(hi)} cy={y(points[hi].c)} r="4.5" fill={col} stroke="var(--panel)" strokeWidth="2" />}
        {points.map((p, i) => (
          <rect key={i} x={x(i) - iw / points.length / 2} y={M.t} width={iw / points.length} height={ih}
                fill="transparent" onMouseEnter={() => setHi(i)} />
        ))}
      </svg>
      {h && (
        <div className="sd-tip" style={{ left: `${Math.min(88, Math.max(4, x(hi) / W * 100))}%` }}>
          {labelFor && labelFor(hi) && <div className="sd-tip-d">{labelFor(hi)}</div>}
          <div className="sd-tip-row"><span>Price</span><b>{rupee}{fmtp(h.c)}</b></div>
          {hChg != null && (
            <div className="sd-tip-row"><span>vs prev close</span>
              <b className={hChg >= 0 ? 'up' : 'down'}>{hChg >= 0 ? '+' : ''}{hChg.toFixed(2)}%</b></div>
          )}
        </div>
      )}
    </div>
  )
}

export default function StockDetail({ symbol, openStock, askAI, scoreLabel = 'NIYTRI Score' }) {
  const [d, setD] = useState(null)
  const [err, setErr] = useState('')
  const [range, setRange] = useState('1M')
  const [ph, setPh] = useState(null)
  const [phLoad, setPhLoad] = useState(false)
  const [perf, setPerf] = useState(null)
  const [cm, setCm] = useState(null)

  useEffect(() => {
    if (!symbol) return
    setD(null); setErr(''); setPerf(null); setCm(null)
    api.stockDetail(symbol).then(setD).catch(e => setErr(e.message))
    api.scorePerf(symbol).then(setPerf).catch(() => setPerf(null))
    api.cmotsStock(symbol).then(r => setCm(r && r.available ? r : null)).catch(() => setCm(null))
  }, [symbol])
  useEffect(() => {
    if (!symbol) return
    setPhLoad(true)
    // Intraday ranges need live delayed bars; longer ranges use our stored
    // daily EOD history (reliable, up to 3 years) instead of a live fetch.
    const intraday = range === '1D' || range === '1W'
    const call = intraday ? api.priceHistory(symbol, range) : api.publicPriceHistory(symbol, range)
    call.then(res => {
      if (intraday) setPh(res)
      else setPh({ points: (res.points || []).map(p => ({ c: p.c, t: p.t || p.d || p.date || '' })), delayed: true, source: 'EOD history' })
    }).catch(() => setPh(null)).finally(() => setPhLoad(false))
  }, [symbol, range])

  if (!symbol) return <div className="panel"><p className="hint">Search for a stock above to see its details.</p></div>
  if (err) return <div className="panel"><p className="note">{err}</p></div>
  if (!d) return <div className="panel"><p className="hint">Loading…</p></div>

  const last = ph?.last ?? d.last_price
  let prev = ph?.prev_close
  // When the source has no prev close (our EOD series), derive it from the day %
  // change so the absolute price change + prev-close guide still show.
  if (prev == null && last != null && d.change_pct != null) prev = last / (1 + d.change_pct / 100)
  const chg = (last != null && prev != null) ? last - prev : null
  const chgPct = (chg != null && prev) ? (chg / prev) * 100 : d.change_pct
  const up = chgPct == null ? true : chgPct >= 0
  const stats = [
    ['P/E', fmt(d.pe)], ['EPS', fmt(d.eps)], ['P/B', fmt(d.pb)],
    ['Div Yield', fmt(d.dividend_yield, { pct: true })], ['ROE', fmt(d.roe, { pct: true })],
    ['Beta', fmt(d.beta)], ['Volume', fmt(d.volume, { int: true })], ['Mkt Cap', fmt(d.market_cap, { cr: true })],
    ['52W High', fmt(d.week52_high)], ['52W Low', fmt(d.week52_low)],
  ]
  const pillars = d.pillar_scores && typeof d.pillar_scores === 'object' ? Object.entries(d.pillar_scores) : []

  return (
    <div className="sd">
      <style>{CSS}</style>

      <div className="sd-head">
        <div>
          <div className="sd-sym">{d.symbol} {idxTag(d.symbol) && <span className="idx-tag">{idxTag(d.symbol)}</span>} {d.sector && <span className="sd-sec">{d.sector}</span>}</div>
          <div className="sd-name">{d.name}</div>
        </div>
        <div className="sd-price">
          <div className="sd-last">{last != null ? String.fromCharCode(0x20B9) + fmt(last) : '—'}</div>
          {chgPct != null && (
            <div className={'sd-chg ' + (up ? 'up' : 'down')}>
              {(up ? String.fromCharCode(0x25B2) : String.fromCharCode(0x25BC))}{' '}
              {chg != null ? fmt(Math.abs(chg)) : ''} ({fmt(Math.abs(chgPct), { pct: true })})
            </div>
          )}
          {ph?.delayed && <span className="sd-delay">Delayed price · {ph.source || 'market'}</span>}
        </div>
      </div>

      <div className="sd-ranges">
        {RANGES.map(r => (
          <button key={r} className={'sd-rg' + (r === range ? ' on' : '')} onClick={() => setRange(r)}>{r}</button>
        ))}
        {askAI && <button className="ghost sm sd-ask" onClick={() => askAI('Tell me about ' + d.symbol + ' (' + d.name + ')')}>Ask the assistant</button>}
      </div>

      <div className="panel sd-chartwrap">
        {phLoad ? <div className="sd-nochart">Loading chart…</div> : <PriceChart points={ph?.points} prevClose={prev} up={up} labelFor={i => (ph?.points?.[i]?.t) || ''} />}
      </div>

      {(() => {
        const pts = (perf?.points || []).filter(p => p.fwd_return != null)
        const avgFwd = pts.length ? pts.reduce((s, p) => s + p.fwd_return, 0) / pts.length : null
        const since = perf?.since_first_scored
        if (!since && avgFwd == null) return null
        const cls = v => (v >= 0 ? 'up' : 'down'); const sgn = v => (v >= 0 ? '+' : '')
        return (
          <div className="panel sd-va">
            <div className="sd-va-h">NIYTRI Score — value-add <span className="hint">· hypothetical, not advice</span></div>
            <div className="sd-va-row">
              {since && (
                <div className="sd-va-stat">
                  <span>Since first scored ({since.from}, score {since.score_then})</span>
                  <b className={cls(since.return_pct)}>{sgn(since.return_pct)}{since.return_pct}%</b>
                </div>
              )}
              {avgFwd != null && (
                <div className="sd-va-stat">
                  <span>Avg {perf.horizon_days}-day move after each score</span>
                  <b className={cls(avgFwd)}>{sgn(avgFwd)}{avgFwd.toFixed(2)}%</b>
                </div>
              )}
            </div>
            <div className="sd-va-note">Informational back-study of this stock's real NIYTRI Scores vs its subsequent price
              move. Early window; past performance is not indicative of future results; not investment advice.</div>
          </div>
        )
      })()}

      <div className="sd-cols">
        <div className="panel sd-score">
          <div className="sd-score-top">
            <div>
              <div className="hint">{scoreLabel}</div>
              <div className={'sd-score-num ' + band(d.score)}>{d.score != null ? Math.round(d.score) : '—'}</div>
            </div>
            {d.quality_status && <span className={'tag ' + (d.quality_status === 'approved' ? '' : 'pending')}>{d.quality_status}</span>}
          </div>
          {pillars.length > 0 && (
            <div className="sd-pillars">
              {pillars.map(([k, v]) => (
                <div className="sd-pill" key={k}>
                  <div className="sd-pill-lbl"><span>{k.replace(/_/g, ' ')}</span><b>{Math.round(v)}</b></div>
                  <div className="sd-bar"><i className={band(v)} style={{ width: Math.max(2, Math.min(100, v)) + '%' }} /></div>
                </div>
              ))}
            </div>
          )}
          {d.explanation && <div className="sd-expl md" dangerouslySetInnerHTML={{ __html: mdToHtml(fmtExplanation(d.explanation)) }} />}
        </div>

        <div className="panel sd-stats">
          <div className="hint" style={{ marginBottom: 10 }}>Key Statistics</div>
          <div className="sd-stat-grid">
            {stats.map(([k, v]) => (
              <div className="sd-stat" key={k}><span>{k}</span><b>{v}</b></div>
            ))}
          </div>
        </div>
      </div>

      {cm && (cm.fundamentals || cm.risk) && (() => {
        const f = cm.fundamentals || {}, rk = cm.risk || {}
        const fx = v => (v == null || v === '' ? null : (isNaN(+v) ? v : (+v).toFixed(2)))
        const rows = [
          ['P/E (TTM)', fx(f.pe_ttm)], ['P/B (TTM)', fx(f.pb_ttm)], ['EPS (TTM)', fx(f.eps_ttm)],
          ['ROE', fx(f.roe)], ['ROA', fx(f.roa)], ['Debt/Equity', fx(f.totaldebt_equity)],
          ['Op. margin', fx(f.operatingprofitmargin)], ['Net margin', fx(f.netprofitmargin)],
          ['Div yield', fx(f.dividendyield)], ['PEG', fx(f.pegratio)], ['Sector P/E', fx(f.sectorpe)],
          ['Volatility (p.a.)', rk.volatility_pct != null ? rk.volatility_pct + '%' : null],
          ['Beta (vs ' + (rk.benchmark || 'NIFTY') + ')', rk.beta != null ? rk.beta : null],
        ].filter(([, v]) => v != null)
        if (!rows.length) return null
        return (
          <div className="panel sd-stats" style={{ marginTop: 14 }}>
            <div className="hint" style={{ marginBottom: 10 }}>
              Fundamentals &amp; Risk <span style={{ opacity: .7 }}>· NIYTRI Data Intelligence{rk.days ? ' · ' + rk.days + 'd history' : ''}</span>
            </div>
            <div className="sd-stat-grid">
              {rows.map(([k, v]) => (
                <div className="sd-stat" key={k}><span>{k}</span><b>{v}</b></div>
              ))}
            </div>
          </div>
        )
      })()}

      {d.news && d.news.length > 0 && (
        <div className="panel sd-news">
          <div className="hint" style={{ marginBottom: 10 }}>Related News</div>
          {d.news.map((n, i) => (
            <a key={i} className="sd-news-item" href={n.url || n.link} target="_blank" rel="noreferrer">
              <div className="sd-news-t">{n.title || n.headline}</div>
              <div className="sd-news-m">{n.source || ''}{n.sentiment ? ' · ' + n.sentiment : ''}</div>
            </a>
          ))}
        </div>
      )}

      <p className="sd-disc">{d.disclaimer}</p>
    </div>
  )
}

const CSS = `
.sd-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:14px}
.sd-sym{font-size:22px;font-weight:800;letter-spacing:.3px}
.sd-sec{font-size:11px;font-weight:600;color:var(--muted);border:1px solid var(--border2);padding:2px 8px;border-radius:999px;margin-left:8px;vertical-align:middle}
.sd-name{color:var(--muted);margin-top:2px}
.sd-price{text-align:right}
.sd-last{font-size:26px;font-weight:800;font-variant-numeric:tabular-nums}
.sd-chg{font-weight:700;font-size:14px;margin-top:2px}
.sd-delay{display:block;color:var(--faint);font-size:11px;margin-top:3px}
.sd-ranges{display:flex;gap:6px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
.sd-rg{background:var(--panel2);color:var(--muted);border:1px solid var(--border);border-radius:8px;padding:6px 12px;font-weight:600;font-size:13px;cursor:pointer}
.sd-rg.on{background:var(--accent);color:#fff;border-color:var(--accent)}
.sd-ask{margin-left:auto}
.sd-chartwrap{padding:12px;position:relative}
.sd-chart2-wrap{position:relative;width:100%}
.sd-chart2{width:100%;height:280px;display:block}
.sd-axis{fill:var(--muted);font-size:10px;font-variant-numeric:tabular-nums}
.sd-tip{position:absolute;top:8px;transform:translateX(-50%);background:var(--panel);border:1px solid var(--border2);border-radius:10px;box-shadow:0 10px 28px rgba(11,37,69,.18);padding:8px 11px;min-width:128px;pointer-events:none;z-index:5}
.sd-tip-d{font-size:11px;color:var(--muted);margin-bottom:5px;font-weight:600}
.sd-tip-row{display:flex;justify-content:space-between;gap:14px;font-size:12.5px;margin:2px 0}
.sd-tip-row span{color:var(--muted)}
.sd-tip-row b{font-variant-numeric:tabular-nums}
.sd-tip-row b.up{color:var(--green)}.sd-tip-row b.down{color:var(--red)}
.sd-va{margin-top:14px;background:linear-gradient(135deg,rgba(255,138,61,.06),rgba(249,76,0,.05));border-color:rgba(255,106,0,.22)}
.sd-va-h{font-weight:700;font-size:14px;margin-bottom:12px}
.sd-va-row{display:flex;gap:34px;flex-wrap:wrap}
.sd-va-stat{display:flex;flex-direction:column;gap:3px}
.sd-va-stat span{font-size:12px;color:var(--muted)}
.sd-va-stat b{font-size:24px;font-weight:800;font-variant-numeric:tabular-nums}
.sd-va-stat b.up{color:var(--green)}.sd-va-stat b.down{color:var(--red)}
.sd-va-note{margin-top:12px;font-size:11.5px;color:var(--faint);line-height:1.55}
.sd-nochart{height:240px;display:flex;align-items:center;justify-content:center;color:var(--muted)}
.sd-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
.sd-score-top{display:flex;justify-content:space-between;align-items:flex-start}
.sd-score-num{font-size:44px;font-weight:800;line-height:1.1}
.sd-score-num.g{color:var(--green)}.sd-score-num.a{color:var(--amber)}.sd-score-num.r{color:var(--red)}.sd-score-num.na{color:var(--muted)}
.sd-pillars{margin-top:14px;display:grid;gap:9px}
.sd-pill-lbl{display:flex;justify-content:space-between;font-size:12.5px;text-transform:capitalize;color:var(--muted);margin-bottom:3px}
.sd-pill-lbl b{color:var(--text)}
.sd-bar{height:7px;background:var(--panel2);border-radius:6px;overflow:hidden}
.sd-bar i{display:block;height:100%;border-radius:6px}
.sd-bar i.g{background:var(--green)}.sd-bar i.a{background:var(--amber)}.sd-bar i.r{background:var(--red)}.sd-bar i.na{background:var(--muted)}
.sd-expl{margin-top:14px;color:var(--text);line-height:1.6;font-size:13.5px}
.sd-expl.md ul{margin:8px 0 0;padding-left:18px}
.sd-expl.md li{margin:5px 0;color:var(--text)}
.sd-expl.md p{margin:6px 0;color:var(--muted)}
.sd-expl.md strong{color:var(--text);font-weight:700}
.sd-stat-grid{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border);border:1px solid var(--border);border-radius:10px;overflow:hidden}
.sd-stat{display:flex;justify-content:space-between;padding:11px 13px;background:var(--panel)}
.sd-stat span{color:var(--muted);font-size:13px}
.sd-stat b{font-variant-numeric:tabular-nums}
.sd-news-item{display:block;padding:10px 0;border-top:1px solid var(--border);text-decoration:none}
.sd-news-item:first-of-type{border-top:0}
.sd-news-t{color:var(--text);font-weight:500;line-height:1.4}
.sd-news-m{color:var(--faint);font-size:12px;margin-top:2px}
.sd-disc{color:var(--faint);font-size:11.5px;margin-top:16px;line-height:1.5}
.stk-search{position:relative;display:flex;align-items:center}
.stk-search-ic{position:absolute;left:11px;font-size:12px;opacity:.6;pointer-events:none}
.stk-search input{padding:8px 12px 8px 30px;border-radius:999px;background:var(--panel2);border:1px solid var(--border);color:var(--text);width:190px;font-size:13px}
.stk-search input:focus{width:240px;border-color:var(--accent)}
.stk-drop{position:absolute;top:110%;left:0;right:0;min-width:280px;background:var(--panel);border:1px solid var(--border2);border-radius:12px;box-shadow:0 16px 40px rgba(0,0,0,.35);overflow:hidden;z-index:40}
.stk-opt{display:flex;gap:10px;align-items:baseline;padding:9px 13px;cursor:pointer}
.stk-opt.hi{background:var(--panel2)}
.stk-opt b{min-width:64px}
.stk-opt span{color:var(--muted);font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
@media(max-width:760px){.sd-cols{grid-template-columns:1fr}.stk-search input{width:130px}.stk-search input:focus{width:160px}}
`
