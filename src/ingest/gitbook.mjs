// GitBook ingestion adapter.
// Reads SUMMARY.md (navigation), README.md (home) and .gitbook/assets,
// producing the unified site model consumed by the builder.
//
// Multilingual: the default language lives at the repo root; each additional
// locale lives in a `<lang>/` subdirectory with its own SUMMARY.md + README.md
// (e.g. `lt/SUMMARY.md`, `lt/README.md`, `lt/*.md`). Detected automatically —
// with no locale subdirs this behaves exactly like a single-language space.
import fs from 'node:fs'
import path from 'node:path'
import { walkMarkdown } from './util.mjs'
import { iconMarkup } from '../icons.mjs'

const ITEM_RE = /^(\s*)[*-]\s+\[([^\]]*)\]\(([^)]+)\)/
const GROUP_RE = /^##\s+(.+?)\s*$/
const TITLE_RE = /^#\s+(.+?)\s*$/

// Display names for the locale switcher; falls back to the upper-cased code.
const LANG_LABELS = {
  en: 'English', lt: 'Lietuvių', de: 'Deutsch', fr: 'Français', es: 'Español',
  it: 'Italiano', pl: 'Polski', lv: 'Latviešu', et: 'Eesti', ru: 'Русский'
}

// repo-relative target -> clean VitePress URL, under an optional locale prefix.
// general/experience.md -> /general/experience ; with prefix "/lt": /lt/general/experience
function toLink(target, prefix = '') {
  let t = target.trim().replace(/\\/g, '/').replace(/#.*$/, '')
  if (!t || /^\.?\/?README\.md$/i.test(t)) return prefix ? `${prefix}/` : '/'
  t = t.replace(/^\.\//, '').replace(/\/README\.md$/i, '/').replace(/\.md$/i, '')
  const clean = t.startsWith('/') ? t : '/' + t
  return prefix + clean
}

export function ingestGitbook(cfg) {
  const root = path.resolve(cfg.projectRoot, cfg.source.root || '.')
  const defaultLang = cfg.site.lang || 'en'
  const summaryName = cfg.source.summary || 'SUMMARY.md'

  // Locale subdirs: any immediate directory that has its own SUMMARY.md.
  const localeDirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (e) =>
        e.isDirectory() &&
        !e.name.startsWith('.') &&
        e.name !== 'node_modules' &&
        e.name !== 'public' &&
        fs.existsSync(path.join(root, e.name, summaryName))
    )
    .map((e) => e.name)

  const langs = [defaultLang, ...localeDirs.filter((l) => l !== defaultLang)]

  const sidebars = {}
  const navs = {}
  const spaceNames = {}
  const contentFiles = []

  // Default language (repo root), excluding the locale subdirs from its content.
  const rootTitle = ingestOne({
    root,
    dir: root,
    lang: defaultLang,
    prefix: '',
    destPrefix: '',
    summaryName,
    homeRel: cfg.source.home || 'README.md',
    excludeDirs: localeDirs,
    sidebars,
    navs,
    contentFiles
  })

  // Additional locales (each in its own subdir, served under /<lang>/).
  for (const lang of localeDirs) {
    if (lang === defaultLang) continue
    ingestOne({
      root,
      dir: path.join(root, lang),
      lang,
      prefix: `/${lang}`,
      destPrefix: `${lang}/`,
      summaryName,
      homeRel: 'README.md',
      excludeDirs: [],
      sidebars,
      navs,
      contentFiles
    })
  }

  for (const lang of langs) spaceNames[lang] = LANG_LABELS[lang] || lang.toUpperCase()

  const title = cfg.site.title || rootTitle || path.basename(cfg.projectRoot)

  // Assets: copy the whole .gitbook/assets tree verbatim (shared across locales).
  const assets = []
  const assetsAbs = path.join(root, cfg.source.assets || '.gitbook/assets')
  if (fs.existsSync(assetsAbs)) {
    assets.push({ srcDir: assetsAbs, destDir: cfg.source.assets || '.gitbook/assets' })
  }

  return {
    title,
    web: cfg.site.web || null,
    langs,
    defaultLang,
    home: 'index.md',
    sidebars,
    navs,
    spaceNames,
    contentFiles,
    assets
  }
}

// Ingest a single language tree (root for the default lang, or a `<lang>/` dir).
// Populates sidebars/navs/contentFiles for `lang`; returns the discovered title.
function ingestOne({
  root, dir, lang, prefix, destPrefix, summaryName, homeRel, excludeDirs, sidebars, navs, contentFiles
}) {
  const summaryPath = path.join(dir, summaryName)
  const sidebar = fs.existsSync(summaryPath)
    ? parseSummary(fs.readFileSync(summaryPath, 'utf8'), prefix)
    : []
  decorateIcons(sidebar, root) // links carry the locale prefix; resolved against root

  const homeAbs = path.join(dir, homeRel)
  let title = null
  if (fs.existsSync(homeAbs)) {
    const m = fs.readFileSync(homeAbs, 'utf8').match(/^#\s+(.+)$/m)
    if (m) title = m[1].trim()
  }

  // Content: every .md under `dir` except SUMMARY.md and the locale subdirs;
  // README.md -> index.md (home). Dest is prefixed for non-default locales.
  const files = walkMarkdown(dir, { exclude: [summaryName, '.mdbook', 'node_modules', ...excludeDirs] })
  for (const abs of files) {
    const rel = path.relative(dir, abs)
    const dest = /^README\.md$/i.test(rel) ? 'index.md' : rel
    contentFiles.push({ src: abs, dest: destPrefix + dest, lang })
  }

  sidebars[lang] = sidebar
  navs[lang] = []
  return title
}

// Resolve a clean sidebar link back to its source markdown file. Links carry the
// locale prefix (e.g. /lt/build), which maps directly under the repo root.
function linkToFile(root, link) {
  if (link === '/') return path.join(root, 'README.md')
  const rel = link.replace(/^\//, '')
  for (const cand of [`${rel}.md`, path.join(rel, 'README.md')]) {
    const abs = path.join(root, cand)
    if (fs.existsSync(abs)) return abs
  }
  return null
}

// Read the `icon:` value from a markdown file's YAML frontmatter.
function readIcon(file) {
  if (!file || !fs.existsSync(file)) return null
  const text = fs.readFileSync(file, 'utf8')
  const fm = text.match(/^---\s*\n([\s\S]*?)\n---/)
  if (!fm) return null
  const m = fm[1].match(/^icon:\s*(.+?)\s*$/m)
  return m ? m[1].replace(/['"]/g, '') : null
}

// Walk the sidebar tree and prepend each linked page's icon to its label.
function decorateIcons(items, root) {
  for (const item of items) {
    if (item.link) {
      const icon = iconMarkup(readIcon(linkToFile(root, item.link)))
      if (icon) item.text = icon + item.text
    }
    if (item.items) decorateIcons(item.items, root)
  }
}

// Parse SUMMARY.md into a VitePress sidebar array (groups from `##`, nesting from
// indent). Links are emitted under `prefix` (empty for the default locale).
function parseSummary(text, prefix = '') {
  const root = []
  let currentGroup = null
  let stack = []
  const container = () => (currentGroup ? currentGroup.items : root)

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const g = line.match(GROUP_RE)
    if (g) {
      currentGroup = { text: g[1], collapsed: false, items: [] }
      root.push(currentGroup)
      stack = []
      continue
    }
    if (TITLE_RE.test(line) && !ITEM_RE.test(line)) continue

    const m = line.match(ITEM_RE)
    if (!m) continue
    const indent = m[1].replace(/\t/g, '  ').length
    const node = { text: m[2].trim(), link: toLink(m[3], prefix) }

    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop()
    if (stack.length) (stack[stack.length - 1].node.items ||= []).push(node)
    else container().push(node)
    stack.push({ indent, node })
  }
  return root
}
