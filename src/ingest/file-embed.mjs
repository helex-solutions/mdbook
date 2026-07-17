// Renders GitBook file embeds — `{% file src="…" %}` — as a preview + download
// card. PDFs get an inline iframe preview; other files get a download card.
//
// Runs at staging so the base path can be baked into the (raw-HTML) URLs, which
// VitePress does not prefix automatically.
const FILE_RE = /\{%\s*file\s+src=["']([^"']+)["']\s*%\}/g

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Normalize an asset path to a base-prefixed, root-relative URL.
function assetUrl(src, base) {
  let s = src.trim().replace(/^(\.\.?\/)+/, '/')
  if (!s.startsWith('/') && !/^https?:/i.test(s)) s = '/' + s
  if (/^https?:/i.test(s)) return s
  const b = (base || '/').replace(/\/$/, '')
  return encodeURI(b + s)
}

export function transformFileEmbeds(text, base) {
  if (!text.includes('{% file')) return text
  return text.replace(FILE_RE, (_m, src) => {
    const url = assetUrl(src, base)
    const name = decodeURIComponent(url.split('/').pop())
    const isPdf = /\.pdf(\?|#|$)/i.test(url)
    const actions =
      `<a class="mdbook-file-btn" href="${url}" target="_blank" rel="noopener">Open</a>` +
      `<a class="mdbook-file-btn mdbook-file-download" href="${url}" download>Download</a>`
    const bar =
      `<div class="mdbook-file-bar"><span class="mdbook-file-icon">📄</span>` +
      `<span class="mdbook-file-name">${esc(name)}</span>` +
      `<span class="mdbook-file-actions">${actions}</span></div>`
    if (isPdf) {
      return (
        `<div class="mdbook-file mdbook-pdf">${bar}` +
        `<iframe class="mdbook-pdf-frame" src="${url}#view=FitH" title="${esc(name)}" loading="lazy"></iframe>` +
        `</div>`
      )
    }
    return `<div class="mdbook-file">${bar}</div>`
  })
}
