// OpenAPI ingestion: load the documents named in `openapi.specs`, resolve them,
// and flatten them into a model the page renderer can slice.
//
// Documents are read at BUILD time, not in the browser. That keeps a spec usable
// on an air-gapped/private network, pins the docs to the spec they were built
// from, and sidesteps the CORS requirement a client-side fetch would impose.
// Resolved documents are cached so a later build still works when a remote spec
// is unreachable.
import fs from 'node:fs'
import path from 'node:path'
import pc from 'picocolors'

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace']

// Swagger 2.0 keeps schemas under `definitions` and the server split across
// host/basePath/schemes; map those onto their 3.x equivalents so the rest of the
// pipeline only ever sees one shape.
function fromSwagger2(doc) {
  const schemes = doc.schemes?.length ? doc.schemes : ['https']
  const servers = doc.host ? schemes.map((s) => ({ url: `${s}://${doc.host}${doc.basePath || ''}` })) : []
  return {
    ...doc,
    servers: doc.servers || servers,
    components: doc.components || {
      schemas: doc.definitions || {},
      securitySchemes: doc.securityDefinitions || {}
    }
  }
}

// A generated document often declares the address the service sees itself on —
// springdoc emits http://127.0.0.1:8080 — which is useless to a reader. Prefer,
// in order: an explicit `server:` from config, any declared server that is not
// loopback, then the origin the document was fetched from (which is by
// definition reachable, since the build just used it).
const LOOPBACK = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i

export function effectiveServers(declared = [], { sourceUrl, server } = {}) {
  if (server) return [{ url: String(server).replace(/\/+$/, '') }]
  const routable = declared.filter((s) => s?.url && !LOOPBACK.test(s.url))
  if (routable.length) return routable
  if (sourceUrl && /^https?:/i.test(sourceUrl)) {
    try {
      return [{ url: new URL(sourceUrl).origin }]
    } catch {
      /* fall through to whatever was declared */
    }
  }
  return declared
}

// Flatten a resolved document into { title, version, servers, securitySchemes,
// operations[], schemas{}, webhooks[] }.
export function modelFromDocument(name, raw, opts = {}) {
  const doc = raw.swagger?.startsWith('2') ? fromSwagger2(raw) : raw
  // Kept so the renderer can follow the internal $refs that bundle() preserves.
  const operations = []

  const collect = (pathKey, item, kind) => {
    if (!item) return
    // Parameters declared on the path apply to every operation under it.
    const shared = item.parameters || []
    for (const method of HTTP_METHODS) {
      const op = item[method]
      if (!op) continue
      operations.push({
        spec: name,
        kind, // 'path' | 'webhook'
        method: method.toUpperCase(),
        path: pathKey,
        id: op.operationId || `${method}-${pathKey}`,
        operationId: op.operationId || null,
        summary: op.summary || '',
        description: op.description || '',
        tags: op.tags || [],
        deprecated: !!op.deprecated,
        parameters: [...shared, ...(op.parameters || [])],
        requestBody: op.requestBody || null,
        responses: op.responses || {},
        security: op.security ?? doc.security ?? null,
        servers: effectiveServers(op.servers || item.servers || doc.servers || [], opts)
      })
    }
  }

  for (const [p, item] of Object.entries(doc.paths || {})) collect(p, item, 'path')
  // OpenAPI 3.1 webhooks: same shape as a path item, but not addressable by URL.
  for (const [hook, item] of Object.entries(doc.webhooks || {})) collect(hook, item, 'webhook')

  return {
    doc,
    name,
    title: doc.info?.title || name,
    version: doc.info?.version || '',
    description: doc.info?.description || '',
    servers: effectiveServers(doc.servers || [], opts),
    securitySchemes: doc.components?.securitySchemes || {},
    schemas: doc.components?.schemas || {},
    operations,
    tags: doc.tags || []
  }
}

