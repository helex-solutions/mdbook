import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ingestTermx } from '../src/ingest/termx.mjs'

// Build a minimal TermX project: __source/{space,pages}.json + input/<slug>.md.
function tmpTermx(space, pages, pageBodies = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdbook-termx-'))
  fs.mkdirSync(path.join(dir, '__source'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'input'), { recursive: true })
  fs.writeFileSync(path.join(dir, '__source', 'space.json'), JSON.stringify(space))
  fs.writeFileSync(path.join(dir, '__source', 'pages.json'), JSON.stringify(pages))
  for (const [slug, body] of Object.entries(pageBodies)) {
    fs.writeFileSync(path.join(dir, 'input', `${slug}.md`), body)
  }
  return dir
}
const cfgFor = (dir, lang = 'en') => ({
  projectRoot: dir,
  source: { format: 'termx', meta: '__source', pages: 'input' },
  site: { lang, title: null, web: null }
})

test('termx ingest: reads space defaultLang/langs/description/siteUrl + page description/keywords', () => {
  const space = {
    code: 'sp1',
    names: { en: 'My Space', lt: 'Mano erdvė' },
    description: { en: 'English summary', lt: 'Lietuviška santrauka' },
    defaultLang: 'lt',
    langs: ['lt', 'en'],
    siteUrl: 'https://custom.example.org',
    ssg: { theme: { skin: 'helex' }, footer: { message: 'Guide' }, txServer: 'https://dev.termx.org/api/fhir' }
  }
  const pages = [
    {
      code: 'p1',
      tags: ['fhir', 'terminology'],
      contents: [
        { name: 'Home', slug: 'home', lang: 'en', description: 'Home page description' },
        { name: 'Pradžia', slug: 'pradzia', lang: 'lt' }
      ],
      children: []
    }
  ]
  const dir = tmpTermx(space, pages, { home: '# Home\n\nBody.', pradzia: '# Pradžia\n\nTekstas.' })
  const model = ingestTermx(cfgFor(dir, 'en'))

  assert.equal(model.defaultLang, 'lt', 'exported defaultLang wins over configured')
  assert.deepEqual(model.langs, ['lt', 'en'], 'exported langs order preserved')
  assert.equal(model.description, 'Lietuviška santrauka', 'space description for the default language')
  assert.equal(model.siteUrl, 'https://custom.example.org')
  assert.equal(model.ssg?.theme?.skin, 'helex', 'space ssg config passed through')
  assert.equal(model.ssg?.txServer, 'https://dev.termx.org/api/fhir')

  const en = model.contentFiles.find((f) => f.lang === 'en' && f.dest.endsWith('home.md'))
  assert.ok(en, 'english home page present')
  assert.equal(en.description, 'Home page description')
  assert.deepEqual(en.tags, ['fhir', 'terminology'], 'page tags -> keywords source')
})

test('termx ingest: falls back cleanly when the new fields are absent', () => {
  const space = { code: 'sp2', names: { en: 'Space' } }
  const pages = [{ code: 'p1', contents: [{ name: 'Home', slug: 'home', lang: 'en' }], children: [] }]
  const dir = tmpTermx(space, pages, { home: '# Home\n\nBody.' })
  const model = ingestTermx(cfgFor(dir, 'en'))

  assert.equal(model.defaultLang, 'en')
  assert.deepEqual(model.langs, ['en'])
  assert.equal(model.description, '', 'no space description -> empty')
  assert.equal(model.siteUrl, null, 'no siteUrl -> null (CI/config still apply upstream)')
  assert.equal(model.ssg, null, 'no ssg block -> null')
  const home = model.contentFiles.find((f) => f.dest.endsWith('home.md'))
  assert.equal(home.description, null)
  assert.equal(home.tags, null)
})

test('termx ingest: locale-switch redirect stubs for slugs that differ per language', () => {
  const space = { code: 'sp3', names: { en: 'Space', lt: 'Erdvė' }, defaultLang: 'en', langs: ['en', 'lt'] }
  const pages = [
    {
      code: 'build',
      contents: [
        { name: 'Builds', slug: 'build', lang: 'en' },
        { name: 'Versijos', slug: 'versijos', lang: 'lt' }
      ],
      children: []
    }
  ]
  const dir = tmpTermx(space, pages, { build: '# Builds\n', versijos: '# Versijos\n' })
  const model = ingestTermx(cfgFor(dir, 'en'))

  // Switching EN (/build) -> LT swaps the prefix to /lt/build; a stub there
  // redirects to the real /lt/versijos.
  const toLt = model.contentFiles.find((f) => f.dest === 'lt/build.md')
  assert.ok(toLt, 'stub at the swapped LT path exists')
  assert.equal(toLt.redirect, '/lt/versijos')
  // Switching LT (/lt/versijos) -> EN swaps to /versijos; a stub redirects to /build.
  const toEn = model.contentFiles.find((f) => f.dest === 'versijos.md')
  assert.ok(toEn, 'stub at the swapped EN path exists')
  assert.equal(toEn.redirect, '/build')
})
