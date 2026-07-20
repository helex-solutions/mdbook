// Loads and normalizes a project's `.mdbook/` configuration.
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'

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

// Defaults per source format. GitBook and TermX exports have different layouts.
const SOURCE_DEFAULTS = {
  gitbook: { root: '.', summary: 'SUMMARY.md', home: 'README.md', assets: '.gitbook/assets' },
  termx: { meta: '__source', pages: 'input', assets: 'files' }
}

export function loadConfig(projectRoot, overrides = {}) {
  projectRoot = path.resolve(projectRoot)
  const mdbookDir = path.join(projectRoot, '.mdbook')
  const { data, file } = readConfigFile(mdbookDir)

  const format = (data.source?.format || detectFormat(projectRoot) || 'gitbook').toLowerCase()
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
      format,
      ...sourceDefaults,
      ...(data.source || {})
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
    comments: data.comments || null, // e.g. { provider: giscus, repo, repoId, category, categoryId }
    footer: data.footer || null, // site footer: { message, copyright } (inline HTML allowed)
    locales: data.locales || null, // resolved from content when null
    build: {
      out: path.resolve(projectRoot, overrides.out || data.build?.out || '.mdbook/dist'),
      staging: path.resolve(projectRoot, data.build?.staging || '.mdbook/.cache/site'),
      cleanUrls: data.build?.cleanUrls ?? true
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
  return cfg
}

function detectFormat(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, '__source', 'pages.json'))) return 'termx'
  if (fs.existsSync(path.join(projectRoot, 'input', 'pages.json'))) return 'termx'
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
