// "Related pages" block after the article, mounted via the `doc-after` slot.
//
// Parallel documentation trees describe one subject from different angles (a
// spec, its validation, the user story it traces from). They sit in different
// sections, so the menu never shows them together. The links are resolved at
// build time into `related` frontmatter (see src/ingest/related.mjs) — an array
// of { text, link, section }. Renders nothing when there is nothing to link.
import { defineComponent, h } from 'vue'
import { useData } from 'vitepress'

export default defineComponent({
  name: 'MdbookRelated',
  setup() {
    const { frontmatter } = useData()
    return () => {
      const related = frontmatter.value?.related
      if (!Array.isArray(related) || !related.length) return null
      return h('aside', { class: 'mdbook-related' }, [
        h('h2', { class: 'mdbook-related-title' }, 'Related'),
        h(
          'ul',
          { class: 'mdbook-related-list' },
          related.map((r) =>
            h('li', { class: 'mdbook-related-item' }, [
              h('a', { href: r.link }, r.text),
              r.section ? h('span', { class: 'mdbook-related-section' }, r.section) : null
            ])
          )
        )
      ])
    }
  }
})
