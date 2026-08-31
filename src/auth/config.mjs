// Normalize the `auth:` config block (see docs/auth-design.md).
//
// Every key falls back to the environment variable its ecosystem already uses
// (AUTH_OIDC_* are the Helex runtime-config names, OAUTH_* / AUTH_ROLE_CLAIMS /
// GUEST_DISABLED the legacy ones), so a container can be fully configured from
// env alone. Secrets accept `${VAR}` and are resolved against the environment —
// they belong to the process running `mdbook serve`, never to the built site.
import { expandEnv } from '../ingest/openapi.mjs'

const isTrue = (v) => v === true || v === 'true' || v === '1' || v === 1

// 'public' | 'authenticated' | [role, …] — anything else is null (unset).
export function normalizeAccess(value) {
  if (value == null) return null
  if (Array.isArray(value)) {
    const roles = value.map(String).filter(Boolean)
    return roles.length ? roles : null
  }
  const s = String(value).trim()
  if (s === 'public' || s === 'authenticated') return s
  return s ? [s] : null
}

// '8h' / '30m' / '3600' / '7d' -> seconds. Bad input falls back to 8 hours.
export function parseMaxAge(value, fallback = 8 * 3600) {
  if (value == null) return fallback
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(60, value)
  const m = /^(\d+)\s*([smhd]?)$/.exec(String(value).trim())
  if (!m) return fallback
  const mult = { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]]
  return Math.max(60, Number(m[1]) * mult)
}

// `${VAR}` in a secret-ish value; a missing variable resolves to null (the
// serve command reports it by name) rather than a literal "${VAR}".
function secret(value, env) {
  if (value == null) return null
  const missing = []
  const out = expandEnv(value, missing, env)
  return missing.length ? null : out || null
}

export function normalizeAuth(data, env = process.env) {
  if (!data || data.enabled === false) return null

  const issuer =
    (data.issuer || env.AUTH_OIDC_AUTHORITY || env.OAUTH_ISSUER || null)?.replace?.(/\/$/, '') ||
    null
  const scopes = data.scopes
    ? [].concat(data.scopes).map(String)
    : (env.AUTH_OIDC_SCOPE || env.OAUTH_SCOPE || 'openid profile').split(/\s+/).filter(Boolean)

  // Site default access; GUEST_DISABLED forces at least `authenticated`.
  let access = normalizeAccess(data.access) || 'public'
  if (access === 'public' && isTrue(env.GUEST_DISABLED)) access = 'authenticated'

  const rules = []
  for (const r of data.rules || []) {
    const path = r?.path && String(r.path)
    const acc = normalizeAccess(r?.access)
    if (path && acc) rules.push({ path, access: acc })
  }
  // Longest (most specific) path decides when several match.
  rules.sort((a, b) => b.path.length - a.path.length)

  const issuers = {}
  for (const [name, v] of Object.entries(data.issuers || {})) {
    const iss = (typeof v === 'string' ? v : v?.issuer)?.replace?.(/\/$/, '')
    if (!iss) continue
    issuers[name] = {
      issuer: iss,
      jwksUrl: (typeof v === 'object' && (v.jwksUrl || v['jwk-set-uri'])) || null,
      audience: (typeof v === 'object' && v.audience) || null
    }
  }

  const tp = data.trustProxy || data['trust-proxy'] || null

  return {
    issuer,
    clientId: data.clientId || data['client-id'] || env.AUTH_OIDC_CLIENT_ID || env.OAUTH_CLIENT_ID || null,
    clientSecret: secret(data.clientSecret ?? data['client-secret'], env) || env.AUTH_OIDC_CLIENT_SECRET || null,
    scopes,
    roleClaims: String(data.roleClaims || data['role-claims'] || env.AUTH_ROLE_CLAIMS || 'roles'),
    access,
    rules,
    // Sign-out scope. 'idp' (default) performs RP-initiated logout: the realm
    // session ends, so the reader is signed out of every application sharing
    // it — which is what people mean by "sign out". 'local' drops this site's
    // session only, leaving sibling applications untouched; the cost is that
    // the realm session survives, so see reauthAfterLogout.
    logout: (data.logout || 'idp').toLowerCase() === 'local' ? 'local' : 'idp',
    // Only relevant to logout: local. The surviving realm session would sign
    // the next login straight back in as the same person, so a deliberate
    // sign-out asks the provider for a fresh login next time. Set false to let
    // that next login complete silently.
    reauthAfterLogout: (data.reauthAfterLogout ?? data['reauth-after-logout']) !== false,
    // Absolute public origin of the served site (scheme://host[:port]). Usually
    // derived per request from X-Forwarded-Proto/Host; set it when the proxy
    // does not send those headers.
    publicUrl: (data.publicUrl || env.AUTH_PUBLIC_URL || null)?.replace?.(/\/$/, '') || null,
    session: {
      secret: secret(data.session?.secret, env) || env.AUTH_SESSION_SECRET || null,
      maxAge: parseMaxAge(data.session?.maxAge)
    },
    trustProxy: tp
      ? {
          userHeader: tp.userHeader || tp['user-header'] || 'X-Auth-Request-User',
          rolesHeader: tp.rolesHeader || tp['roles-header'] || 'X-Auth-Request-Groups'
        }
      : null,
    issuers: Object.keys(issuers).length ? issuers : null
  }
}
