import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buildSite, loadConfig, stageContent } from '../src/build.mjs'
import { ingestOwliki } from '../src/ingest/owliki.mjs'

// The source format is not just a config value: it gates the RENDER pipeline —
// which adapter runs, `breaks:`, and the whole `isOwliki` branch in
// `stageContent` that sanitizes, expands `{{def:}}` and resolves `{{drawio:}}`.
// A format that resolved in config but never reached that branch would publish
// raw macro text, and nothing would say so.
//
// The wiki format's former name, `termx`, is NOT an alias. It is rejected by
// name, which is the other half of what these tests hold in place: a repository
// still carrying it must be told, not quietly built on a retired spelling.
//
// This drives the real ingest + staging. It stops short of handing the staged
// tree to VitePress: that step is VitePress's behaviour, not this repo's, and
// paying ~7s per build would change what this suite is.

const PAGE = `# Macros

A versioned diagram: {{drawio:architecture}}

A legacy embed: ![d](files/12/diagram-1.drawio.png)
`

function fixture(format) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `mdbook-fmt-${format}-`))
  const w = (rel, body) => {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), body)
  }
  w('.mdbook/config.yml', `site:\n  title: Fmt\nsource:\n  format: ${format}\n  meta: docs\n  pages: docs/pages\n`)
  w('docs/space.json', JSON.stringify({ code: 'fmt', names: { en: 'Fmt' }, defaultLang: 'en', langs: ['en'] }))
  w('docs/pages.json', JSON.stringify([
    { code: 'p-1', pageId: 12, contents: [{ name: 'Macros', slug: 'macros', lang: 'en' }], children: [] }
  ]))
  w('docs/pages/macros.md', PAGE)
  // Two versions, so a staged page that resolved the macro can only name v2.
  for (const v of [1, 2]) w(`docs/attachments/12/architecture.v${v}.drawio.png`, `png-v${v}`)
  w('docs/attachments/12/diagram-1.drawio.png', 'png-legacy')
  return dir
}

// The staged page, with the volatile bits (paths, generated description) removed
// so two runs from different directories compare as equal.
function stagedPage(format) {
  const dir = fixture(format)
  const cfg = loadConfig(dir)
  const staging = stageContent(cfg, ingestOwliki(cfg))
  return fs.readFileSync(path.join(staging, 'macros.md'), 'utf8')
}

test('format owliki: the macro resolves through real ingest and staging', () => {
  const page = stagedPage('owliki')
  // The macro only expands inside stageContent's owliki branch, so its absence
  // here would mean the format resolved in config and stopped there.
  assert.match(
    page,
    /!\[architecture\]\(\/attachments\/12\/architecture\.v2\.drawio\.png\)/,
    '{{drawio:}} resolved to the newest version'
  )
  assert.doesNotMatch(page, /\{\{drawio:/, 'no macro text is left for a reader to see')
  assert.doesNotMatch(page, /architecture\.v1/, 'and it is not the older version')
  assert.match(
    page,
    /!\[d\]\(\/attachments\/12\/diagram-1\.drawio\.png\)/,
    'a .drawio.png with no .vN. stays an ordinary image'
  )
})

test('format termx: retired, and rejected by name rather than half-built', async () => {
  // The failure a stale config must get. Not "Unknown source format", which
  // sends someone hunting for a typo, and emphatically not a silent alias.
  // `buildSite` is async, so the throw arrives as a rejection — and it has to
  // arrive at ingest, before anything is staged or a bundler is started.
  const dir = fixture('termx')
  const cfg = loadConfig(dir)
  await assert.rejects(
    () => buildSite(dir),
    (e) => {
      assert.match(e.message, /no longer supported/)
      assert.match(e.message, /owliki/, 'names the replacement')
      assert.match(e.message, /config\.yml/, 'and where to change it')
      return true
    }
  )
  assert.equal(cfg.source.format, 'termx', 'the raw spelling survives config, to be rejected')
})

test('format gating: the wiki transforms are gated on the format, not unconditional', () => {
  // Without this the assertions above would pass even if `isOwliki` were `true`
  // for every source, and they would be proving nothing about the alias.
  const dir = fixture('gitbook')
  const cfg = loadConfig(dir)
  assert.equal(cfg.source.format, 'gitbook')
  const staging = stageContent(cfg, ingestOwliki(cfg))
  const page = fs.readFileSync(path.join(staging, 'macros.md'), 'utf8')
  assert.match(page, /drawio:architecture/, 'the macro is left alone for a non-wiki source')
})
