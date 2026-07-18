import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveBase, resolveSiteUrl } from '../src/config.mjs'

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