// The OpenID Connect discovery URL a document declares, if any. An
// `openIdConnect` scheme states it directly; an `oauth2` scheme only gives raw
// endpoints, which the console can use as-is.
export function authFromSchemes(securitySchemes = {}) {
  for (const scheme of Object.values(securitySchemes)) {
    if (scheme?.type === 'openIdConnect' && scheme.openIdConnectUrl) {
      return { kind: 'openIdConnect', discoveryUrl: scheme.openIdConnectUrl, scopes: [] }
    }
  }
  for (const scheme of Object.values(securitySchemes)) {
    if (scheme?.type !== 'oauth2') continue
    const flow = scheme.flows?.authorizationCode || scheme.flows?.implicit
    if (flow?.authorizationUrl) {
      return {
        kind: 'oauth2',
        authorizationUrl: flow.authorizationUrl,
        tokenUrl: flow.tokenUrl || null,
        scopes: Object.keys(flow.scopes || {})
      }
    }
  }
  return null
}

// Resolve `${VAR}` against the build environment. Missing names are collected
// rather than substituted, so a build never sends a literal "${TOKEN}" upstream.
export function expandEnv(value, missing = [], env = process.env) {
  return String(value).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_m, name) => {
    if (env[name] == null || env[name] === '') {
      missing.push(name)
      return ''
    }
    return env[name]
  })
}

// Fetch a document that needs headers (an API behind auth) and hand the parsed
// object to the resolver. Only internal $refs can be followed in this mode —
// which is what a generated spec emits.
async function fetchWithHeaders(url, headers, env = process.env) {
  const missing = []
  const resolved = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, expandEnv(v, missing, env)])
  )
  if (missing.length) {
    const err = new Error(`environment variable(s) not set: ${[...new Set(missing)].join(', ')}`)
    err.missingEnv = true
    throw err
  }
  const res = await fetch(url, { headers: resolved, redirect: 'follow' })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    const yaml = (await import('js-yaml')).default
    return yaml.load(text)
  }
}

// Dig the real reason out of a json-schema-ref-parser failure.
//
// Its resolver wraps a plugin failure as `{ plugin, error }` — a plain object
// with no `message` — and hands that to `new ResolverError(wrapper, url)`, whose
// message falls back to `Error reading file "<url>"` when the thing it wraps has
// none (util/errors.js). So the one line a build logs is the one line that says
// nothing: the HTTP status, the DNS failure, the reset connection are all in
// `wrapper.error.message`, thrown away before anybody sees it.
//
// Measured on docs.helex.org/emr: four specs failed with `Error reading file
// "<url>"` and no way to tell why, while the same URLs answered 200 in 100 ms
// from the same host a minute later.
export function resolverCause(err) {
  if (!err) return 'unknown error'
  const seen = new Set()
  const walk = (e, depth) => {
    if (!e || depth > 4 || seen.has(e)) return null
    seen.add(e)
    // An inner error is more specific than its wrapper, so prefer it.
    for (const inner of [e.error, e.cause, Array.isArray(e.errors) ? e.errors[0] : null]) {
      const found = walk(inner, depth + 1)
      if (found) return found
    }
    const msg = typeof e.message === 'string' ? e.message.trim() : ''
    // The generic fallback is what we are trying to get past, not an answer.
    return msg && !/^Error reading file "/.test(msg) ? msg : null
  }
  return walk(err, 0) || (typeof err.message === 'string' && err.message.trim()) || String(err)
}

// Retry a spec fetch. The documents are served by live services, and a service
// that is restarting, a proxy that hiccups or a connection that resets makes one
// attempt fail and the next succeed — with no retry, a build publishes that
// module's API reference from a cached copy (or drops it) for a transient blip.
// Deliberately not retried: a missing environment variable, and anything that is
// not fetched over the network. Neither heals by asking again.
export async function withRetries(fn, { attempts = 3, delayMs = 400, onRetry = () => {} } = {}) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt)
    } catch (err) {
      lastError = err
      if (err && err.missingEnv) break
      if (attempt < attempts) {
        onRetry(attempt, err)
        // Linear backoff: the failures worth retrying here are blips, not load
        // shedding, so waiting minutes buys nothing on a build that fetches ~30.
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt))
      }
    }
  }
  throw lastError
}

const isHttpSource = (src) => typeof src === 'string' && /^https?:\/\//i.test(src)

