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

test('gitbook ingest: no SUMMARY.md derives a per-section multi-sidebar from the tree', () => {
  const dir = tmpGitbook({
    'README.md': '# EMR Docs\n\nHome.',
    'glossary.md': '# Glossary\n',
    'architecture/README.md': '# Architecture\n',
    'architecture/frontend/01-component.md': '# Component Architecture\n',
    'architecture/frontend/10-later.md': '# Later\n',
    'architecture/frontend/02-data.md': '# Data Controller\n'
  })
  const model = ingestGitbook(cfgFor(dir))
  assert.deepEqual(model.langs, ['en'])
  assert.equal(model.title, 'EMR Docs')

  const sb = model.sidebars.en
  assert.ok(!Array.isArray(sb), 'sidebar is a multi-sidebar object')
  const plain = (t) => t.replace(/<span class="mdbook-icon">[\s\S]*?<\/span>/, '')
  const isFolder = (i) => /<span class="mdbook-icon">/.test(i.text)

  // A folder's README is its index at any depth, so /architecture/ is a real page.
  const dests = model.contentFiles.map((f) => f.dest)
  assert.ok(dests.includes('index.md'), 'root README is the home page')
  assert.ok(dests.includes('architecture/index.md'), 'nested README becomes the folder index')

  // Root fallback: folders first, then loose files — each alphabetical.
  const root = sb['/']
  assert.equal(root[0].link, '/architecture/', 'folder sorts before the loose file')
  assert.equal(plain(root[0].text), 'Architecture')
  assert.ok(isFolder(root[0]), 'folder entry carries a folder icon')
  const glossary = root.find((i) => i.link === '/glossary')
  assert.ok(glossary, 'loose root file is listed')
  assert.ok(!isFolder(glossary), 'a file has no folder icon')

  // Each top-level folder has its own sidebar under its path, led by a way back
  // to the top-level menu (inside a section only that section is shown).
  const arch = sb['/architecture/']
  assert.ok(arch, 'architecture section has its own sidebar')
  assert.equal(arch[0].link, '/', 'first entry returns to the top-level menu')
  assert.match(plain(arch[0].text), /All sections/)

  const section = arch[1]
  assert.equal(section.link, '/architecture/', 'section group links to its README')
  assert.equal(section.collapsed, undefined, 'section header is not collapsible')
  assert.equal(plain(section.text), 'Architecture', 'section label from README H1')

  const fe = section.items.find((i) => i.items)
  assert.ok(fe, 'nested frontend group exists and is collapsed')
  assert.equal(fe.collapsed, true)
  assert.ok(isFolder(fe), 'nested folder carries a folder icon')
  // Files sort naturally: 01 < 02 < 10, labeled by their H1.
  assert.deepEqual(
    fe.items.map((i) => i.link),
    ['/architecture/frontend/01-component', '/architecture/frontend/02-data', '/architecture/frontend/10-later']
  )
  assert.equal(plain(fe.items[0].text), 'Component Architecture', 'file label from H1')
})

test('gitbook ingest: source.exclude hides scaffolding from pages and menu', () => {
  const dir = tmpGitbook({
    'README.md': '# Docs\n',
    'CLAUDE.md': '# Assistant Guide\n',
    'glossary.md': '# Glossary\n',
    'agents/notes/x.md': '# Agent Note\n',
    'specifications/README.md': '# Specifications\n',
    'specifications/SPEC.01.md': '# Spec One\n',
    'specifications/_templates/tpl.md': '# Template\n'
  })
  const cfg = cfgFor(dir)
  // Bare names match at any depth; paths match from the content root.
  cfg.source.exclude = ['CLAUDE.md', 'agents', '_templates']
  const model = ingestGitbook(cfg)

  const dests = model.contentFiles.map((f) => f.dest)
  assert.ok(dests.includes('glossary.md'), 'ordinary pages are kept')
  assert.ok(dests.includes('specifications/SPEC.01.md'), 'section pages are kept')
  assert.ok(!dests.some((d) => d.includes('CLAUDE')), 'excluded root file is not published')
  assert.ok(!dests.some((d) => d.startsWith('agents/')), 'excluded folder is not published')
  assert.ok(!dests.some((d) => d.includes('_templates')), 'nested excluded folder is not published')

  const sb = model.sidebars.en
  const flat = JSON.stringify(sb)
  assert.ok(!/CLAUDE|Assistant Guide/.test(flat), 'excluded file is absent from the menu')
  assert.ok(!/Agent Note|Agents/.test(flat), 'excluded folder is absent from the menu')
  assert.ok(!/Template/.test(flat), 'excluded nested folder is absent from the menu')
  assert.ok(/Spec One/.test(flat), 'kept pages still appear in the menu')
})

test('gitbook ingest: sidebarTitle frontmatter overrides the H1 as the menu label', () => {
  const dir = tmpGitbook({
    'README.md': '# Docs\n',
    'specifications/README.md':
      '---\nsidebarTitle: Specs\n---\n\n# Specifications — The Long Official Heading\n',
    'specifications/ACC.11-posting.md':
      '---\nsidebarTitle: ACC.11 Posting\n---\n\n# ACC.11 — Posting Rules (Common Spec, Consolidated)\n',
    'specifications/ACC.12-other.md': '# ACC.12 — Other\n'
  })
  const model = ingestGitbook(cfgFor(dir))
  const plain = (t) => t.replace(/<span class="mdbook-icon">[\s\S]*?<\/span>/, '')
  const section = model.sidebars.en['/specifications/'][1]

  assert.equal(plain(section.text), 'Specs', 'folder label uses its README sidebarTitle')
  const labels = section.items.map((i) => plain(i.text))
  assert.ok(labels.includes('ACC.11 Posting'), 'page label uses sidebarTitle')
  assert.ok(
    labels.includes('ACC.12 — Other'),
    'a page without the override still falls back to its H1'
  )
})
