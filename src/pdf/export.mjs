// Turns a request — a route and a scope — into the document md2pdf renders.
//
// Lives apart from serve.mjs so the ACL behaviour is testable without a server:
// which pages a session may read is the load-bearing rule here, not the HTTP.
import fs from 'node:fs'
import path from 'node:path'
import { requirementFor, isAllowed } from '../auth/acl.mjs'
import { renderSection, assemble, siteCss, readDirectives } from './document.mjs'
import { langForRoute } from './manifest.mjs'

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
 * Book scope: every page in the locale's manifest order that THIS SESSION may
 * read. Pages it may not are listed at the end rather than dropped — a document
 * that looks complete and is not is the worst artefact, because it is the one
 * that gets filed. (Same rule as OWLIKI.06 §2.3's omitted-language list.)
 */
export function buildDocument({ dist, base = '/', route, scope = 'page', pdf, acl = null, session = null, siteTitle = 'Documentation', mdbookDir }) {
  const css0 = printCss(mdbookDir)
  const stamp = new Date().toISOString().slice(0, 10)

  if (scope === 'book') {
    const manifest = readManifest(dist)
    if (!manifest) {
      throw Object.assign(new Error('this site was built without a PDF manifest — rebuild with pdf configured'), { status: 409 })
    }
    const langs = Object.keys(manifest.locales || {})
    const lang = langForRoute(route, langs, manifest.defaultLang)
    const locale = manifest.locales?.[lang] || manifest.locales?.[manifest.defaultLang]
    if (!locale?.pages?.length) throw Object.assign(new Error('no pages to export'), { status: 409 })

    const sections = []
    const omitted = []
    let css = ''
    for (const page of locale.pages) {
      if (!allowed(acl, page.route, session)) {
        omitted.push(page.title || page.route)
        continue
      }
      const file = pageFile(dist, page.route)
      if (!file) continue // in the menu, not in the build — nothing to render
      const html = fs.readFileSync(file, 'utf8')
      if (!css) css = siteCss(html, dist, base)
      const section = renderSection(html, {
        dist,
        base,
        numbered: pdf.numbered,
        wholeBook: true,
        section: sections.length + 1
      })
      if (section) sections.push(section)
    }
    if (!sections.length) {
      throw Object.assign(new Error('no pages in this export are readable by you'), { status: 403 })
    }
    return {
      title: locale.title || siteTitle,
      filename: `${slug(locale.title || siteTitle)}.pdf`,
      html: assemble({
        title: locale.title || siteTitle,
        siteTitle,
        sections,
        css,
        printCss: css0,
        extraCss: pdf.css || '',
        toc: true,
        coverDate: stamp,
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
