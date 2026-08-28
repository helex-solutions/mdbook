// `mdbook serve` — the production entry point for a gated site (docs/auth-design.md).
//
// Serves the built dist and enforces acl.json. Two identity modes, mutually
// exclusive:
//   - verify (default): server-side OIDC Authorization Code + PKCE against
//     auth.issuer; the session is a signed HttpOnly cookie. Bearer JWTs from
//     auth.issuers (or the main issuer) are also accepted and verified.
//   - trustProxy: identity read from headers an authenticating gateway sets.
//     Safe only when nothing reaches this process except through that gateway.
//
// Without an `auth:` config this is a plain static server.
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import crypto from 'node:crypto'
import pc from 'picocolors'
import { loadConfig } from './config.mjs'
import { requirementFor, isAllowed } from './auth/acl.mjs'

const log = (msg) => console.log(pc.cyan('mdbook'), msg)

// ---------------------------------------------------------------- session ---

// Compact signed token: b64url(json).b64url(hmacSHA256(json, secret)).
// Small enough for a cookie; tamper-evident; self-expiring via `exp`.
export function createSessionCodec(secret) {
  const key = crypto.createHash('sha256').update(String(secret)).digest()
  const mac = (data) => crypto.createHmac('sha256', key).update(data).digest()
  const b64 = (buf) => Buffer.from(buf).toString('base64url')
  return {
    sign(payload) {
      const body = b64(JSON.stringify(payload))
      return `${body}.${b64(mac(body))}`
    },
    verify(token) {
      if (!token || typeof token !== 'string') return null
      const dot = token.lastIndexOf('.')
      if (dot < 1) return null
      const body = token.slice(0, dot)
      const sig = Buffer.from(token.slice(dot + 1), 'base64url')
      const expect = mac(body)
      if (sig.length !== expect.length || !crypto.timingSafeEqual(sig, expect)) return null
      try {
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
        if (payload.exp && Date.now() / 1000 > payload.exp) return null
        return payload
      } catch {
        return null
      }
    }
  }
}

// ------------------------------------------------------------------- oidc ---

const discoveryCache = new Map()
async function discover(issuer) {
  if (discoveryCache.has(issuer)) return discoveryCache.get(issuer)
  const url = `${issuer.replace(/\/$/, '')}/.well-known/openid-configuration`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`OIDC discovery failed: ${url} -> HTTP ${res.status}`)
  const doc = await res.json()
  discoveryCache.set(issuer, doc)
  return doc
}

// Dotted claim paths ("realm_access.roles,resource_access.owlexicon.roles"),
// unioned in order; a missing or malformed claim contributes nothing.
export function rolesFromClaims(payloads, roleClaims) {
  const roles = new Set()
  const paths = String(roleClaims || 'roles').split(',').map((p) => p.trim()).filter(Boolean)
  for (const payload of payloads.filter(Boolean)) {
    for (const p of paths) {
      let v = payload
      for (const seg of p.split('.')) v = v?.[seg]
      if (Array.isArray(v)) v.forEach((r) => r && roles.add(String(r)))
      else if (typeof v === 'string') v.split(/[,\s]+/).forEach((r) => r && roles.add(r))
    }
  }
  return [...roles]
}

// Per-issuer JWKS, lazily created and cached. Verification selects the issuer
// by the token's own `iss`, and never trusts a token from an unknown issuer.
function createBearerVerifier(auth, jose) {
  const entries = []
  if (auth.issuer) entries.push({ issuer: auth.issuer, jwksUrl: null, audience: null })
  for (const v of Object.values(auth.issuers || {})) entries.push(v)
  const jwks = new Map()
  return async function verifyBearer(token) {
    let iss
    try {
      iss = jose.decodeJwt(token).iss?.replace(/\/$/, '')
    } catch {
      return null
    }
    const entry = entries.find((e) => e.issuer === iss)
    if (!entry) return null
    if (!jwks.has(iss)) {
      const url = entry.jwksUrl || (await discover(iss)).jwks_uri
      jwks.set(iss, jose.createRemoteJWKSet(new URL(url)))
    }
    try {
      const { payload } = await jose.jwtVerify(token, jwks.get(iss), {
        issuer: iss,
        ...(entry.audience ? { audience: entry.audience } : {})
      })
      return {
        sub: payload.sub,
        name: payload.preferred_username || payload.name || payload.sub,
        roles: rolesFromClaims([payload], auth.roleClaims)
      }
    } catch {
      return null
    }
  }
}

