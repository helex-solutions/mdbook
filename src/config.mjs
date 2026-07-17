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
      base: normalizeBase(data.site?.base || '/'),
      logo: data.site?.logo || null,
      ...data.site
    },
    source: {
      format,
      ...sourceDefaults,
      ...(data.source || {})
    },
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
