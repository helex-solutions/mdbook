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

// SUMMARY.md has two dialects. mdBook groups with `# Part` titles and allows
// unbulleted prefix/suffix chapters; GitBook groups with `##`. Both drop the first `#`
// heading as the book title. Reading only the GitBook half flattened every mdBook
// sidebar into one undivided list and lost its Introduction link.
const summaryOf = (files) => ingestGitbook(cfgFor(tmpGitbook(files))).sidebars.en

test('gitbook ingest: mdBook part titles become sidebar groups', () => {
  const sb = summaryOf({
    'README.md': '# Docs\n',
    'SUMMARY.md': [
      '# Summary', '', '[Introduction](README.md)', '',
      '# Manuals', '', '- [Deploy](deploy.md)', '  - [Plugins](plugins.md)', '',
      '# Architecture', '', '- [Overview](arch.md)', '',
      '---', '', '[Glossary](glossary.md)', ''
    ].join('\n'),
    'deploy.md': '# Deploy\n',
    'plugins.md': '# Plugins\n',
    'arch.md': '# Overview\n',
    'glossary.md': '# Glossary\n'
  })
  assert.deepEqual(sb.map((i) => i.text), ['Introduction', 'Manuals', 'Architecture', 'Glossary'])
  assert.ok(!JSON.stringify(sb).includes('"Summary"'), 'the book title is not a group')

  const [intro, manuals, arch, glossary] = sb
  assert.equal(intro.link, '/', 'an unbulleted prefix chapter is kept, at the top level')
  assert.equal(manuals.link, undefined, 'a part title is a group, not a page')
  assert.deepEqual(manuals.items.map((i) => i.link), ['/deploy'])
  assert.deepEqual(manuals.items[0].items.map((i) => i.link), ['/plugins'], 'indent still nests inside a part')
  assert.deepEqual(arch.items.map((i) => i.link), ['/arch'])
  assert.equal(glossary.link, '/glossary', 'a suffix chapter after the last part stays top-level')
  assert.equal(glossary.items, undefined)
})

test('gitbook ingest: a part title straight after the book title is still a group', () => {
  // The case a "title is any # before the first entry" rule would silently drop.
  const sb = summaryOf({
    'README.md': '# Docs\n',
    'SUMMARY.md': '# Summary\n\n# Manuals\n\n- [Deploy](deploy.md)\n',
    'deploy.md': '# Deploy\n'
  })
  assert.equal(sb.length, 1)
  assert.equal(sb[0].text, 'Manuals')
  assert.deepEqual(sb[0].items.map((i) => i.link), ['/deploy'])
})

test('gitbook ingest: GitBook ## groups are unchanged, and its # title is still dropped', () => {
  const sb = summaryOf({
    'README.md': '# Portfolio\n',
    'SUMMARY.md': [
      '# Table of contents', '', '* [Summary](README.md)', '',
      '## General', '', '* [Experience](experience.md)', '',
      '## Services', '', '* [Overview](overview.md)', ''
    ].join('\n'),
    'experience.md': '# Experience\n',
    'overview.md': '# Overview\n'
  })
  assert.deepEqual(sb.map((i) => i.text), ['Summary', 'General', 'Services'])
  assert.ok(!JSON.stringify(sb).includes('Table of contents'), 'the book title is not a group')
  assert.equal(sb[0].link, '/')
  assert.deepEqual(sb[1].items.map((i) => i.link), ['/experience'])
  assert.deepEqual(sb[2].items.map((i) => i.link), ['/overview'])
})

// A numbered folder reads in the order its author numbered it. Labels are written to read
// well, not to sort, so ordering by label scrambled numbered folders (EMR's architecture
// conventions/data/fhir/frontend all rendered out of sequence).
const sidebarOf = (files, section) => ingestGitbook(cfgFor(tmpGitbook(files))).sidebars.en[section][1].items
const plainText = (t) => t.replace(/<span class="mdbook-icon">[\s\S]*?<\/span>/, '')