// ------------------------------------------------------------------ http ----

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.map': 'application/json'
}

function parseCookies(req) {
  const out = {}
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return out
}

function setCookie(res, name, value, { maxAge, path = '/', secure = false, clear = false } = {}) {
  const parts = [`${name}=${clear ? '' : value}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax']
  if (secure) parts.push('Secure')
  if (clear) parts.push('Max-Age=0')
  else if (maxAge) parts.push(`Max-Age=${maxAge}`)
  const prev = res.getHeader('Set-Cookie')
  res.setHeader('Set-Cookie', [...(prev ? [].concat(prev) : []), parts.join('; ')])
}

// The site's public origin: explicit auth.publicUrl, else the proxy's
// X-Forwarded-Proto/Host, else the request Host.
function originFor(req, auth) {
  if (auth?.publicUrl) return auth.publicUrl
  const proto = req.headers['x-forwarded-proto']?.split(',')[0].trim() || 'http'
  const host = req.headers['x-forwarded-host']?.split(',')[0].trim() || req.headers.host
  return `${proto}://${host}`
}

// Only same-site relative paths may be a login return target.
const safeReturnTo = (v) => (v && v.startsWith('/') && !v.startsWith('//') ? v : '/')

function send(res, status, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(status, { 'Content-Type': type, ...extra })
  res.end(body)
}

const b64url = (buf) => Buffer.from(buf).toString('base64url')

// Resolve a base-relative route to a file in the dist (cleanUrls layout).
function resolveFile(dist, route) {
  const safe = path.normalize(route).replace(/^([/\\.])+/, '')
  const abs = path.join(dist, safe)
  if (!abs.startsWith(dist)) return null
  const candidates = route.endsWith('/')
    ? [path.join(abs, 'index.html')]
    : path.extname(abs)
      ? [abs]
      : [`${abs}.html`, path.join(abs, 'index.html'), abs]
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

// Exported for tests: builds the request handler from resolved pieces.
export function createHandler({ dist, base = '/', acl = null, auth = null, codec = null, quiet = false }) {
  const trust = auth?.trustProxy || null
  let verifyBearer = null // lazy — jose is only imported when needed

  const identityOf = async (req) => {
    if (trust) {
      const user = req.headers[trust.userHeader.toLowerCase()]
      if (!user) return null
      const roles = String(req.headers[trust.rolesHeader.toLowerCase()] || '')
        .split(/[,\s]+/)
        .filter(Boolean)
      return { sub: user, name: user, roles }
    }
    const cookie = parseCookies(req)['mdbook-session']
    if (cookie && codec) {
      const s = codec.verify(cookie)
      if (s) return s
    }
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '')
    if (m && auth?.issuer) {
      if (!verifyBearer) {
        const jose = await import('jose')
        verifyBearer = createBearerVerifier(auth, jose)
      }
      return verifyBearer(m[1])
    }
    return null
  }

  const access = (req, res, status, user, note = '') => {
    if (quiet) return
    const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress
    console.log(`${ip} ${user || '-'} ${req.method} ${req.url} ${status}${note ? ` ${note}` : ''}`)
  }

  // ---- OIDC endpoints (verify mode) ----
  async function handleAuth(req, res, url, session) {
    const secure = originFor(req, auth).startsWith('https://')
    if (url.pathname === '/auth/session') {
      if (!session) return send(res, 401, JSON.stringify({ error: 'unauthenticated' }), MIME['.json'])
      return send(
        res,
        200,
        JSON.stringify({ user: { sub: session.sub, name: session.name }, roles: session.roles || [] }),
        MIME['.json'],
        { 'Cache-Control': 'no-store' }
      )
    }
    if (trust) return send(res, 404, 'not found') // gateway owns login/logout
    if (!auth?.issuer || !auth?.clientId) {
      return send(res, 500, 'auth.issuer / auth.clientId not configured')
    }
    const doc = await discover(auth.issuer)
    const origin = originFor(req, auth)
    const redirectUri = `${origin}${base}auth/callback`.replace(/([^:])\/\//g, '$1/')

    if (url.pathname === '/auth/login') {
      const state = b64url(crypto.randomBytes(16))
      const verifier = b64url(crypto.randomBytes(48))
      const challenge = b64url(crypto.createHash('sha256').update(verifier).digest())
      const returnTo = safeReturnTo(url.searchParams.get('returnTo'))
      setCookie(res, 'mdbook-pkce', codec.sign({ state, verifier, returnTo, exp: Date.now() / 1000 + 600 }), {
        path: `${base}auth`,
        secure
      })
      const q = new URLSearchParams({
        response_type: 'code',
        client_id: auth.clientId,
        redirect_uri: redirectUri,
        scope: auth.scopes.join(' '),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256'
      })
      return send(res, 302, '', 'text/plain', { Location: `${doc.authorization_endpoint}?${q}` })
    }

    if (url.pathname === '/auth/callback') {
      const pkce = codec.verify(parseCookies(req)['mdbook-pkce'])
      const code = url.searchParams.get('code')
      if (!pkce || !code || url.searchParams.get('state') !== pkce.state) {
        return send(res, 400, 'sign-in failed: state mismatch (retry from the page you came from)')
      }
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: auth.clientId,
        code_verifier: pkce.verifier
      })
      if (auth.clientSecret) body.set('client_secret', auth.clientSecret)
      const tokenRes = await fetch(doc.token_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      })
      if (!tokenRes.ok) {
        access(req, res, 502, null, 'token-exchange-failed')
        return send(res, 502, `sign-in failed: token endpoint returned HTTP ${tokenRes.status}`)
      }
      const tokens = await tokenRes.json()
      const jose = await import('jose')
      // The id_token is verified against the issuer's keys (defense in depth —
      // it already arrived over the TLS channel we opened to the token
      // endpoint). Roles may live in either token; both are decoded.
      let idClaims = null
      try {
        const jwks = jose.createRemoteJWKSet(new URL(doc.jwks_uri))
        idClaims = (
          await jose.jwtVerify(tokens.id_token, jwks, { issuer: doc.issuer, audience: auth.clientId })
        ).payload
      } catch (e) {
        access(req, res, 502, null, 'id-token-verify-failed')
        return send(res, 502, `sign-in failed: id_token verification (${e?.message || e})`)
      }
      let accessClaims = null
      try {
        accessClaims = jose.decodeJwt(tokens.access_token)
      } catch {
        /* opaque access token — roles must come from the id_token */
      }
      const session = {
        sub: idClaims.sub,
        name: idClaims.preferred_username || idClaims.name || idClaims.email || idClaims.sub,
        roles: rolesFromClaims([idClaims, accessClaims], auth.roleClaims),
        exp: Math.floor(Date.now() / 1000) + auth.session.maxAge
      }
      setCookie(res, 'mdbook-pkce', '', { path: `${base}auth`, clear: true })
      setCookie(res, 'mdbook-session', codec.sign(session), { path: base, maxAge: auth.session.maxAge, secure })
      access(req, res, 302, session.name, 'signed-in')
      return send(res, 302, '', 'text/plain', { Location: safeReturnTo(pkce.returnTo) })
    }

    if (url.pathname === '/auth/logout') {
      setCookie(res, 'mdbook-session', '', { path: base, clear: true })
      const landing = `${origin}${base}auth/signed-out`.replace(/([^:])\/\//g, '$1/')
      const location = doc.end_session_endpoint
        ? `${doc.end_session_endpoint}?${new URLSearchParams({ client_id: auth.clientId, post_logout_redirect_uri: landing })}`
        : landing
      access(req, res, 302, session?.name, 'signed-out')
      return send(res, 302, '', 'text/plain', { Location: location })
    }

    return send(res, 404, 'not found')
  }

  const serveFile = (res, file, status = 200) => {
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'
    const cache = /\/assets\//.test(file.replace(/\\/g, '/'))
      ? 'public, max-age=31536000, immutable'
      : 'no-cache'
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': cache })
    fs.createReadStream(file).pipe(res)
  }

  return async function handler(req, res) {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')
      const url = new URL(req.url, 'http://internal')
      let route = decodeURIComponent(url.pathname)
      // Strip the site base so ACL routes and dist paths are base-relative.
      if (base !== '/' && route.startsWith(base)) route = '/' + route.slice(base.length)
      if (base !== '/' && (route + '/') === base) route = '/'

      const session = auth ? await identityOf(req) : null

      if (auth && route.startsWith('/auth/')) return await handleAuth(req, res, new URL(route + url.search, 'http://internal'), session)

      const requirement = auth ? requirementFor(acl, route) : 'public'
      if (!isAllowed(requirement, session)) {
        if (!session) {
          // Anonymous: browsers are sent to sign in; API-style callers get 401.
          if ((req.headers.accept || '').includes('application/json')) {
            access(req, res, 401, null)
            return send(res, 401, JSON.stringify({ error: 'unauthenticated' }), MIME['.json'])
          }
          access(req, res, 302, null, 'login-redirect')
          const returnTo = encodeURIComponent(url.pathname + url.search)
          return send(res, 302, '', 'text/plain', { Location: `${base}auth/login?returnTo=${returnTo}` })
        }
        access(req, res, 403, session.name)
        const denied = resolveFile(dist, '/auth/denied')
        if (denied) return serveFile(res, denied, 403)
        return send(res, 403, 'access denied')
      }

      const file = resolveFile(dist, route)
      if (!file) {
        access(req, res, 404, session?.name)
        const nf = resolveFile(dist, '/404')
        if (nf) return serveFile(res, nf, 404)
        return send(res, 404, 'not found')
      }
      access(req, res, 200, session?.name)
      return serveFile(res, file)
    } catch (err) {
      console.error(err)
      return send(res, 500, 'internal error')
    }
  }
}

