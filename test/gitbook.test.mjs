import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingestGitbook } from '../src/ingest/gitbook.mjs'

// Build a minimal GitBook project: files is a { relativePath: content } map.
function tmpGitbook(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdbook-gitbook-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  return dir
}
const cfgFor = (dir, lang = 'en') => ({
  projectRoot: dir,
  source: { format: 'gitbook' },
  site: { lang, title: null, web: null }
})

test('gitbook ingest: single language (no locale subdirs) behaves as before', () => {
  const dir = tmpGitbook({
    'README.md': '# My Docs\n\nHome.',
    'SUMMARY.md': '# Summary\n\n- [Home](README.md)\n- [Build](build.md)\n',
    'build.md': '# Build\n'
  })
  const model = ingestGitbook(cfgFor(dir))
  assert.deepEqual(model.langs, ['en'])
  assert.equal(model.defaultLang, 'en')
  assert.equal(model.title, 'My Docs')
  const dests = model.contentFiles.map((f) => f.dest).sort()
  assert.deepEqual(dests, ['build.md', 'index.md'])
  assert.equal(model.sidebars.en[1].link, '/build')
})

test('gitbook ingest: a lt/ locale subdir becomes a second locale under /lt/', () => {
  const dir = tmpGitbook({
    'README.md': '# My Docs\n',
    'SUMMARY.md': '- [Home](README.md)\n- [Build](build.md)\n',
    'build.md': '# Build\n',
    'lt/README.md': '# Mano dokumentai\n',
    'lt/SUMMARY.md': '- [Pradžia](README.md)\n- [Būdai](build.md)\n',
    'lt/build.md': '# Būdai\n'
  })
  const model = ingestGitbook(cfgFor(dir))
  assert.deepEqual(model.langs, ['en', 'lt'])
  assert.equal(model.defaultLang, 'en')

  // Content routed under lt/ for the non-default locale.
  const dests = model.contentFiles.map((f) => f.dest).sort()
  assert.deepEqual(dests, ['build.md', 'index.md', 'lt/build.md', 'lt/index.md'])

  // Sidebar links carry the /lt prefix for the locale.
  assert.equal(model.sidebars.en[1].link, '/build')
  assert.equal(model.sidebars.lt[0].link, '/lt/')
  assert.equal(model.sidebars.lt[1].link, '/lt/build')

  // Switcher labels are language display names.
  assert.equal(model.spaceNames.en, 'English')
  assert.equal(model.spaceNames.lt, 'Lietuvių')
})
