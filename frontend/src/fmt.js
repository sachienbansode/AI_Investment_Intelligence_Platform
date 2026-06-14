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

export function fmtDur(a, b) {
  return (a && b) ? `${(b - a).toFixed(1)}s` : ''
}
