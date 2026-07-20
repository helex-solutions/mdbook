// mdbook default theme — extends VitePress's default theme and layers on
// skin palettes, smart-text styles, and client-side Mermaid rendering. The
// active skin's CSS is imported by the generated staging theme file.
import DefaultTheme from 'vitepress/theme'
import { useRoute, useRouter, useData, withBase } from 'vitepress'
import { h, onMounted, watch, nextTick } from 'vue'
import Comments from './comments.mjs'
import Present from './present.mjs'
import Footer from './footer.mjs'
import Breadcrumbs from './breadcrumbs.mjs'
import Related from './related.mjs'
import Zoom from './zoom.mjs'
import './styles/base.css'
import './styles/smart-text.css'

// Render every `.mermaid-diagram` placeholder produced by the markdown layer.
// Register the vendored TermX StructureDefinition viewer web component
// (<tx-sd-view>) once, on the client.
async function registerSdViewer() {
  if (typeof window === 'undefined') return
  if (window.customElements?.get('tx-sd-view')) return
  if (!document.querySelector('tx-sd-view')) return
  const { initializeWebComponent } = await import('../../vendor/structure-definition-viewer/index.js')
  if (!window.customElements.get('tx-sd-view')) initializeWebComponent('tx-sd-view')
}

// Mark the .links-list row whose link points at the current page as current.
function markCurrentLink() {
  if (typeof document === 'undefined') return
  const here = location.pathname.replace(/index\.html$/, '').replace(/\.html$/, '').replace(/\/$/, '')
  document.querySelectorAll('.vp-doc ul.links-list > li').forEach((li) => {
    const a = li.querySelector(':scope > a')
    const href = a?.getAttribute('href')
    if (!href || /^(https?:)?\/\//.test(href)) return li.classList.remove('is-current')
    const target = href.replace(/\.html$/, '').replace(/\/$/, '')
    li.classList.toggle('is-current', target === here)
  })
}

async function renderMermaid() {
  if (typeof document === 'undefined') return
  const nodes = document.querySelectorAll('.mermaid-diagram:not([data-rendered])')
  if (!nodes.length) return
  const mermaid = (await import('mermaid')).default
  const dark = document.documentElement.classList.contains('dark')
  mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default' })
  let i = 0
  for (const el of nodes) {
    el.setAttribute('data-rendered', '1')
    const src = decodeURIComponent(el.getAttribute('data-src') || '')
    try {
      const { svg } = await mermaid.render(`mdbook-mermaid-${Date.now()}-${i++}`, src)
      el.innerHTML = svg
    } catch (e) {
      el.innerHTML = `<pre class="mermaid-error">Mermaid error: ${e?.message || e}</pre>`
    }
  }
}

export default {
  extends: DefaultTheme,
  // Mount the (optional) comments widget after the article body, and the
  // presentation-mode controls once per layout.
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      'nav-bar-content-after': () => h(Zoom),
      'doc-before': () => h(Breadcrumbs),
      'doc-after': () => [h(Related), h(Comments)],
      'layout-bottom': () => [h(Footer), h(Present)]
    }),
  setup() {
    const route = useRoute()
    const router = useRouter()
    const { frontmatter } = useData()
    // Locale-switch redirect stubs (see src/ingest/termx.mjs): a page carrying a
    // `redirect` front-matter bounces to its real translation. This makes the
    // language switcher land on the translated page even when its slug differs
    // per locale (e.g. /lt/build -> /lt/versijos).
    const redirectIfNeeded = () => {
      const to = frontmatter.value?.redirect
      if (to && typeof window !== 'undefined') {
        router.go(withBase(to))
        return true
      }
      return false
    }
    const run = () => {
      renderMermaid()
      registerSdViewer()
      markCurrentLink()
    }
    onMounted(() => {
      if (redirectIfNeeded()) return
      run()
      watch(
        () => route.path,
        () => nextTick(() => {
          if (!redirectIfNeeded()) run()
        })
      )
    })
  }
}
