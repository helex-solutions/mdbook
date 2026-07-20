// Orchestrates a build: ingest -> stage content -> generate VitePress project ->
// run VitePress (build or dev).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import pc from 'picocolors'
import { loadConfig, applySpaceConfig } from './config.mjs'
import { ingestGitbook } from './ingest/gitbook.mjs'
import { ingestTermx } from './ingest/termx.mjs'
import { copyDir, makeExcluder } from './ingest/util.mjs'
import { sanitizeTermxMarkdown, hardenMarkdown } from './ingest/sanitize.mjs'
import { buildDocIndex, relatedFor } from './ingest/related.mjs'
import { fixStagedImages } from './ingest/images.mjs'
import { transformGitbookCards } from './ingest/cards.mjs'
import { transformFileEmbeds } from './ingest/file-embed.mjs'
import { applySeoFrontmatter, deriveDescription } from './ingest/seo.mjs'
import { auditLinks } from './ingest/links.mjs'
import { expandStructureDefinitions } from './ingest/structure-definition.mjs'
import { expandConceptMatrices } from './ingest/concept-matrix.mjs'

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

// Warn (never fail) about internal links that won't resolve on the static site.
function reportDeadLinks(staging, model) {
  const dead = auditLinks(staging, model)
  if (!dead.length) return
  log(pc.yellow(`${dead.length} internal link(s) may not resolve on the static site:`))
  for (const d of dead.slice(0, 25)) {
    console.log(`  ${pc.dim(path.relative(staging, d.file))}  →  ${d.href}`)
  }
  if (dead.length > 25) console.log(`  … and ${dead.length - 25} more`)
}

// The TermX web UI origin, derived from the FHIR server (…/api/fhir or …/fhir).
function webFromTxServer(txServer) {
  return txServer ? txServer.replace(/\/(api\/)?fhir\/?$/i, '') : null
}

// Build the JSON bundle handed to createMdbookConfig at VitePress config time.
function makeBundle(cfg, model) {
  // cs:/vs:/concept: link base — explicit site.web wins, else the tx-server's
  // own web UI (so links follow the configured server), else the space's web.
  const web = cfg.site.web || webFromTxServer(cfg.txServer) || model.web || null
  // Slugs of pages that exist in this build (for resolving page: links locally).
  const pageSlugs = [
    ...new Set(
      model.contentFiles
        .filter((f) => f.dest.endsWith('.md'))
        .map((f) => path.basename(f.dest, '.md'))
        .filter((s) => s !== 'index')
    )
  ]
  return {
    title: cfg.site.title || model.title,
    description: cfg.site.description,
    base: cfg.site.base,
    siteUrl: cfg.site.url || null,
    image: cfg.site.image || cfg.site.logo || null, // social/OG image
    defaultLang: model.defaultLang,
    langs: model.langs,
    spaceNames: model.spaceNames,
    sidebars: model.sidebars,
    navs: model.navs,
    userNav: cfg.nav,
    userSidebar: cfg.sidebar,
    userSidebarExtra: cfg.sidebarExtra,
    userLocales: cfg.locales, // per-locale menu overrides: { <lang>: { label, nav, sidebar, sidebarExtra } }
    search: cfg.search,
    comments: cfg.comments || null,
    footer: cfg.footer || null,
    wide: cfg.theme.wide ?? false, // full-width layout (wide tables / reference docs)
    web,
    txServer: cfg.txServer,
    spaceCode: model.spaceCode || null,
    pageSlugs,
    logo: cfg.site.logo,
    mdbookDir: path.resolve(MDBOOK_SRC, '..'),
    outDir: cfg.build.out,
    cleanUrls: cfg.build.cleanUrls,
    assetBase: '/attachments',
    breaks: cfg.source.format === 'termx' // TermX Wiki uses breaks:true
  }
}

