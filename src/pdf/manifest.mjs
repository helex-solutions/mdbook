// The page order a book export follows, written to `dist/pdf-manifest.json`.
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

function walk(items, out, seen, sectionKey) {
  for (const item of items || []) {
    if (item?.link && !isBackLink(item, sectionKey)) {
      const route = String(item.link).replace(/\.html$/, '')
      // Dedupe by route: a section's landing page is reachable both from the
      // root sidebar's section link and from the section's own group.
      if (!seen.has(route)) {
        seen.add(route)
        out.push({ route, title: stripIcon(item.text) })
      }
    }
    if (item?.items) walk(item.items, out, seen, sectionKey)
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
  for (const key of [...roots, ...rest]) walk(sidebar[key], out, seen, key)
  return out
}

/** `{ <lang>: { title, pages: [{route, title}] } }` for every locale. */
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
