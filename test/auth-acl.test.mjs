import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ruleRegex,
  resolveAccess,
  routeForDest,
  buildAclManifest,
  requirementFor,
  isAllowed,
  readAccessFrontmatter,
  isSearchable,
  SEARCH_INDEX_PREFIX
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

test('isSearchable: a page is indexed only if the chunk audience can read it', () => {
  // Public site: the chunk is public, so only public pages may go in it.
  assert.equal(isSearchable('public', 'public'), true)
  assert.equal(isSearchable('authenticated', 'public'), false)
  assert.equal(isSearchable(['viewer'], 'public'), false)

  // Wholly gated site — the regression this fixes: every page carries the site
  // default, so every page is indexable and the index is no longer empty.
  assert.equal(isSearchable(['viewer'], ['viewer']), true)
  assert.equal(isSearchable('authenticated', 'authenticated'), true)

  // A public page inside a gated site is safe: its readers are a superset.
  assert.equal(isSearchable('public', ['viewer']), true)
  // Any session satisfies `authenticated`, and the chunk already needs one.
  assert.equal(isSearchable('authenticated', ['viewer']), true)
  // But a role the chunk does not demand must stay out.
  assert.equal(isSearchable(['viewer'], 'authenticated'), false)

  // Mixed role sets: the chunk's roles must all open the page.
  assert.equal(isSearchable(['viewer', 'admin'], ['viewer']), true)
  assert.equal(isSearchable(['admin'], ['viewer']), false)
  assert.equal(isSearchable(['admin'], ['viewer', 'admin']), false)

  // Unset means public on either side.
  assert.equal(isSearchable(null, null), true)
  assert.equal(isSearchable(['viewer'], null), false)
})

test('the search index chunk is pinned at the site default', () => {
  const m = buildAclManifest({
    entries: [],
    rules: [],
    assets: [{ prefix: SEARCH_INDEX_PREFIX, access: ['viewer'] }],
    siteDefault: ['viewer']
  })
  assert.deepEqual(requirementFor(m, '/assets/chunks/@localSearchIndexroot.abc123.js'), ['viewer'])
  assert.equal(isAllowed(requirementFor(m, SEARCH_INDEX_PREFIX + 'root.js'), null), false)
})

test('ruleRegex: a rule path containing a space gates exactly what it names', () => {
  // The glob expansion used to park `**` behind a space, then turn every space
  // into `.*` — so this pattern became `my.*docs/.*` and gated unrelated
  // sections whose names merely started and ended the same way.
  const re = ruleRegex('my docs/**')
  assert.equal(re.test('my docs/internal.md'), true)
  assert.equal(re.test('my docs/deep/internal.md'), true)
  assert.equal(re.test('mydocs/internal.md'), false)
  assert.equal(re.test('my other docs/internal.md'), false)
})

test('ruleRegex: the glob convention itself is unchanged', () => {
  assert.equal(ruleRegex('internal/**').test('internal/a/b.md'), true)
  assert.equal(ruleRegex('internal/**').test('public/a.md'), false)
  // `*` stays within one segment; `**` crosses them.
  assert.equal(ruleRegex('specs/*.md').test('specs/a.md'), true)
  assert.equal(ruleRegex('specs/*.md').test('specs/deep/a.md'), false)
  assert.equal(ruleRegex('specs/**/x.md').test('specs/deep/x.md'), true)
  // A leading locale segment is transparent, so one rule covers translations.
  assert.equal(ruleRegex('internal/**').test('de/internal/a.md'), true)
})

test('a rule path with a space resolves and enforces on the real path only', () => {
  const rules = [{ path: 'my docs/**', access: ['editor'] }]
  assert.deepEqual(resolveAccess('my docs/plan.md', { rules }), ['editor'])
  assert.equal(resolveAccess('mydocs/plan.md', { rules }), 'public')
  const m = buildAclManifest({ entries: [], rules, siteDefault: 'public' })
  assert.deepEqual(requirementFor(m, '/my docs/plan'), ['editor'])
  assert.equal(requirementFor(m, '/mydocs/plan'), 'public')
})
