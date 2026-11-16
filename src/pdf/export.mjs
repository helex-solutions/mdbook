// Turns a request — a route and a scope — into the document md2pdf renders.
//
// Lives apart from serve.mjs so the ACL behaviour is testable without a server:
// which pages a session may read is the load-bearing rule here, not the HTTP.
import fs from 'node:fs'
import path from 'node:path'
import { requirementFor, isAllowed } from '../auth/acl.mjs'
import { renderSection, assemble, siteCss, readDirectives } from './document.mjs'
import { langForRoute, subtreePages, routeKey } from './manifest.mjs'

// Base-relative route -> the built HTML file, mirroring serve.mjs's own
// cleanUrls resolution.
export function pageFile(dist, route) {
  // `dist` is resolved first: the containment check below compares resolved
  // paths, so a relative dist would make every route look like an escape.
  const root = path.resolve(dist)
  const rel = String(route || '/').replace(/^\/+/, '').replace(/\.html$/, '')
  const safe = path.normalize(rel).replace(/^([/\\.])+/, '')
  const base = path.resolve(root, safe)
  if (base !== root && !base.startsWith(root + path.sep)) return null
  for (const c of [`${base}.html`, path.join(base, 'index.html')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

const allowed = (acl, route, session) => !acl || isAllowed(requirementFor(acl, route), session)

// A filename a person can find again: the page title, or the site's.
const slug = (s) =>
  String(s || 'document')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}._-]+/gu, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 80) || 'document'

