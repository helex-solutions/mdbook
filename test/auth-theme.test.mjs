import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { returnToFor } from '../src/auth/nav.mjs'
import { giscusMapping } from '../src/theme/giscus.mjs'

const at = (pathname, search = '') => ({ pathname, search })

test('returnToFor: comes back to the page the reader was on', () => {
  assert.equal(returnToFor('/mdbook/', at('/mdbook/guide/code')), '/mdbook/guide/code')
  assert.equal(returnToFor('/mdbook/', at('/mdbook/internal/notes', '?x=1')), '/mdbook/internal/notes?x=1')
  assert.equal(returnToFor('/mdbook/', at('/mdbook/')), '/mdbook/')
})

test('returnToFor: never returns to a generated auth page', () => {
  // Signing in and landing back on "Signed out" reads as a failed login.
  for (const p of ['signed-out', 'denied', 'login', 'logout', 'callback']) {
    assert.equal(returnToFor('/mdbook/', at(`/mdbook/auth/${p}`)), '/mdbook/')
  }
})

test('returnToFor: no location (SSR) falls back to the base', () => {
  assert.equal(returnToFor('/mdbook/', null), '/mdbook/')
})

// The auth endpoints are served by `mdbook serve`, not by the static bundle.
// VitePress's router intercepts same-origin anchor clicks unless the link
// carries `download` or `target`, so without one the click is handled
// client-side, renders the SPA 404 and never reaches the server.
test('auth links opt out of the SPA router', () => {
  const src = fs.readFileSync(new URL('../src/theme/auth.mjs', import.meta.url), 'utf8')
  assert.match(src, /const nav = \{ target: '_self' \}/, 'the opt-out attribute must be defined')
  // Both links must spread it into their props, or the click is swallowed.
  for (const cls of ['mdbook-auth-signin', 'mdbook-auth-signout']) {
    const re = new RegExp(`\\{ \\.\\.\\.nav,[^}]*${cls}`)
    assert.match(src, re, `${cls} must spread nav so VitePress leaves the click alone`)
  }
})

// ---------------------------------------------------------------------------
// Giscus threading. `owliki` means "thread by the wiki's stable page code"; the
// former name is no longer accepted and falls through to giscus untouched. The
// TERM is the page code either way, so a site that updates that one config word
// keeps every discussion it has.
// ---------------------------------------------------------------------------

test('giscusMapping: owliki threads by the stable page code', () => {
  assert.deepEqual(giscusMapping('owliki', 'p-42'), { mapping: 'specific', term: 'p-42' })
})

test('giscusMapping: the retired name is no longer special-cased', () => {
  // It passes through as an ordinary giscus mapping rather than threading by
  // page code — which is what makes updating the config word the migration.
  assert.deepEqual(giscusMapping('termx', 'p-42'), { mapping: 'termx' })
})

test('giscusMapping: no page code falls back to pathname, never an empty term', () => {
  // `specific` with an empty term is a discussion nobody can find again.
  assert.deepEqual(giscusMapping('owliki', undefined), { mapping: 'pathname' })
})

test('giscusMapping: a real giscus mapping passes through untouched', () => {
  for (const m of ['pathname', 'url', 'title', 'og:title']) {
    assert.deepEqual(giscusMapping(m, 'p-42'), { mapping: m }, m)
  }
  assert.deepEqual(giscusMapping(undefined, 'p-42'), { mapping: 'pathname' }, 'unset default')
})
