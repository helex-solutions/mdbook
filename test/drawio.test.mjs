import { test } from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import {
  DIAGRAM_SUFFIX,
  diagramFileName,
  isDiagramName,
  latestDiagram,
  parseDiagramFile
} from '../src/ingest/diagram-files.mjs'
import { expandDiagrams, resolveFolder } from '../src/ingest/drawio.mjs'
import { hardenMarkdown } from '../src/ingest/sanitize.mjs'
import { applyMarkdown } from '../src/markdown/index.mjs'

// ---------------------------------------------------------------------------
// Version resolution. These mirror, case for case, the wiki's own tests at
// helex-tx `modules/owliki/frontend/src/__tests__/diagramLinks.spec.ts` — two
// implementations of "which file does this macro mean" drift silently, and the
// failure mode is a published page showing an older diagram than the wiki.
// ---------------------------------------------------------------------------

test('drawio: a version is stored under a name the macro does not have to know', () => {
  assert.equal(DIAGRAM_SUFFIX, '.drawio.png')
  assert.equal(diagramFileName('architecture', 1), 'architecture.v1.drawio.png')
  assert.deepEqual(parseDiagramFile('architecture.v7.drawio.png'), {
    name: 'architecture',
    version: 7
  })
})

test('drawio: resolves the newest version by NUMBER, not by listing or name order', () => {
  // v10 must beat v2 — a filename sort would put `.v10.` before `.v2.`, and the
  // order the attachment folder happens to be read in must not decide either.
  const files = [
    'architecture.v2.drawio.png',
    'architecture.v10.drawio.png',
    'architecture.v1.drawio.png'
  ]
  assert.equal(latestDiagram(files, 'architecture').version, 10)
  assert.equal(latestDiagram([...files].reverse(), 'architecture').version, 10)
  assert.equal(latestDiagram([...files].sort(), 'architecture').version, 10)
})

test('drawio: a gap in the versions still resolves to the highest present', () => {
  const files = ['plan.v1.drawio.png', 'plan.v5.drawio.png']
  assert.equal(latestDiagram(files, 'plan').fileName, 'plan.v5.drawio.png')
})

test('drawio: keeps two diagrams on one page apart, and answers null for an unknown name', () => {
  const files = ['architecture.v3.drawio.png', 'dataflow.v1.drawio.png']
  assert.equal(latestDiagram(files, 'dataflow').fileName, 'dataflow.v1.drawio.png')
  assert.equal(latestDiagram(files, 'architecture').fileName, 'architecture.v3.drawio.png')
  assert.equal(latestDiagram(files, 'missing'), null)
})

test('drawio: a file with no .vN. segment is not ours — legacy diagrams included', () => {
  // A pre-macro diagram is a plain `![](files/…drawio.png)` embed and must never
  // be mistaken for version 0 of anything.
  for (const f of ['photo.png', 'diagram-1788108317762.drawio.png', 'notes.drawio.png']) {
    assert.equal(parseDiagramFile(f), null, f)
  }
  assert.equal(latestDiagram(['notes.drawio.png'], 'notes'), null)
})

test('drawio: rejects names that would make the stored file ambiguous or unroutable', () => {
  for (const ok of ['architecture', 'data-flow', 'a_1', 'X9']) assert.ok(isDiagramName(ok), ok)
  // A dot would make `a.b.v2.drawio.png` ambiguous about where the name ends;
  // the rest are path or macro syntax.
  for (const bad of ['a.b', 'a/b', 'a b', '', '-lead', 'a}b']) assert.ok(!isDiagramName(bad), bad)
})

// ---------------------------------------------------------------------------
// Which page's attachments a macro resolves against (generator-only: the wiki
// simply knows the page id, a published page does not).
// ---------------------------------------------------------------------------

const INDEX = () =>
  new Map([
    ['12', ['architecture.v1.drawio.png', 'architecture.v2.drawio.png', 'diagram-1.drawio.png']],
    ['34', ['dataflow.v1.drawio.png', 'diagram.v1.drawio.png']],
    ['56', ['diagram.v4.drawio.png']]
  ])

test('drawio: an exported page id resolves exactly', () => {
  assert.deepEqual(resolveFolder('diagram', { folder: 56, index: INDEX() }), { folder: '56' })
})

test('drawio: a folder the page already embeds from resolves it', () => {
  assert.deepEqual(
    resolveFolder('architecture', { referenced: ['12'], index: INDEX() }),
    { folder: '12' }
  )
})