function readManifest(dist) {
  const p = path.join(dist, 'pdf-manifest.json')
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

// The menu's own label for a route — a fallback for the document name when the
// built page has no title to read.
function titleFor(pages, route) {
  const key = routeKey(route)
  return (pages || []).find((p) => routeKey(p.route) === key)?.title || null
}

export function printCss(mdbookDir) {
  const p = path.join(mdbookDir, 'src', 'theme', 'styles', 'print.css')
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
}

/**
 * Build the document for one request.
 *
 * Returns `{ html, filename, title }`, or throws with a `status`.
 *
 * Page scope: the one page, ACL-checked.
 * Subpages scope: that page and everything under it in the menu.
 * Book scope: every page in the locale's manifest order.
 *
 * The two multi-page scopes contain what THIS SESSION may read. Pages it may not
 * are listed at the end rather than dropped — a document that looks complete and
 * is not is the worst artefact, because it is the one that gets filed. (Same rule
 * as OWLIKI.06 §2.3's omitted-language list.)
 */
export function buildDocument({ dist, base = '/', route, scope = 'page', pdf, acl = null, session = null, siteTitle = 'Documentation', mdbookDir }) {
  const css0 = printCss(mdbookDir)
  const stamp = new Date().toISOString().slice(0, 10)

  if (scope === 'book' || scope === 'subpages') {
    const manifest = readManifest(dist)
    if (!manifest) {
      throw Object.assign(new Error('this site was built without a PDF manifest — rebuild with pdf configured'), { status: 409 })
    }
    const langs = Object.keys(manifest.locales || {})
    const lang = langForRoute(route, langs, manifest.defaultLang)
    const locale = manifest.locales?.[lang] || manifest.locales?.[manifest.defaultLang]
    if (!locale?.pages?.length) throw Object.assign(new Error('no pages to export'), { status: 409 })

    let pages = locale.pages
    if (scope === 'subpages') {
      // The page it was asked FROM is checked first and on its own, so a reader
      // who may not open it gets the page scope's 403 (and the login redirect
      // serve.mjs hangs off it) rather than a document of its children.
      if (!allowed(acl, route, session)) throw Object.assign(new Error('not allowed'), { status: 403 })
      if (!pageFile(dist, route)) throw Object.assign(new Error('no such page'), { status: 404 })
      pages = subtreePages(locale.pages, route)
      // A page outside the menu has no children to find. Exporting it alone is
      // the honest answer; refusing would be a button that fails on some pages.
      if (!pages.length) pages = [{ route, title: null }]
    }

    // Resolved before anything is rendered, because the COUNT decides the shape
    // of the document: one page is a page, not a book with a cover and a
    // one-line table of contents.
    const omitted = []
    const files = []
    for (const page of pages) {
      if (!allowed(acl, page.route, session)) {
        omitted.push(page.title || page.route)
        continue
      }
      const file = pageFile(dist, page.route)
      if (!file) continue // in the menu, not in the build — nothing to render
      files.push(file)
    }
    if (!files.length) {
      throw Object.assign(new Error('no pages in this export are readable by you'), { status: 403 })
    }
    // Refused BEFORE a single page is read. The count is of the pages this
    // reader may actually open, so the ceiling is per reader, and it costs
    // nothing to apply — which is the point: the document that kills the
    // process is the one that is never started. (docs/pdf-design.md §4.2)
    const maxPages = pdf.maxPages ?? 200
    if (maxPages && files.length > maxPages) {
      throw Object.assign(
        new Error(
          `this export is ${files.length} pages and the limit is ${maxPages} — ` +
            'download a section at a time, or raise pdf.maxPages for this site'
        ),
        { status: 413 }
      )
    }
    const collection = scope === 'book' || files.length > 1

    const sections = []
    let css = ''
    let firstHtml = ''
    let bytes = 0
    const maxBytes = pdf.maxBytes ?? 32 * 1048576
    for (const file of files) {
      const html = fs.readFileSync(file, 'utf8')
      if (!css) css = siteCss(html, dist, base)
      if (!firstHtml) firstHtml = html
      const section = renderSection(html, {
        dist,
        base,
        numbered: pdf.numbered,
        wholeBook: collection,
        section: sections.length + 1
      })
      if (!section) continue
      sections.push(section)
      // Checked AS IT GROWS, not at the end: the end is what we are trying not
      // to reach. Pages carry their images inlined as data: URIs, so a page is
      // hundreds of KB rather than tens, and the parse trees behind this string
      // cost an order of magnitude more again — a measured 523 MB of RSS for
      // 26.5 MB of sections. Stopping at the ceiling stops all three.
      bytes += section.html.length
      if (maxBytes && bytes > maxBytes) {
        throw Object.assign(
          new Error(
            `this export passed ${Math.round(maxBytes / 1048576)} MB at page ${sections.length} ` +
              `of ${files.length} — download a section at a time, or raise pdf.maxBytes for this site`
          ),
          { status: 413 }
        )
      }
    }
    if (!sections.length) {
      throw Object.assign(new Error('no pages in this export have an article to export'), { status: 409 })
    }

    // A book is titled by the book; a subpages export by the page it was asked
    // from — that is the name a reader will look for the file under.
    const name =
      scope === 'book'
        ? locale.title || siteTitle
        : sections[0].title || titleFor(locale.pages, route) || siteTitle
    // Collapsed to the single page it was asked from, a subpages export IS a
    // page export, so it honours that page's layout directives too. A real
    // collection cannot: a dozen pages each claiming a page box cannot all win.
    const directives = collection ? null : readDirectives(firstHtml)
    return {
      title: name,
      filename: `${slug(name)}.pdf`,
      options: directives ? { landscape: directives.landscape, margin: directives.margin, scale: directives.scale } : null,
      html: assemble({
        title: name,
        siteTitle,
        sections,
        css,
        printCss: css0,
        extraCss: [pdf.css || '', directives?.css || ''].filter(Boolean).join('\n'),
        toc: collection,
        coverDate: collection ? stamp : null,
        omitted
      })
    }
  }

  if (!allowed(acl, route, session)) {
    throw Object.assign(new Error('not allowed'), { status: 403 })
  }
  const file = pageFile(dist, route)
  if (!file) throw Object.assign(new Error('no such page'), { status: 404 })
  const html = fs.readFileSync(file, 'utf8')
  const section = renderSection(html, { dist, base, numbered: pdf.numbered, wholeBook: false })
  if (!section) throw Object.assign(new Error('that page has no article to export'), { status: 409 })
  // This page's own layout directives, if it set any. Book scope ignores them —
  // a dozen pages each claiming a different page box cannot be honoured, and
  // letting the last one read win silently is worse than ignoring all of them.
  const directives = readDirectives(html)
  return {
    title: section.title || siteTitle,
    filename: `${slug(section.title || siteTitle)}.pdf`,
    options: directives ? { landscape: directives.landscape, margin: directives.margin, scale: directives.scale } : null,
    html: assemble({
      title: section.title || siteTitle,
      siteTitle,
      sections: [section],
      css: siteCss(html, dist, base),
      printCss: css0,
      extraCss: [pdf.css || '', directives?.css || ''].filter(Boolean).join('\n'),
      toc: false
    })
  }
}
