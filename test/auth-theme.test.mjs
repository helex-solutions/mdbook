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
// Giscus threading. `owliki` and `termx` are the same instruction under two
// names and MUST produce the same term: a site that updates its config would
// otherwise lose every discussion it has.
// ---------------------------------------------------------------------------

test('giscusMapping: owliki and its former name termx thread by the same page code', () => {
  const owliki = giscusMapping('owliki', 'p-42')
  assert.deepEqual(owliki, { mapping: 'specific', term: 'p-42' })
  assert.deepEqual(giscusMapping('termx', 'p-42'), owliki, 'the old spelling is not a new thread')
})

test('giscusMapping: no page code falls back to pathname, never an empty term', () => {
  // `specific` with an empty term is a discussion nobody can find again.
  for (const m of ['owliki', 'termx']) {
    assert.deepEqual(giscusMapping(m, undefined), { mapping: 'pathname' })
  }
})

test('giscusMapping: a real giscus mapping passes through untouched', () => {
  for (const m of ['pathname', 'url', 'title', 'og:title']) {
    assert.deepEqual(giscusMapping(m, 'p-42'), { mapping: m }, m)
  }
  assert.deepEqual(giscusMapping(undefined, 'p-42'), { mapping: 'pathname' }, 'unset default')
})
