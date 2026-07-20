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

// Flatten a resolved document into { title, version, servers, securitySchemes,
// operations[], schemas{}, webhooks[] }.
export function modelFromDocument(name, raw) {
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
        servers: op.servers || item.servers || doc.servers || []
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
    servers: doc.servers || [],
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

// Load and resolve every configured spec. Never throws: a spec that cannot be
// read is reported and skipped, so one bad document can't fail a whole site.
export async function loadOpenapiSpecs(cfg, log = () => {}) {
  if (!cfg.openapi) return {}
  const cacheDir = path.join(cfg.mdbookDir || cfg.projectRoot, '.mdbook', '.cache', 'openapi')
  const dir = path.join(path.dirname(cfg.build.staging), 'openapi')
  const out = {}

  let parser
  try {
    parser = await import('@readme/openapi-parser')
  } catch {
    log(pc.yellow('openapi: @readme/openapi-parser is not installed — skipping specs'))
    return {}
  }

  for (const [name, spec] of Object.entries(cfg.openapi.specs)) {
    const { url: src, headers } = typeof spec === 'string' ? { url: spec, headers: null } : spec
    const cacheFile = path.join(dir, `${name}.json`)
    let doc = null
    try {
      // bundle(), not dereference(): external files and URLs are pulled into one
      // document, but internal $refs stay put. That keeps schema *names* (so a
      // response reads `Pet[]`, not `object[]`) and makes recursive schemas safe.
      doc = await parser.bundle(headers ? await fetchWithHeaders(src, headers) : src)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(cacheFile, JSON.stringify(doc))
    } catch (e) {
      // Unreachable or invalid: fall back to the last good copy if we have one.
      const fallback = [cacheFile, path.join(cacheDir, `${name}.json`)].find((f) => fs.existsSync(f))
      if (fallback) {
        doc = JSON.parse(fs.readFileSync(fallback, 'utf8'))
        log(pc.yellow(`openapi: ${name} unreachable (${e.message.split('\n')[0]}) — using cached copy`))
      } else {
        const hint = e.missingEnv ? ' (set it in the build environment)' : ''
        log(pc.yellow(`openapi: ${name} could not be loaded — ${e.message.split('\n')[0]}${hint}`))
        continue
      }
    }
    out[name] = modelFromDocument(name, doc)
    log(`openapi ${pc.bold(name)} — ${out[name].operations.length} operations`)
  }
  return out
}