// Replace every URL in a failure message with "the service", so that one unset
// token across 32 specs groups as one problem instead of 32 near-identical
// lines. The punctuation around the URL has to survive: the old pattern ran to
// the next whitespace and swallowed the closing quote or the colon with it,
// printing `Error reading file "the service` — an unbalanced line that read
// like the message itself had been truncated.
export function maskUrls(text) {
  return String(text).replace(/https?:\/\/[^\s"'<>)\]]+/g, (match) => {
    const trailing = /[:.,;!?]$/.test(match) ? match.slice(-1) : ''
    return `the service${trailing}`
  })
}

// Load and resolve every configured spec. Never throws: a spec that cannot be
// read is reported and skipped, so one bad document can't fail a whole site.
export async function loadOpenapiSpecs(cfg, log = () => {}) {
  if (!cfg.openapi) return {}
  const cacheDir = path.join(cfg.mdbookDir || cfg.projectRoot, '.mdbook', '.cache', 'openapi')
  const dir = path.join(path.dirname(cfg.build.staging), 'openapi')
  const out = {}
  // `openapi.retries: 1` switches the retries off for a site that would rather
  // see a failure immediately than wait for two more attempts.
  const retries = Number.isInteger(cfg.openapi.retries) && cfg.openapi.retries > 0 ? cfg.openapi.retries : 3

  let parser
  try {
    parser = await import('@readme/openapi-parser')
  } catch {
    log(pc.yellow('openapi: @readme/openapi-parser is not installed — skipping specs'))
    return {}
  }

  // Failures are grouped by cause: one unset token across 34 specs is one
  // problem, not 34, and 34 identical lines bury everything else in the log.
  const problems = new Map()
  // Group on the *kind* of failure, not the literal message: each one embeds its
  // own URL, which would otherwise make 32 identical 401s look like 32 problems.
  const note = (reason, name) => {
    const key = maskUrls(reason)
    problems.set(key, [...(problems.get(key) || []), name])
  }

  for (const [name, spec] of Object.entries(cfg.openapi.specs)) {
    const { url: src, headers } = typeof spec === 'string' ? { url: spec, headers: null } : spec
    const cacheFile = path.join(dir, `${name}.json`)
    let doc = null
    try {
      // bundle(), not dereference(): external files and URLs are pulled into one
      // document, but internal $refs stay put. That keeps schema *names* (so a
      // response reads `Pet[]`, not `object[]`) and makes recursive schemas safe.
      const load = async () => parser.bundle(headers ? await fetchWithHeaders(src, headers) : src)
      doc = isHttpSource(src)
        ? await withRetries(load, {
            attempts: retries,
            onRetry: (attempt, err) =>
              log(pc.yellow(`openapi: ${name} attempt ${attempt} failed (${resolverCause(err)}) — retrying`))
          })
        : await load()
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(cacheFile, JSON.stringify(doc))
    } catch (e) {
      // Unreachable or invalid: fall back to the last good copy if we have one.
      const fallback = [cacheFile, path.join(cacheDir, `${name}.json`)].find((f) => fs.existsSync(f))
      const reason = resolverCause(e).split('\n')[0]
      if (fallback) {
        doc = JSON.parse(fs.readFileSync(fallback, 'utf8'))
        note(`${reason} — using cached copy`, name)
      } else {
        note(e.missingEnv ? `${reason} (set it in the build environment)` : reason, name)
        continue
      }
    }
    out[name] = modelFromDocument(name, doc, { sourceUrl: src, server: spec.server || cfg.openapi.server })
  }

  const names = Object.keys(out)
  if (names.length) {
    const ops = names.reduce((n, k) => n + out[k].operations.length, 0)
    // Few specs: name them. Many: a count, so the log stays readable.
    const which = names.length <= 4 ? ` (${names.join(', ')})` : ''
    log(`openapi ${pc.bold(names.length)} spec(s)${which} — ${ops} operations`)
  }
  for (const [reason, failed] of problems) {
    const list = failed.length <= 6 ? failed.join(', ') : `${failed.slice(0, 6).join(', ')} +${failed.length - 6} more`
    log(pc.yellow(`openapi: ${failed.length} spec(s) not loaded [${list}] — ${reason}`))
  }
  return out
}
