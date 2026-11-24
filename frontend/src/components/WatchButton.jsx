import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { toast } from '../dialog.jsx'

// Shared watchlist state so every star across the app stays in sync without each
// component refetching. Load once, mutate in place on toggle.
let _set = null
let _loading = null

export async function loadWatchSet(force = false) {
  if (_set && !force) return _set
  if (!_loading || force) {
    _loading = api.watchlist()
      .then(d => { _set = new Set((d.watchlist || []).map(w => String(w.symbol || w).toUpperCase())); return _set })
      .catch(() => { _set = new Set(); return _set })
  }
  return _loading
}
export function invalidateWatch() { _set = null; _loading = null }

// A star toggle that adds/removes a symbol from the user's watchlist.
// variant: 'button' (star + label) | 'icon' (just the star).
export default function WatchButton({ symbol, variant = 'button', onChange }) {
  const sym = String(symbol || '').toUpperCase()
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    if (sym) loadWatchSet().then(s => { if (alive) setOn(s.has(sym)) })
    return () => { alive = false }
  }, [sym])

  async function toggle(e) {
    if (e && e.stopPropagation) e.stopPropagation()
    if (busy || !sym) return
    setBusy(true)
    const next = !on
    try {
      if (next) await api.watchAdd(sym); else await api.watchRemove(sym)
      setOn(next)
      const s = await loadWatchSet()
      if (next) s.add(sym); else s.delete(sym)
      toast(next ? `${sym} added to watchlist` : `${sym} removed from watchlist`)
      onChange && onChange(next)
    } catch (ex) {
      toast(ex.message || 'Could not update watchlist', { type: 'error' })
    }
    setBusy(false)
  }

  if (variant === 'icon') {
    return (
      <button className={'watch-star-btn' + (on ? ' on' : '')} disabled={busy}
              title={on ? 'Remove from watchlist' : 'Add to watchlist'}
              aria-pressed={on} onClick={toggle}>
        {on ? '★' : '☆'}
      </button>
    )
  }
  return (
    <button className={'watch-btn' + (on ? ' on' : '')} disabled={busy}
            title={on ? 'Remove from watchlist' : 'Add to watchlist'}
            aria-pressed={on} onClick={toggle}>
      <span className="watch-star">{on ? '★' : '☆'}</span>
      {busy ? '…' : on ? 'Watching' : 'Watch'}
    </button>
  )
}
