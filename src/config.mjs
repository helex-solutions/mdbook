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

  const cfg = {
    projectRoot,
    mdbookDir,
    configFile: file,
    site: {
      title: data.site?.title || null, // resolved later from space.json / dir name
      description: data.site?.description || '',
      lang: data.site?.lang || 'en',
      logo: data.site?.logo || null,
      ...data.site,
      // Resolved last so it wins over the spread. Auto-detected in CI.
      base: resolveBase({ explicit: overrides.base ?? data.site?.base, projectRoot })
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
    search: data.search ?? true,
    locales: data.locales || null, // resolved from content when null
    build: {
      out: path.resolve(projectRoot, overrides.out || data.build?.out || '.mdbook/dist'),
      staging: path.resolve(projectRoot, data.build?.staging || '.mdbook/.cache/site'),
      cleanUrls: data.build?.cleanUrls ?? true
    }
  }
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

// A GitHub Pages custom domain (a CNAME file) means the site is served at the
// domain root, so base is '/'.
function hasCname(projectRoot) {
  return ['CNAME', 'public/CNAME', '.gitbook/assets/CNAME'].some((p) =>
    fs.existsSync(path.join(projectRoot, p))
  )
}

// Resolve the site base path. Precedence:
//   1. explicit --base / site.base in config
//   2. MDBOOK_BASE env
//   3. GitHub Actions: /<repo>/ for a project page ('/' for a custom domain or
//      an <owner>.github.io user/org page)
//   4. '/'
function resolveBase({ explicit, projectRoot }) {
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
