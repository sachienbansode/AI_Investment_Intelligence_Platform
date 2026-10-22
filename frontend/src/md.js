// Minimal, safe markdown → HTML (escapes input first; no external deps).
// Supports: **bold**, *italic*, `code`, "- " bullets, "1. " numbered lists,
// ### headings, > callouts, [text](url) links, GFM pipe tables, line breaks.
// Tooltips for common table column headers (hover help in rendered tables).
const COL_TIPS = {
  'sector': 'Sector / index name', 'industry': 'Industry group',
  'change': 'Change in the last session (%)', 'change (%)': 'Change in %',
  "today's change": "Today's change (%)", "today's change (%)": "Today's change (%)",
  'level': 'Current index level / value', 'symbol': 'NSE trading symbol',
  'stock': 'Stock / scrip', 'scrip': 'Scrip (stock)',
  'score': 'NIYTRI Score (0–100) — our internal quality score',
  'niytri score': 'NIYTRI Score (0–100) — our internal quality score',
  'p/e': 'Price-to-earnings ratio', 'pe': 'Price-to-earnings ratio',
  'p/b': 'Price-to-book ratio', 'pb': 'Price-to-book ratio',
  'eps': 'Earnings per share', 'peg': 'P/E-to-growth ratio',
  'net margin': 'Net profit margin (%)', 'op margin': 'Operating margin (%)',
  'roe': 'Return on equity (%)', 'div yield': 'Dividend yield (%)',
  'weight': 'Share of portfolio value (%)', 'value': 'Current market value',
  'p&l': 'Profit / loss vs your cost', 'mkt cap': 'Market capitalisation',
  'market cap': 'Market capitalisation', 'ltp': 'Last traded price', 'price': 'Price',
  'qty': 'Quantity held', 'avg price': 'Average buy price',
}
const colTip = h => {
  const k = String(h).replace(/[*`]/g, '').trim().toLowerCase()
  const v = COL_TIPS[k]
  return v ? ` title="${v.replace(/"/g, '&quot;')}" class="has-tip"` : ''
}

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
      // collect body rows first so a header-only table (no data) is skipped entirely
      let j = i + 2
      let body = ''
      let nrows = 0
      while (j < lines.length && lines[j].trim() !== '' && lines[j].includes('|')) {
        const row = cells(lines[j].trim())
        body += '<tr>'
        headers.forEach((_, k) => { body += `<td${al(k)}>${inline(row[k] || '')}</td>` })
        body += '</tr>'
        nrows++
        j++
      }
      if (nrows > 0) {
        let t = '<div class="md-table-wrap"><table class="md-table"><thead><tr>'
        headers.forEach((h, k) => { t += `<th${al(k)}${colTip(h)}>${inline(h)}</th>` })
        t += '</tr></thead><tbody>' + body + '</tbody></table></div>'
        html += t
      }
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
    .replace(/\[([^\]]+)\]\(#page:([A-Za-z][A-Za-z ]{0,19})\)/g,
             (m, t, p) => `<a href="#" class="md-pagelink" data-page="${p.trim()}">${t}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
             '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}
