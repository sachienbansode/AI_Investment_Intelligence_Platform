// Generic mobile helper: copy each .data-table's column headers into per-cell
// data-label attributes so the mobile CSS can render rows as label:value cards
// (no horizontal scroll). Works for every table without touching components.
function labelize() {
  document.querySelectorAll('table.data-table').forEach(tbl => {
    const heads = Array.from(tbl.querySelectorAll('thead th')).map(th => th.textContent.trim())
    if (!heads.length) return
    tbl.querySelectorAll('tbody tr').forEach(tr => {
      Array.from(tr.children).forEach((td, i) => {
        if (td.colSpan && td.colSpan > 1) return        // detail/expanded rows: no label
        if (heads[i] && td.getAttribute('data-label') !== heads[i]) {
          td.setAttribute('data-label', heads[i])
        }
      })
    })
  })
}

export function startTableLabels() {
  let timer = null
  const run = () => { try { labelize() } catch { /* ignore */ } }
  run()
  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(run, 80) })
  obs.observe(document.body, { childList: true, subtree: true })
  return obs
}
