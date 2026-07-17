// mdbook default theme — extends VitePress's default theme and layers on
// skin palettes, smart-text styles, and client-side Mermaid rendering. The
// active skin's CSS is imported by the generated staging theme file.
import DefaultTheme from 'vitepress/theme'
import { useRoute } from 'vitepress'
import { onMounted, watch, nextTick } from 'vue'
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
  setup() {
    const route = useRoute()
    const run = () => {
      renderMermaid()
      registerSdViewer()
      markCurrentLink()
    }
    onMounted(() => {
      run()
      watch(
        () => route.path,
        () => nextTick(run)
      )
    })
  }
}
