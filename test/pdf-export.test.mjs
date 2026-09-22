// PDF export (docs/pdf-design.md). Distinct from pdf.test.mjs, which covers the
// opposite direction — publishing PDFs stored in the repo AS pages.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { parse } from 'node-html-parser'
import { normalizePdf, pdfBundle } from '../src/pdf/config.mjs'
import { flattenSidebar, buildPdfManifest, langForRoute } from '../src/pdf/manifest.mjs'
import {
  readDirectives,
  distFile,
  stylesheetHrefs,
  numberHeadings,
  namespaceIds,
  cleanArticle,
  inlineImages,
  extractArticle,
  assemble
} from '../src/pdf/document.mjs'
import { pageFile, buildDocument } from '../src/pdf/export.mjs'
import { createHandler, contentDisposition } from '../src/serve.mjs'
import { filenameFrom, saveBlob } from '../src/theme/download.mjs'

const tmp = (files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdbook-pdfx-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  return dir
}

const page = (title, body) =>
  `<!DOCTYPE html><html><head><title>${title} | Site</title>` +
  `<link rel="preload stylesheet" href="/assets/style.css" as="style"></head>` +
  `<body><div class="VPNav">chrome</div><div class="vp-doc"><div>${body}</div></div></body></html>`

// ------------------------------------------------------------------ config ---

test('pdf: naming the server IS the switch; no server means no feature', () => {
  assert.equal(normalizePdf(undefined, '/tmp'), null)
  assert.equal(normalizePdf({}, '/tmp'), null)
  assert.equal(normalizePdf({ server: 'http://md2pdf:18509', enabled: false }, '/tmp'), null)
  assert.equal(normalizePdf({ server: 'http://md2pdf:18509', scope: [] }, '/tmp'), null)
  const cfg = normalizePdf({ server: 'http://md2pdf:18509/' }, '/tmp')
  assert.equal(cfg.server, 'http://md2pdf:18509') // trailing slash trimmed
  assert.deepEqual(cfg.scope, ['page', 'book'])
  assert.equal(cfg.theme, 'site')
  assert.equal(cfg.numbered, true)
})

test('pdf: a token comes from the environment, never from the config file', () => {
  process.env.MDBOOK_TEST_PDF_TOKEN = 's3cret'
  const cfg = normalizePdf({ server: 'http://x:18509', token: '${MDBOOK_TEST_PDF_TOKEN}' }, '/tmp')
  assert.equal(cfg.token, 's3cret')
  delete process.env.MDBOOK_TEST_PDF_TOKEN
  // An unset variable is null, not the literal "${…}" sent as a bearer token.
  assert.equal(normalizePdf({ server: 'http://x:18509', token: '${MDBOOK_TEST_PDF_TOKEN}' }, '/tmp').token, null)
})

test('pdf: the client bundle carries the scope and NOT the server or token', () => {
  const cfg = normalizePdf({ server: 'http://md2pdf:18509', token: 'abc', scope: ['page'] }, '/tmp')
  const bundle = pdfBundle(cfg)
  assert.deepEqual(bundle, { scope: ['page'] })
  const json = JSON.stringify(bundle)
  assert.doesNotMatch(json, /18509|abc/)
})

test('pdf: an unknown scope value is dropped rather than passed through', () => {
  const cfg = normalizePdf({ server: 'http://x:18509', scope: ['page', 'universe'] }, '/tmp')
  assert.deepEqual(cfg.scope, ['page'])
})

// ---------------------------------------------------------------- manifest ---

test('manifest: a SUMMARY.md sidebar flattens in order', () => {
  const pages = flattenSidebar([
    { text: 'Intro', link: '/' },
    { text: 'Guide', link: '/guide/', items: [{ text: 'A', link: '/guide/a' }] }
  ])
  assert.deepEqual(pages.map((p) => p.route), ['/', '/guide/', '/guide/a'])
})