test('drawio: one candidate site-wide is not a guess', () => {
  assert.deepEqual(resolveFolder('dataflow', { index: INDEX() }), { folder: '34' })
})

test('drawio: a name several pages have, with nothing to narrow it, fails rather than guesses', () => {
  // `diagram` is the wiki editor's default name, so this collides by construction.
  assert.deepEqual(resolveFolder('diagram', { index: INDEX() }), { ambiguous: ['34', '56'] })
})

// ---------------------------------------------------------------------------
// The macro in a page.
// ---------------------------------------------------------------------------

test('drawio: {{drawio:name}} becomes an ordinary attachment embed at the newest version', () => {
  const out = expandDiagrams('See {{drawio:architecture}} below.', { index: INDEX(), folder: 12 })
  assert.equal(out, 'See ![architecture](files/12/architecture.v2.drawio.png) below.')
})

test('drawio: an unknown name renders a named placeholder, never a broken image', () => {
  const warnings = []
  const out = expandDiagrams('{{drawio:nope}}', {
    index: INDEX(),
    folder: 12,
    warn: (m) => warnings.push(m)
  })
  assert.match(out, /class="mdbook-diagram-missing"/)
  assert.match(out, /nope/, 'the placeholder names what was looked for')
  assert.doesNotMatch(out, /!\[|<img/, 'no image reference is emitted')
  assert.equal(warnings.length, 1, 'the build is told too')
})

test('drawio: an ambiguous name says so rather than showing another page’s diagram', () => {
  const out = expandDiagrams('{{drawio:diagram}}', { index: INDEX() })
  assert.match(out, /class="mdbook-diagram-missing"/)
  assert.match(out, /ambiguous/i)
})

test('drawio: a legacy ![](files/…drawio.png) embed is left completely alone', () => {
  const src = '![d](files/12/diagram-1.drawio.png)'
  assert.equal(expandDiagrams(src, { index: INDEX(), folder: 12 }), src)
})

test('drawio: a macro inside code is documentation, not a diagram', () => {
  const src = 'Write `{{drawio:architecture}}`.\n\n```\n{{drawio:architecture}}\n```\n'
  assert.equal(expandDiagrams(src, { index: INDEX(), folder: 12 }), src)
})

test('drawio: the expansion survives hardenMarkdown and renders as an image', () => {
  const staged = hardenMarkdown(
    expandDiagrams('{{drawio:architecture}}', { index: INDEX(), folder: 12 })
  )
  const md = new MarkdownIt({ html: true })
  applyMarkdown(md, {})
  const html = md.render(staged)
  assert.match(html, /<img[^>]+src="\/attachments\/12\/architecture\.v2\.drawio\.png"/)
})

test('drawio: an unresolved macro’s placeholder survives hardening as real markup', () => {
  const staged = hardenMarkdown(expandDiagrams('{{drawio:nope}}', { index: INDEX(), folder: 12 }))
  assert.match(staged, /<span class="mdbook-diagram-missing">/)
  assert.doesNotMatch(staged, /&#123;/, 'no leftover escaped braces')
})

// ---------------------------------------------------------------------------
// Staged-image resolution, which the macro's output rides on.
// ---------------------------------------------------------------------------

test('drawio: on a portal, an attachment resolves inside its own space’s mount', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const pathMod = await import('node:path')
  const { fixStagedImages } = await import('../src/ingest/images.mjs')
  const staging = mkdtempSync(pathMod.join(tmpdir(), 'mdbook-portal-'))
  mkdirSync(pathMod.join(staging, 'handbook'), { recursive: true })
  mkdirSync(pathMod.join(staging, 'public/attachments/handbook/12'), { recursive: true })
  writeFileSync(pathMod.join(staging, 'public/attachments/handbook/12/a.v2.drawio.png'), 'x')
  writeFileSync(
    pathMod.join(staging, 'handbook/macros.md'),
    '![a](files/12/a.v2.drawio.png)\n'
  )
  fixStagedImages(staging, { langs: ['en'], mounts: ['handbook'] })
  const out = readFileSync(pathMod.join(staging, 'handbook/macros.md'), 'utf8')
  // Without the mount the bytes are staged under `handbook/` but nothing points
  // at them, and every attachment on a portal degrades to its alt text.
  assert.match(out, /!\[a\]\(\/attachments\/handbook\/12\/a\.v2\.drawio\.png\)/)
})
