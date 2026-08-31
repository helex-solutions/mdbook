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
 * `termx` is the same instruction under its former name and resolves to the SAME
 * term, so a site that updates its config keeps every discussion it already has.
 *
 * A page with no code (a generated home, a gitbook source) falls back to
 * `pathname` rather than to `specific` with an empty term, which giscus would
 * answer with a thread nobody can find again.
 */
export function giscusMapping(configured, pageCode) {
  const mapping = configured || 'pathname'
  if (mapping !== 'owliki' && mapping !== 'termx') return { mapping }
  return pageCode ? { mapping: 'specific', term: pageCode } : { mapping: 'pathname' }
}