test('manifest: a multi-sidebar tree drops back-links and never repeats a page', () => {
  // The auto folder-tree layout (src/ingest/gitbook.mjs): each section's sidebar
  // opens with an "All sections" link back to the root, and the root sidebar
  // links INTO each section. Concatenating the values naively yields the root
  // page once per section and every landing page twice.
  const pages = flattenSidebar({
    '/': [
      { text: 'Guide', link: '/guide/' },
      { text: 'Internal', link: '/internal/' }
    ],
    '/guide/': [
      { text: '← All sections', link: '/' },
      { text: 'Guide', link: '/guide/', items: [{ text: 'A', link: '/guide/a' }] }
    ],
    '/internal/': [
      { text: '← All sections', link: '/' },
      { text: 'Internal', link: '/internal/', items: [{ text: 'N', link: '/internal/n' }] }
    ]
  })
  const routes = pages.map((p) => p.route)
  assert.deepEqual(routes, ['/guide/', '/internal/', '/guide/a', '/internal/n'])
  assert.equal(new Set(routes).size, routes.length, 'a route appears twice')
  assert.ok(!routes.includes('/'), 'the back-link leaked in as a page')
})

test('manifest: icon markup is stripped from titles', () => {
  const [p] = flattenSidebar([{ text: '<img src="x.svg"> Guide', link: '/guide/' }])
  assert.equal(p.title, 'Guide')
})

test('manifest: a book export follows the locale of the page it was asked from', () => {
  const m = buildPdfManifest({
    sidebars: { en: [{ text: 'A', link: '/a' }], lt: [{ text: 'A', link: '/lt/a' }] },
    title: 'Docs',
    defaultLang: 'en'
  })
  assert.deepEqual(Object.keys(m.locales).sort(), ['en', 'lt'])
  assert.equal(langForRoute('/lt/guide/x', ['en', 'lt'], 'en'), 'lt')
  assert.equal(langForRoute('/guide/x', ['en', 'lt'], 'en'), 'en')
})

// ---------------------------------------------------------------- document ---

test('document: rel is a token list — VitePress emits "preload stylesheet"', () => {
  // Matching rel="stylesheet" exactly finds nothing here, and the PDF comes out
  // silently unstyled.
  assert.deepEqual(stylesheetHrefs('<link rel="preload stylesheet" href="/a.css" as="style">'), ['/a.css'])
  assert.deepEqual(stylesheetHrefs('<link href="/b.css" rel="stylesheet">'), ['/b.css'])
  assert.deepEqual(stylesheetHrefs('<link rel="icon" href="/f.png">'), [])
})

test('document: headings are numbered INTO the text, not with CSS counters', () => {
  const doc = parse('<div><h1>Top</h1><h2>One</h2><h3>Deep</h3><h2>Two</h2></div>')
  const toc = numberHeadings(doc, { wholeBook: false })
  const text = doc.textContent
  assert.match(text, /1\. One/)
  assert.match(text, /1\.1\. Deep/)
  assert.match(text, /2\. Two/)
  // The TOC comes from the same pass, so the two cannot disagree.
  assert.deepEqual(toc.map((t) => t.text), ['Top', '1. One', '1.1. Deep', '2. Two'])
})

test('document: a hand-numbered heading is not numbered twice', () => {
  // docs.helex.org's own pages are authored this way ("17 — Module dependencies").
  const doc = parse('<div><h2>17 — Module dependencies</h2><h2>Next</h2></div>')
  numberHeadings(doc, { wholeBook: false })
  assert.match(doc.textContent, /17 — Module dependencies/)
  assert.doesNotMatch(doc.textContent, /1\. 17/)
  // Numbering continues for the headings that are not hand-numbered.
  assert.match(doc.textContent, /1\. Next/)
})

test('document: inline markup inside a heading survives numbering', () => {
  const doc = parse('<div><h2>The <code>pdf</code> block</h2></div>')
  numberHeadings(doc, { wholeBook: false })
  assert.match(doc.toString(), /<code>pdf<\/code>/)
  assert.match(doc.textContent, /1\. The pdf block/)
})

