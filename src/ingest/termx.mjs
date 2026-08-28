// TermX Wiki export ingestion adapter.
// Reads space.json + pages.json (the `wiki-ssg` export contract) and the page
// markdown, producing the unified multilingual site model.
//
//   space.json : { web, code, names: { <lang>: <string> },
//                  description?: { <lang>: <string> }, defaultLang?, langs?: [...], siteUrl? }
//   pages.json : [ { code, tags?: [...], contents: [ { name, slug, lang, description? } ], children: [...] } ]
// The description/defaultLang/langs/siteUrl, per-page description and page-level tags
// are additive: when absent, mdbook falls back to inference (first-paragraph summary,
// languages inferred from content, CI-detected URL) exactly as before. Page tags are
// surfaced as <meta name="keywords">.
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

function ingestSpaceModel(cfg) {
  const spacePath = findMeta(cfg, 'space.json')
  const pagesPath = findMeta(cfg, 'pages.json')
  const space = spacePath ? readJson(spacePath) : { names: {} }
  const tree = pagesPath ? readJson(pagesPath) : []

  const spaceNames = space.names || {}
  // Languages: prefer the space's explicit list (space.langs), else the union of
  // space names and langs used across page contents. Inferred langs are always
  // kept too, so an incomplete explicit list can never drop translated content.
  const langSet = new Set(Object.keys(spaceNames))
  ;(function collect(nodes) {
    for (const n of nodes || []) {
      for (const c of n.contents || []) if (c.lang) langSet.add(c.lang)
      collect(n.children)
    }
  })(tree)
  const exportedLangs = Array.isArray(space.langs) ? space.langs.filter(Boolean) : []
  const configuredDefault = cfg.site.lang
  const langs = exportedLangs.length ? [...new Set([...exportedLangs, ...langSet])] : [...langSet]
  if (langs.length === 0) langs.push(configuredDefault || 'en')
  // Default lang: the space's own default wins when valid, else the configured
  // one, else the first language.
  const exportedDefault = space.defaultLang
  // A portal build forces one default across every space; a space that lacks
  // that language simply has no unprefixed content (strict-translation rule).
  const defaultLang =
    cfg.source._forceDefaultLang ||
    [exportedDefault, configuredDefault].find((l) => l && langs.includes(l)) || langs[0]
  // Space-level description (localized) for the default language, if authored.
  const spaceDescription = (space.description && space.description[defaultLang]) || ''

  const contentFiles = []
  const seen = new Set()
  const linkFor = (slug, lang) => (lang === defaultLang ? `/${slug}` : `/${lang}/${slug}`)
  const destFor = (slug, lang) => (lang === defaultLang ? `${slug}.md` : `${lang}/${slug}.md`)

  // Build a per-language sidebar. STRICT: a page is included only if it is
  // actually translated in that language. Ancestors without a translation but
  // with translated descendants become link-less group headers so the tree
  // stays navigable. Returns the number of real (linked) pages found.
  const pageCount = {}
  function buildSidebar(nodes, lang, inheritedAccess = null) {
    const items = []
    for (const node of nodes || []) {
      // Optional per-node access (wiki-ssg contract extension): children
      // inherit unless they carry their own. Flattened into acl.json at stage.
      const access = node.access ?? inheritedAccess
      const content = (node.contents || []).find((c) => c.lang === lang)
      const children = buildSidebar(node.children, lang, access)
      if (content) {
        const src = findPageFile(cfg, content.slug)
        const dest = destFor(content.slug, lang)
        if (src && !seen.has(dest)) {
          seen.add(dest)
          contentFiles.push({
            src, dest, lang, title: content.name?.trim() || content.slug, code: node.code,
            description: content.description || null,
            tags: node.tags?.length ? node.tags : null, // page-level; -> <meta keywords>
            access: access || null // page/inherited access -> acl.json
          })
          pageCount[lang] = (pageCount[lang] || 0) + 1
        }
        const entry = { text: content.name?.trim() || content.slug, link: linkFor(content.slug, lang) }
        if (children.length) {
          entry.items = children
          entry.collapsed = true // collapsible + collapsed, like the TermX SSG menu
        }
        items.push(entry)
      } else if (children.length) {
        // Untranslated ancestor: keep as a collapsible group header (no link).
        const fallback = (node.contents || [])[0]
        items.push({ text: fallback?.name?.trim() || 'Section', collapsed: true, items: children })
      }
    }
    return items
  }

  // First DFS page node that has a translation in `lang` (locale home source).
  function firstPageNode(nodes, lang) {
    for (const node of nodes || []) {
      if ((node.contents || []).some((x) => x.lang === lang)) return node
      const deep = firstPageNode(node.children, lang)
      if (deep) return deep
    }
    return null
  }

  const sidebars = {}
  const navs = {}
  const home = {}
  for (const lang of langs) {
    sidebars[lang] = buildSidebar(tree, lang)
    navs[lang] = []
    // Each locale needs a landing page at its root.
    const node = firstPageNode(tree, lang)
    const first = node && (node.contents || []).find((x) => x.lang === lang)
    if (first) {
      const src = findPageFile(cfg, first.slug)
      if (src) {
        const dest = lang === defaultLang ? 'index.md' : `${lang}/index.md`
        contentFiles.push({
          src, dest, lang, title: first.name?.trim() || first.slug, code: node.code,
          description: first.description || null,
          tags: node.tags?.length ? node.tags : null // page-level; -> <meta keywords>
        })
        home[lang] = dest
      }
    }
  }

  // Locale-switch redirect stubs. VitePress's language switcher swaps only the
  // locale prefix (keeping the current slug); when a page's slug differs per
  // language (e.g. `/build` vs `/lt/versijos`) the swapped path (`/lt/build`)
  // 404s. Emit a stub at that path that redirects to the real translation,
  // using the per-code slug mapping from pages.json.
  ;(function collectStubs(nodes) {
    for (const node of nodes || []) {
      const contents = (node.contents || []).filter((c) => c.lang && langs.includes(c.lang))
      for (const from of contents) {
        for (const to of contents) {
          if (to.lang === from.lang || to.slug === from.slug) continue
          const dest = destFor(from.slug, to.lang) // swapped path: to's prefix + from's slug
          if (seen.has(dest)) continue
          seen.add(dest)
          contentFiles.push({ dest, lang: to.lang, redirect: linkFor(to.slug, to.lang) })
        }
      }
      collectStubs(node.children)
    }
  })(tree)

  // Keep only languages that actually have pages (default language always kept).
  const activeLangs = langs.filter((l) => l === defaultLang || pageCount[l] > 0)

  return {
    title: spaceNames[defaultLang] || cfg.site.title || path.basename(cfg.projectRoot),
    web: space.web || cfg.site.web || null,
    spaceCode: space.code || null,
    description: spaceDescription,
    siteUrl: space.siteUrl || null,
    ssg: space.ssg || null, // generator config (theme/footer/txServer/search/logo) from the wiki
    langs: activeLangs,
    defaultLang,
    home: home[defaultLang] || null,
    sidebars,
    navs,
    spaceNames,
    contentFiles: contentFiles.filter((f) => activeLangs.includes(f.lang)),
    assets: [] // TermX attachments (files/<id>/…) are rewritten by the markdown plugin
  }
}

