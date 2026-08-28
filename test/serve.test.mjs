import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { createHandler, createSessionCodec, rolesFromClaims } from '../src/serve.mjs'

// A minimal built dist: public page, protected page, denied page, asset.
function makeDist() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'mdbook-serve-'))
  const w = (p, c) => {
    fs.mkdirSync(path.dirname(path.join(dist, p)), { recursive: true })
    fs.writeFileSync(path.join(dist, p), c)
  }
  w('index.html', '<h1>home</h1>')
  w('open.html', '<h1>open</h1>')
  w('internal/secret.html', '<h1>secret</h1>')
  w('auth/denied.html', '<h1>denied</h1>')
  w('404.html', '<h1>nope</h1>')
  w('attachments/42/pic.png', 'PNG')
  w('assets/app.js', 'js')
  return dist
}

const ACL = {
  default: 'public',
  rules: [{ path: 'internal/**', access: ['editor'] }],
  pages: { '/internal/secret': ['editor'] },
  assets: [{ prefix: '/attachments/42/', access: ['editor'] }]
}

function serve(handler) {
  const server = http.createServer(handler)
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }))
  })
}

const get = (port, p, headers = {}) =>
  fetch(`http://127.0.0.1:${port}${p}`, { headers, redirect: 'manual' })

test('session codec: roundtrip, tamper, expiry', () => {
  const codec = createSessionCodec('secret')
  const token = codec.sign({ sub: 'u1', roles: ['editor'], exp: Math.floor(Date.now() / 1000) + 60 })
  assert.equal(codec.verify(token).sub, 'u1')
  assert.equal(codec.verify(token + 'x'), null)
  assert.equal(codec.verify('garbage'), null)
  assert.equal(createSessionCodec('other').verify(token), null)
  const expired = codec.sign({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 1 })
  assert.equal(codec.verify(expired), null)
})

test('rolesFromClaims: dotted paths, fallback union, string values', () => {
  const idt = { realm_access: { roles: ['a'] }, resource_access: { owlexicon: { roles: ['b'] } } }
  const at = { roles: 'c d' }
  assert.deepEqual(
    rolesFromClaims([idt, at], 'realm_access.roles,resource_access.owlexicon.roles,roles').sort(),
    ['a', 'b', 'c', 'd']
  )
  assert.deepEqual(rolesFromClaims([{}], 'roles'), [])
  assert.deepEqual(rolesFromClaims([null, { roles: ['x'] }], 'roles'), ['x'])
})

test('no auth: plain static server with cleanUrls', async () => {
  const dist = makeDist()
  const { server, port } = await serve(createHandler({ dist, quiet: true }))
  try {
    assert.equal((await get(port, '/')).status, 200)
    assert.equal((await get(port, '/open')).status, 200)
    assert.equal((await get(port, '/internal/secret')).status, 200) // no auth -> everything public
    const nf = await get(port, '/missing')
    assert.equal(nf.status, 404)
    assert.match(await nf.text(), /nope/)
  } finally {
    server.close()
  }
})

test('trust-proxy mode: enforcement from gateway headers', async () => {
  const dist = makeDist()
  const auth = {
    access: 'public',
    trustProxy: { userHeader: 'X-Auth-Request-User', rolesHeader: 'X-Auth-Request-Groups' },
    session: { maxAge: 3600 }
  }
  const { server, port } = await serve(createHandler({ dist, acl: ACL, auth, quiet: true }))
  try {
    // Public page: fine anonymously.
    assert.equal((await get(port, '/open')).status, 200)
    // Protected page, anonymous browser -> redirect to login.
    const anon = await get(port, '/internal/secret')
    assert.equal(anon.status, 302)
    assert.match(anon.headers.get('location'), /^\/auth\/login\?returnTo=/)
    // Anonymous API-style call -> 401 JSON.
    const api = await get(port, '/internal/secret', { accept: 'application/json' })
    assert.equal(api.status, 401)
    // Right role -> 200.
    const ok = await get(port, '/internal/secret', {
      'X-Auth-Request-User': 'alice',
      'X-Auth-Request-Groups': 'editor,viewer'
    })
    assert.equal(ok.status, 200)
    assert.match(await ok.text(), /secret/)
    // Wrong role -> 403 with the denied page body.
    const denied = await get(port, '/internal/secret', {
      'X-Auth-Request-User': 'bob',
      'X-Auth-Request-Groups': 'viewer'
    })
    assert.equal(denied.status, 403)
    assert.match(await denied.text(), /denied/)
    // Protected asset follows its page.
    assert.equal((await get(port, '/attachments/42/pic.png')).status, 302)
    assert.equal(
      (await get(port, '/attachments/42/pic.png', { 'X-Auth-Request-User': 'a', 'X-Auth-Request-Groups': 'editor' })).status,
      200
    )
    // Rule (not just the exact page) protects new/unlisted routes in the section.
    assert.equal((await get(port, '/internal/whatever')).status, 302)
    // /auth/session reflects the headers.
    const sess = await get(port, '/auth/session', { 'X-Auth-Request-User': 'alice', 'X-Auth-Request-Groups': 'editor' })
    assert.equal(sess.status, 200)
    const body = await sess.json()
    assert.equal(body.user.name, 'alice')
    assert.deepEqual(body.roles, ['editor'])
    assert.equal((await get(port, '/auth/session')).status, 401)
    // Login/logout belong to the gateway in this mode.
    assert.equal((await get(port, '/auth/login')).status, 404)
  } finally {
    server.close()
  }
})