test('document: book scope numbers the page at h1 and namespaces its anchors', () => {
  const doc = parse('<div><h1 id="over">Over</h1><h2 id="a">A</h2><a href="#a">jump</a></div>')
  numberHeadings(doc, { wholeBook: true, section: 3 })
  namespaceIds(doc, 3)
  assert.match(doc.textContent, /3\. Over/)
  assert.match(doc.textContent, /3\.1\. A/)
  // Without this, #a from three pages collides in one document.
  assert.match(doc.toString(), /id="s3-a"/)
  assert.match(doc.toString(), /href="#s3-a"/)
})

test('document: a collapsed section is opened, never dropped', () => {
  const doc = parse('<div class="vp-doc"><details><summary>Why</summary><p>Because</p></details></div>')
  cleanArticle(doc)
  assert.match(doc.toString(), /<details open/)
  assert.match(doc.textContent, /Because/)
})

test('document: chrome, scripts and unprintable controls are removed', () => {
  const doc = parse(
    '<div class="vp-doc"><script>evil()</script><a class="header-anchor">#</a>' +
      '<div class="mdbook-pdf-frame">iframe</div><button>Try</button><p>Keep</p></div>'
  )
  cleanArticle(doc)
  const out = doc.toString()
  assert.doesNotMatch(out, /evil\(\)|header-anchor|mdbook-pdf-frame|<button/)
  assert.match(out, /Keep/)
})

test('document: distFile refuses to escape dist, and resolves a based URL', () => {
  const dist = tmp({ 'a/pic.png': 'PNG', 'assets/s.css': 'body{}' })
  assert.ok(distFile(dist, '/a/pic.png'))
  assert.equal(distFile(dist, '/../../etc/passwd'), null)
  assert.equal(distFile(dist, '/a/../../../etc/passwd'), null)
  assert.equal(distFile(dist, 'https://evil.test/x.png'), null)
  assert.equal(distFile(dist, '/nope.png'), null)
  // Site mounted under a base: the link carries it, the file does not.
  assert.ok(distFile(dist, '/emr/a/pic.png', '/emr/'))
})