// ---------------------------------------------------------------- portal ----
//
// Multi-space portal (OWLEXICON.01 §4.5): one site, many wiki-ssg exports.
//   source:
//     format: termx
//     spaces:
//       handbook: docs/handbook    # dir with space.json / pages.json / pages/…
//       api: docs/api
// Each space mounts under /<key>/ (its own sidebar; every locale under
// /<lang>/<key>/), the nav gets one entry per space, and a portal home page
// linking the spaces is generated per locale. Attachments are namespaced per
// mount so page ids from different TermX instances cannot collide.

const MOUNT_RE = /^[A-Za-z0-9][\w-]*$/

// Prefix an internal link with the mount, keeping any locale prefix in front:
// /slug -> /<mount>/slug, /<lang>/slug -> /<lang>/<mount>/slug.
function mountLink(link, mount, lang, portalDefault) {
  if (typeof link !== 'string' || !link.startsWith('/')) return link
  if (lang === portalDefault) return `/${mount}${link}`.replace(/\/$/, '') || `/${mount}/`
  const re = new RegExp(`^/${lang}(/|$)`)
  return re.test(link) ? link.replace(re, `/${lang}/${mount}$1`) : `/${mount}${link}`
}

function mountItems(items, mount, lang, portalDefault) {
  return (items || []).map((item) => {
    const out = { ...item }
    if (out.link) out.link = mountLink(out.link, mount, lang, portalDefault)
    if (Array.isArray(out.items)) out.items = mountItems(out.items, mount, lang, portalDefault)
    return out
  })
}

