// Shared symbol -> company name map, fetched once from the instruments master
// and cached, so any page can show the full script name (and tooltips) without
// each component refetching. Used via the useNames() hook.
import { useEffect, useState } from 'react'
import { api } from './api.js'

let _map = null
let _promise = null

export function loadNames() {
  if (_map) return Promise.resolve(_map)
  if (!_promise) {
    _promise = api.instruments()
      .then(d => {
        _map = {}
        for (const i of (d.instruments || [])) _map[(i.symbol || '').toUpperCase()] = i.name || ''
        return _map
      })
      .catch(() => (_map = {}))
  }
  return _promise
}

export function nameOf(sym) {
  return (_map && _map[(sym || '').toUpperCase()]) || ''
}

// React hook: returns the symbol->name map, loading it on first use.
export function useNames() {
  const [m, setM] = useState(_map || {})
  useEffect(() => { loadNames().then(x => setM({ ...x })) }, [])
  return m
}