test('gitbook ingest: numbered pages follow their file names, not their labels', () => {
  const items = sidebarOf({
    'README.md': '# Docs\n',
    'arch/README.md': '# Arch\n',
    'arch/01-zeta.md': '# Zeta — first on purpose\n',
    'arch/02-alpha.md': '# Alpha\n',
    'arch/10-beta.md': '# Beta\n',
    'arch/notes.md': '# Aardvark notes\n'
  }, '/arch/')
  assert.deepEqual(
    items.map((i) => i.link),
    ['/arch/01-zeta', '/arch/02-alpha', '/arch/10-beta', '/arch/notes'],
    'numbered pages first in file-name order (10 after 02), then unnumbered by label'
  )
  assert.equal(plainText(items[0].text), 'Zeta — first on purpose', 'labels are untouched')
})

test('gitbook ingest: spec IDs order numerically', () => {
  const items = sidebarOf({
    'README.md': '# Docs\n',
    'specs/README.md': '# Specs\n',
    'specs/TEAGLE.90-parity.md': '# TEAGLE.90 — Parity\n',
    'specs/TEAGLE.10-browser.md': '# TEAGLE.10 — Browser\n',
    'specs/TEAGLE.02-scan.md': '# TEAGLE.02 — Scan\n',
    'specs/TEAGLE-open-questions.md': '# Open questions\n'
  }, '/specs/')
  assert.deepEqual(
    items.map((i) => i.link),
    ['/specs/TEAGLE.02-scan', '/specs/TEAGLE.10-browser', '/specs/TEAGLE.90-parity', '/specs/TEAGLE-open-questions']
  )
})

// A spec family is TEDY.01 with children TEDY.01.1 …; the files stay flat on disk (the layout
// specifications are written and moved in), so only the menu learns the family.
test('gitbook ingest: spec children nest under their parent page, at any depth', () => {
  const items = sidebarOf({
    'README.md': '# Docs\n',
    'specs/README.md': '# Specs\n',
    'specs/TEDY.01-code-system.md': '# TEDY.01 — Code System\n',
    'specs/TEDY.01.2-create.md': '# TEDY.01.2 — Create\n',
    'specs/TEDY.01.1-list.md': '# TEDY.01.1 — List\n',
    'specs/TEDY.01.1.1-filters.md': '# TEDY.01.1.1 — Filters\n',
    'specs/TEDY.02-value-set.md': '# TEDY.02 — Value Set\n',
    'specs/TEDY.03.1-orphan.md': '# TEDY.03.1 — Orphan\n'
  }, '/specs/')

  assert.deepEqual(
    items.map((i) => i.link),
    ['/specs/TEDY.01-code-system', '/specs/TEDY.02-value-set', '/specs/TEDY.03.1-orphan'],
    'children leave the top level; a child with no parent page stays there'
  )
  const [family, leaf, orphan] = items
  assert.equal(family.link, '/specs/TEDY.01-code-system', 'the parent stays a page')
  assert.equal(family.collapsed, true, 'the family is collapsible')
  assert.deepEqual(family.items.map((i) => i.link), ['/specs/TEDY.01.1-list', '/specs/TEDY.01.2-create'])
  assert.deepEqual(family.items[0].items.map((i) => i.link), ['/specs/TEDY.01.1.1-filters'], 'nesting recurses')
  assert.equal(leaf.items, undefined, 'a spec without children is a plain page')
  assert.equal(orphan.items, undefined)
})

test('gitbook ingest: a family nests inside a section folder with its icon intact', () => {
  const sb = ingestGitbook(cfgFor(tmpGitbook({
    'README.md': '# Docs\n',
    'specs/README.md': '# Specs\n',
    'specs/tedy/README.md': '# TEDY\n',
    'specs/tedy/TEDY.01-code-system.md': '# TEDY.01 — Code System\n',
    'specs/tedy/TEDY.01.1-list.md': '# TEDY.01.1 — List\n'
  }))).sidebars.en
  assert.match(sb['/'][0].text, /mdbook-icon/, 'the section link keeps its folder icon')
  const tedy = sb['/specs/'][1].items[0]
  assert.match(tedy.text, /mdbook-icon/, 'the nested folder keeps its icon')
  assert.equal(tedy.items[0].link, '/specs/tedy/TEDY.01-code-system')
  assert.deepEqual(tedy.items[0].items.map((i) => i.link), ['/specs/tedy/TEDY.01.1-list'])
})
