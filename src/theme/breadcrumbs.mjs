// Breadcrumb trail above the article, mounted via the `doc-before` slot.
//
// On a large space each top-level section gets its own sidebar, so a page deep
// inside one shows no trace of where it sits in the whole tree. The trail is
// resolved at build time into `breadcrumbs` frontmatter (see breadcrumbsFor in
// src/build.mjs) — an array of { text, link? }; a folder without an index page
// has no link, so a crumb never leads to a 404. Renders nothing when absent.
import { defineComponent, h } from 'vue'
import { useData } from 'vitepress'

export default defineComponent({
  name: 'MdbookBreadcrumbs',
  setup() {
    const { frontmatter } = useData()
    return () => {
      const crumbs = frontmatter.value?.breadcrumbs
      if (!Array.isArray(crumbs) || crumbs.length < 2) return null
      const items = []
      crumbs.forEach((c, i) => {
        if (i) items.push(h('span', { class: 'mdbook-crumb-sep', 'aria-hidden': 'true' }, '/'))
        items.push(
          c.link
            ? h('a', { class: 'mdbook-crumb', href: c.link }, c.text)
            : h('span', { class: 'mdbook-crumb is-plain' }, c.text)
        )
      })
      return h('nav', { class: 'mdbook-breadcrumbs', 'aria-label': 'Breadcrumb' }, items)
    }
  }
})
