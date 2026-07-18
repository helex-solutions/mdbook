import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routeFor, absImage, createMdbookConfig } from '../src/vitepress.mjs'

const find = (tags, pred) => tags.find(pred)

test('routeFor: index/cleanUrls/html variants', () => {
  assert.equal(routeFor('index.md', true), '')
  assert.equal(routeFor('import.md', true), 'import')
  assert.equal(routeFor('lt/index.md', true), 'lt/')
  assert.equal(routeFor('import.md', false), 'import.html')
})

test('absImage: passthrough / resolve / null', () => {
  assert.equal(absImage('https://x.io/a.png', null), 'https://x.io/a.png')
  assert.equal(absImage('/a/b.png', 'https://x.io/docs/'), 'https://x.io/docs/a/b.png')
  assert.equal(absImage('/a.png', null), null)
  assert.equal(absImage(null, 'https://x.io/'), null)
})

test('createMdbookConfig: sitemap + transformHead gated on siteUrl', () => {
  const withUrl = createMdbookConfig({ title: 'S', siteUrl: 'https://x.io/b/', langs: ['en'], defaultLang: 'en' })
  assert.deepEqual(withUrl.sitemap, { hostname: 'https://x.io/b/' })
  assert.equal(typeof withUrl.transformHead, 'function')

  const noUrl = createMdbookConfig({ title: 'S', langs: ['en'], defaultLang: 'en' })
  assert.equal(noUrl.sitemap, undefined)
})

test('seoHead: content page emits og/canonical/termx/JSON-LD', () => {
  const cfg = createMdbookConfig({
    title: 'Site', description: 'sd', siteUrl: 'https://x.io/b/', cleanUrls: true,
    langs: ['en'], defaultLang: 'en', spaceCode: 'space1'
  })
  const tags = cfg.transformHead({
    pageData: { relativePath: 'foo.md', title: 'Foo', description: 'Bar', frontmatter: { termxPage: 'p-1' } }
  })
  assert.ok(find(tags, (t) => t[1].property === 'og:title' && t[1].content === 'Foo'))
  assert.ok(find(tags, (t) => t[0] === 'link' && t[1].rel === 'canonical' && t[1].href === 'https://x.io/b/foo'))
  assert.ok(find(tags, (t) => t[1].name === 'termx:page' && t[1].content === 'p-1'))
  assert.ok(find(tags, (t) => t[1].name === 'termx:space' && t[1].content === 'space1'))
  const ld = JSON.parse(find(tags, (t) => t[0] === 'script' && t[1].type === 'application/ld+json')[2])
  assert.equal(ld['@type'], 'TechArticle')
  assert.equal(ld.url, 'https://x.io/b/foo')
})

test('seoHead: home is a WebSite / og:type website', () => {
  const cfg = createMdbookConfig({ title: 'Site', siteUrl: 'https://x.io/', cleanUrls: true, langs: ['en'], defaultLang: 'en' })
  const tags = cfg.transformHead({ pageData: { relativePath: 'index.md', title: 'Home' } })
  assert.ok(find(tags, (t) => t[1].property === 'og:type' && t[1].content === 'website'))
  assert.equal(JSON.parse(find(tags, (t) => t[0] === 'script')[2])['@type'], 'WebSite')
})

test('seoHead: no image -> summary card, no og:image', () => {
  const cfg = createMdbookConfig({ title: 'Site', langs: ['en'], defaultLang: 'en' })
  const tags = cfg.transformHead({ pageData: { relativePath: 'foo.md', title: 'Foo' } })
  assert.ok(find(tags, (t) => t[1].name === 'twitter:card' && t[1].content === 'summary'))
  assert.equal(find(tags, (t) => t[1].property === 'og:image'), undefined)
})
