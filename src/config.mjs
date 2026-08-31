// Loads and normalizes a project's `.mdbook/` configuration.
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { normalizeAuth, normalizeAccess } from './auth/config.mjs'

const CONFIG_NAMES = ['config.yml', 'config.yaml', 'config.json']

function readConfigFile(mdbookDir) {
  for (const name of CONFIG_NAMES) {
    const p = path.join(mdbookDir, name)
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf8')
      const data = name.endsWith('.json') ? JSON.parse(raw) : yaml.load(raw)
      return { data: data || {}, file: p }
    }
  }
  return { data: {}, file: null }
}

// Defaults per source format. GitBook and Owliki exports have different layouts.
const SOURCE_DEFAULTS = {
  gitbook: { root: '.', summary: 'SUMMARY.md', home: 'README.md', assets: '.gitbook/assets', pdf: true },
  owliki: { meta: '__source', pages: 'input', assets: 'files' }
}

// `format: termx` was this format's name before the wiki was called Owliki, and
// it is written into the config of every site already published with mdbook. It
// keeps working: a format name is a contract with those repositories, and
// renaming one without an alias turns the next release into "Unknown source
// format" for all of them. `owliki` is the name to write in new configs.
const FORMAT_ALIASES = { termx: 'owliki' }

function normalizeFormat(format) {
  const f = String(format).toLowerCase()
  return FORMAT_ALIASES[f] || f
}

export function loadConfig(projectRoot, overrides = {}) {
  projectRoot = path.resolve(projectRoot)
  const mdbookDir = path.join(projectRoot, '.mdbook')
  const { data, file } = readConfigFile(mdbookDir)

  const format = normalizeFormat(
    data.source?.format || (data.source?.spaces ? 'owliki' : detectFormat(projectRoot)) || 'gitbook'
  )
  const sourceDefaults = SOURCE_DEFAULTS[format] || {}

  const siteBase = resolveBase({ explicit: overrides.base ?? data.site?.base, projectRoot })

  const cfg = {
    projectRoot,
    mdbookDir,
    configFile: file,
    raw: data, // the parsed config.yml, used to tell an explicit setting from an applied default

    site: {
      title: data.site?.title || null, // resolved later from space.json / dir name
      description: data.site?.description || '',
      lang: data.site?.lang || 'en',
      logo: data.site?.logo || null,
      ...data.site,
      // Resolved last so they win over the spread. Auto-detected in CI.
      base: siteBase,
      // Canonical absolute URL (origin + base), used for sitemap/canonical/OG.
      url: resolveSiteUrl({ explicit: data.site?.url, projectRoot, base: siteBase })
    },
    source: {
      ...sourceDefaults,
      ...(data.source || {}),
      // Resolved last so it wins over the spread: `data.source.format` is the raw
      // spelling, and an alias (`termx`) has to survive to the normalized name.
      format
    },
    // FHIR terminology server base (…/fhir) for expanding {{csc:}}/{{vsc:}} at
    // build time and for cs:/vs: links. Accepts `txServer` or `tx-server`.
    txServer: (data.txServer || data['tx-server'] || null)?.replace?.(/\/$/, '') || null,
    theme: {
      skin: data.theme?.skin || 'default',
      accent: data.theme?.accent || null,
      switcher: data.theme?.switcher ?? false, // show a live skin switcher in the UI
      ...(data.theme || {})
    },
    // Menu customization — merged on top of the auto-generated menu.
    nav: data.nav || [],
    sidebar: data.sidebar || null, // if set, fully overrides the generated sidebar
    sidebarExtra: data.sidebarExtra || [], // appended to the generated sidebar
    // `search: true|false`, or `search: { enabled, exclude: [patterns] }`.
    // Excluded pages stay published but are kept out of the search index — a few
    // huge pages (a generated glossary, a changelog) can otherwise dominate it.
    search: typeof data.search === 'object' && data.search ? (data.search.enabled ?? true) : (data.search ?? true),
    searchExclude:
      (typeof data.search === 'object' && data.search && data.search.exclude) || [],
    // Diagram rendering. `plantumlServer` is the PlantUML endpoint (e.g.
    // https://www.plantuml.com/plantuml, or a self-hosted one) — UNSET by
    // default, because rendering sends the fence's source to that server and
    // points every reader's browser at it. With none set, a ```plantuml fence
    // renders as a code block. Mermaid and draw.io need no server.
    diagrams: {
      plantumlServer: data.diagrams?.plantumlServer || data.diagrams?.plantuml || null
    },
    openapi: normalizeOpenapi(data.openapi, projectRoot),
    // Site authentication (see docs/auth-design.md): OIDC gate + access rules,
    // resolved at build into acl.json and enforced by `mdbook serve`.
    auth: normalizeAuth(data.auth),
    comments: data.comments || null, // e.g. { provider: giscus, repo, repoId, category, categoryId }
    footer: data.footer || null, // site footer: { message, copyright } (inline HTML allowed)
    locales: data.locales || null, // resolved from content when null
    build: {
      out: path.resolve(projectRoot, overrides.out || data.build?.out || '.mdbook/dist'),
      staging: path.resolve(projectRoot, data.build?.staging || '.mdbook/.cache/site'),
      cleanUrls: data.build?.cleanUrls ?? true
    }
  }
  // The try-it console's OIDC falls back to the site auth block, so one realm
  // and client id serve both, configured once.
  if (cfg.openapi && !cfg.openapi.auth && cfg.auth?.clientId && cfg.auth?.issuer) {
    cfg.openapi.auth = {
      clientId: cfg.auth.clientId,
      issuer: cfg.auth.issuer,
      scopes: cfg.auth.scopes,
      pkce: true,
      redirectUri: '/oauth2/callback',
      audience: null
    }
  }
  return cfg
}

