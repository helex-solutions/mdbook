// GitBook ingestion adapter.
// Reads SUMMARY.md (navigation), README.md (home) and .gitbook/assets,
// producing the unified site model consumed by the builder.
import fs from 'node:fs'
import path from 'node:path'
import { walkMarkdown } from './util.mjs'

const ITEM_RE = /^(\s*)[*-]\s+\[([^\]]*)\]\(([^)]+)\)/
const GROUP_RE = /^##\s+(.+?)\s*$/
const TITLE_RE = /^#\s+(.+?)\s*$/

// repo-relative target -> clean VitePress URL: general/experience.md -> /general/experience
function toLink(target) {
  let t = target.trim().replace(/\\/g, '/').replace(/#.*$/, '')
  if (!t || /^\.?\/?README\.md$/i.test(t)) return '/'
  t = t.replace(/^\.\//, '').replace(/\/README\.md$/i, '/').replace(/\.md$/i, '')
  return t.startsWith('/') ? t : '/' + t
}

export function ingestGitbook(cfg) {
  const root = path.resolve(cfg.projectRoot, cfg.source.root || '.')
  const lang = cfg.site.lang || 'en'
  const summaryPath = path.join(root, cfg.source.summary || 'SUMMARY.md')

  const sidebar = fs.existsSync(summaryPath)
    ? parseSummary(fs.readFileSync(summaryPath, 'utf8'))
    : []

  const homeRel = cfg.source.home || 'README.md'
  let title = cfg.site.title
  const homeAbs = path.join(root, homeRel)
  if (!title && fs.existsSync(homeAbs)) {
    const m = fs.readFileSync(homeAbs, 'utf8').match(/^#\s+(.+)$/m)
    if (m) title = m[1].trim()
  }

  // Content: every .md under root except SUMMARY.md; README.md -> index.md (home).
  const summaryName = cfg.source.summary || 'SUMMARY.md'
  const contentFiles = walkMarkdown(root, { exclude: [summaryName, '.mdbook', 'node_modules'] })
    .map((abs) => {
      const rel = path.relative(root, abs)
      const dest = /^README\.md$/i.test(rel) ? 'index.md' : rel
      return { src: abs, dest, lang }
    })

  // Assets: copy the whole .gitbook/assets tree verbatim (referenced by relative paths).
  const assets = []
  const assetsAbs = path.join(root, cfg.source.assets || '.gitbook/assets')
  if (fs.existsSync(assetsAbs)) {
    assets.push({ srcDir: assetsAbs, destDir: cfg.source.assets || '.gitbook/assets' })
  }

  return {
    title: title || path.basename(cfg.projectRoot),
    web: cfg.site.web || null,
    langs: [lang],
    defaultLang: lang,
    home: 'index.md',
    sidebars: { [lang]: sidebar },
    navs: { [lang]: [] },
    spaceNames: { [lang]: title || path.basename(cfg.projectRoot) },
    contentFiles,
    assets
  }
}

// Parse SUMMARY.md into a VitePress sidebar array (groups from `##`, nesting from indent).
function parseSummary(text) {
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
    const node = { text: m[2].trim(), link: toLink(m[3]) }

    while (stack.length && indent <= stack[stack.length - 1].indent) stack.pop()
    if (stack.length) (stack[stack.length - 1].node.items ||= []).push(node)
    else container().push(node)
    stack.push({ indent, node })
  }
  return root
}