test('document: images are inlined, and a missing one is named rather than broken', () => {
  const dist = tmp({ 'a/pic.png': 'PNG' })
  const doc = parse('<div><img src="/a/pic.png"><img src="/gone.png"></div>')
  inlineImages(doc, dist, '/')
  const out = doc.toString()
  assert.match(out, /src="data:image\/png;base64,/)
  // The renderer fetches nothing, so a URL left behind would be a blocked
  // request and a broken-image glyph.
  assert.doesNotMatch(out, /src="\/gone\.png"/)
  assert.match(out, /\[image: \/gone\.png\]/)
})

test('document: the assembled document references nothing external', () => {
  const dist = tmp({ 'a/pic.png': 'PNG' })
  const { doc, title } = extractArticle(page('T', '<h1>T</h1><img src="/a/pic.png">'))
  cleanArticle(doc)
  inlineImages(doc, dist, '/')
  const html = assemble({ title, siteTitle: 'S', sections: [{ title, toc: [], html: doc.innerHTML }] })
  assert.doesNotMatch(html, /<script/)
  assert.doesNotMatch(html, /src="(?!data:)/)
  assert.doesNotMatch(html, /<link/)
})

test('document: a book export LISTS what it omitted', () => {
  const html = assemble({
    title: 'Book',
    siteTitle: 'S',
    sections: [{ title: 'A', toc: [{ level: 1, text: 'A', id: 'a' }], html: '<h1 id="a">A</h1>' }],
    toc: true,
    omitted: ['Internal notes']
  })
  assert.match(html, /Omitted pages/)
  assert.match(html, /Internal notes/)
})

test('directives: a page can set its own layout, and only from a known set', () => {
  const meta = (o) => `<meta name="mdbook-pdf" content='${JSON.stringify(o).replace(/"/g, '&quot;')}'>`
  const d = readDirectives(meta({ orientation: 'landscape', margins: 'narrow', scale: 0.9, tables: 'fit' }))
  assert.equal(d.landscape, true)
  assert.equal(d.margin.top, '12mm')
  assert.equal(d.scale, 0.9)
  assert.match(d.css, /table\{width:100%/)
  // Values end up in CSS and in Chromium's print settings, so they are matched
  // against fixed sets rather than interpolated.
  assert.equal(readDirectives(meta({ orientation: 'sideways' })), null)
  assert.equal(readDirectives(meta({ margins: '99mm; evil' })), null)
  assert.equal(readDirectives(meta({ scale: 99 })), null)
  assert.equal(readDirectives('<p>no meta</p>'), null)
  assert.equal(readDirectives('<meta name="mdbook-pdf" content="not json">'), null)
})

test('directives: print.css must not pin @page size, or orientation is ignored', () => {
  // `@page { size: A4 }` overrides Chromium's own paper settings, so a page
  // asking for landscape came out portrait A4 — silently. The stylesheet owns
  // the margins; md2pdf owns the page box.
  const css = fs.readFileSync(new URL('../src/theme/styles/print.css', import.meta.url), 'utf8')
  const atPage = /@page\s*\{([^}]*)\}/.exec(css.replace(/\/\*[\s\S]*?\*\//g, ''))
  assert.ok(atPage, 'print.css has no @page rule at all')
  assert.doesNotMatch(atPage[1], /\bsize\s*:/)
  assert.match(atPage[1], /\bmargin\s*:/)
})

// ------------------------------------------------------------------ export ---

const DIST = () =>
  tmp({
    'index.html': page('Home', '<h1>Home</h1><h2>Bit</h2>'),
    'guide/index.html': page('Guide', '<h1>Guide</h1>'),
    'internal/secret.html': page('Secret', '<h1>Secret</h1>'),
    'assets/style.css': 'body{color:#123456}',
    'pdf-manifest.json': JSON.stringify({
      title: 'Site',
      defaultLang: 'en',
      locales: {
        en: {
          title: 'Site',
          pages: [
            { route: '/', title: 'Home' },
            { route: '/guide/', title: 'Guide' },
            { route: '/internal/secret', title: 'Secret' }
          ]
        }
      }
    })
  })

const ACL = {
  default: 'public',
  rules: [{ path: 'internal/**', access: ['editor'] }],
  pages: { '/internal/secret': ['editor'] },
  assets: []
}
const PDF = { numbered: true, css: '', scope: ['page', 'book'], theme: 'site' }

test('export: pageFile resolves cleanUrls routes and refuses traversal', () => {
  const dist = DIST()
  assert.ok(pageFile(dist, '/'))
  assert.ok(pageFile(dist, '/guide/'))
  assert.ok(pageFile(dist, '/internal/secret'))
  assert.equal(pageFile(dist, '/../../etc/passwd'), null)
  assert.equal(pageFile(dist, '/nope'), null)
})

test('export: the site stylesheet is inlined into the document', () => {
  const doc = buildDocument({ dist: DIST(), route: '/', scope: 'page', pdf: PDF, mdbookDir: '.' })
  assert.match(doc.html, /#123456/)
  assert.equal(doc.filename, 'Home.pdf')
})

test('export: a reader cannot export a page they cannot read', () => {
  const dist = DIST()
  assert.throws(
    () => buildDocument({ dist, route: '/internal/secret', scope: 'page', pdf: PDF, acl: ACL, session: null, mdbookDir: '.' }),
    (e) => e.status === 403
  )
  // With the role, the same request succeeds.
  const ok = buildDocument({
    dist, route: '/internal/secret', scope: 'page', pdf: PDF, acl: ACL,
    session: { sub: 'u', roles: ['editor'] }, mdbookDir: '.'
  })
  assert.match(ok.html, /Secret/)
})

test('export: a book contains what THIS session may read, and lists the rest', () => {
  const dist = DIST()
  const anon = buildDocument({ dist, route: '/', scope: 'book', pdf: PDF, acl: ACL, session: null, mdbookDir: '.' })
  assert.match(anon.html, /Home/)
  assert.match(anon.html, /Omitted pages/)
  assert.match(anon.html, /Secret/) // named in the omitted list...
  assert.doesNotMatch(anon.html, /<h1[^>]*>3\. Secret/) // ...but not as a section

  const editor = buildDocument({
    dist, route: '/', scope: 'book', pdf: PDF, acl: ACL,
    session: { sub: 'u', roles: ['editor'] }, mdbookDir: '.'
  })
  assert.doesNotMatch(editor.html, /Omitted pages/)
})

test('export: a book built without a manifest says so instead of emitting nothing', () => {
  const dist = tmp({ 'index.html': page('Home', '<h1>Home</h1>') })
  assert.throws(
    () => buildDocument({ dist, route: '/', scope: 'book', pdf: PDF, mdbookDir: '.' }),
    (e) => e.status === 409 && /manifest/.test(e.message)
  )
})

// ------------------------------------------------------------------- serve ---

const listen = (handler) =>
  new Promise((resolve) => {
    const server = http.createServer(handler)
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })

// A stand-in md2pdf: records what it was asked for, answers a PDF.
async function stubMd2pdf() {
  const seen = []
  const { server, port } = await listen(async (req, res) => {
    if (req.url === '/pdf') {
      const chunks = []
      for await (const c of req) chunks.push(c)
      seen.push(JSON.parse(Buffer.concat(chunks).toString()))
      res.writeHead(200, { 'Content-Type': 'application/pdf' })
      return res.end(Buffer.from('%PDF-1.7 stub'))
    }
    res.writeHead(404).end()
  })
  return { seen, server, url: `http://127.0.0.1:${port}` }
}

const get = (port, p, headers = {}) =>
  new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: p, headers }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }))
    })
  })