test('cookie session: verified and enforced', async () => {
  const dist = makeDist()
  const codec = createSessionCodec('test-secret')
  const auth = {
    issuer: 'https://sso.example.org/realms/x',
    clientId: 'owlexicon',
    scopes: ['openid'],
    roleClaims: 'roles',
    access: 'public',
    session: { maxAge: 3600 },
    trustProxy: null
  }
  const { server, port } = await serve(createHandler({ dist, acl: ACL, auth, codec, quiet: true }))
  try {
    const cookie = `mdbook-session=${codec.sign({ sub: 'u1', name: 'alice', roles: ['editor'], exp: Math.floor(Date.now() / 1000) + 60 })}`
    assert.equal((await get(port, '/internal/secret', { cookie })).status, 200)
    const sess = await get(port, '/auth/session', { cookie })
    assert.equal((await sess.json()).user.name, 'alice')
    // Tampered cookie -> anonymous -> redirect.
    const bad = `mdbook-session=${codec.sign({ sub: 'u1', roles: ['editor'] })}x`
    assert.equal((await get(port, '/internal/secret', { cookie: bad })).status, 302)
  } finally {
    server.close()
  }
})

test('bearer JWT verified against a configured issuer JWKS', async () => {
  const jose = await import('jose')
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256')
  const jwk = await jose.exportJWK(publicKey)
  jwk.kid = 'k1'
  jwk.alg = 'RS256'
  // A local "IdP" serving only the JWKS document.
  const jwksServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ keys: [jwk] }))
  })
  const jwksPort = await new Promise((r) => jwksServer.listen(0, '127.0.0.1', () => r(jwksServer.address().port)))
  const issuer = 'https://internal.example.org'

  const dist = makeDist()
  const codec = createSessionCodec('s')
  const auth = {
    issuer: 'https://main.example.org', // main issuer exists but is not used here
    clientId: 'owlexicon',
    roleClaims: 'roles',
    access: 'public',
    session: { maxAge: 3600 },
    trustProxy: null,
    issuers: { internal: { issuer, jwksUrl: `http://127.0.0.1:${jwksPort}/jwks`, audience: null } }
  }
  const { server, port } = await serve(createHandler({ dist, acl: ACL, auth, codec, quiet: true }))
  try {
    const token = await new jose.SignJWT({ roles: ['editor'], preferred_username: 'svc' })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setSubject('svc-1')
      .setExpirationTime('5m')
      .sign(privateKey)
    const ok = await get(port, '/internal/secret', { authorization: `Bearer ${token}` })
    assert.equal(ok.status, 200)
    // Unknown issuer -> anonymous.
    const foreign = await new jose.SignJWT({ roles: ['editor'] })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer('https://unknown.example.org')
      .setExpirationTime('5m')
      .sign(privateKey)
    assert.equal((await get(port, '/internal/secret', { authorization: `Bearer ${foreign}` })).status, 302)
    // Wrong signature -> anonymous.
    const { privateKey: otherKey } = await jose.generateKeyPair('RS256')
    const forged = await new jose.SignJWT({ roles: ['editor'] })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(issuer)
      .setExpirationTime('5m')
      .sign(otherKey)
    assert.equal((await get(port, '/internal/secret', { authorization: `Bearer ${forged}` })).status, 302)
  } finally {
    server.close()
    jwksServer.close()
  }
})

