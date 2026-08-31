// Client-side Mermaid rendering for the `.mermaid-diagram` placeholders the
// markdown layer emits.
//
// Kept out of `index.mjs` because that module imports `vitepress`, which only
// resolves inside a VitePress build — the same reason `giscus.mjs` and
// `auth/nav.mjs` exist. What that buys here is that the two safety settings
// below are an ordinary value a test can read, rather than an argument buried in
// a call no test can reach.

/**
 * The options every `mermaid.initialize` in mdbook is called with.
 *
 * Diagram source is page content, so both safety settings are STATED rather than
 * inherited from whatever the installed mermaid happens to default to — the same
 * two the wiki's own renderer states (helex-tx `mermaidRenderer.ts`):
 *
 *   - `securityLevel: 'strict'` runs mermaid's own DOMPurify over the SVG it
 *     generates and disables `click` bindings.
 *   - `htmlLabels: false` keeps labels as SVG `<text>` instead of live HTML
 *     inside a `foreignObject`. This is the ROOT-level key: since mermaid 11.17
 *     the per-diagram `flowchart.htmlLabels` is deprecated and the root one
 *     overrides it, so setting only the nested one silently does nothing.
 *
 * The second is not defence in depth for its own sake. Without it a diagram
 * label is parsed into real DOM — sanitized, so no script, but enough to place
 * an `<img>` at an author-chosen URL. Ordinary markdown may already do that; a
 * diagram simply has no need to.
 *
 * `theme` is the only part that varies, and it carries no security meaning.
 */
export function mermaidInit(dark) {
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    htmlLabels: false,
    theme: dark ? 'dark' : 'default'
  }
}

/** Draw every placeholder that has not been drawn yet. */
export async function renderMermaid() {
  if (typeof document === 'undefined') return
  const nodes = document.querySelectorAll('.mermaid-diagram:not([data-rendered])')
  if (!nodes.length) return
  const mermaid = (await import('mermaid')).default
  mermaid.initialize(mermaidInit(document.documentElement.classList.contains('dark')))
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