// Ancestor trail for a staged page: [{ text, link? }] from the site root down to
// (but not including) the page itself. A folder with no index page contributes a
// label without a link, so a crumb never points at a 404.
function breadcrumbsFor(dest, folderLabels, destSet, base = '/') {
  const dir = dest.split('/').slice(0, -1)
  if (!dir.length) return [] // root-level page: nothing to trace
  const prettify = (n) => n.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  const crumbs = [{ text: 'Home', link: base }]
  let acc = ''
  for (const seg of dir) {
    acc = acc ? `${acc}/${seg}` : seg
    const crumb = { text: folderLabels?.[acc] || prettify(seg) }
    if (destSet.has(`${acc}/index.md`)) crumb.link = `${base}${acc}/`.replace(/\/{2,}/g, '/')
    crumbs.push(crumb)
  }
  return crumbs
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
  const isSearchExcluded = makeExcluder(cfg.searchExclude || [])
  const docIndex = buildDocIndex(model.contentFiles)
  // Which staged folders actually have an index page — a breadcrumb for a folder
  // without one is shown as plain text rather than a link to a 404.
  const destSet = new Set(model.contentFiles.map((f) => f.dest))
  const sdDirs = [
    path.join(cfg.projectRoot, cfg.source.meta || '__source', 'resources', 'structure-definition'),
    path.join(cfg.projectRoot, 'input', 'resources', 'structure-definition')
  ]
  for (const f of model.contentFiles) {
    const dest = path.join(staging, f.dest)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    // Locale-switch redirect stub: a page that bounces to its real translation
    // (see the redirect handling in src/theme/index.mjs). Excluded from search.
    if (f.redirect) {
      fs.writeFileSync(
        dest,
        `---\nredirect: ${f.redirect}\nsearch: false\naside: false\n---\n\nRedirecting to [${f.redirect}](${f.redirect})…\n`
      )
      continue
    }
    if (f.src.endsWith('.md')) {
      let text = fs.readFileSync(f.src, 'utf8')
      if (isTermx) {
        text = sanitizeTermxMarkdown(text)
        text = expandStructureDefinitions(text, sdDirs) // {{def:…}} -> <tx-sd-view>
      }
      // Harden against VitePress's Vue compiler (stray `<Tag>` / `{{…}}` in prose).
      text = hardenMarkdown(text)
      text = transformGitbookCards(text) // GitBook card tables -> card grid
      text = transformFileEmbeds(text, cfg.site.base) // {% file %} -> PDF/download card
      // Per-page <title>/<meta description>/<meta keywords>: authored description
      // (else a first-paragraph summary), and page tags exported as keywords.
      // `termxPage` carries the stable TermX page code (for comment threading etc.).
      const extra = {}
      if (f.code) extra.termxPage = f.code
      if (f.tags?.length) extra.keywords = f.tags
      // Keep hand-picked pages out of the search index (they stay published).
      if (isSearchExcluded(f.dest)) extra.search = false
      // Where am I / what else covers this — resolved at build time so the theme
      // only has to render, and pages carry no extra client-side lookup cost.
      const crumbs = breadcrumbsFor(f.dest, model.folderLabels, destSet, cfg.site.base)
      if (crumbs.length) extra.breadcrumbs = crumbs
      const related = relatedFor(f, docIndex, text, model.folderLabels || {})
      if (related.length) extra.related = related
      text = applySeoFrontmatter(text, {
        title: f.title,
        description: f.description?.trim() || deriveDescription(text),
        extra: Object.keys(extra).length ? extra : null
      })
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

  // Carry a custom-domain CNAME into the published output.
  for (const c of ['CNAME', 'public/CNAME', '.gitbook/assets/CNAME']) {
    const src = path.join(cfg.projectRoot, c)
    if (fs.existsSync(src)) {
      fs.mkdirSync(path.join(staging, 'public'), { recursive: true })
      fs.copyFileSync(src, path.join(staging, 'public', 'CNAME'))
      break
    }
  }

  // robots.txt pointing crawlers at the sitemap (only when the site URL is known
  // and the project doesn't ship its own robots.txt).
  const robotsDest = path.join(staging, 'public', 'robots.txt')
  if (cfg.site.url && !fs.existsSync(robotsDest)) {
    fs.mkdirSync(path.dirname(robotsDest), { recursive: true })
    fs.writeFileSync(robotsDest, `User-agent: *\nAllow: /\n\nSitemap: ${cfg.site.url}sitemap.xml\n`)
  }

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
  log(`format ${pc.bold(cfg.source.format)}  skin ${pc.bold(cfg.theme.skin)}  base ${pc.bold(cfg.site.base)}`)
  const model = ingest(cfg)
  // Space-level metadata + generator config from the export fill config that wasn't set explicitly
  // (config.yml still wins; CI/CNAME URL detection still wins over the space's siteUrl).
  applySpaceConfig(cfg, model)
  log(
    `ingested ${pc.bold(model.contentFiles.length)} pages, langs [${model.langs.join(', ')}]`
  )
  const staging = stageContent(cfg, model)
  if (cfg.source.format === 'termx' && cfg.txServer) {
    log(`expanding {{csc}}/{{vsc}} from ${pc.dim(cfg.txServer)}`)
    await expandConceptMatrices(staging, cfg.txServer)
  }
  reportDeadLinks(staging, model)
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
  const serverOpts = { port: overrides.port || 5173 }
  if (overrides.host !== undefined) serverOpts.host = overrides.host // expose on the LAN
  const server = await createServer(staging, serverOpts)
  await server.listen()
  server.printUrls()
  return server
}

export { loadConfig }
