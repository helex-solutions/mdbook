// Converts GitBook card tables (`<table data-view="cards">`) into a styled card
// grid. GitBook renders these tables as cards; VitePress would show a plain
// table, so we rewrite them at staging time.
//
// Column semantics (from the <thead> <th> attributes):
//   data-hidden       -> column not shown as a field
//   data-card-cover   -> column holds the card's cover image (an <a> or <img>)
import { parse } from 'node-html-parser'

const TABLE_RE = /<table\s+data-view="cards"[\s\S]*?<\/table>/gi

export function transformGitbookCards(text) {
  if (!text.includes('data-view="cards"')) return text
  return text.replace(TABLE_RE, (tableHtml) => {
    try {
      return renderCards(tableHtml)
    } catch {
      return tableHtml // never break the build over a card table
    }
  })
}

// Normalize a GitBook asset path to a root-served public path.
function assetUrl(href) {
  const clean = href.replace(/^(\.\.?\/)+/, '/')
  return encodeURI(clean.startsWith('/') ? clean : '/' + clean)
}

// Strip GitBook's empty/wrapping <p> tags from a cell's inner HTML.
function cellHtml(cell) {
  if (!cell) return ''
  let html = cell.innerHTML || ''
  html = html.replace(/<p>\s*<\/p>/gi, '').replace(/<\/?p>/gi, ' ')
  return html.trim()
}

function hasText(html) {
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}

function renderCards(tableHtml) {
  const root = parse(tableHtml)
  const table = root.querySelector('table')
  const headers = table.querySelectorAll('thead th')
  let coverIdx = -1
  const visible = []
  headers.forEach((th, i) => {
    const isCover = th.hasAttribute('data-card-cover')
    if (isCover) coverIdx = i
    if (!th.hasAttribute('data-hidden')) visible.push(i)
  })

  const rows = table.querySelectorAll('tbody tr')
  const cards = rows.map((tr) => {
    const cells = tr.querySelectorAll('td')

    let cover = ''
    if (coverIdx >= 0 && cells[coverIdx]) {
      const a = cells[coverIdx].querySelector('a')
      const img = cells[coverIdx].querySelector('img')
      const href = a?.getAttribute('href') || img?.getAttribute('src')
      if (href) cover = `<img class="mdbook-card-cover" src="${assetUrl(href)}" alt="" loading="lazy">`
    }

    const fields = visible
      .map((i) => cellHtml(cells[i]))
      .filter((h) => hasText(h) || /<img/i.test(h))
    const title = fields.length ? `<div class="mdbook-card-title">${fields[0]}</div>` : ''
    const rest = fields
      .slice(1)
      .map((h) => `<div class="mdbook-card-field">${h}</div>`)
      .join('')

    return `<div class="mdbook-card">${cover}<div class="mdbook-card-body">${title}${rest}</div></div>`
  })

  return `<div class="mdbook-cards">${cards.join('')}</div>`
}
