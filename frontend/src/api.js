// Web build uses the relative '/api/v1' (same origin via nginx). The native
// (Capacitor) build sets VITE_API_BASE to the absolute API URL at build time.
const BASE = (import.meta.env && import.meta.env.VITE_API_BASE) || '/api/v1'

let _token = sessionStorage.getItem('token') || null
let _refresh = sessionStorage.getItem('refresh') || null
let _onUnauthorized = null
let _refreshing = null   // in-flight refresh promise, so concurrent 401s share one

export function setToken(t) {
  _token = t
  if (t) sessionStorage.setItem('token', t)
  else sessionStorage.removeItem('token')
}
export function setRefresh(t) {
  _refresh = t
  if (t) sessionStorage.setItem('refresh', t)
  else sessionStorage.removeItem('refresh')
}
// Store both tokens from a login/refresh response.
export function setSession(d) {
  if (!d) { setToken(null); setRefresh(null); return }
  setToken(d.access_token || null)
  if (d.refresh_token != null) setRefresh(d.refresh_token || null)
}
export function clearSession() { setToken(null); setRefresh(null) }
export function getToken() { return _token }
export function getRefresh() { return _refresh }
export function onUnauthorized(fn) { _onUnauthorized = fn }

// Exchange the refresh token for a fresh access+refresh pair. Returns true on
// success. A 401 here means the session is dead server-side (idle past the
// window, over the absolute cap, or token revoked) -> caller must log out.
export async function refreshSession() {
  if (!_refresh) return false
  if (_refreshing) return _refreshing
  _refreshing = (async () => {
    try {
      const res = await fetch(BASE + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: _refresh }),
      })
      if (!res.ok) { clearSession(); return false }
      const d = await res.json()
      setSession(d)
      return true
    } catch {
      return false   // network blip: keep tokens, let caller retry later
    } finally {
      _refreshing = null
    }
  })()
  return _refreshing
}

async function _do(path, opts) {
  const headers = { 'Content-Type': 'application/json' }
  if (_token) headers['Authorization'] = `Bearer ${_token}`
  return fetch(BASE + path, { headers, ...opts })
}

async function http(path, opts = {}) {
  const isAuthCall = path.startsWith('/auth/login') || path.startsWith('/auth/refresh')
  let res = await _do(path, opts)
  // Access token likely expired -> try one silent refresh, then retry once.
  if (res.status === 401 && !isAuthCall && _refresh) {
    const ok = await refreshSession()
    if (ok) res = await _do(path, opts)
  }
  if (res.status === 401 && !isAuthCall) {
    clearSession()
    if (_onUnauthorized) _onUnauthorized()
    throw new Error('Session expired — please log in again')
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `Request failed (${res.status})`)
  }
  return res.json()
}