// Merge the space.json export metadata into cfg as defaults. A repo's own config.yml always wins:
// fields with a non-null default (skin/switcher/search) are only taken from the space when the raw
// parsed config didn't set them; CI/CNAME URL detection still wins over the space's siteUrl upstream.
export function applySpaceConfig(cfg, model) {
  if (!cfg.site.description && model.description) cfg.site.description = model.description
  if (!cfg.site.url && model.siteUrl) {
    cfg.site.url = model.siteUrl.endsWith('/') ? model.siteUrl : model.siteUrl + '/'
  }
  const raw = cfg.raw || {}
  const ssg = model.ssg || {}
  if (ssg.theme?.skin && raw.theme?.skin == null) cfg.theme.skin = ssg.theme.skin
  if (ssg.theme?.accent && raw.theme?.accent == null) cfg.theme.accent = ssg.theme.accent
  if (ssg.theme?.switcher != null && raw.theme?.switcher == null) cfg.theme.switcher = ssg.theme.switcher
  if (ssg.txServer && raw.txServer == null && raw['tx-server'] == null) cfg.txServer = ssg.txServer
  if (ssg.footer && !cfg.footer) cfg.footer = ssg.footer
  if (ssg.search != null && raw.search == null) cfg.search = ssg.search
  if (ssg.logo && !cfg.site.logo) cfg.site.logo = ssg.logo
  // The wiki knows its own PlantUML endpoint; a space can export it so a
  // published repo renders the fences its pages render. The repo's config wins.
  const ssgPlantuml = ssg.diagrams?.plantumlServer || ssg.plantumlServer
  if (ssgPlantuml && raw.diagrams?.plantumlServer == null) cfg.diagrams.plantumlServer = ssgPlantuml
  // wiki-ssg contract extension: the space may export access defaults
  // (`ssg.auth: { access, rules }`). The repo's own auth block wins.
  if (ssg.auth && raw.auth == null) cfg.auth = normalizeAuth(ssg.auth)
  // Portal: per-space ssg.auth arrives as mount-scoped rules from the ingester.
  // They apply only when the portal has auth configured, and specificity
  // (longest path) still decides between them and the repo's own rules.
  if (cfg.auth && model.authRules?.length) {
    const extra = model.authRules
      .map((r) => ({ path: r.path, access: normalizeAccess(r.access) }))
      .filter((r) => r.access)
    cfg.auth.rules = [...cfg.auth.rules, ...extra].sort((a, b) => b.path.length - a.path.length)
  }
  return cfg
}