test('serve: /pdf/status tells the theme whether to show a button at all', async () => {
  const off = await listen(createHandler({ dist: DIST(), pdf: null }))
  assert.deepEqual(JSON.parse((await get(off.port, '/pdf/status')).body.toString()), { enabled: false })
  off.server.close()

  const stub = await stubMd2pdf()
  const on = await listen(
    createHandler({ dist: DIST(), pdf: { ...PDF, server: stub.url, timeout: 5000 }, mdbookDir: '.' })
  )
  assert.deepEqual(JSON.parse((await get(on.port, '/pdf/status')).body.toString()), {
    enabled: true,
    scope: ['page', 'book']
  })
  on.server.close()
  stub.server.close()
})

test('serve: an unconfigured site 404s /pdf rather than half-working', async () => {
  const { server, port } = await listen(createHandler({ dist: DIST(), pdf: null }))
  assert.equal((await get(port, '/pdf?path=/')).status, 404)
  server.close()
})

test('serve: a page export reaches md2pdf and comes back as a PDF attachment', async () => {
  const stub = await stubMd2pdf()
  const { server, port } = await listen(
    createHandler({ dist: DIST(), pdf: { ...PDF, server: stub.url, timeout: 5000 }, siteTitle: 'Site', mdbookDir: '.' })
  )
  const res = await get(port, '/pdf?path=/&scope=page')
  assert.equal(res.status, 200)
  assert.equal(res.headers['content-type'], 'application/pdf')
  assert.match(res.headers['content-disposition'], /attachment; filename="Home\.pdf"/)
  assert.equal(res.body.toString(), '%PDF-1.7 stub')
  assert.equal(stub.seen.length, 1)
  assert.match(stub.seen[0].html, /<h1[^>]*>Home<\/h1>/)
  server.close()
  stub.server.close()
})

test('serve: the browser supplies a path, never HTML — traversal just 404s', async () => {
  const stub = await stubMd2pdf()
  const { server, port } = await listen(
    createHandler({ dist: DIST(), pdf: { ...PDF, server: stub.url, timeout: 5000 }, mdbookDir: '.' })
  )
  assert.equal((await get(port, '/pdf?path=/../../etc/passwd')).status, 404)
  // A protocol-relative path is not a route on this site.
  assert.equal((await get(port, '/pdf?path=//evil.test/x')).status, 200) // falls back to '/'
  server.close()
  stub.server.close()
})

