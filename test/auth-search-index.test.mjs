// The regression this guards: on a wholly gated site every page counted as
// protected, staging excluded every one of them from the search index, and the
// site shipped an empty index — search returned nothing for every query.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stageContent, loadConfig } from '../src/build.mjs'
import { ingestGitbook } from '../src/ingest/gitbook.mjs'
import { requirementFor, isAllowed, SEARCH_INDEX_PREFIX } from '../src/auth/acl.mjs'

// A GitBook project with an `auth:` block, staged the way `mdbook build` stages
// it. `files` is a { relativePath: content } map.
function stage(authYaml, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdbook-search-'))
  for (const [rel, content] of Object.entries({ ...files, '.mdbook/config.yml': authYaml })) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  const cfg = loadConfig(dir)
  const staging = stageContent(cfg, ingestGitbook(cfg))
  // `search: false` in the staged frontmatter is what keeps a page out of the
  // index chunk, so that is what the assertions read.
  const excluded = (rel) => /^search: false$/m.test(fs.readFileSync(path.join(staging, rel), 'utf8'))
  return { cfg, excluded }
}

const GATED = `
site:
  title: Gated
auth:
  enabled: true
  issuer: https://example.invalid/realms/demo
  clientId: demo
  access: [viewer]
  rules:
    - path: internal/**
      access: [admin]
`

const PAGES = {
  'README.md': '# Home\n\nHome page.\n',
  'guide/README.md': '# Guide\n\nGuide index.\n',
  'internal/notes.md': '# Notes\n\nRunbooks and contact lists.\n',
  'open.md': '---\naccess: public\n---\n\n# Open\n\nPublic page.\n'
}

test('a wholly gated site still indexes its pages', () => {
  const { excluded } = stage(GATED, PAGES)
  // Pages carrying the site default: the reader of the index chunk is exactly
  // the reader of these pages, so they belong in it.
  assert.equal(excluded('index.md'), false, 'home is indexed')
  assert.equal(excluded('guide/index.md'), false, 'guide is indexed')
  // Weaker than the default — anyone who reaches the chunk can read it anyway.
  assert.equal(excluded('open.md'), false, 'a public page inside a gated site is indexed')
  // Stricter than the default: a viewer can fetch the chunk but cannot open
  // this page, so its text must not travel inside the chunk.
  assert.equal(excluded('internal/notes.md'), true, 'an admin-only page stays out')
})

test('a public site indexes only its public pages', () => {
  const { excluded } = stage(
    `
site:
  title: Open
auth:
  enabled: true
  issuer: https://example.invalid/realms/demo
  clientId: demo
  access: public
  rules:
    - path: internal/**
      access: [admin]
`,
    PAGES
  )
  assert.equal(excluded('index.md'), false, 'public default, public page')
  // The chunk itself is public here, so nothing protected may go in it.
  assert.equal(excluded('internal/notes.md'), true, 'protected page stays out of a public chunk')
})

test('an unauthenticated site indexes everything, as before', () => {
  const { cfg, excluded } = stage('site:\n  title: Plain\n', PAGES)
  assert.equal(cfg.auth, null)
  assert.equal(excluded('index.md'), false)
  assert.equal(excluded('internal/notes.md'), false)
})

test('the emitted manifest pins the index chunk at the site default', () => {
  const { cfg } = stage(GATED, PAGES)
  const acl = cfg.aclManifest
  assert.ok(
    acl.assets.some((a) => a.prefix === SEARCH_INDEX_PREFIX),
    'the chunk prefix is in the manifest'
  )
  // Whatever else the rules say, the chunk is gated at the site default — which
  // is the audience the indexing decision above assumed.
  const chunk = `${SEARCH_INDEX_PREFIX}root.abc123.js`
  assert.deepEqual(requirementFor(acl, chunk), ['viewer'])
  assert.equal(isAllowed(requirementFor(acl, chunk), null), false, 'anonymous is refused')
  assert.equal(isAllowed(requirementFor(acl, chunk), { roles: ['viewer'] }), true)
})
