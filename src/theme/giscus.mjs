// How one page maps onto a giscus discussion.
//
// Kept out of `comments.mjs` because that module imports `vitepress`, which only
// resolves inside a VitePress build — the same reason `auth/nav.mjs` holds
// `returnToFor`. This branch is the whole of the threading behaviour and is
// worth testing without mounting a component.

/**
 * The giscus `data-mapping` / `data-term` pair for one page.
 *
 * `owliki` is not a giscus mapping — it means "thread by the wiki's stable page
 * code", which giscus expresses as `specific` plus that code as the term.
 *
 * The former name is no longer accepted. It resolved to the same term, so a site
 * still using it threads identically today and stops threading by page code the
 * moment it builds against this — its `mapping` falls through to giscus as an
 * unknown value. Changing that one word in `comments.mapping` is the migration,
 * and it keeps every existing discussion, because the TERM is unchanged.
 *
 * A page with no code (a generated home, a gitbook source) falls back to
 * `pathname` rather than to `specific` with an empty term, which giscus would
 * answer with a thread nobody can find again.
 */
export function giscusMapping(configured, pageCode) {
  const mapping = configured || 'pathname'
  if (mapping !== 'owliki') return { mapping }
  return pageCode ? { mapping: 'specific', term: pageCode } : { mapping: 'pathname' }
}
