// Orchestrates a build: ingest -> stage content -> generate VitePress project ->
// run VitePress (build or dev).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import { loadConfig } from './config.mjs'
import { ingestGitbook } from './ingest/gitbook.mjs'
import { ingestTermx } from './ingest/termx.mjs'
import { copyDir } from './ingest/util.mjs'
import { sanitizeTermxMarkdown } from './ingest/sanitize.mjs'
import { fixStagedImages } from './ingest/images.mjs'
import { transformGitbookCards } from './ingest/cards.mjs'

const MDBOOK_SRC = path.dirname(fileURLToPath(import.meta.url)) // .../mdbook/src

const ADAPTERS = { gitbook: ingestGitbook, termx: ingestTermx }

function log(msg) {
  console.log(pc.cyan('mdbook'), msg)
}

function ingest(cfg) {
  const adapter = ADAPTERS[cfg.source.format]
  if (!adapter) throw new Error(`Unknown source format: ${cfg.source.format}`)
  return adapter(cfg)
}

// Build the JSON bundle handed to createMdbookConfig at VitePress config time.
function makeBundle(cfg, model) {
  return {
    title: cfg.site.title || model.title,
    description: cfg.site.description,
    base: cfg.site.base,
    defaultLang: model.defaultLang,
    langs: model.langs,
    spaceNames: model.spaceNames,
    sidebars: model.sidebars,
    navs: model.navs,
    userNav: cfg.nav,
    userSidebar: cfg.sidebar,
    userSidebarExtra: cfg.sidebarExtra,
    search: cfg.search,
    web: model.web || null,
    logo: cfg.site.logo,
    outDir: cfg.build.out,
    cleanUrls: cfg.build.cleanUrls,
    assetBase: '/attachments'
  }
}

function stageContent(cfg, model) {
  const staging = cfg.build.staging
  fs.rmSync(staging, { recursive: true, force: true })
  fs.mkdirSync(staging, { recursive: true })

  // Make mdbook's dependencies (vue, vitepress, markdown-it plugins) resolvable
  // from the staging root, which otherwise has no node_modules on its path.
  const mdbookModules = path.resolve(MDBOOK_SRC, '..', 'node_modules')
  const link = path.join(staging, 'node_modules')
  try {
    fs.symlinkSync(mdbookModules, link, 'junction')
  } catch (e) {
    if (e.code !== 'EEXIST') throw e
  }

  // Copy content files, running markdown through the transform pipeline.
  const isTermx = cfg.source.format === 'termx'
  for (const f of model.contentFiles) {
    const dest = path.join(staging, f.dest)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    if (f.src.endsWith('.md')) {
      let text = fs.readFileSync(f.src, 'utf8')
      if (isTermx) text = sanitizeTermxMarkdown(text)
      text = transformGitbookCards(text) // GitBook card tables -> card grid
      fs.writeFileSync(dest, text)
    } else {
      fs.copyFileSync(f.src, dest)
    }
  }

  // Copy relative asset directories (e.g. .gitbook/assets) alongside the content
  // so VitePress resolves & bundles relative image refs next to each page. Also
  // mirror them under public/ so raw-HTML/root-relative refs resolve too.
  for (const a of model.assets || []) {
    copyDir(a.srcDir, path.join(staging, a.destDir))
    copyDir(a.srcDir, path.join(staging, 'public', a.destDir))
  }

  // TermX attachments -> public/attachments (served from site root).
  const attachments = path.join(cfg.projectRoot, cfg.source.meta || '__source', 'attachments')
  if (fs.existsSync(attachments)) {
    copyDir(attachments, path.join(staging, 'public', 'attachments'))
  }

  // Resolve/neutralize image references so a missing asset can't fail the build.
  fixStagedImages(staging)

  return staging
}

function writeVitepressProject(cfg, model, staging) {
  const vpDir = path.join(staging, '.vitepress')
  fs.mkdirSync(path.join(vpDir, 'theme'), { recursive: true })

  const bundle = makeBundle(cfg, model)
  const factory = path.join(MDBOOK_SRC, 'vitepress.mjs')
  const config =
    `import { createMdbookConfig } from ${JSON.stringify(factory)}\n` +
    `export default createMdbookConfig(${JSON.stringify(bundle, null, 2)})\n`
  fs.writeFileSync(path.join(vpDir, 'config.mjs'), config)

  // Theme entry: mdbook theme + the selected skin stylesheet.
  const skin = cfg.theme.skin || 'default'
  let skinFile = path.join(MDBOOK_SRC, 'theme', 'skins', `${skin}.css`)
  if (!fs.existsSync(skinFile)) {
    log(pc.yellow(`skin "${skin}" not found, using "default"`))
    skinFile = path.join(MDBOOK_SRC, 'theme', 'skins', 'default.css')
  }
  const themeEntry =
    `import theme from ${JSON.stringify(path.join(MDBOOK_SRC, 'theme', 'index.mjs'))}\n` +
    `import ${JSON.stringify(skinFile)}\n` +
    `export default theme\n`
  fs.writeFileSync(path.join(vpDir, 'theme', 'index.js'), themeEntry)
}

async function prepare(projectRoot, overrides = {}) {
  const cfg = loadConfig(projectRoot, overrides)
  log(`project ${pc.dim(cfg.projectRoot)}`)
  log(`format ${pc.bold(cfg.source.format)}  skin ${pc.bold(cfg.theme.skin)}`)
  const model = ingest(cfg)
  log(
    `ingested ${pc.bold(model.contentFiles.length)} pages, langs [${model.langs.join(', ')}]`
  )
  const staging = stageContent(cfg, model)
  writeVitepressProject(cfg, model, staging)
  return { cfg, model, staging }
}

export async function buildSite(projectRoot, overrides = {}) {
  const { cfg, staging } = await prepare(projectRoot, overrides)
  const { build } = await import('vitepress')
  log('building…')
  await build(staging)
  log(pc.green(`done -> ${cfg.build.out}`))
  return cfg.build.out
}

export async function devSite(projectRoot, overrides = {}) {
  const { staging } = await prepare(projectRoot, overrides)
  const { createServer } = await import('vitepress')
  const server = await createServer(staging, { port: overrides.port || 5173 })
  await server.listen()
  server.printUrls()
  return server
}

export { loadConfig }
