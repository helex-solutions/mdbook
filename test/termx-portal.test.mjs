import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import MarkdownIt from 'markdown-it'
import { loadConfig } from '../src/config.mjs'
import { ingestTermx } from '../src/ingest/termx.mjs'
import { termxLinks, termxImages, mountFromPath } from '../src/markdown/index.mjs'

// Two wiki-ssg exports composed into one portal.
function portalProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mdbook-portal-'))
  const w = (p, c) => {
    const abs = path.join(root, p)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, typeof c === 'string' ? c : JSON.stringify(c, null, 2))
  }
  w('.mdbook/config.yml', ['site: { title: Docs Portal, lang: en }', 'source:', '  spaces:', '    handbook: spaces/handbook', '    api: spaces/api'].join('\n'))
  // Space 1: handbook — en + de, one restricted subtree, space auth defaults.
  w('spaces/handbook/space.json', {
    code: 'handbook-space',
    names: { en: 'Handbook', de: 'Handbuch' },
    description: { en: 'How we work' },
    defaultLang: 'en',
    langs: ['en', 'de'],
    ssg: { auth: { rules: [{ path: 'secret', access: ['editor'] }] } }
  })
  w('spaces/handbook/pages.json', [
    { code: 'p1', contents: [
      { name: 'Intro', slug: 'intro', lang: 'en', contentType: 'markdown' },
      { name: 'Einfuehrung', slug: 'einfuehrung', lang: 'de', contentType: 'markdown' }
    ] },
    { code: 'p2', access: ['admin'], contents: [{ name: 'Secret', slug: 'secret', lang: 'en', contentType: 'markdown' }] }
  ])
  w('spaces/handbook/pages/intro.md', '# Intro\n\nSee [the API](page:api-space/reference) and [secret](page:secret).\n\n![pic](files/61/a.png)\n')
  w('spaces/handbook/pages/einfuehrung.md', '# Einfuehrung\n')
  w('spaces/handbook/pages/secret.md', '# Secret\n')
  w('spaces/handbook/attachments/61/a.png', 'PNG')
  // Space 2: api — en only.
  w('spaces/api/space.json', { code: 'api-space', names: { en: 'API' } })
  w('spaces/api/pages.json', [
    { code: 'a1', contents: [{ name: 'Reference', slug: 'reference', lang: 'en', contentType: 'markdown' }] }
  ])
  w('spaces/api/pages/reference.md', '# Reference\n\nBack to [intro](page:handbook-space/intro).\n')
  return root
}

