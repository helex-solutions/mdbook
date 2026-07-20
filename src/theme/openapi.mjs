// Try-it console for OpenAPI operations, plus the OIDC callback handler.
//
// The operation documentation itself is static markdown produced at build time
// (src/ingest/openapi-render.mjs) so it stays searchable; this only hydrates the
// `<div class="mdbook-tryit">` islands left behind, and the callback page.
//
// The UI is built with plain DOM rather than a Vue template: the islands live
// inside already-rendered markdown, and imperative construction avoids
// re-parsing user content as a template.
import { defineComponent, h, onMounted, watch, nextTick } from 'vue'
import { useData, useRoute } from 'vitepress'
import { login, logout, getToken, completeLogin } from './oidc.mjs'

const el = (tag, props = {}, children = []) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') n.className = v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v)
    else if (v != null) n.setAttribute(k, v)
  }
  for (const c of [].concat(children)) n.append(c)
  return n
}

// Path templating: /pets/{petId} + { petId: 7 } -> /pets/7
const fillPath = (p, values) => p.replace(/\{([^}]+)\}/g, (m, k) => encodeURIComponent(values[k] ?? m))

function buildConsole(root, cfg) {
  if (root.dataset.mounted) return
  root.dataset.mounted = '1'

  const method = root.dataset.method || 'GET'
  const pathTpl = decodeURI(root.dataset.path || '')
  const specName = root.dataset.spec
  const specInfo = cfg.specs?.[specName] || {}
  const servers = specInfo.servers?.length ? specInfo.servers : [decodeURI(root.dataset.server || '')]
  const hasBody = !['GET', 'HEAD', 'DELETE'].includes(method)

  // Parameters are carried on the island itself (data-params), written at build
  // time — no second copy of the spec is shipped to the browser.
  let params = []
  try {
    params = JSON.parse(root.dataset.params || '[]')
  } catch {
    params = []
  }

  const fields = {}
  const paramRows = params.map((p) => {
    const input = el('input', { class: 'mdbook-tryit-input', placeholder: p.in + (p.required ? ' · required' : '') })
    fields[p.name] = { input, in: p.in }
    return el('label', { class: 'mdbook-tryit-field' }, [el('span', {}, p.name), input])
  })

  // Editable rather than a dropdown: plenty of documents declare no `servers` at
  // all (or only a demo host), and the reader still needs somewhere to send the
  // request. Known servers are offered as suggestions.
  const known = servers.filter(Boolean)
  const listId = `mdbook-servers-${Math.random().toString(36).slice(2, 8)}`
  const serverSel = el('input', {
    class: 'mdbook-tryit-input',
    value: known[0] || '',
    placeholder: 'https://api.example.com',
    list: known.length ? listId : null
  })
  const serverList = known.length
    ? el('datalist', { id: listId }, known.map((s) => el('option', { value: s })))
    : null
  const bodyArea = hasBody ? el('textarea', { class: 'mdbook-tryit-body', rows: '6', placeholder: '{ }' }) : null
  const out = el('pre', { class: 'mdbook-tryit-out' })
  const authNote = el('span', { class: 'mdbook-tryit-auth' })

  // Sign-in exists only when a client is configured. Without `openapi.auth`
  // there is nothing to sign in to, so the button is not created at all rather
  // than rendered dead or hidden — an API that needs no auth shows no auth UI.
  const canSignIn = !!cfg.auth?.clientId
  const loginBtn = canSignIn
    ? el('button', {
        class: 'mdbook-tryit-btn',
        type: 'button',
        onClick: async () => {
          if (getToken()) {
            logout()
            refreshAuth()
            return
          }
          try {
            await login(specInfo.auth, cfg.auth)
          } catch (e) {
            out.textContent = `Sign-in failed: ${e.message}`
          }
        }
      })
    : null

  const refreshAuth = () => {
    const t = getToken()
    authNote.textContent = t ? 'authenticated' : canSignIn ? 'not signed in' : ''
    authNote.className = 'mdbook-tryit-auth' + (t ? ' is-on' : '')
    if (loginBtn) loginBtn.textContent = t ? 'Sign out' : 'Sign in'
  }

  const send = async () => {
    out.textContent = 'Sending…'
    const values = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f.input.value]))
    // Concatenate, never `new URL(path, server)`: an operation path is absolute,
    // so URL resolution would discard the server's own base path — turning
    // https://host/api/fhir + /CodeSystem into https://host/CodeSystem.
    let base = (serverSel.value || location.origin).trim().replace(/\/+$/, '')
    if (!/^https?:\/\//i.test(base)) base = location.origin.replace(/\/+$/, '') + (base.startsWith('/') ? base : `/${base}`)
    const url = new URL(base + fillPath(pathTpl, values))
    const headers = {}
    for (const [k, f] of Object.entries(fields)) {
      if (!f.input.value) continue
      if (f.in === 'query') url.searchParams.set(k, f.input.value)
      if (f.in === 'header') headers[k] = f.input.value
    }
    const token = getToken()
    if (token) headers.authorization = `${token.tokenType} ${token.accessToken}`
    if (hasBody && bodyArea.value.trim()) headers['content-type'] = 'application/json'

    const started = performance.now()
    try {
      const res = await fetch(url, {
        method,
        headers,
        body: hasBody && bodyArea.value.trim() ? bodyArea.value : undefined,
        credentials: 'omit'
      })
      const text = await res.text()
      let shown = text
      try {
        shown = JSON.stringify(JSON.parse(text), null, 2)
      } catch {
        /* not JSON — show as-is */
      }
      out.textContent = `${res.status} ${res.statusText} · ${Math.round(performance.now() - started)} ms\n\n${shown}`
    } catch (e) {
      // A browser fetch cannot distinguish CORS refusal from a network failure.
      out.textContent = `Request failed: ${e.message}\n\nIf the API is on another origin it must allow CORS from this site.`
    }
  }

  root.append(
    el('div', { class: 'mdbook-tryit-head' }, [
      el('span', { class: `mdbook-tryit-method m-${method.toLowerCase()}` }, method),
      el('code', { class: 'mdbook-tryit-path' }, pathTpl),
      authNote,
      loginBtn,
      el('button', { class: 'mdbook-tryit-btn is-primary', type: 'button', onClick: send }, 'Send')
    ].filter(Boolean)),
    el('div', { class: 'mdbook-tryit-form' }, [
      el('label', { class: 'mdbook-tryit-field' }, [el('span', {}, 'server'), serverSel, serverList].filter(Boolean)),
      ...paramRows,
      ...(bodyArea ? [el('label', { class: 'mdbook-tryit-field is-wide' }, [el('span', {}, 'body'), bodyArea])] : [])
    ]),
    out
  )
  refreshAuth()
}

export default defineComponent({
  name: 'MdbookOpenapi',
  setup() {
    const { theme, frontmatter } = useData()
    const route = useRoute()

    const hydrate = () => {
      const cfg = theme.value.openapi
      if (!cfg) return
      // The OIDC redirect lands on a page flagged in frontmatter; finish the
      // exchange there and return the reader to where they started.
      if (frontmatter.value?.oauthCallback) {
        const box = document.querySelector('.mdbook-oauth-callback')
        completeLogin().then(({ ok, error, returnTo }) => {
          if (box) box.textContent = ok ? 'Signed in — returning…' : `Sign-in failed: ${error}`
          if (ok && returnTo) location.replace(returnTo)
        })
        return
      }
      if (cfg.tryIt === false) return
      document.querySelectorAll('.mdbook-tryit').forEach((n) => buildConsole(n, cfg))
    }

    onMounted(hydrate)
    watch(() => route.path, () => nextTick(hydrate))
    return () => null
  }
})
