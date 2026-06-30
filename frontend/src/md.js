// Minimal, safe markdown → HTML (escapes input first; no external deps).
// Supports: **bold**, *italic*, `code`, "- " bullets, "1. " numbered lists,
// ### headings, > callouts, [text](url) links, GFM pipe tables, line breaks.
export function mdToHtml(text) {
  if (!text) return ''
  const esc = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const lines = esc.split(/\r?\n/)
  let html = '', inUl = false, inOl = false, quote = []
  const closeLists = () => {
    if (inUl) { html += '</ul>'; inUl = false }
    if (inOl) { html += '</ol>'; inOl = false }
  }
  const flushQuote = () => {
    if (quote.length) {
      html += `<blockquote class="callout">${quote.map(q => inline(q)).join('<br/>')}</blockquote>`
      quote = []
    }
  }

  // A GFM table separator row, e.g. "|---|:--:|--:|" (>= 2 columns).
  const isSep = l => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(l)
  // Split "| a | b |" into trimmed cells (tolerates missing edge pipes).
  const cells = l => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // ---- GFM table: a header row with pipes immediately followed by a separator
    if (line.includes('|') && i + 1 < lines.length && isSep(lines[i + 1].trim())) {
      flushQuote(); closeLists()
      const aligns = cells(lines[i + 1].trim()).map(c => {
        const lft = c.startsWith(':'), rgt = c.endsWith(':')
        return lft && rgt ? 'center' : rgt ? 'right' : lft ? 'left' : ''
      })
      const headers = cells(line)
      const al = k => aligns[k] ? ` style="text-align:${aligns[k]}"` : ''
      let t = '<div class="md-table-wrap"><table class="md-table"><thead><tr>'
      headers.forEach((h, k) => { t += `<th${al(k)}>${inline(h)}</th>` })
      t += '</tr></thead><tbody>'
      let j = i + 2
      while (j < lines.length && lines[j].trim() !== '' && lines[j].includes('|')) {
        const row = cells(lines[j].trim())
        t += '<tr>'
        headers.forEach((_, k) => { t += `<td${al(k)}>${inline(row[k] || '')}</td>` })
        t += '</tr>'
        j++
      }
      t += '</tbody></table></div>'
      html += t
      i = j - 1
      continue
    }

    if (/^&gt;\s?/.test(line)) {   // '>' is already HTML-escaped to &gt; above
      closeLists()
      quote.push(line.replace(/^&gt;\s?/, ''))
      continue
    }
    flushQuote()
    if (/^[-*•]\s+/.test(line)) {
      if (!inUl) { closeLists(); html += '<ul>'; inUl = true }
      html += `<li>${inline(line.replace(/^[-*•]\s+/, ''))}</li>`
    } else if (/^\d+[.)]\s+/.test(line)) {
      if (!inOl) { closeLists(); html += '<ol>'; inOl = true }
      html += `<li>${inline(line.replace(/^\d+[.)]\s+/, ''))}</li>`
    } else if (/^#{1,4}\s+/.test(line)) {
      closeLists()
      html += `<h4>${inline(line.replace(/^#{1,4}\s+/, ''))}</h4>`
    } else if (line === '') {
      closeLists()
      html += '<div class="md-gap"></div>'
    } else {
      closeLists()
      html += `<p>${inline(line)}</p>`
    }
  }
  flushQuote()
  closeLists()
  return html
}

function inline(s) {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
             '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}
