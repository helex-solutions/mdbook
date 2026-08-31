// Optional Giscus (GitHub Discussions) comments, mounted at the end of each doc
// page. Configured via `.mdbook/config.yml` → `comments: { provider: giscus, … }`
// which mdbook forwards to VitePress themeConfig. When `mapping: owliki` (or its
// former name `termx`) and the page carries a stable page code, comments are
// threaded by that id so a slug/title change never orphans a thread.
//
// Both spellings resolve to the SAME giscus term — the page code — so a site
// that switches its config from `termx` to `owliki` keeps every existing
// discussion. That is the whole reason the old name still works.
import { defineComponent, h, ref, onMounted, watch, nextTick } from 'vue'
import { useData, useRoute } from 'vitepress'
import { giscusMapping } from './giscus.mjs'

const GISCUS_SRC = 'https://giscus.app/client.js'
const GISCUS_ORIGIN = 'https://giscus.app'

export default defineComponent({
  name: 'MdbookComments',
  setup() {
    const { theme, frontmatter, isDark, lang } = useData()
    const route = useRoute()
    const el = ref(null)

    const cfg = () => theme.value.comments
    const enabled = () => cfg()?.provider === 'giscus' && !!cfg()?.repo
    const themeName = (c) => (isDark.value ? c.themeDark || 'dark' : c.themeLight || 'light')

    function render() {
      if (typeof document === 'undefined' || !el.value || !enabled()) return
      const c = cfg()
      el.value.innerHTML = ''
      const { mapping, term } = giscusMapping(c.mapping, frontmatter.value?.termxPage)
      const attrs = {
        'data-repo': c.repo,
        'data-repo-id': c.repoId,
        'data-category': c.category,
        'data-category-id': c.categoryId,
        'data-mapping': mapping,
        'data-term': term,
        'data-strict': c.strict ?? '0',
        'data-reactions-enabled': c.reactions ?? '1',
        'data-emit-metadata': '0',
        'data-input-position': c.inputPosition || 'top',
        'data-theme': themeName(c),
        'data-lang': c.lang || lang.value || 'en'
      }
      const s = document.createElement('script')
      s.src = GISCUS_SRC
      s.async = true
      s.crossOrigin = 'anonymous'
      for (const [k, v] of Object.entries(attrs)) if (v != null) s.setAttribute(k, String(v))
      el.value.appendChild(s)
    }

    onMounted(() => {
      render()
      watch(() => route.path, () => nextTick(render)) // re-thread on navigation
    })

    // Live theme switch: message the existing iframe instead of re-injecting.
    watch(isDark, () => {
      if (!enabled()) return
      const frame = el.value?.querySelector('iframe.giscus-frame')
      frame?.contentWindow?.postMessage(
        { giscus: { setConfig: { theme: themeName(cfg()) } } },
        GISCUS_ORIGIN
      )
    })

    return () => (enabled() ? h('div', { ref: el, class: 'mdbook-comments' }) : null)
  }
})
