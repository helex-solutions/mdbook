// Site footer, mounted once per layout (via the `layout-bottom` slot). Reads
// `.mdbook/config.yml` → `footer: { message, copyright }` (forwarded to VitePress
// themeConfig). Unlike VitePress's built-in `themeConfig.footer` — which is hidden
// on any page that shows a sidebar — this renders on every page. Both fields
// allow inline HTML (links etc.). Returns nothing when no footer is configured.
import { defineComponent, h } from 'vue'
import { useData } from 'vitepress'

export default defineComponent({
  name: 'MdbookFooter',
  setup() {
    const { theme } = useData()
    return () => {
      const f = theme.value.footer
      if (!f || (!f.message && !f.copyright)) return null
      const parts = []
      if (f.message) {
        parts.push(h('p', { class: 'mdbook-footer-message', innerHTML: f.message }))
      }
      if (f.copyright) {
        parts.push(h('p', { class: 'mdbook-footer-copyright', innerHTML: f.copyright }))
      }
      return h('footer', { class: 'mdbook-footer' }, [
        h('div', { class: 'mdbook-footer-inner' }, parts)
      ])
    }
  }
})
