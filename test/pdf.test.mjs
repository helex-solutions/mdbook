import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingestGitbook } from '../src/ingest/gitbook.mjs'
import { pdfPageDest, prettifyPdfName } from '../src/ingest/pdf.mjs'
import { transformFileEmbeds } from '../src/ingest/file-embed.mjs'

// Minimal project on disk: files is a { relativePath: content } map.
function tmpProject(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdbook-pdf-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  return dir
}
const cfgFor = (dir, source = {}) => ({
  projectRoot: dir,
  source: { format: 'gitbook', ...source },
  site: { lang: 'en', title: null, web: null }
})
const byDest = (model, dest) => model.contentFiles.find((f) => f.dest === dest)
// The auto-generated root sidebar (no SUMMARY.md -> multi-sidebar object).
const rootBar = (model, lang = 'en', prefix = '') => model.sidebars[lang][`${prefix}/`]

test('pdf: a PDF in the tree is staged under public/ and gets a page previewing it', () => {
  const dir = tmpProject({
    'README.md': '# Docs\n',
    'specs/architecture-review.pdf': '%PDF-1.7\n'
  })
  const model = ingestGitbook(cfgFor(dir))

  // The file itself, served from the site root at its repo-relative path.
  const asset = byDest(model, 'public/specs/architecture-review.pdf')
  assert.ok(asset, 'PDF is staged under public/')
  assert.equal(asset.asset, true)
  assert.equal(asset.src, path.join(dir, 'specs/architecture-review.pdf'))

  // The generated page, at the URL the file would have had without its extension.
  const page = byDest(model, 'specs/architecture-review.md')
  assert.ok(page, 'PDF page is generated')
  assert.equal(page.title, 'Architecture Review')
  assert.equal(page.pdf, '/specs/architecture-review.pdf')
  assert.match(page.content, /^# Architecture Review$/m)
  assert.match(page.content, /\{% file src="\/specs\/architecture-review\.pdf" %\}/)
})

test('pdf: the generated page renders the inline preview + download card', () => {
  const page = byDest(
    ingestGitbook(cfgFor(tmpProject({ 'README.md': '# D\n', 'report.pdf': '%PDF-1.7\n' }))),
    'report.md'
  )
  // Staged with a site base, as `mdbook build --base` produces for a subpath site.
  const html = transformFileEmbeds(page.content, '/docs/')
  assert.match(html, /<iframe class="mdbook-pdf-frame" src="\/docs\/report\.pdf#view=FitH"/)
  assert.match(html, /href="\/docs\/report\.pdf" download/)
})

test('pdf: PDFs are listed in the folder-tree menu next to markdown pages', () => {
  const dir = tmpProject({
    'README.md': '# Docs\n',
    'handbook.pdf': '%PDF-1.7\n',
    'guides/README.md': '# Guides\n',
    'guides/setup.md': '# Setup\n',
    'guides/wall-chart.pdf': '%PDF-1.7\n'
  })
  const model = ingestGitbook(cfgFor(dir))

  // Root-level PDF sits among the root pages.
  const root = rootBar(model)
  assert.ok(root.some((i) => i.link === '/handbook' && /Handbook/.test(i.text)))

  // Section PDFs are listed in that section's own sidebar, after its folders.
  const section = model.sidebars.en['/guides/'][1].items.map((i) => i.link)
  assert.deepEqual(section, ['/guides/setup', '/guides/wall-chart'])
})

test('pdf: a markdown page of the same name keeps the URL; the PDF stays a download', () => {
  const dir = tmpProject({
    'README.md': '# Docs\n',
    'specs/spec.md': '# The Spec\n\nProse.\n',
    'specs/spec.pdf': '%PDF-1.7\n'
  })
  const model = ingestGitbook(cfgFor(dir))

  // The markdown page owns specs/spec.md — it is not replaced by a generated one.
  const page = byDest(model, 'specs/spec.md')
  assert.equal(page.content, undefined, 'the authored markdown page is untouched')
  assert.equal(model.contentFiles.filter((f) => f.dest === 'specs/spec.md').length, 1)

  // The file is still published, so `[PDF](/specs/spec.pdf)` resolves.
  assert.ok(byDest(model, 'public/specs/spec.pdf'))

  // And the menu lists that page once, not twice.
  const links = model.sidebars.en['/specs/'][1].items.map((i) => i.link)
  assert.deepEqual(links, ['/specs/spec'])
})

test('pdf: README.pdf is the folder index, and never a menu entry of its own', () => {
  assert.equal(pdfPageDest('reports/README.pdf'), 'reports/index.md')
  assert.equal(pdfPageDest('README.pdf'), 'index.md')

  const model = ingestGitbook(
    cfgFor(tmpProject({ 'README.md': '# Docs\n', 'reports/README.pdf': '%PDF-1.7\n' }))
  )
  assert.ok(byDest(model, 'reports/index.md'), 'README.pdf becomes the folder index page')
  const section = model.sidebars.en['/reports/']
  assert.equal(section[1].link, '/reports/', 'the folder links to its index')
  assert.deepEqual(section[1].items, [], 'and the PDF is not also listed inside it')
})

test('pdf: assets, dot-directories and excluded paths are not turned into pages', () => {
  const dir = tmpProject({
    'README.md': '# Docs\n',
    '.gitbook/assets/logo-sheet.pdf': '%PDF-1.7\n',
    'internal/draft.pdf': '%PDF-1.7\n'
  })
  const model = ingestGitbook(cfgFor(dir, { exclude: ['internal'] }))
  const dests = model.contentFiles.map((f) => f.dest)
  assert.deepEqual(dests.filter((d) => d.includes('logo-sheet')), [])
  assert.deepEqual(dests.filter((d) => d.includes('draft')), [])
})

test('pdf: source.pdf false keeps PDFs out of the site entirely', () => {
  const dir = tmpProject({ 'README.md': '# Docs\n', 'handbook.pdf': '%PDF-1.7\n' })
  const model = ingestGitbook(cfgFor(dir, { pdf: false }))
  assert.deepEqual(model.contentFiles.map((f) => f.dest), ['index.md'])
  assert.deepEqual(rootBar(model).filter((i) => /Handbook/.test(i.text)), [])
})

test('pdf: a locale subdir keeps its PDFs under its own prefix', () => {
  const dir = tmpProject({
    'README.md': '# Docs\n',
    'SUMMARY.md': '- [Home](README.md)\n',
    'handbook.pdf': '%PDF-1.7\n',
    'lt/README.md': '# Dokumentai\n',
    'lt/SUMMARY.md': '- [Pradžia](README.md)\n',
    'lt/vadovas.pdf': '%PDF-1.7\n'
  })
  const model = ingestGitbook(cfgFor(dir))
  const page = byDest(model, 'lt/vadovas.md')
  assert.equal(page.lang, 'lt')
  assert.equal(page.pdf, '/lt/vadovas.pdf')
  assert.ok(byDest(model, 'public/lt/vadovas.pdf'))
  // The default locale's own PDF is unprefixed.
  assert.equal(byDest(model, 'handbook.md').pdf, '/handbook.pdf')
})

test('pdf: file names become titles the way folder-tree labels do', () => {
  assert.equal(prettifyPdfName('annual-report_2026.pdf'), 'Annual Report 2026')
  assert.equal(prettifyPdfName('X-tee teenused.PDF'), 'X Tee Teenused')
})
