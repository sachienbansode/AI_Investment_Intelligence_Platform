import { useEffect, useRef, useState } from 'react'
import { api } from '../api.js'
import { toast } from '../dialog.jsx'

// Shared store so every star in the app reflects the same list membership and
// stays in sync when any one of them changes.
let _lists = null        // [{ id, name, count }]
let _members = null      // { SYMBOL: [listId, ...] }
let _loaded = null
const _subs = new Set()
const _emit = () => _subs.forEach(f => f())

export async function loadWatch(force = false) {
  if (_loaded && !force) return _loaded
  _loaded = Promise.all([api.watchlists(), api.watchMembership()])
    .then(([l, m]) => { _lists = l.lists || []; _members = m.membership || {}; _emit() })
    .catch(() => { _lists = _lists || []; _members = _members || {} })
  return _loaded
}
export function invalidateWatch() { _loaded = null; loadWatch(true) }
export function watchLists() { return _lists || [] }
const listsOf = sym => (_members && _members[sym]) || []

export default function WatchButton({ symbol, variant = 'button' }) {
  const sym = String(symbol || '').toUpperCase()
  const [, bump] = useState(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const ref = useRef(null)

  useEffect(() => {
    const f = () => bump(x => x + 1)
    _subs.add(f); loadWatch()
    return () => { _subs.delete(f) }
  }, [])
  useEffect(() => {
    if (!open) return
    const away = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const inLists = listsOf(sym)
  const on = inLists.length > 0

  async function toggleList(listId, checked) {
    setBusy(true)
    try {
      if (checked) {
        await api.watchAdd(sym, listId)
        _members[sym] = [...(_members[sym] || []), listId]
      } else {
        await api.watchRemove(sym, listId)
        _members[sym] = (_members[sym] || []).filter(x => x !== listId)
      }
      const l = (_lists || []).find(x => x.id === listId)
      if (l) l.count = Math.max(0, (l.count || 0) + (checked ? 1 : -1))
      _emit()
    } catch (ex) { toast(ex.message || 'Could not update watchlist', { type: 'error' }) }
    setBusy(false)
  }

  async function addList() {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    try {
      const l = await api.createWatchlist(name)
      _lists = [...(_lists || []), { id: l.id, name: l.name, count: 0 }]
      setNewName('')
      await toggleList(l.id, true)
    } catch (ex) { toast(ex.message || 'Could not create list', { type: 'error' }) }
    setBusy(false)
  }

  const star = on ? '★' : '☆'
  const onClick = e => { if (e && e.stopPropagation) e.stopPropagation(); setOpen(o => !o) }

  return (
    <span className="wb-wrap" ref={ref}>
      {variant === 'icon'
        ? <button className={'watch-star-btn' + (on ? ' on' : '')} disabled={busy} aria-pressed={on}
                  title={on ? `In ${inLists.length} list(s)` : 'Add to watchlist'} onClick={onClick}>{star}</button>
        : <button className={'watch-btn' + (on ? ' on' : '')} disabled={busy} aria-pressed={on}
                  title={on ? `In ${inLists.length} list(s)` : 'Add to watchlist'} onClick={onClick}>
            <span className="watch-star">{star}</span>{on ? 'Watching' : 'Watch'}
          </button>}
      {open && (
        <div className="wb-pop" onClick={e => e.stopPropagation()}>
          <div className="wb-pop-h">Add <b>{sym}</b> to</div>
          <div className="wb-pop-lists">
            {(_lists || []).length === 0 && <div className="hint" style={{ padding: '4px 2px' }}>Loading lists…</div>}
            {(_lists || []).map(l => (
              <label key={l.id} className="wb-pop-row">
                <input type="checkbox" checked={inLists.includes(l.id)} disabled={busy}
                       onChange={e => toggleList(l.id, e.target.checked)} />
                <span className="wb-pop-name">{l.name}</span>
                <em>{l.count}</em>
              </label>
            ))}
          </div>
          <div className="wb-pop-new">
            <input value={newName} placeholder="New list…" disabled={busy}
                   onChange={e => setNewName(e.target.value)}
                   onKeyDown={e => { if (e.key === 'Enter') addList() }} />
            <button className="sm" disabled={busy || !newName.trim()} onClick={addList}>Create</button>
          </div>
        </div>
      )}
    </span>
  )
}