// ------------------------------------------------------------------ entry ---

export async function serveSite(projectRoot, overrides = {}) {
  const cfg = loadConfig(projectRoot, overrides)
  const dist = cfg.build.out
  if (!fs.existsSync(path.join(dist, 'index.html'))) {
    throw new Error(`no built site at ${dist} — run \`mdbook build\` first (or pass --build)`)
  }

  const auth = cfg.auth
  let acl = null
  let codec = null
  if (auth) {
    const aclPath = path.join(dist, 'acl.json')
    acl = fs.existsSync(aclPath) ? JSON.parse(fs.readFileSync(aclPath, 'utf8')) : null
    if (!acl) {
      throw new Error(`auth is configured but ${aclPath} is missing — rebuild with this mdbook version`)
    }
    if (!auth.trustProxy && (!auth.issuer || !auth.clientId)) {
      throw new Error('auth requires issuer + clientId (or trustProxy) — set them in config or env (AUTH_OIDC_AUTHORITY, AUTH_OIDC_CLIENT_ID)')
    }
    let secret = auth.session.secret
    if (!secret) {
      secret = crypto.randomBytes(32).toString('hex')
      log(pc.yellow('auth: no session secret configured (AUTH_SESSION_SECRET) — using an ephemeral one; sessions reset on restart'))
    }
    codec = createSessionCodec(secret)
    log(
      auth.trustProxy
        ? `auth: trust-proxy mode (${auth.trustProxy.userHeader} / ${auth.trustProxy.rolesHeader})`
        : `auth: OIDC verify mode against ${auth.issuer} (client ${auth.clientId})`
    )
    log(`auth: default access "${Array.isArray(auth.access) ? auth.access.join(',') : auth.access}", ${Object.keys(acl.pages).length} protected page(s), ${acl.rules.length} rule(s)`)
  }

  const handler = createHandler({ dist, base: cfg.site.base, acl, auth, codec })
  const server = http.createServer(handler)
  const port = overrides.port || 8080
  const host = overrides.host === true ? '0.0.0.0' : overrides.host || '127.0.0.1'
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, resolve)
  })
  log(pc.green(`serving ${dist} at http://${host}:${port}${cfg.site.base}`))
  return server
}