test('serve: a scope the site did not enable is refused', async () => {
  const stub = await stubMd2pdf()
  const { server, port } = await listen(
    createHandler({ dist: DIST(), pdf: { ...PDF, scope: ['page'], server: stub.url, timeout: 5000 }, mdbookDir: '.' })
  )
  assert.equal((await get(port, '/pdf?path=/&scope=book')).status, 400)
  server.close()
  stub.server.close()
})

test('serve: md2pdf being down is a 502 naming the endpoint, not a stack trace', async () => {
  const { server, port } = await listen(
    // Nothing listens on this port.
    createHandler({ dist: DIST(), pdf: { ...PDF, server: 'http://127.0.0.1:1', timeout: 1000 }, mdbookDir: '.' })
  )
  const res = await get(port, '/pdf?path=/&scope=page')
  assert.equal(res.status, 502)
  assert.match(res.body.toString(), /md2pdf at http:\/\/127\.0\.0\.1:1 is unreachable/)
  server.close()
})

test('serve: the ACL applies to the export, not only to the page', async () => {
  const stub = await stubMd2pdf()
  const { server, port } = await listen(
    createHandler({
      dist: DIST(),
      acl: ACL,
      auth: { access: 'public', rules: ACL.rules, session: {} },
      pdf: { ...PDF, server: stub.url, timeout: 5000 },
      mdbookDir: '.'
    })
  )
  // Anonymous and unauthorized: sent to sign in rather than handed the document.
  const res = await get(port, '/pdf?path=/internal/secret&scope=page')
  assert.equal(res.status, 302)
  assert.match(res.headers.location, /auth\/login/)
  assert.equal(stub.seen.length, 0, 'the renderer was called for a page the caller may not read')
  server.close()
  stub.server.close()
})

// ------------------------------------------------------------- filenames ----

test('filenames: a non-ASCII title survives via filename*', () => {
  const cd = contentDisposition('Propouštěcí zpráva.pdf')
  assert.match(cd, /filename="[\w.\- ]+"/)
  assert.equal(decodeURIComponent(/filename\*=UTF-8''(\S+)/.exec(cd)[1]), 'Propouštěcí zpráva.pdf')
  assert.doesNotMatch(cd, /[\r\n]/)
})

test('filenames: the theme prefers filename* over the lossy ASCII form', () => {
  const cd = "attachment; filename=\"Propou-t-c-zpr-va.pdf\"; filename*=UTF-8''Propou%C5%A1t%C4%9Bc%C3%AD%20zpr%C3%A1va.pdf"
  assert.equal(filenameFrom(cd), 'Propouštěcí zpráva.pdf')
  assert.equal(filenameFrom('attachment; filename="plain.pdf"'), 'plain.pdf')
  assert.equal(filenameFrom(null), 'document.pdf')
  // A malformed encoding falls back rather than throwing.
  assert.equal(filenameFrom("attachment; filename=\"ok.pdf\"; filename*=UTF-8''%E0%A4%A"), 'ok.pdf')
})

test('download: the anchor is in the document when it is clicked, and gone after', async () => {
  // All three assertions below are defects in the reference implementation
  // (helex-tx wikiClient.ts downloadExport), so they are pinned rather than
  // left to a comment.
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!DOCTYPE html><body></body>')
  const doc = dom.window.document
  const revoked = []
  let inDocumentAtClick = null
  globalThis.URL.createObjectURL = () => 'blob:stub'
  globalThis.URL.revokeObjectURL = (u) => revoked.push(u)
  // jsdom's click() does not navigate; capture the state at the moment it fires.
  const realCreate = doc.createElement.bind(doc)
  doc.createElement = (tag) => {
    const el = realCreate(tag)
    if (tag === 'a') el.click = () => (inDocumentAtClick = doc.body.contains(el))
    return el
  }

  saveBlob({}, 'Propouštěcí zpráva.pdf', doc)

  assert.equal(inDocumentAtClick, true, 'a detached anchor does not fire in every browser')
  assert.equal(doc.querySelectorAll('a').length, 0, 'the anchor was left behind')
  // Revoking synchronously races the download; some browsers cancel it.
  assert.deepEqual(revoked, [], 'the object URL was revoked before the download could start')
})