test('path traversal is rejected', async () => {
  const dist = makeDist()
  const { server, port } = await serve(createHandler({ dist, quiet: true }))
  try {
    const res = await get(port, '/..%2f..%2fetc%2fpasswd')
    assert.equal(res.status, 404)
  } finally {
    server.close()
  }
})

test('OIDC verify mode: full login roundtrip against a mock IdP', async () => {
  const jose = await import('jose')
  const { publicKey, privateKey } = await jose.generateKeyPair('RS256')
  const jwk = await jose.exportJWK(publicKey)
  jwk.kid = 'idp1'
  jwk.alg = 'RS256'

  // Mock IdP: discovery + JWKS + token endpoint issuing a signed id_token.
  let issuer
  let tokenRequestBody = null
  const idp = http.createServer(async (req, res) => {
    if (req.url === '/.well-known/openid-configuration') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        end_session_endpoint: `${issuer}/logout`
      }))
    } else if (req.url === '/jwks') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ keys: [jwk] }))
    } else if (req.url === '/token' && req.method === 'POST') {
      let body = ''
      for await (const c of req) body += c
      tokenRequestBody = new URLSearchParams(body)
      const idToken = await new jose.SignJWT({
        preferred_username: 'alice',
        realm_access: { roles: ['editor'] }
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'idp1' })
        .setIssuer(issuer)
        .setAudience('owlexicon')
        .setSubject('u-1')
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(privateKey)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ id_token: idToken, access_token: 'opaque-token', token_type: 'Bearer' }))
    } else {
      res.writeHead(404)
      res.end()
    }
  })
  const idpPort = await new Promise((r) => idp.listen(0, '127.0.0.1', () => r(idp.address().port)))
  issuer = `http://127.0.0.1:${idpPort}`

  const dist = makeDist()
  const codec = createSessionCodec('e2e-secret')
  const auth = {
    issuer,
    clientId: 'owlexicon',
    clientSecret: null,
    scopes: ['openid', 'profile'],
    roleClaims: 'realm_access.roles',
    access: 'public',
    publicUrl: null,
    session: { maxAge: 3600 },
    trustProxy: null,
    issuers: null
  }
  const { server, port } = await serve(createHandler({ dist, base: '/', acl: ACL, auth, codec, quiet: true }))
  try {
    // 1. Protected page anonymously -> login redirect.
    const first = await get(port, '/internal/secret')
    assert.equal(first.status, 302)
    // 2. Follow to /auth/login -> IdP authorize URL + PKCE cookie.
    const login = await get(port, first.headers.get('location'))
    assert.equal(login.status, 302)
    const authorize = new URL(login.headers.get('location'))
    assert.equal(authorize.origin, issuer)
    assert.equal(authorize.searchParams.get('client_id'), 'owlexicon')
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256')
    const pkceCookie = login.headers.get('set-cookie').split(';')[0]
    const state = authorize.searchParams.get('state')
    // 3. IdP "redirects back" with a code; the callback exchanges it.
    const cb = await get(port, `/auth/callback?code=abc123&state=${state}`, { cookie: pkceCookie })
    assert.equal(cb.status, 302)
    assert.equal(cb.headers.get('location'), '/internal/secret')
    assert.equal(tokenRequestBody.get('grant_type'), 'authorization_code')
    assert.equal(tokenRequestBody.get('code'), 'abc123')
    assert.ok(tokenRequestBody.get('code_verifier'))
    const sessionCookie = [].concat(cb.headers.getSetCookie()).find((c) => c.startsWith('mdbook-session='))
    assert.ok(sessionCookie)
    const cookie = sessionCookie.split(';')[0]
    // 4. The session now reads the protected page and reports roles.
    assert.equal((await get(port, '/internal/secret', { cookie })).status, 200)
    const sess = await (await get(port, '/auth/session', { cookie })).json()
    assert.equal(sess.user.name, 'alice')
    assert.deepEqual(sess.roles, ['editor'])
    // 5. State mismatch is rejected.
    const badCb = await get(port, `/auth/callback?code=abc123&state=WRONG`, { cookie: pkceCookie })
    assert.equal(badCb.status, 400)
    // 6. Logout clears the session and does RP-initiated logout at the IdP.
    const out = await get(port, '/auth/logout', { cookie })
    assert.equal(out.status, 302)
    const outUrl = new URL(out.headers.get('location'))
    assert.equal(outUrl.pathname, '/logout')
    assert.equal(outUrl.searchParams.get('client_id'), 'owlexicon')
  } finally {
    server.close()
    idp.close()
  }
})
