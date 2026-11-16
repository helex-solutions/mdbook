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
const ICON_CARET = SVG("<path d='m6 9 6 6 6-6'/>")

// What each scope is called, and what it contains. The wording is the contract
// with the reader: "Page + subpages" has to say that a section landing page
// brings its children, because the alternative is a reader downloading the one
// page three times and wondering where the rest went.
const LABEL = {
  page: 'This page',
  subpages: 'Page + subpages',
  book: 'Whole book'
}
const HINT = {
  page: 'Download this page as a PDF',
  subpages: 'This page and every page under it in the menu, as one document',
  book: 'The whole site as one document, with a cover and contents'
}

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
    const el = ref(null)
    let controller = null

    // The bundle says the site was BUILT with export configured; the probe says
    // this deployment can actually serve it. Both must hold.
    const configured = computed(() => Boolean(theme.value?.pdf?.scope?.length))

    // A menu that only closes by clicking the button again is the one that gets
    // left open over the page the reader wanted to read.
    const onAway = (e) => {
      if (open.value && el.value && !el.value.contains(e.target)) open.value = false
    }
    const onKey = (e) => {
      if (e.key === 'Escape') open.value = false
    }

    onMounted(async () => {
      document.addEventListener('click', onAway, true)
      document.addEventListener('keydown', onKey)
      if (!configured.value) return
      const status = await loadStatus()
      if (status && status.enabled) {
        enabled.value = true
        scopes.value = status.scope || theme.value.pdf.scope
      }
    })
    onBeforeUnmount(() => {
      document.removeEventListener('click', onAway, true)
      document.removeEventListener('keydown', onKey)
      controller?.abort()
    })

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

    const label = (scope) => LABEL[scope] || scope
    const hint = (scope) => HINT[scope] || ''

    return () => {
      if (!enabled.value) return null
      const single = scopes.value.length === 1
      // A SPLIT button: the click does the common thing — the first configured
      // scope, which is the page — and the caret offers the rest. Making the
      // whole button open a menu would charge every reader an extra click for
      // the download they almost always want.
      const primary = scopes.value[0]
      const ico = (svg, cls = '') => h('span', { class: `mdbook-pdf-ico ${cls}`, innerHTML: svg })

      // Rendering a book takes seconds, so the control says so and offers a way
      // out — OWLIKI.06 §2.8 asks for exactly this and the wiki never built it.
      if (busy.value) {
        return h('div', { class: 'mdbook-pdf-ui', ref: el }, [
          h(
            'button',
            { class: 'mdbook-pdf-btn is-busy', type: 'button', title: `Cancel — ${label(busy.value)}`, onClick: cancel },
            [ico(ICON_WAIT, 'is-spinning'), h('span', { class: 'mdbook-pdf-text' }, 'Cancel')]
          )
        ])
      }

      const group = [
        h(
          'button',
          {
            class: `mdbook-pdf-btn${single ? '' : ' is-split'}`,
            type: 'button',
            title: `Download PDF — ${label(primary)}`,
            'aria-label': `Download PDF — ${label(primary)}`,
            onClick: () => download(primary)
          },
          [ico(ICON_PDF), h('span', { class: 'mdbook-pdf-text' }, 'PDF')]
        )
      ]
      if (!single) {
        group.push(
          h(
            'button',
            {
              class: 'mdbook-pdf-btn mdbook-pdf-caret',
              type: 'button',
              title: 'Other PDF downloads',
              'aria-label': 'Other PDF downloads',
              'aria-haspopup': 'menu',
              'aria-expanded': String(open.value),
              onClick: () => (open.value = !open.value)
            },
            [ico(ICON_CARET)]
          )
        )
      }

      const children = [h('div', { class: 'mdbook-pdf-group' }, group)]
      // The menu lists EVERY scope, the default one included: a reader opening
      // it is choosing from the whole set, and leaving out the one the button
      // already does makes the list read as if that scope did not exist.
      if (!single && open.value) {
        children.push(
          h(
            'div',
            { class: 'mdbook-pdf-menu', role: 'menu' },
            scopes.value.map((s) =>
              h(
                'button',
                {
                  class: `mdbook-pdf-item${s === primary ? ' is-default' : ''}`,
                  type: 'button',
                  role: 'menuitem',
                  title: hint(s),
                  onClick: () => download(s)
                },
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
      return h('div', { class: 'mdbook-pdf-ui', ref: el }, children)
    }
  }
})
