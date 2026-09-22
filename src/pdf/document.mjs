// Turns built pages into ONE self-contained HTML document for md2pdf.
//
// The input is `dist/**.html` — the same bytes the reader is served — so nothing
// re-renders markdown and the PDF cannot drift from the page (docs/pdf-design.md).
// The output references nothing external: stylesheets and images are inlined, so
// the renderer can run with its network cut (§3.4).
import fs from 'node:fs'
import path from 'node:path'
import { parse } from 'node-html-parser'

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Elements that are chrome, controls or script — not part of the document.
const DROP = [
  'script',
  'noscript',
  '.header-anchor',
  '.mdbook-zoom',
  '.mdbook-present-ui',
  '.mdbook-pdf-ui',
  '.mdbook-auth',
  '.mdbook-op-filter',
  '.mdbook-tryit',
  '.mdbook-comments',
  '.VPDocFooter',
  '.mdbook-breadcrumbs'
]

// An inlined asset has to fit in the request body; a 20MB hero image in a book
// export is a failed render, not a nicer document.
const MAX_INLINE = 4 * 1024 * 1024

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf'
}

// Resolve a site URL to a file in dist. Returns null for anything external,
// anything that escapes dist, and anything that isn't there.
export function distFile(dist, url, base = '/') {
  if (!url || /^(https?:|data:|blob:|mailto:|#)/i.test(url)) return null
  let rel = url.split(/[?#]/)[0]
  if (!rel.startsWith('/')) return null
  if (base !== '/' && rel.startsWith(base)) rel = '/' + rel.slice(base.length)
  try {
    rel = decodeURIComponent(rel)
  } catch {
    /* a malformed escape is not a path we can resolve */
  }
  // Resolved first, for the same reason as pageFile(): the containment check
  // is between resolved paths, so a relative dist would reject everything.
  const root = path.resolve(dist)
  const abs = path.resolve(root, '.' + path.posix.normalize(rel))
  if (abs !== root && !abs.startsWith(root + path.sep)) return null
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? abs : null
}

export function dataUri(file) {
  const stat = fs.statSync(file)
  if (stat.size > MAX_INLINE) return null
  const mime = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`
}

// ------------------------------------------------------------- extraction ---

/** The `.vp-doc` body and `<title>` of a built page. */
export function extractArticle(html) {
  const root = parse(html, { blockTextElements: { script: false, style: true } })
  const doc = root.querySelector('.vp-doc')
  if (!doc) return null
  const title = (root.querySelector('title')?.textContent || '').split(' | ')[0].trim()
  return { title, doc }
}

/**
 * Stylesheet hrefs the built page links, in order.
 *
 * `rel` is a TOKEN LIST, not a value: VitePress emits
 * `rel="preload stylesheet"`, so matching `rel="stylesheet"` exactly finds
 * nothing and the PDF silently comes out unstyled — which is exactly what it
 * did. Attribute order varies too, so href is read from the whole tag.
 */
export function stylesheetHrefs(html) {
  return [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter((m) => {
      const rel = /\brel=["']([^"']*)["']/i.exec(m[0])?.[1] || ''
      return rel.split(/\s+/).includes('stylesheet')
    })
    .map((m) => /\bhref=["']([^"']+)["']/i.exec(m[0])?.[1])
    .filter(Boolean)
}

/**
 * Strip what cannot print, and open what is closed.
 *
 * A collapsed `<details>` must be OPEN in the document rather than quietly
 * missing from it — the same rule OWLIKI.06 applies to pages omitted for
 * language: a document that looks complete and is not is the worst artefact,
 * because it is the one that gets filed and cited.
 */
export function cleanArticle(doc) {
  for (const sel of DROP) doc.querySelectorAll(sel).forEach((n) => n.remove())
  doc.querySelectorAll('details').forEach((d) => d.setAttribute('open', ''))
  // An inline PDF preview is an iframe; paper cannot hold one. The card's own
  // Open/Download links stay, so the file is still named and reachable.
  doc.querySelectorAll('.mdbook-pdf-frame').forEach((f) => f.remove())
  // Interactive controls that would print as empty boxes.
  doc.querySelectorAll('input, select, textarea, button').forEach((n) => n.remove())
  return doc
}

// --------------------------------------------------------------- numbering ---

const AUTHORED = /^\d+(\.\d+)*\.?\s/

/**
 * Number h2–h4 as `1.`, `1.1`, `1.1.1`, prefixed INTO the heading text so the
 * numbers survive copy-paste and PDF text extraction — they are not CSS
 * counters (OWLIKI.06 §2.5). A heading that already starts with a number-like
 * token is left as authored. In a book export the page itself numbers at h1.
 *
 * Returns the TOC entries, so the contents page and the headings are produced by
 * the same pass and cannot disagree.
 */
export function numberHeadings(doc, { wholeBook = false, section = 0 } = {}) {
  const counters = [0, 0, 0] // h2..h4
  const toc = []
  for (const h of doc.querySelectorAll('h1, h2, h3, h4')) {
    const level = Number(h.tagName[1])
    const text = h.textContent.trim()
    if (AUTHORED.test(text)) {
      toc.push({ level, text, id: h.getAttribute('id') || null })
      continue
    }
    if (level === 1) {
      counters[0] = counters[1] = counters[2] = 0
      if (wholeBook) h.set_content(`${section}. ${h.innerHTML}`)
      toc.push({ level, text: wholeBook ? `${section}. ${text}` : text, id: h.getAttribute('id') || null })
      continue
    }
    counters[level - 2]++
    for (let i = level - 1; i < 3; i++) counters[i] = 0
    const parts = wholeBook ? [section] : []
    for (let i = 0; i <= level - 2; i++) parts.push(counters[i])
    const prefix = parts.join('.')
    h.set_content(`${prefix}. ${h.innerHTML}`)
    toc.push({ level, text: `${prefix}. ${text}`, id: h.getAttribute('id') || null })
  }
  return toc
}

// Headings carry the page's own anchor ids. In a book every page's ids land in
// one document, so `#overview` from three pages would collide and the TOC would
// link to whichever came first. Prefix them per section.
export function namespaceIds(doc, section) {
  const p = `s${section}-`
  doc.querySelectorAll('[id]').forEach((n) => n.setAttribute('id', p + n.getAttribute('id')))
  doc.querySelectorAll('a[href^="#"]').forEach((a) => a.setAttribute('href', '#' + p + a.getAttribute('href').slice(1)))
  return p
}

// ----------------------------------------------------------------- assets ---

/** Inline `<img>` sources that resolve inside dist; drop the ones that don't. */
export function inlineImages(doc, dist, base = '/') {
  for (const img of doc.querySelectorAll('img')) {
    const src = img.getAttribute('src')
    if (!src || src.startsWith('data:')) continue
    const file = distFile(dist, src, base)
    const uri = file && dataUri(file)
    if (uri) img.setAttribute('src', uri)
    // An image the renderer could not be given would be a blocked request and
    // a broken-image glyph; a named placeholder says what is missing instead.
    else img.replaceWith(parse(`<span class="mdbook-pdf-missing">[image: ${esc(src)}]</span>`))
    img.removeAttribute?.('loading')
  }
  return doc
}

/** Inline `url(...)` references in a stylesheet, so fonts and sprites resolve. */
export function inlineCssUrls(css, dist, base = '/') {
  return css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (whole, _q, url) => {
    if (/^(data:|https?:|\/\/)/i.test(url)) return whole
    const file = distFile(dist, url.startsWith('/') ? url : '/assets/' + url, base)
    const uri = file && dataUri(file)
    return uri ? `url(${uri})` : whole
  })
}

/**
 * The site's own built stylesheet, inlined.
 *
 * This is what makes the PDF the site's skin rather than a generic print sheet:
 * the same CSS VitePress compiled for the reader, with `print.css` layered on
 * top for paged media.
 */
export function siteCss(html, dist, base = '/') {
  const out = []
  for (const href of stylesheetHrefs(html)) {
    const file = distFile(dist, href, base)
    if (file) out.push(inlineCssUrls(fs.readFileSync(file, 'utf8'), dist, base))
  }
  return out.join('\n')
}

// -------------------------------------------------------------- directives ---

/**
 * Per-page layout directives, ported from the `md2pdf:` comment/frontmatter of
 * ~/bin/md2pdf.sh. Read back from the `<meta name="mdbook-pdf">` tag the build
 * emitted (src/vitepress.mjs).
 *
 *     ---
 *     pdf: { orientation: landscape, margins: narrow, scale: 0.9, tables: fit }
 *     ---
 *
 * Page scope only: in a book export a dozen pages would each claim a different
 * page box, and the last one read would win silently. Useful exactly where the
 * script uses it — a page that is one wide reference table.
 *
 * Values are matched against fixed sets rather than interpolated, because they
 * end up in CSS and in Chromium's own print settings.
 */
export function readDirectives(html) {
  const m = /<meta[^>]+name=["']mdbook-pdf["'][^>]*content=["']([^"']*)["'][^>]*>/i.exec(html)
  if (!m) return null
  let raw
  try {
    raw = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const out = {}
  if (String(raw.orientation).toLowerCase() === 'landscape') out.landscape = true
  const margins = { narrow: '12mm', normal: null, wide: '30mm' }[String(raw.margins).toLowerCase()]
  if (margins) out.margin = { top: margins, right: margins, bottom: margins, left: margins }
  const scale = Number(raw.scale)
  if (Number.isFinite(scale) && scale >= 0.5 && scale <= 1.5) out.scale = scale
  // `tables: fit` shrinks wide tables to the page rather than letting them
  // overflow it — the one directive that is CSS rather than a print setting.
  if (String(raw.tables || '').toLowerCase().split(/[,\s]+/).includes('fit')) {
    out.css =
      'table{width:100%!important;table-layout:auto}' +
      'table th,table td{overflow-wrap:break-word;word-break:break-word;hyphens:auto}' +
      'table,table th,table td{font-size:8.5pt}'
  }
  return Object.keys(out).length ? out : null
}

// --------------------------------------------------------------- assembly ---

/** One page, ready to be placed in a document. */
export function renderSection(html, { dist, base = '/', numbered = true, wholeBook = false, section = 0 }) {
  const extracted = extractArticle(html)
  if (!extracted) return null
  const { title, doc } = extracted
  cleanArticle(doc)
  const toc = numbered ? numberHeadings(doc, { wholeBook, section }) : collectToc(doc)
  if (wholeBook) namespaceIds(doc, section)
  inlineImages(doc, dist, base)
  return { title, toc, html: doc.innerHTML }
}

function collectToc(doc) {
  return doc.querySelectorAll('h1, h2, h3, h4').map((h) => ({
    level: Number(h.tagName[1]),
    text: h.textContent.trim(),
    id: h.getAttribute('id') || null
  }))
}

function tocHtml(entries, { maxLevel = 3 } = {}) {
  const rows = entries
    .filter((e) => e.level <= maxLevel)
    .map(
      (e) =>
        `<li class="toc-l${e.level}">${e.id ? `<a href="#${esc(e.id)}">${esc(e.text)}</a>` : esc(e.text)}</li>`
    )
  return rows.length ? `<nav class="mdbook-pdf-toc"><h2>Contents</h2><ul>${rows.join('')}</ul></nav>` : ''
}

/**
 * Wrap rendered sections into the document md2pdf receives.
 *
 * `omitted` names pages a book export left out — pages this reader may not open.
 * They are LISTED, never silently dropped, for the reason in cleanArticle().
 */
export function assemble({
  title,
  siteTitle,
  sections,
  css = '',
  printCss = '',
  extraCss = '',
  toc = false,
  coverDate = null,
  omitted = []
}) {
  const body = sections
    .map((s) => `<section class="mdbook-pdf-section">${s.html}</section>`)
    .join('\n')
  const cover = toc
    ? `<header class="mdbook-pdf-cover"><h1>${esc(title)}</h1>` +
      (siteTitle && siteTitle !== title ? `<p class="mdbook-pdf-site">${esc(siteTitle)}</p>` : '') +
      (coverDate ? `<p class="mdbook-pdf-date">${esc(coverDate)}</p>` : '') +
      '</header>'
    : ''
  const contents = toc ? tocHtml(sections.flatMap((s) => s.toc)) : ''
  const tail = omitted.length
    ? '<section class="mdbook-pdf-omitted"><h2>Omitted pages</h2>' +
      '<p>Not included — this export covers only the pages you may read:</p><ul>' +
      omitted.map((o) => `<li>${esc(o)}</li>`).join('') +
      '</ul></section>'
    : ''
  return (
    '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    `<title>${esc(title)}</title>` +
    `<style>${css}</style><style>${printCss}</style>` +
    (extraCss ? `<style>${extraCss}</style>` : '') +
    '</head><body class="mdbook-pdf">' +
    cover +
    contents +
    `<div class="vp-doc">${body}${tail}</div>` +
    '</body></html>'
  )
}

/** Chromium's footer: page number, and the site it came from. */
export function footerTemplate(siteTitle) {
  return (
    '<div style="width:100%;font-size:8pt;color:#666;padding:0 16mm;' +
    'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;' +
    'display:flex;justify-content:space-between;">' +
    `<span>${esc(siteTitle || '')}</span>` +
    '<span><span class="pageNumber"></span> / <span class="totalPages"></span></span>' +
    '</div>'
  )
}
