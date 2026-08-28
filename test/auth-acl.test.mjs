import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveAccess,
  routeForDest,
  buildAclManifest,
  requirementFor,
  isAllowed,
  readAccessFrontmatter
} from '../src/auth/acl.mjs'

test('resolveAccess: frontmatter override > rule > default', () => {
  const rules = [{ path: 'internal/**', access: ['editor'] }]
  assert.deepEqual(resolveAccess('internal/x.md', { pageAccess: ['admin'], rules }), ['admin'])
  assert.deepEqual(resolveAccess('internal/x.md', { rules }), ['editor'])
  assert.equal(resolveAccess('open/x.md', { rules }), 'public')
  assert.equal(resolveAccess('open/x.md', { rules, siteDefault: 'authenticated' }), 'authenticated')
  // A public page override inside a restricted section opens it up.
  assert.equal(resolveAccess('internal/announce.md', { pageAccess: 'public', rules }), 'public')
})

test('resolveAccess: longest rule wins; locale prefix is transparent', () => {
  const rules = [
    { path: 'internal/keys/**', access: ['admin'] },
    { path: 'internal/**', access: ['editor'] }
  ].sort((a, b) => b.path.length - a.path.length)
  assert.deepEqual(resolveAccess('internal/keys/root.md', { rules }), ['admin'])
  assert.deepEqual(resolveAccess('internal/other.md', { rules }), ['editor'])
  assert.deepEqual(resolveAccess('de/internal/keys/root.md', { rules }), ['admin'])
  assert.deepEqual(resolveAccess('lt/internal/other.md', { rules }), ['editor'])
})

test('resolveAccess: a bare directory path protects its subtree', () => {
  const rules = [{ path: 'handbook', access: 'authenticated' }]
  assert.equal(resolveAccess('handbook/intro.md', { rules }), 'authenticated')
  assert.equal(resolveAccess('handbook.md', { rules }), 'authenticated')
  assert.equal(resolveAccess('handbook-public.md', { rules }), 'public')
})

test('routeForDest', () => {
  assert.equal(routeForDest('internal/page.md'), '/internal/page')
  assert.equal(routeForDest('index.md'), '/')
  assert.equal(routeForDest('de/index.md'), '/de/')
  assert.equal(routeForDest('a/b/index.md'), '/a/b/')
})

test('buildAclManifest keeps only protected entries', () => {
  const m = buildAclManifest({
    entries: [
      { dest: 'open.md', access: 'public' },
      { dest: 'internal/x.md', access: ['editor'] },
      { dest: 'members.md', access: 'authenticated' }
    ],
    rules: [{ path: 'internal/**', access: ['editor'] }],
    assets: [
      { prefix: '/attachments/42/', access: ['editor'] },
      { prefix: '/attachments/7/', access: 'public' }
    ],
    siteDefault: 'public'
  })
  assert.deepEqual(Object.keys(m.pages), ['/internal/x', '/members'])
  assert.equal(m.assets.length, 1)
  assert.equal(m.rules.length, 1)
  assert.equal(m.default, 'public')
})

test('requirementFor: page > asset > rule > default', () => {
  const m = {
    default: 'public',
    rules: [{ path: 'internal/**', access: ['editor'] }],
    pages: { '/internal/keys': ['admin'], '/members': 'authenticated' },
    assets: [{ prefix: '/attachments/42/', access: ['editor'] }]
  }
  assert.deepEqual(requirementFor(m, '/internal/keys'), ['admin'])
  assert.deepEqual(requirementFor(m, '/internal/keys.html'), ['admin'])
  assert.deepEqual(requirementFor(m, '/internal/anything-else'), ['editor'])
  assert.deepEqual(requirementFor(m, '/attachments/42/pic.png'), ['editor'])
  assert.equal(requirementFor(m, '/members'), 'authenticated')
  assert.equal(requirementFor(m, '/open-page'), 'public')
  assert.equal(requirementFor(null, '/anything'), 'public')
})

test('isAllowed', () => {
  assert.equal(isAllowed('public', null), true)
  assert.equal(isAllowed('authenticated', null), false)
  assert.equal(isAllowed('authenticated', { roles: [] }), true)
  assert.equal(isAllowed(['editor'], { roles: ['viewer'] }), false)
  assert.equal(isAllowed(['editor', 'admin'], { roles: ['admin'] }), true)
  assert.equal(isAllowed(['editor'], null), false)
})

test('readAccessFrontmatter forms', () => {
  assert.equal(readAccessFrontmatter('# no frontmatter'), null)
  assert.equal(readAccessFrontmatter('---\ntitle: X\n---\n'), null)
  assert.equal(readAccessFrontmatter('---\naccess: public\n---\n'), 'public')
  assert.equal(readAccessFrontmatter('---\naccess: authenticated\n---\n'), 'authenticated')
  assert.deepEqual(readAccessFrontmatter('---\naccess: [editor, admin]\n---\n'), ['editor', 'admin'])
  assert.deepEqual(readAccessFrontmatter("---\naccess: ['a', \"b\"]\n---\n"), ['a', 'b'])
  assert.deepEqual(readAccessFrontmatter('---\naccess: wiki-handbook\n---\n'), ['wiki-handbook'])
  assert.deepEqual(readAccessFrontmatter('---\ntitle: X\naccess:\n  - editor\n  - admin\n---\n'), ['editor', 'admin'])
})