// Normalize the `openapi:` block.
//
//   openapi:
//     specs:                       # name -> local file or URL; pages cite the name
//       petstore: ./api/petstore.yaml
//       billing:  https://api.example.com/openapi.json
//     tryIt: true                  # interactive console (default: on)
//     auth:                        # ONLY what an OpenAPI document cannot declare
//       clientId: docs-portal      #   the spec's securitySchemes own the endpoints
//       scopes: [openid, api.read]
//       pkce: true
//       redirectUri: /oauth2/callback
//       issuer: https://id.example.com/realms/x   # fallback when the spec has no
//                                                 # openIdConnect scheme
//
// There is deliberately no `openapi: true` switch — declaring specs enables the
// feature, so the two can never disagree. `enabled: false` still turns it off.
function normalizeOpenapi(data, projectRoot) {
  if (!data || data.enabled === false) return null
  // A spec is either a bare file/URL, or an object carrying fetch headers for a
  // document that sits behind auth:
  //     mpi:
  //       url: https://api.example.com/api/mpi/api-docs
  //       headers: { Authorization: "Bearer ${EMR_API_TOKEN}" }
  // `${VAR}` is resolved from the build environment — a token belongs in CI, not
  // in a config file, and is never written to the built site.
  // `openapi.headers` applies to every spec (a whole API behind one token), and
  // a spec's own `headers` override it per entry.
  const defaultHeaders = data.headers || null
  const specs = {}
  for (const [name, value] of Object.entries(data.specs || {})) {
    const src = typeof value === 'string' ? value : value?.url
    if (!src) continue
    const own = (typeof value === 'object' && value?.headers) || null
    const headers = defaultHeaders || own ? { ...(defaultHeaders || {}), ...(own || {}) } : null
    specs[name] = {
      url: /^https?:\/\//i.test(src) ? String(src) : path.resolve(projectRoot, src),
      headers,
      // Overrides whatever the document declares — a generated one often names
      // the address the service sees itself on rather than a reachable base.
      server: (typeof value === 'object' && value?.server) || null
    }
  }
  if (!Object.keys(specs).length) return null
  const auth = data.auth || null
  return {
    specs,
    server: data.server || null, // default base URL for every spec
    // Dev-server proxy: { '/api': 'https://host' }. The try-it console then
    // calls the docs' own origin, so the browser never makes a cross-origin
    // request and the API needs no CORS headers. Applies to `dev` only.
    proxy: data.proxy || null,
    // 'path' (default) sorts operations by path then method; 'none' keeps the
    // document's own order.
    sort: data.sort || 'path',
    tryIt: data.tryIt ?? data['try-it'] ?? true,
    // Operations render collapsed by default: a document with hundreds of
    // operations is unreadable fully expanded. The detail stays in the HTML, so
    // search still finds it.
    collapsed: data.collapsed ?? true,
    auth: auth
      ? {
          clientId: auth.clientId || auth['client-id'] || null,
          issuer: (auth.issuer || null)?.replace?.(/\/$/, '') || null,
          scopes: auth.scopes || ['openid'],
          pkce: auth.pkce ?? true, // public client: PKCE is the only safe flow
          redirectUri: auth.redirectUri || auth['redirect-uri'] || '/oauth2/callback',
          audience: auth.audience || null
        }
      : null
  }
}

function detectFormat(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, '__source', 'pages.json'))) return 'owliki'
  if (fs.existsSync(path.join(projectRoot, 'input', 'pages.json'))) return 'owliki'
  if (fs.existsSync(path.join(projectRoot, 'SUMMARY.md'))) return 'gitbook'
  return null
}

function normalizeBase(base) {
  if (!base.startsWith('/')) base = '/' + base
  if (!base.endsWith('/')) base += '/'
  return base
}

const CNAME_PATHS = ['CNAME', 'public/CNAME', '.gitbook/assets/CNAME']

// A GitHub Pages custom domain (a CNAME file) means the site is served at the
// domain root, so base is '/'.
function hasCname(projectRoot) {
  return CNAME_PATHS.some((p) => fs.existsSync(path.join(projectRoot, p)))
}

// The custom domain from a CNAME file, if any.
function readCname(projectRoot) {
  for (const p of CNAME_PATHS) {
    const f = path.join(projectRoot, p)
    if (fs.existsSync(f)) {
      const domain = fs.readFileSync(f, 'utf8').trim().split(/\s+/)[0]
      if (domain) return domain
    }
  }
  return null
}

// Resolve the canonical absolute site URL (origin + base, trailing slash) used
// for the sitemap, canonical links and Open Graph tags. Precedence:
//   1. explicit site.url in config
//   2. CNAME custom domain -> https://<domain>/<base>
//   3. GitHub Actions -> https://<owner>.github.io/<base>
//   4. null (local/unknown: relative-only, sitemap/canonical skipped)
export function resolveSiteUrl({ explicit, projectRoot, base }) {
  if (explicit) return explicit.endsWith('/') ? explicit : explicit + '/'
  let origin = null
  const cname = readCname(projectRoot)
  const repo = process.env.GITHUB_REPOSITORY
  if (cname) origin = `https://${cname}`
  else if (process.env.GITHUB_ACTIONS === 'true' && repo?.includes('/')) {
    origin = `https://${repo.split('/')[0].toLowerCase()}.github.io`
  }
  return origin ? origin + base : null
}

// Resolve the site base path. Precedence:
//   1. explicit --base / site.base in config
//   2. MDBOOK_BASE env
//   3. GitHub Actions: /<repo>/ for a project page ('/' for a custom domain or
//      an <owner>.github.io user/org page)
//   4. '/'
export function resolveBase({ explicit, projectRoot }) {
  if (explicit != null) return normalizeBase(explicit)
  if (process.env.MDBOOK_BASE) return normalizeBase(process.env.MDBOOK_BASE)
  const repo = process.env.GITHUB_REPOSITORY
  if (process.env.GITHUB_ACTIONS === 'true' && repo?.includes('/')) {
    const [owner, name] = repo.split('/')
    if (hasCname(projectRoot)) return '/'
    if (name.toLowerCase() === `${owner.toLowerCase()}.github.io`) return '/'
    return normalizeBase(name)
  }
  return '/'
}
