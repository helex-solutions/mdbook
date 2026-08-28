// Site authentication widget + cosmetic menu filtering (docs/auth-design.md).
//
// Renders sign-in/sign-out and a user badge in the nav when the site is served
// by `mdbook serve` with auth configured, and hides sidebar/nav entries the
// session's roles cannot access. The hiding is a courtesy on top of server
// enforcement, never instead of it — protected bodies and the search index are
// withheld server-side. On a host without the serve endpoints (dev server,
// plain static hosting) the widget stays hidden entirely.
import { defineComponent, ref, onMounted, watch, h, nextTick } from 'vue'
import { useData, useRoute, withBase } from 'vitepress'
import { requirementFor, isAllowed } from '../auth/acl.mjs'

let cached = null // { session, acl } shared across route changes

async function loadState() {
  if (cached) return cached
  let session = null
  const res = await fetch(withBase('/auth/session'), { headers: { accept: 'application/json' } })
  if (res.ok) session = await res.json()
  else if (res.status !== 401) throw new Error(`session ${res.status}`)
  let acl = null
  try {
    const a = await fetch(withBase('/acl.json'))
    if (a.ok) acl = await a.json()
  } catch {
    /* no manifest — no filtering */
  }
  cached = { session, acl }
  return cached
}

// Hide sidebar/nav links whose target the current session cannot access.
// Titles are baked into the bundle (documented v1 leak level) — this removes
// them from view; the pages themselves 302/403 at the server.
function filterMenus(acl, session) {
  if (!acl || typeof document === 'undefined') return
  const base = withBase('/')
  const roleSession = session ? { roles: session.roles || [] } : null
  const links = document.querySelectorAll('.VPSidebar a[href], .VPNavBarMenu a[href]')
  for (const a of links) {
    const href = a.getAttribute('href')
    if (!href || /^(https?:)?\/\//.test(href) || href.startsWith('#')) continue
    let route = href.split(/[?#]/)[0]
    if (base !== '/' && route.startsWith(base)) route = '/' + route.slice(base.length)
    const ok = isAllowed(requirementFor(acl, route), roleSession)
    const item = a.closest('.VPSidebarItem') || a.closest('.VPNavBarMenuLink') || a
    item.classList.toggle('mdbook-auth-hidden', !ok)
  }
}

export default defineComponent({
  name: 'MdbookAuth',
  setup() {
    const { theme } = useData()
    const route = useRoute()
    const state = ref(null) // null = unavailable/loading, else { session, acl }

    onMounted(async () => {
      if (!theme.value.auth?.enabled) return
      try {
        state.value = await loadState()
      } catch {
        return // no serve endpoints behind this host — stay hidden
      }
      const refilter = () => nextTick(() => filterMenus(state.value.acl, state.value.session))
      refilter()
      watch(() => route.path, refilter)
    })

    return () => {
      const s = state.value
      if (!s) return null
      const here = typeof location !== 'undefined' ? location.pathname + location.search : '/'
      if (!s.session) {
        return h(
          'a',
          { class: 'mdbook-auth mdbook-auth-signin', href: withBase(`/auth/login?returnTo=${encodeURIComponent(here)}`) },
          'Sign in'
        )
      }
      return h('span', { class: 'mdbook-auth' }, [
        h('span', { class: 'mdbook-auth-user', title: (s.session.roles || []).join(', ') }, s.session.user?.name || ''),
        h('a', { class: 'mdbook-auth-signout', href: withBase('/auth/logout') }, 'Sign out')
      ])
    }
  }
})
