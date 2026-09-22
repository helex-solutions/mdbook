// PDF download control in the nav bar.
//
// The export itself is done by `mdbook serve` (docs/pdf-design.md) — this asks
// for it and hands the reader the file. Two things it deliberately does NOT do:
// build the PDF in the browser, and appear on a site that cannot produce one.
import { defineComponent, h, ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useData, useRoute, withBase } from 'vitepress'
import { saveBlob, filenameFrom } from './download.mjs'

const SVG = (body) =>
  `<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>${body}</svg>`
const ICON_PDF = SVG(
  "<path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><path d='M14 2v6h6'/><path d='M12 18v-6'/><path d='m9 15 3 3 3-3'/>"
)
const ICON_WAIT = SVG("<path d='M12 2a10 10 0 0 1 10 10'/>")

/**
 * Whether this deployment can actually export.
 *
 * A site built with `pdf:` configured and then published statically has no
 * serve endpoint, so the control would offer something that cannot work. One
 * probe, cached for the session — the same reason and the same shape as the
 * auth widget's (src/theme/auth.mjs).
 */
let statusCache = null
async function loadStatus() {
  if (statusCache !== null) return statusCache
  try {
    const res = await fetch(withBase('/pdf/status'), { headers: { accept: 'application/json' } })
    statusCache = res.ok ? await res.json() : false
  } catch {
    statusCache = false
  }
  return statusCache
}

export default defineComponent({
  name: 'MdbookPdf',
  setup() {
    const { theme, page } = useData()
    const route = useRoute()
    const enabled = ref(false)
    const scopes = ref([])
    const busy = ref(null) // the scope being rendered
    const error = ref('')
    const open = ref(false)
    let controller = null

    // The bundle says the site was BUILT with export configured; the probe says
    // this deployment can actually serve it. Both must hold.
    const configured = computed(() => Boolean(theme.value?.pdf?.scope?.length))

    onMounted(async () => {
      if (!configured.value) return
      const status = await loadStatus()
      if (status && status.enabled) {
        enabled.value = true
        scopes.value = status.scope || theme.value.pdf.scope
      }
    })
    onBeforeUnmount(() => controller?.abort())

    const currentPath = () =>
      route.path.replace(/index\.html$/, '').replace(/\.html$/, '') || '/'

    async function download(scope) {
      if (busy.value) return
      busy.value = scope
      error.value = ''
      open.value = false
      controller = new AbortController()
      try {
        const q = new URLSearchParams({ path: currentPath(), scope })
        const res = await fetch(withBase(`/pdf?${q}`), { signal: controller.signal })
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`)
        const blob = await res.blob()
        saveBlob(blob, filenameFrom(res.headers.get('content-disposition'), 'document.pdf'))
      } catch (e) {
        // An aborted fetch is the reader cancelling, not a failure.
        if (e?.name !== 'AbortError') error.value = String(e?.message || e).slice(0, 200)
      } finally {
        busy.value = null
        controller = null
      }
    }

    const cancel = () => controller?.abort()

    const label = (scope) => (scope === 'book' ? 'Whole book' : 'This page')

    return () => {
      if (!enabled.value) return null
      const single = scopes.value.length === 1
      const ico = (svg, cls = '') => h('span', { class: `mdbook-pdf-ico ${cls}`, innerHTML: svg })

      // Rendering a book takes seconds, so the control says so and offers a way
      // out — OWLIKI.06 §2.8 asks for exactly this and the wiki never built it.
      if (busy.value) {
        return h('div', { class: 'mdbook-pdf-ui' }, [
          h(
            'button',
            { class: 'mdbook-pdf-btn is-busy', type: 'button', title: 'Cancel', onClick: cancel },
            [ico(ICON_WAIT, 'is-spinning'), h('span', { class: 'mdbook-pdf-text' }, 'Cancel')]
          )
        ])
      }

      const children = [
        h(
          'button',
          {
            class: 'mdbook-pdf-btn',
            type: 'button',
            title: single ? `Download PDF — ${label(scopes.value[0])}` : 'Download PDF',
            'aria-label': 'Download PDF',
            'aria-haspopup': single ? undefined : 'menu',
            'aria-expanded': single ? undefined : String(open.value),
            onClick: () => (single ? download(scopes.value[0]) : (open.value = !open.value))
          },
          [ico(ICON_PDF), h('span', { class: 'mdbook-pdf-text' }, 'PDF')]
        )
      ]
      if (!single && open.value) {
        children.push(
          h(
            'div',
            { class: 'mdbook-pdf-menu', role: 'menu' },
            scopes.value.map((s) =>
              h(
                'button',
                { class: 'mdbook-pdf-item', type: 'button', role: 'menuitem', onClick: () => download(s) },
                label(s)
              )
            )
          )
        )
      }
      // A failure is SHOWN. The reference implementation swallowed it, so a
      // reader who lacked access just saw nothing happen.
      if (error.value) {
        children.push(h('div', { class: 'mdbook-pdf-error', role: 'alert' }, error.value))
      }
      return h('div', { class: 'mdbook-pdf-ui' }, children)
    }
  }
})
