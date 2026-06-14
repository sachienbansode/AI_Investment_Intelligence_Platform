// Minimal, safe markdown → HTML (escapes input first; no external deps).
// Supports: **bold**, *italic*, `code`, "- " bullets, "1. " numbered lists,
// ### headings, [text](url) links, line breaks.
export function mdToHtml(text) {
  if (!text) return ''
  const esc = text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const lines = esc.split(/\r?\n/)
  let html = '', inUl = false, inOl = false
  const closeLists = () => {
    if (inUl) { html += '</ul>'; inUl = false }
    if (inOl) { html += '</ol>'; inOl = false }
  }
  for (const raw of lines) {
    const line = raw.trim()
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