function ingestPortal(cfg) {
  const portalDefault = cfg.site.lang || 'en'
  const spaces = []
  for (const [mount, dir] of Object.entries(cfg.source.spaces)) {
    if (!MOUNT_RE.test(mount)) throw new Error(`source.spaces: invalid mount name "${mount}"`)
    const shim = {
      ...cfg,
      source: {
        ...cfg.source,
        spaces: null,
        meta: dir,
        pages: `${dir}/pages`,
        _forceDefaultLang: portalDefault
      }
    }
    const model = ingestSpaceModel(shim)
    spaces.push({ mount, dir, model })
  }

  // Locales: the union, portal default first.
  const langs = [portalDefault, ...new Set(spaces.flatMap((s) => s.model.langs))].filter(
    (l, i, a) => a.indexOf(l) === i
  )

  const contentFiles = []
  const sidebars = {}
  const navs = {}
  const spaceNames = {}
  const folderLabels = {}
  const spaceMounts = {}
  const spaceSlugs = {}
  const authRules = []

  for (const { mount, model } of spaces) {
    const titleFor = (lang) => model.spaceNames?.[lang] || model.title
    if (model.spaceCode) spaceMounts[model.spaceCode] = mount
    spaceSlugs[mount] = [
      ...new Set(
        model.contentFiles
          .filter((f) => f.dest?.endsWith('.md') && !f.redirect)
          .map((f) => f.dest.replace(/\.md$/, '').split('/').pop())
          .filter((s) => s !== 'index')
      )
    ]
    for (const f of model.contentFiles) {
      const dest =
        f.lang === portalDefault
          ? `${mount}/${f.dest}`
          : f.dest.replace(new RegExp(`^${f.lang}/`), `${f.lang}/${mount}/`)
      const out = { ...f, dest, mount }
      if (f.redirect) out.redirect = mountLink(f.redirect, mount, f.lang, portalDefault)
      contentFiles.push(out)
    }
    for (const lang of model.langs) {
      const key = lang === portalDefault ? `/${mount}/` : `/${lang}/${mount}/`
      ;(sidebars[lang] ||= {})[key] = mountItems(model.sidebars[lang], mount, lang, portalDefault)
      ;(navs[lang] ||= []).push({ text: titleFor(lang), link: key })
      folderLabels[lang === portalDefault ? mount : `${lang}/${mount}`] = titleFor(lang)
    }
    for (const [lang, name] of Object.entries(model.spaceNames || {})) {
      spaceNames[lang] ||= name // locale labels: first space naming the locale wins
    }
    // Space-exported access defaults (ssg.auth) become portal rules scoped to
    // the mount; the portal repo's own auth config still wins on specificity.
    const sa = model.ssg?.auth
    if (sa) {
      if (sa.access != null) authRules.push({ path: `${mount}/**`, access: sa.access })
      for (const r of sa.rules || []) {
        if (r?.path && r?.access != null) authRules.push({ path: `${mount}/${r.path}`, access: r.access })
      }
    }
  }

  // Portal home per locale: the space directory. Plain generated markdown —
  // it goes through the normal staging pipeline (SEO, search, hardening).
  const portalTitle = cfg.site.title || 'Documentation'
  for (const lang of langs) {
    const withContent = spaces.filter((s) => s.model.langs.includes(lang))
    if (lang !== portalDefault && !withContent.length) continue
    const lines = [`# ${portalTitle}`, '']
    for (const { mount, model } of withContent) {
      const key = lang === portalDefault ? `/${mount}/` : `/${lang}/${mount}/`
      const name = model.spaceNames?.[lang] || model.title
      lines.push(`- [**${name}**](${key})${model.description ? ` — ${model.description}` : ''}`)
    }
    lines.push('', '{.links-list}', '')
    contentFiles.push({
      dest: lang === portalDefault ? 'index.md' : `${lang}/index.md`,
      lang,
      title: portalTitle,
      content: lines.join('\n')
    })
  }

  return {
    portal: true,
    title: portalTitle,
    web: cfg.site.web || spaces.map((s) => s.model.web).find(Boolean) || null,
    spaceCode: null,
    description: cfg.site.description || '',
    siteUrl: null,
    ssg: null, // portal theming is owned by the repo config, not by any one space
    langs,
    defaultLang: portalDefault,
    home: 'index.md',
    sidebars,
    navs,
    spaceNames,
    folderLabels,
    spaceMounts,
    spaceSlugs,
    authRules,
    contentFiles,
    attachmentDirs: spaces
      .map(({ mount, dir }) => ({ mount, srcDir: path.join(cfg.projectRoot, dir, 'attachments') }))
      .filter((a) => fs.existsSync(a.srcDir)),
    resourceDirs: spaces.map(({ dir }) =>
      path.join(cfg.projectRoot, dir, 'resources', 'structure-definition')
    ),
    assets: []
  }
}

export function ingestTermx(cfg) {
  const spaces = cfg.source.spaces
  if (spaces && Object.keys(spaces).length) return ingestPortal(cfg)
  return ingestSpaceModel(cfg)
}