test('portal ingest: mounts, sidebars, navs, home, langs', () => {
  const cfg = loadConfig(portalProject())
  assert.equal(cfg.source.format, 'termx') // spaces implies termx
  const model = ingestTermx(cfg)

  assert.equal(model.portal, true)
  assert.deepEqual(model.langs, ['en', 'de'])
  assert.equal(model.defaultLang, 'en')

  const dests = model.contentFiles.map((f) => f.dest)
  assert.ok(dests.includes('handbook/intro.md'))
  assert.ok(dests.includes('de/handbook/einfuehrung.md'))
  assert.ok(dests.includes('api/reference.md'))
  assert.ok(dests.includes('handbook/index.md')) // space landing at /handbook/
  assert.ok(dests.includes('index.md')) // generated portal home
  assert.ok(dests.includes('de/index.md'))

  // Sidebars: multi-sidebar objects keyed by mount, links mounted.
  assert.deepEqual(Object.keys(model.sidebars.en).sort(), ['/api/', '/handbook/'])
  assert.deepEqual(Object.keys(model.sidebars.de), ['/de/handbook/'])
  const enHandbook = JSON.stringify(model.sidebars.en['/handbook/'])
  assert.match(enHandbook, /"\/handbook\/intro"/)
  const deHandbook = JSON.stringify(model.sidebars.de['/de/handbook/'])
  assert.match(deHandbook, /"\/de\/handbook\/einfuehrung"/)

  // Nav: one entry per space with content in that locale, localized titles.
  assert.deepEqual(model.navs.en.map((n) => n.text).sort(), ['API', 'Handbook'])
  assert.deepEqual(model.navs.de, [{ text: 'Handbuch', link: '/de/handbook/' }])

  // Portal home lists the spaces.
  const home = model.contentFiles.find((f) => f.dest === 'index.md')
  assert.match(home.content, /\[\*\*Handbook\*\*\]\(\/handbook\/\)/)
  assert.match(home.content, /How we work/)
  assert.match(home.content, /\[\*\*API\*\*\]\(\/api\/\)/)
  const deHome = model.contentFiles.find((f) => f.dest === 'de/index.md')
  assert.match(deHome.content, /Handbuch/)
  assert.ok(!/API/.test(deHome.content)) // api has no de content

  // Cross-space context for the markdown layer.
  assert.deepEqual(model.spaceMounts, { 'handbook-space': 'handbook', 'api-space': 'api' })
  assert.deepEqual(model.spaceSlugs.api, ['reference'])
  assert.ok(model.spaceSlugs.handbook.includes('intro'))

  // Page-level access threads through with the mounted dest.
  const secret = model.contentFiles.find((f) => f.dest === 'handbook/secret.md')
  assert.deepEqual(secret.access, ['admin'])

  // Space ssg.auth arrives as mount-scoped rules.
  assert.deepEqual(model.authRules, [{ path: 'handbook/secret', access: ['editor'] }])

  // Attachments namespaced per mount.
  assert.equal(model.attachmentDirs.length, 1)
  assert.equal(model.attachmentDirs[0].mount, 'handbook')
})

test('mountFromPath: locale prefix is transparent, unknown segment is null', () => {
  const ctx = { langs: ['en', 'de'], mounts: ['handbook', 'api'] }
  assert.equal(mountFromPath('handbook/intro.md', ctx), 'handbook')
  assert.equal(mountFromPath('de/handbook/x.md', ctx), 'handbook')
  assert.equal(mountFromPath('api/reference.md', ctx), 'api')
  assert.equal(mountFromPath('index.md', ctx), null)
  assert.equal(mountFromPath('de/index.md', ctx), null)
})

test('portal markdown: page links and images resolve within the page mount', () => {
  const opts = {
    web: 'https://wiki.example.org',
    spaceCode: null,
    portal: true,
    langs: ['en', 'de'],
    spaceSlugs: { handbook: ['intro', 'secret'], api: ['reference'] },
    spaceMounts: { 'handbook-space': 'handbook', 'api-space': 'api' }
  }
  const md = new MarkdownIt({ html: true })
  md.use(termxLinks, opts)
  md.use(termxImages, opts)
  const render = (src, relativePath) => md.render(src, { relativePath })

  // Same-space link resolves under the page's own mount.
  assert.match(render('[x](page:secret)', 'handbook/intro.md'), /href="\/handbook\/secret"/)
  // Cross-space by space code -> internal mounted link.
  assert.match(render('[x](page:api-space/reference)', 'handbook/intro.md'), /href="\/api\/reference"/)
  // Cross-space by mount name works too.
  assert.match(render('[x](page:api/reference)', 'de/handbook/x.md'), /href="\/api\/reference"/)
  // Unknown space falls back to the wiki web URL.
  assert.match(render('[x](page:other/thing)', 'handbook/intro.md'), /href="https:\/\/wiki.example.org\/wiki\/other\/thing"/)
  // Attachments namespaced by mount.
  assert.match(render('![p](files/61/a.png)', 'handbook/intro.md'), /src="\/attachments\/handbook\/61\/a.png"/)
  assert.match(render('![p](files/61/a.png)', 'de/handbook/x.md'), /src="\/attachments\/handbook\/61\/a.png"/)
  // A page outside any mount (portal home) keeps the flat asset base.
  assert.match(render('![p](files/61/a.png)', 'index.md'), /src="\/attachments\/61\/a.png"/)
})
