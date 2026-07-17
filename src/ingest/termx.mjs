// TermX Wiki export ingestion adapter.
// Reads space.json + pages.json (the `wiki-ssg` export contract) and the page
// markdown, producing the unified multilingual site model.
//
//   space.json : { web, code, names: { <lang>: <string> } }
//   pages.json : [ { code, contents: [ { name, slug, lang, ct } ], children: [...] } ]
import fs from 'node:fs'
import path from 'node:path'

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}

// Locate a metadata file (pages.json / space.json) across the known layouts.
function findMeta(cfg, name) {
  const candidates = [
    path.join(cfg.projectRoot, cfg.source.meta || '__source', name),
    path.join(cfg.projectRoot, 'input', name),
    path.join(cfg.projectRoot, '__source', name)
  ]
  return candidates.find((p) => fs.existsSync(p)) || null
}

// Locate the markdown file for a slug across the known page dirs.
function findPageFile(cfg, slug) {
  const dirs = [
    cfg.source.pages && path.join(cfg.projectRoot, cfg.source.pages),
    path.join(cfg.projectRoot, 'input'),
    path.join(cfg.projectRoot, 'input', 'pagecontent'),
    path.join(cfg.projectRoot, '__source', 'pages')
  ].filter(Boolean)
  for (const d of dirs) {
    for (const ext of ['md', 'html']) {
      const p = path.join(d, `${slug}.${ext}`)
      if (fs.existsSync(p)) return p
    }
  }
  return null
}

export function ingestTermx(cfg) {
  const spacePath = findMeta(cfg, 'space.json')
  const pagesPath = findMeta(cfg, 'pages.json')
  const space = spacePath ? readJson(spacePath) : { names: {} }
  const tree = pagesPath ? readJson(pagesPath) : []

  const spaceNames = space.names || {}
  // Languages: union of space names and langs used across page contents.
  const langSet = new Set(Object.keys(spaceNames))
  ;(function collect(nodes) {
    for (const n of nodes || []) {
      for (const c of n.contents || []) if (c.lang) langSet.add(c.lang)
      collect(n.children)
    }
  })(tree)
  const configuredDefault = cfg.site.lang
  const langs = [...langSet]
  if (langs.length === 0) langs.push(configuredDefault || 'en')
  // Default lang: configured one if available, else first.
  const defaultLang = langs.includes(configuredDefault) ? configuredDefault : langs[0]

  const contentFiles = []
  const seen = new Set()
  const linkFor = (slug, lang) => (lang === defaultLang ? `/${slug}` : `/${lang}/${slug}`)
  const destFor = (slug, lang) => (lang === defaultLang ? `${slug}.md` : `${lang}/${slug}.md`)

  // Build a per-language sidebar from the page tree; also queue content files.
  function buildSidebar(nodes, lang) {
    const items = []
    for (const node of nodes || []) {
      const content =
        (node.contents || []).find((c) => c.lang === lang) || (node.contents || [])[0]
      if (!content) continue
      const src = findPageFile(cfg, content.slug)
      const dest = destFor(content.slug, lang)
      if (src && !seen.has(dest)) {
        seen.add(dest)
        contentFiles.push({ src, dest, lang })
      }
      const entry = { text: content.name?.trim() || content.slug, link: linkFor(content.slug, lang) }
      const children = buildSidebar(node.children, lang)
      if (children.length) entry.items = children
      items.push(entry)
    }
    return items
  }

  const sidebars = {}
  const navs = {}
  for (const lang of langs) {
    sidebars[lang] = buildSidebar(tree, lang)
    navs[lang] = []
  }

  // Home = first root page of the default language.
  let home = null
  const firstRoot = tree[0]
  if (firstRoot) {
    const c =
      (firstRoot.contents || []).find((x) => x.lang === defaultLang) || (firstRoot.contents || [])[0]
    if (c) {
      const src = findPageFile(cfg, c.slug)
      if (src) {
        home = 'index.md'
        contentFiles.push({ src, dest: 'index.md', lang: defaultLang })
      }
    }
  }

  return {
    title: spaceNames[defaultLang] || cfg.site.title || path.basename(cfg.projectRoot),
    web: space.web || cfg.site.web || null,
    langs,
    defaultLang,
    home,
    sidebars,
    navs,
    spaceNames,
    contentFiles,
    assets: [] // TermX attachments (files/<id>/…) are rewritten by the markdown plugin
  }
}
