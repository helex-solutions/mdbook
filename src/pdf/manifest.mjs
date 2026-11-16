// The page order a book — or one section's subpages — export follows, written to
// `dist/pdf-manifest.json`.
//
// `mdbook serve` only has the built dist — the sidebar model lives in the build.
// So the order is resolved once, here, and read back at request time.
//
// It is the MENU order, deliberately: a document that matches the menu the
// reader already knows is navigable; one in filesystem order is not.

// A sidebar entry that exists only to climb back out of a section (the
// "All sections" link src/ingest/gitbook.mjs puts at the top of each one).
// It is navigation, not a page, and a book that included it would carry the
// parent's landing page over and over.
const isBackLink = (item, sectionKey) =>
  Boolean(item?.link) && Boolean(sectionKey) && item.link !== sectionKey && sectionKey.startsWith(item.link)

function walk(items, out, seen, sectionKey, parent = null) {
  for (const item of items || []) {
    let childParent = parent
    if (item?.link && !isBackLink(item, sectionKey)) {
      const route = String(item.link).replace(/\.html$/, '')
      // Dedupe by route: a section's landing page is reachable both from the
      // root sidebar's section link and from the section's own group.
      if (!seen.has(route)) {
        seen.add(route)
        out.push({ route, title: stripIcon(item.text), parent })
      }
      // Whether or not it was a duplicate, it is the parent of its own items —
      // in the folder-tree layout the landing page is ALWAYS the duplicate, so
      // reading this off the push would orphan every section's children.
      childParent = route
    }
    // A group with no link is not a page; its children keep the page above it.
    if (item?.items) walk(item.items, out, seen, sectionKey, childParent)
  }
}

// Menu labels may carry an icon prefix (an <img>/emoji the folder-tree menu
// adds). A PDF's table of contents wants the words.
function stripIcon(text) {
  return String(text ?? '')
    .replace(/<[^>]+>/g, '')
    .trim()
}

/**
 * Flatten one locale's sidebar model into page order.
 *
 * `sidebar` is EITHER an array (a SUMMARY.md project) OR an object keyed by
 * section path (the auto folder-tree layout). The two need different walks and
 * conflating them is the bug this function exists to avoid: on the object form,
 * naively concatenating the values emits every section's back-link as a page and
 * repeats each landing page.
 */
export function flattenSidebar(sidebar) {
  const out = []
  const seen = new Set()
  if (!sidebar) return out
  if (Array.isArray(sidebar)) {
    walk(sidebar, out, seen, null)
    return out
  }
  // Object form: the root sidebar first (it names the sections in order), then
  // each section's own sidebar, so the book reads the way the menu does.
  const keys = Object.keys(sidebar)
  const roots = keys.filter((k) => k.split('/').filter(Boolean).length === 0)
  const rest = keys.filter((k) => !roots.includes(k))
  for (const key of [...roots, ...rest]) {
    // A section's sidebar is a sidebar OF that section: its entries hang off the
    // section's landing page even though the markup does not nest them under it.
    // Without this a subpages export from a section landing page would find no
    // children at all in the folder-tree layout.
    // Matched through routeKey: the key may be spelled `/guide/` where the link
    // that created the page was `/guide`, and a string compare would silently
    // orphan the section.
    const landing = [...seen].find((r) => routeKey(r) === routeKey(key))
    const under = roots.includes(key) ? null : landing || null
    walk(sidebar[key], out, seen, key, under)
  }
  return out
}

/**
 * Canonical form of a route, for comparing one to another:
 * `/guide/`, `/guide`, `/guide/index.html` are all `/guide`, and the site root
 * is the empty string.
 */
export function routeKey(route) {
  let s = String(route ?? '/').split(/[?#]/)[0].replace(/\.html$/, '')
  if (!s.startsWith('/')) s = '/' + s
  return s.replace(/\/index$/, '/').replace(/\/+$/, '')
}

/**
 * One page and everything under it, in manifest (menu) order, root first.
 *
 * Membership follows the MENU, not the filesystem: the `parent` the walk above
 * recorded is the sidebar's own nesting, so a SUMMARY.md that files a page under
 * a chapter it does not share a path with still exports as that chapter reads.
 *
 * A manifest written before `parent` existed has none, and then membership falls
 * back to the route prefix — a stale `dist` gives a slightly coarser document
 * rather than an empty one.
 */
export function subtreePages(pages, route) {
  const key = routeKey(route)
  const list = pages || []
  const self = list.filter((p) => routeKey(p.route) === key)
  const hierarchical = list.some((p) => Object.hasOwn(p, 'parent'))

  let keep
  if (hierarchical) {
    const kids = new Map()
    for (const p of list) {
      // A top-level page's parent is the site root, so a subpages export asked
      // from the home page is the whole menu rather than one lonely page.
      const pk = p.parent == null ? '' : routeKey(p.parent)
      if (!kids.has(pk)) kids.set(pk, [])
      kids.get(pk).push(routeKey(p.route))
    }
    keep = new Set([key])
    const queue = [key]
    while (queue.length) {
      for (const child of kids.get(queue.shift()) || []) {
        if (keep.has(child)) continue
        keep.add(child)
        queue.push(child)
      }
    }
  } else {
    const prefix = key + '/'
    keep = new Set(
      list.map((p) => routeKey(p.route)).filter((k) => k === key || k.startsWith(prefix))
    )
  }

  const rest = list.filter((p) => routeKey(p.route) !== key && keep.has(routeKey(p.route)))
  return [...self, ...rest]
}

/**
 * `{ <lang>: { title, pages: [{route, title, parent}] } }` for every locale.
 *
 * `parent` is the route of the page's own parent in the menu (null at the top).
 * Book scope ignores it; subpages scope is defined by it (subtreePages above).
 */
export function buildPdfManifest({ sidebars = {}, title = 'Documentation', defaultLang = 'en' } = {}) {
  const locales = {}
  for (const [lang, sidebar] of Object.entries(sidebars)) {
    const pages = flattenSidebar(sidebar)
    if (pages.length) locales[lang] = { title, pages }
  }
  return { title, defaultLang, locales }
}

/**
 * Which locale a route belongs to — `/lt/guide/x` -> `lt`, given the known set.
 * A book export from a translated page should be that translation's book.
 */
export function langForRoute(route, langs, defaultLang) {
  const first = String(route || '/').split('/').filter(Boolean)[0]
  return first && langs.includes(first) ? first : defaultLang
}