export const api = {
  login: (email, password) =>
    http('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => http('/auth/me'),
  ask: (question, session_id, language = 'en') =>
    http('/ask', { method: 'POST', body: JSON.stringify({ question, session_id, language }) }),
  chatSessions: () => http('/chat/sessions'),
  chatHistory: (sessionId) => http(`/chat/history/${sessionId}`),
  chatSuggestions: () => http('/chat/suggestions'),
  sendFeedback: (rating, { session_id = '', question = '', answer = '', provider = '' } = {}) =>
    http('/chat/feedback', { method: 'POST', body: JSON.stringify({ rating, session_id, question, answer, provider }) }),
  chatFeedback: (p = {}) => http('/admin/chat-feedback?' + new URLSearchParams(p)),
  registerDevice: (token, platform = '') => http('/devices/register', { method: 'POST', body: JSON.stringify({ token, platform }) }),
  deleteSession: (sessionId) => http(`/chat/history/${sessionId}`, { method: 'DELETE' }),
  clearChats: () => http('/chat/sessions', { method: 'DELETE' }),
  scores: (score_date = '') => http('/scores' + (score_date ? `?score_date=${score_date}` : '')),
  refreshScore: (symbol) => http(`/score/${symbol}/refresh`, { method: 'POST' }),
  trends: (days = 30, symbols = '') => http(`/scores/trends?days=${days}` + (symbols ? `&symbols=${encodeURIComponent(symbols)}` : '')),
  scoreHistory: (symbol, days = 30) => http(`/scores/${symbol}/history?days=${days}`),
  indexConstituents: () => http('/indices/constituents'),
  runScoring: (full = false) => http('/admin/run-scoring' + (full ? '?full=true' : ''), { method: 'POST' }),
  refreshNewsNow: () => http('/admin/refresh-news', { method: 'POST' }),
  news: (refresh = false, limit = 20) => http(`/news?refresh=${refresh}&limit=${limit}`),
  indices: () => http('/market/indices'),
  analyzePortfolio: (holdings) =>
    http('/portfolio/analyze', { method: 'POST', body: JSON.stringify({ holdings }) }),
  portfolioSaved: () => http('/portfolio/saved'),
  downloadPortfolioTemplate: async () => {
    const res = await fetch(BASE + '/portfolio/template.csv', { headers: { Authorization: `Bearer ${_token}` } })
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `Download failed (${res.status})`) }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'portfolio_template.csv'
    document.body.appendChild(a); a.click()
    setTimeout(() => { URL.revokeObjectURL(url); a.remove() }, 1500)
  },
  savePortfolio: (holdings) =>
    http('/portfolio/save', { method: 'POST', body: JSON.stringify({ holdings }) }),
  compare: (a, b, language = 'en') =>
    http('/compare?' + new URLSearchParams({ a, b, language })),
  compareRandom: () => http('/compare/random'),
  downloadPortfolioPdf: async (holdings) => {
    const headers = { 'Content-Type': 'application/json' }
    if (_token) headers['Authorization'] = `Bearer ${_token}`
    const res = await fetch(BASE + '/portfolio/report.pdf', {
      method: 'POST', headers, body: JSON.stringify({ holdings }),
    })
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `Export failed (${res.status})`) }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = 'portfolio_analysis.pdf'
    document.body.appendChild(link); link.click()
    setTimeout(() => { URL.revokeObjectURL(url); link.remove() }, 1500)
  },
  portfolioUpload: async (file) => {
    const fd = new FormData(); fd.append('file', file)
    const headers = {}
    if (_token) headers['Authorization'] = `Bearer ${_token}`
    const res = await fetch(BASE + '/portfolio/upload', { method: 'POST', headers, body: fd })
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `Upload failed (${res.status})`) }
    return res.json()
  },
  health: () => http('/health'),
  branding: () => http('/branding'),
  uploadBrandLogo: async (file) => {
    const fd = new FormData(); fd.append('file', file)
    const headers = {}; if (_token) headers['Authorization'] = `Bearer ${_token}`
    const res = await fetch(BASE + '/admin/branding', { method: 'POST', headers, body: fd })
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `Upload failed (${res.status})`) }
    return res.json()
  },
  clearBrandLogo: () => http('/admin/branding', { method: 'DELETE' }),
  audit: (event = '', limit = 50, offset = 0) =>
    http(`/admin/audit?event=${encodeURIComponent(event)}&limit=${limit}&offset=${offset}`),
  stats: () => http('/admin/stats'),
  llmTest: () => http('/admin/llm-test', { method: 'POST' }),
  chatAudit: (p = {}) => http('/admin/chat-audit?' + new URLSearchParams(p)),
  pendingScores: () => http('/admin/scores/pending'),
  scoresHistory: (p = {}) => http('/admin/scores/history?' + new URLSearchParams(p)),
  reviewScore: (id, status) =>
    http(`/admin/scores/${id}/review`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  reviewScoresBulk: (set_status, { score_date = '', status = '', symbol = '' } = {}) =>
    http('/admin/scores/review-bulk', { method: 'POST', body: JSON.stringify({ set_status, score_date, status, symbol }) }),
  users: () => http('/admin/users'),
  createUser: (email, password, full_name, is_admin, role_id) =>
    http('/admin/users', { method: 'POST', body: JSON.stringify({ email, password, full_name, is_admin, role_id }) }),
  toggleUser: (id) => http(`/admin/users/${id}/toggle-active`, { method: 'PATCH' }),
  setUserRole: (id, role_id) =>
    http(`/admin/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role_id }) }),
  // RBAC roles
  pagesCatalog: () => http('/admin/pages'),
  roles: () => http('/admin/roles'),
  createRole: (name, pages, is_admin) =>
    http('/admin/roles', { method: 'POST', body: JSON.stringify({ name, pages, is_admin }) }),
  updateRole: (id, name, pages, is_admin) =>
    http(`/admin/roles/${id}`, { method: 'PUT', body: JSON.stringify({ name, pages, is_admin }) }),
  deleteRole: (id) => http(`/admin/roles/${id}`, { method: 'DELETE' }),
  // instruments + watchlist + agents
  instruments: () => http('/instruments'),
  watchlist: () => http('/watchlist'),
  watchAdd: (s) => http(`/watchlist/${s}`, { method: 'POST' }),
  watchRemove: (s) => http(`/watchlist/${s}`, { method: 'DELETE' }),
  agentsStatus: () => http('/agents/status'),
  adminInstruments: () => http('/admin/instruments'),
  addInstrument: (symbol, name, sector) =>
    http('/admin/instruments', { method: 'POST', body: JSON.stringify({ symbol, name, sector }) }),
  toggleInstrument: (id, field) =>
    http(`/admin/instruments/${id}/toggle/${field}`, { method: 'PATCH' }),
  importNifty50: () => http('/admin/instruments/import-nifty50', { method: 'POST' }),
  importNifty500: () => http('/admin/instruments/import-nifty500', { method: 'POST' }),
  importNseAll: () => http('/admin/instruments/import-nse-all', { method: 'POST' }),
  sectorsStatus: () => http('/admin/instruments/sectors-status'),
  backfillSectors: (source = 'nse', limit = 150) =>
    http('/admin/instruments/backfill-sectors?' + new URLSearchParams({ source, limit }), { method: 'POST' }),
  sectorMapUpload: async (file) => {
    const fd = new FormData(); fd.append('file', file)
    const headers = {}; if (_token) headers['Authorization'] = `Bearer ${_token}`
    const res = await fetch(BASE + '/admin/instruments/sector-map-upload', { method: 'POST', headers, body: fd })
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `Upload failed (${res.status})`) }
    return res.json()
  },
  settings: () => http('/admin/settings'),
  integrations: () => http('/admin/integrations'),
  pipelineRuns: (p = {}) => http('/admin/pipeline-runs?' + new URLSearchParams(p)),
  llmUsage: () => http('/admin/llm-usage'),
  exportRunsUrl: (p = {}) => BASE + '/admin/pipeline-runs/export?' + new URLSearchParams(p),
  downloadExport: async (p = {}) => {
    const res = await fetch(BASE + '/admin/pipeline-runs/export?' + new URLSearchParams(p), {
      headers: { Authorization: `Bearer ${_token}` },
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || `Export failed (${res.status})`)
    }
    const blob = await res.blob()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = (res.headers.get('Content-Disposition') || '').match(/filename="(.+)"/)?.[1] || 'pipeline_runs.xlsx'
    a.click()
    URL.revokeObjectURL(a.href)
  },
  updateSetting: (key, value) =>
    http('/admin/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }),
  research: () => http('/admin/research'),
  researchText: (title, text, source) =>
    http('/admin/research/text', { method: 'POST', body: JSON.stringify({ title, text, source }) }),
  researchDelete: (id) => http(`/admin/research/${id}`, { method: 'DELETE' }),
  researchUpload: async (file, title, source) => {
    const fd = new FormData()
    fd.append('file', file); fd.append('title', title || ''); fd.append('source', source || '')
    const headers = {}
    if (_token) headers['Authorization'] = `Bearer ${_token}`
    const res = await fetch(BASE + '/admin/research/upload', { method: 'POST', headers, body: fd })
    if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.detail || `Upload failed (${res.status})`) }
    return res.json()
  },
}
