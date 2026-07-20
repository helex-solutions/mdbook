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
import { walkMarkdown, makeExcluder } from './util.mjs'
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

  // `source.exclude`: hide scaffolding (templates, agent notes, tooling) from
  // both the published pages and the generated menu.
  const isExcluded = makeExcluder(cfg.source.exclude || [])

  const sidebars = {}
  const navs = {}
  const spaceNames = {}
  const contentFiles = []
  const folderLabels = {} // staged dir path -> menu label (used for breadcrumbs)

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
    isExcluded,
    sidebars,
    navs,
    contentFiles,
    folderLabels
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
      isExcluded,
      sidebars,
      navs,
      contentFiles,
      folderLabels
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
    folderLabels,
    assets
  }
}

// Ingest a single language tree (root for the default lang, or a `<lang>/` dir).
// Populates sidebars/navs/contentFiles for `lang`; returns the discovered title.
function ingestOne({
  root, dir, lang, prefix, destPrefix, summaryName, homeRel, excludeDirs, isExcluded,
  sidebars, navs, contentFiles, folderLabels
}) {
  const summaryPath = path.join(dir, summaryName)
  const hasSummary = fs.existsSync(summaryPath)
  // No SUMMARY.md: derive the nav from the folder tree. That path resolves icons
  // itself (it already knows each entry's file), so it isn't decorated again.
  // Folder labels are collected on the way for breadcrumbs, keyed like the
  // staged content paths (so a locale's folders land under `<lang>/…`).
  const labels = {}
  const sidebar = hasSummary
    ? parseSummary(fs.readFileSync(summaryPath, 'utf8'), prefix)
    : buildAutoSidebar(dir, prefix, excludeDirs, isExcluded, labels)
  if (hasSummary) decorateIcons(sidebar, root) // links carry the locale prefix; resolved against root
  if (folderLabels) for (const [rel, label] of Object.entries(labels)) folderLabels[destPrefix + rel] = label

  const homeAbs = path.join(dir, homeRel)
  let title = null
  if (fs.existsSync(homeAbs)) {
    const m = fs.readFileSync(homeAbs, 'utf8').match(/^#\s+(.+)$/m)
    if (m) title = m[1].trim()
  }

  // Content: every .md under `dir` except SUMMARY.md and the locale subdirs;
  // README.md -> index.md (home). Dest is prefixed for non-default locales.
  const files = walkMarkdown(dir, {
    exclude: [summaryName, '.mdbook', 'node_modules', ...excludeDirs],
    isExcluded
  })
  for (const abs of files) {
    const rel = path.relative(dir, abs)
    // A README is a folder's index at ANY depth (root README -> index.md,
    // docs/README.md -> docs/index.md), so `/docs/` resolves to a real page —
    // this is what toLink() and the link rewriter already assume.
    const dest = rel.replace(/(^|[\\/])README\.md$/i, (m, sep) => `${sep}index.md`)
    contentFiles.push({ src: abs, dest: destPrefix + dest, lang })
  }

  sidebars[lang] = sidebar
  navs[lang] = []
  return title
}

// Human-friendly label from a file/dir name: "user-stories" -> "User Stories".
function prettify(name) {
  return name
    .replace(/\.md$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// A scalar value out of a YAML frontmatter block (no full YAML parse — the
// block may be hand-written and imperfect, and only simple scalars matter here).
function fmValue(fm, key) {
  const m = fm.match(new RegExp(`^${key}:\\s*(.+?)\\s*$`, 'm'))
  return m ? m[1].replace(/^['"]|['"]$/g, '').trim() : null
}

// One read per file: the menu label and the page icon.
//
// The label is the frontmatter `sidebarTitle` if present, else the first H1.
// Without the override the H1 has to serve as page title, menu label AND search
// result at once, which forces either a long heading or a cryptic menu entry —
// `sidebarTitle` lets a page keep a descriptive H1 and a short menu label.
function readMeta(abs) {
  let text
  try {
    text = fs.readFileSync(abs, 'utf8')
  } catch {
    return { label: null, icon: '' }
  }
  const block = text.match(/^---\s*\n([\s\S]*?)\n---/)
  const fm = block ? block[1] : ''
  const h1 = text.match(/^#\s+(.+?)\s*$/m)
  return {
    label: (fm && fmValue(fm, 'sidebarTitle')) || (h1 ? h1[1].trim() : null),
    icon: iconMarkup(fm ? fmValue(fm, 'icon') : null)
  }
}

// Natural, case-insensitive compare so "ACC.2" < "ACC.10" and "01-" < "10-".
const naturalCmp = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

const AUTO_SIDEBAR_SKIP = new Set(['node_modules', 'public', '.mdbook', '.gitbook'])

// Prefix for the "back to the top-level menu" entry at the top of each section.
const BACK_ICON = iconMarkup('arrow-left')

// Split a directory into its markdown files (as sidebar links labeled by H1,
// carrying any `icon:` frontmatter) and its subdirectory names. READMEs are the
// folder's index, so they are never listed as their own entry.
function scanDir(d, base, skip, isExcluded, relDir) {
  let entries
  try {
    entries = fs.readdirSync(d, { withFileTypes: true })
  } catch {
    return { files: [], dirs: [] }
  }
  const files = []
  const dirs = []
  for (const e of entries) {
    if (e.name.startsWith('.') || skip.has(e.name)) continue
    const rel = relDir ? `${relDir}/${e.name}` : e.name
    if (isExcluded?.(rel, e.name, e.isDirectory())) continue
    if (e.isDirectory()) dirs.push(e.name)
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md') && !/^readme\.md$/i.test(e.name)) {
      const abs = path.join(d, e.name)
      const meta = readMeta(abs)
      files.push({
        text: meta.label || prettify(e.name),
        link: `${base}/${e.name.replace(/\.md$/i, '')}`,
        icon: meta.icon
      })
    }
  }
  return { files, dirs }
}

const readmeIn = (d) =>
  ['README.md', 'readme.md'].map((r) => path.join(d, r)).find((p) => fs.existsSync(p))

// Folders sort before files, each alphabetically (natural order) by their visible
// label. Icons are applied only after sorting so the markup can't affect order.
function orderAndIcon(folders, files) {
  const byText = (a, b) => naturalCmp(a.text, b.text)
  folders.sort(byText)
  files.sort(byText)
  return [...folders, ...files].map(({ icon, ...rest }) =>
    icon ? { ...rest, text: icon + rest.text } : rest
  )
}

// A folder's label and icon come from its README (`sidebarTitle` > H1, and its
// own `icon:` if set); otherwise the folder name and a generic folder icon.
function folderMeta(readme, name) {
  const meta = readme ? readMeta(readme) : { label: null, icon: '' }
  return { label: meta.label || prettify(name), icon: meta.icon || iconMarkup('folder') }
}

// Recursively build a nested item list for a directory: subfolders (collapsed
// groups, their README as the group's link) first, then the folder's own pages.
function subtree(d, base, skip, isExcluded, relDir, labels) {
  const { files, dirs } = scanDir(d, base, skip, isExcluded, relDir)
  const folders = []
  for (const name of dirs) {
    const childDir = path.join(d, name)
    const childBase = `${base}/${name}`
    const childRel = relDir ? `${relDir}/${name}` : name
    const childItems = subtree(childDir, childBase, skip, isExcluded, childRel, labels)
    const readme = readmeIn(childDir)
    if (!childItems.length && !readme) continue
    const fm = folderMeta(readme, name)
    if (labels) labels[childRel] = fm.label
    const group = { text: fm.label, collapsed: true, items: childItems, icon: fm.icon }
    if (readme) group.link = `${childBase}/`
    folders.push(group)
  }
  return orderAndIcon(folders, files)
}

// Build a VitePress multi-sidebar from the directory tree, used when a language
// has no SUMMARY.md. Each top-level folder gets its OWN sidebar (keyed by its URL
// path) so a page only carries its section's nav, not the entire tree — essential
// for large repos. A `<prefix>/` fallback sidebar lists the root-level pages and a
// link into each section. Folder labels come from a README H1 (else the folder
// name); files from their own H1. `prefix` is '' for the default locale, '/<lang>'
// otherwise.
function buildAutoSidebar(dir, prefix, excludeDirs = [], isExcluded, labels) {
  const skip = new Set([...excludeDirs, ...AUTO_SIDEBAR_SKIP])
  const { files: rootFiles, dirs: rootDirs } = scanDir(dir, prefix, skip, isExcluded, '')
  const sidebars = {}
  const sectionLinks = []
  for (const name of rootDirs) {
    const childDir = path.join(dir, name)
    const childBase = `${prefix}/${name}`
    const items = subtree(childDir, childBase, skip, isExcluded, name, labels)
    const readme = readmeIn(childDir)
    if (!items.length && !readme) continue
    const { label, icon } = folderMeta(readme, name)
    if (labels) labels[name] = label
    const key = `${childBase}/`
    // The section's own sidebar. The section header is deliberately NOT
    // collapsible: collapsing the only group would leave an empty sidebar.
    const group = { text: icon + label, items }
    if (readme) group.link = key
    // A way back to the top-level menu — inside a section the sidebar shows only
    // that section, so without this the only route back is the browser's Back.
    sidebars[key] = [{ text: `${BACK_ICON}All sections`, link: `${prefix}/` }, group]
    // The root sidebar just links into each section.
    sectionLinks.push({ text: label, link: readme ? key : items[0]?.link || key, icon })
  }
  sidebars[`${prefix}/`] = orderAndIcon(sectionLinks, rootFiles)
  return sidebars
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

// Walk the sidebar tree and prepend each linked page's icon to its label. Accepts
// either a sidebar array (SUMMARY.md) or a multi-sidebar object (auto-generated).
function decorateIcons(items, root) {
  if (!items) return
  const lists = Array.isArray(items) ? [items] : Object.values(items)
  for (const list of lists) {
    for (const item of list) {
      if (item.link) {
        const icon = iconMarkup(readIcon(linkToFile(root, item.link)))
        if (icon) item.text = icon + item.text
      }
      if (item.items) decorateIcons(item.items, root)
    }
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
