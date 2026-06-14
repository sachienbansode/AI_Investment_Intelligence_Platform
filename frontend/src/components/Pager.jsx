export default function Pager({ page, setPage, total, size = 20, label = 'records' }) {
  const pages = Math.max(1, Math.ceil(total / size))
  if (total <= size) return null
  return (
    <div className="toolbar" style={{ justifyContent: 'center' }}>
      <button className="ghost sm" disabled={page === 0} onClick={() => setPage(0)}>« First</button>
      <button className="ghost sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>‹ Prev</button>
      <span className="hint">page {page + 1} of {pages} · {total} {label}</span>
      <button className="ghost sm" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>Next ›</button>
      <button className="ghost sm" disabled={page >= pages - 1} onClick={() => setPage(pages - 1)}>Last »</button>
    </div>
  )
}
