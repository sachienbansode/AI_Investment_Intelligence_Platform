const BASE = '/api/v1'

let _token = localStorage.getItem('token') || null
let _onUnauthorized = null

export function setToken(t) {
  _token = t
  if (t) localStorage.setItem('token', t)
  else localStorage.removeItem('token')
}
export function getToken() { return _token }
export function onUnauthorized(fn) { _onUnauthorized = fn }

async function http(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (_token) headers['Authorization'] = `Bearer ${_token}`
  const res = await fetch(BASE + path, { headers, ...opts })
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    setToken(null)
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
  // auth
  login: (email, password) =>
    http('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  me: () => http('/auth/me'),
  // assistant + chat history
  ask: (question, session_id, language = 'en') =>
    http('/ask', { method: 'POST', body: JSON.stringify({ question, session_id, language }) }),
  chatSessions: () => http('/chat/sessions'),
  chatHistory: (sessionId) => http(`/chat/history/${sessionId}`),
  // data
  scores: () => http('/scores'),
  refreshScore: (symbol) => http(`/score/${symbol}/refresh`, { method: 'POST' }),
  trends: (days = 30) => http(`/scores/trends?days=${days}`),
  runScoring: () => http('/admin/run-scoring', { method: 'POST' }),
  news: (refresh = false, limit = 20) => http(`/news?refresh=${refresh}&limit=${limit}`),
  indices: () => http('/market/indices'),
  analyzePortfolio: (holdings) =>
    http('/portfolio/analyze', { method: 'POST', body: JSON.stringify({ holdings }) }),
  health: () => http('/health'),
  // admin
  audit: (event = '', limit = 50, offset = 0) =>
    http(`/admin/audit?event=${encodeURIComponent(event)}&limit=${limit}&offset=${offset}`),
  stats: () => http('/admin/stats'),
  pendingScores: () => http('/admin/scores/pending'),
  scoresHistory: (p = {}) => http('/admin/scores/history?' + new URLSearchParams(p)),
  reviewScore: (id, status) =>
    http(`/admin/scores/${id}/review`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  users: () => http('/admin/users'),
  createUser: (email, password, full_name, is_admin) =>
    http('/admin/users', { method: 'POST', body: JSON.stringify({ email, password, full_name, is_admin }) }),
  toggleUser: (id) => http(`/admin/users/${id}/toggle-active`, { method: 'PATCH' }),
  // instruments + watchlist + agents
  instruments: () => http('/instruments'),
  watchlist: () => http('/watchlist'),
  watchAdd: (s) => http(`/watchlist/${s}`, { method: 'POST' }),
  watchRemove: (s) => http(`/watchlist/${s}`, { method: 'DELETE' }),
  agentsStatus: () => http('/agents/status'),
  // admin: instruments + settings
  adminInstruments: () => http('/admin/instruments'),
  addInstrument: (symbol, name, sector) =>
    http('/admin/instruments', { method: 'POST', body: JSON.stringify({ symbol, name, sector }) }),
  toggleInstrument: (id, field) =>
    http(`/admin/instruments/${id}/toggle/${field}`, { method: 'PATCH' }),
  importNifty500: () => http('/admin/instruments/import-nifty500', { method: 'POST' }),
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
    a.download = (res.headers.get('Content-Disposition') || '').match(/filename="(.+)"/)?.[1]
      || 'pipeline_runs.xlsx'
    a.click()
    URL.revokeObjectURL(a.href)
  },
  updateSetting: (key, value) =>
    http('/admin/settings', { method: 'PUT', body: JSON.stringify({ key, value }) }),
  // admin: broker-research RAG store
  research: () => http('/admin/research'),
  researchText: (title, text, source) =>
    http('/admin/research/text', { method: 'POST', body: JSON.stringify({ title, text, source }) }),
  researchDelete: (id) => http(`/admin/research/${id}`, { method: 'DELETE' }),
  researchUpload: async (file, title, source) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('title', title || '')
    fd.append('source', source || '')
    const headers = {}
    if (_token) headers['Authorization'] = `Bearer ${_token}`
    const res = await fetch(BASE + '/admin/research/upload', { method: 'POST', headers, body: fd })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || `Upload failed (${res.status})`)
    }
    return res.json()
  },
}
