// IST date formatting: DDMMMYYYY hh:mm:ss AM/PM (e.g. 12Jun2026 10:16:24 AM)
const F = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kolkata',
  day: '2-digit', month: 'short', year: 'numeric',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
})

export function fmtIST(v) {
  if (v === null || v === undefined || v === '') return '—'
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(v)
  if (isNaN(d.getTime())) return String(v)
  const p = Object.fromEntries(F.formatToParts(d).map(x => [x.type, x.value]))
  return `${p.day}${p.month}${p.year} ${p.hour}:${p.minute}:${p.second} ${(p.dayPeriod || '').toUpperCase()}`
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Date as dd-MMM-yyyy (e.g. 25-Jun-2026). Accepts 'YYYY-MM-DD', ISO strings,
// RSS pubdates, or epoch seconds. Returns the original string if unparseable.
export function fmtDate(v) {
  if (v === null || v === undefined || v === '') return '—'
  const s = String(v)
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[3]}-${MON[(+m[2] || 1) - 1]}-${m[1]}`
  const d = typeof v === 'number' ? new Date(v * 1000) : new Date(s)
  if (isNaN(d.getTime())) return s
  return `${String(d.getDate()).padStart(2, '0')}-${MON[d.getMonth()]}-${d.getFullYear()}`
}

export function fmtDur(a, b) {
  return (a && b) ? `${(b - a).toFixed(1)}s` : ''
}
