import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeAuth, normalizeAccess, parseMaxAge } from '../src/auth/config.mjs'

const env = (extra = {}) => ({ ...extra }) // isolated env, never process.env

test('normalizeAuth: absent or disabled -> null', () => {
  assert.equal(normalizeAuth(null, env()), null)
  assert.equal(normalizeAuth(undefined, env()), null)
  assert.equal(normalizeAuth({ enabled: false, issuer: 'https://x' }, env()), null)
})

test('normalizeAuth: config values win over env', () => {
  const a = normalizeAuth(
    { issuer: 'https://sso.example.org/realms/htx/', clientId: 'owlexicon' },
    env({ AUTH_OIDC_AUTHORITY: 'https://other', AUTH_OIDC_CLIENT_ID: 'nope' })
  )
  assert.equal(a.issuer, 'https://sso.example.org/realms/htx') // trailing slash dropped
  assert.equal(a.clientId, 'owlexicon')
})

test('normalizeAuth: env fallbacks (Helex names, then TermX names)', () => {
  const a = normalizeAuth({}, env({
    AUTH_OIDC_AUTHORITY: 'https://sso/realms/x',
    AUTH_OIDC_CLIENT_ID: 'owlexicon',
    AUTH_OIDC_SCOPE: 'openid profile email',
    AUTH_ROLE_CLAIMS: 'realm_access.roles',
    AUTH_SESSION_SECRET: 's3cret'
  }))
  assert.equal(a.issuer, 'https://sso/realms/x')
  assert.equal(a.clientId, 'owlexicon')
  assert.deepEqual(a.scopes, ['openid', 'profile', 'email'])
  assert.equal(a.roleClaims, 'realm_access.roles')
  assert.equal(a.session.secret, 's3cret')

  const b = normalizeAuth({}, env({ OAUTH_ISSUER: 'https://t/realms/y', OAUTH_CLIENT_ID: 'term-client' }))
  assert.equal(b.issuer, 'https://t/realms/y')
  assert.equal(b.clientId, 'term-client')
})

test('normalizeAuth: GUEST_DISABLED forces at least authenticated', () => {
  assert.equal(normalizeAuth({}, env({ GUEST_DISABLED: 'true' })).access, 'authenticated')
  assert.equal(normalizeAuth({}, env({ GUEST_DISABLED: '1' })).access, 'authenticated')
  assert.equal(normalizeAuth({}, env()).access, 'public')
  // An explicit role list is stricter than authenticated — kept as-is.
  assert.deepEqual(normalizeAuth({ access: ['admin'] }, env({ GUEST_DISABLED: 'true' })).access, ['admin'])
})

test('normalizeAuth: rules normalized and sorted most-specific-first', () => {
  const a = normalizeAuth(
    { rules: [{ path: 'x/**', access: 'authenticated' }, { path: 'x/deep/**', access: ['admin'] }, { path: '', access: ['x'] }] },
    env()
  )
  assert.equal(a.rules.length, 2)
  assert.equal(a.rules[0].path, 'x/deep/**')
  assert.deepEqual(a.rules[0].access, ['admin'])
})

test('normalizeAuth: ${VAR} secrets resolve from env; missing -> null', () => {
  const a = normalizeAuth({ clientSecret: '${CS}', session: { secret: '${SS}', maxAge: '30m' } }, env({ CS: 'abc', SS: 'def' }))
  assert.equal(a.clientSecret, 'abc')
  assert.equal(a.session.secret, 'def')
  assert.equal(a.session.maxAge, 1800)
  const b = normalizeAuth({ clientSecret: '${MISSING}' }, env())
  assert.equal(b.clientSecret, null)
})

test('normalizeAuth: issuers map with kebab-case keys', () => {
  const a = normalizeAuth(
    {
      issuers: {
        public: 'https://pub.example.org/',
        internal: { issuer: 'https://int.example.org', 'jwk-set-uri': 'https://int.example.org/jwks', audience: 'docs' }
      }
    },
    env()
  )
  assert.equal(a.issuers.public.issuer, 'https://pub.example.org')
  assert.equal(a.issuers.internal.jwksUrl, 'https://int.example.org/jwks')
  assert.equal(a.issuers.internal.audience, 'docs')
})

test('normalizeAuth: trustProxy defaults', () => {
  const a = normalizeAuth({ trustProxy: {} }, env())
  assert.equal(a.trustProxy.userHeader, 'X-Auth-Request-User')
  assert.equal(a.trustProxy.rolesHeader, 'X-Auth-Request-Groups')
})

test('normalizeAuth: logout defaults to local, idp is opt-in', () => {
  assert.equal(normalizeAuth({}, env()).logout, 'local')
  assert.equal(normalizeAuth({ logout: 'idp' }, env()).logout, 'idp')
  assert.equal(normalizeAuth({ logout: 'IDP' }, env()).logout, 'idp')
  assert.equal(normalizeAuth({ logout: 'nonsense' }, env()).logout, 'local')
})

test('normalizeAccess forms', () => {
  assert.equal(normalizeAccess('public'), 'public')
  assert.equal(normalizeAccess('authenticated'), 'authenticated')
  assert.deepEqual(normalizeAccess('editor'), ['editor'])
  assert.deepEqual(normalizeAccess(['a', 'b']), ['a', 'b'])
  assert.equal(normalizeAccess([]), null)
  assert.equal(normalizeAccess(null), null)
})

test('parseMaxAge', () => {
  assert.equal(parseMaxAge('8h'), 8 * 3600)
  assert.equal(parseMaxAge('7d'), 7 * 86400)
  assert.equal(parseMaxAge('90s'), 90)
  assert.equal(parseMaxAge(3600), 3600)
  assert.equal(parseMaxAge('nonsense'), 8 * 3600)
  assert.equal(parseMaxAge('1s'), 60) // clamped to a sane floor
})
