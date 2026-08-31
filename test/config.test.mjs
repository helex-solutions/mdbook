import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveBase, resolveSiteUrl, applySpaceConfig, loadConfig } from '../src/config.mjs'

const ENV_KEYS = ['GITHUB_ACTIONS', 'GITHUB_REPOSITORY', 'MDBOOK_BASE']
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function tmpProject(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdbook-cfg-'))
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content)
  return dir
}
function ci(repo) {
  process.env.GITHUB_ACTIONS = 'true'
  process.env.GITHUB_REPOSITORY = repo
  delete process.env.MDBOOK_BASE
}

test('resolveBase: explicit wins and is normalized', () => {
  assert.equal(resolveBase({ explicit: 'foo' }), '/foo/')
  assert.equal(resolveBase({ explicit: '/' }), '/')
})

test('resolveBase: GitHub project page -> /repo/', () => {
  ci('owner/repo')
  assert.equal(resolveBase({ projectRoot: tmpProject() }), '/repo/')
})

test('resolveBase: user/org github.io page -> /', () => {
  ci('owner/owner.github.io')
  assert.equal(resolveBase({ projectRoot: tmpProject() }), '/')
})

test('resolveBase: CNAME custom domain -> /', () => {
  ci('owner/repo')
  assert.equal(resolveBase({ projectRoot: tmpProject({ CNAME: 'docs.example.org' }) }), '/')
})

test('resolveBase: local default -> /', () => {
  for (const k of ENV_KEYS) delete process.env[k]
  assert.equal(resolveBase({ projectRoot: tmpProject() }), '/')
})

test('resolveSiteUrl: explicit gets a trailing slash', () => {
  assert.equal(resolveSiteUrl({ explicit: 'https://x.io/docs', base: '/docs/' }), 'https://x.io/docs/')
})

test('resolveSiteUrl: GitHub origin + base (owner lowercased)', () => {
  ci('Owner/repo')
  assert.equal(resolveSiteUrl({ projectRoot: tmpProject(), base: '/repo/' }), 'https://owner.github.io/repo/')
})

test('resolveSiteUrl: CNAME domain at root', () => {
  ci('owner/repo')
  const dir = tmpProject({ CNAME: 'docs.example.org' })
  assert.equal(resolveSiteUrl({ projectRoot: dir, base: '/' }), 'https://docs.example.org/')
})

test('resolveSiteUrl: null when local/unknown', () => {
  for (const k of ENV_KEYS) delete process.env[k]
  assert.equal(resolveSiteUrl({ projectRoot: tmpProject(), base: '/' }), null)
})

// A minimal cfg shaped like loadConfig's output, for the space-config merge.
function cfgLike({ raw = {}, theme = {}, footer = null, txServer = null, site = {} } = {}) {
  return {
    raw,
    site: { description: '', url: null, logo: null, ...site },
    theme: { skin: 'default', ...theme },
    footer,
    txServer,
    search: true
  }
}

test('applySpaceConfig: space ssg fills config that was not set explicitly', () => {
  const cfg = cfgLike()
  applySpaceConfig(cfg, {
    description: 'From the wiki',
    siteUrl: 'https://tutorial.example.org',
    ssg: {
      theme: { skin: 'helex' },
      footer: { message: 'Guide', copyright: '(c) 2026' },
      txServer: 'https://tx.example.org/api/fhir',
      search: false,
      logo: 'files/1/logo.png'
    }
  })
  assert.equal(cfg.theme.skin, 'helex')
  assert.deepEqual(cfg.footer, { message: 'Guide', copyright: '(c) 2026' })
  assert.equal(cfg.txServer, 'https://tx.example.org/api/fhir')
  assert.equal(cfg.search, false)
  assert.equal(cfg.site.logo, 'files/1/logo.png')
  assert.equal(cfg.site.description, 'From the wiki')
  assert.equal(cfg.site.url, 'https://tutorial.example.org/')
})

test('applySpaceConfig: an explicit config.yml value wins over the space', () => {
  const cfg = cfgLike({
    raw: { theme: { skin: 'custom' }, search: true, 'tx-server': 'https://cfg/fhir' },
    theme: { skin: 'custom' },
    footer: { message: 'Config footer' },
    txServer: 'https://cfg/fhir'
  })
  applySpaceConfig(cfg, {
    ssg: {
      theme: { skin: 'helex' },
      footer: { message: 'Wiki footer' },
      txServer: 'https://wiki/fhir',
      search: false
    }
  })
  assert.equal(cfg.theme.skin, 'custom', 'explicit skin kept')
  assert.equal(cfg.txServer, 'https://cfg/fhir', 'explicit tx-server kept')
  assert.equal(cfg.search, true, 'explicit search kept')
  assert.deepEqual(cfg.footer, { message: 'Config footer' }, 'existing footer kept')
})

test('applySpaceConfig: no-op when the space has no ssg block', () => {
  const cfg = cfgLike()
  applySpaceConfig(cfg, { ssg: null })
  assert.equal(cfg.theme.skin, 'default')
  assert.equal(cfg.footer, null)
  assert.equal(cfg.txServer, null)
})

test('source format: a retired format name is not normalized away', () => {
  // The former wiki-format name is NOT an alias. loadConfig keeps the raw
  // spelling so the build can reject it BY NAME (see test/format.test.mjs);
  // silently normalizing it would let a stale config build forever.
  const dir = tmpProject()
  fs.mkdirSync(path.join(dir, '.mdbook'), { recursive: true })
  fs.writeFileSync(
    path.join(dir, '.mdbook', 'config.yml'),
    'source:\n  format: termx\n  meta: docs\n'
  )
  const cfg = loadConfig(dir)
  assert.equal(cfg.source.format, 'termx', 'not rewritten to owliki')
  assert.equal(cfg.source.meta, 'docs', 'and the rest of the source block survives')
})
