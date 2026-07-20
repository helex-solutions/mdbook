// Live filter for a page of OpenAPI operations. A reference page can carry
// hundreds of them, and site search only gets a reader to the *page* — this
// narrows to the operation. Matches method, path and summary.
//
// Heading and <details> are siblings rather than one wrapper, because wrapping
// them in raw HTML would stop markdown-it parsing the heading and cost the page
// its outline entries and anchors. So the filter toggles the pair together.
//
// Nothing is removed from the DOM, only hidden: the full content stays in the
// HTML for site search, deep links, printing and no-JS readers.
import { el } from './dom.mjs'

// Below this, a filter box is more clutter than help.
export const FILTER_MIN_OPS = 8

export function installFilter(root) {
  const ops = [...root.querySelectorAll('details.mdbook-op')]
  if (ops.length < FILTER_MIN_OPS || root.querySelector('.mdbook-op-filter')) return null

  // Pair each operation with its heading, and note the section it sits under.
  const items = ops.map((details) => {
    let heading = details.previousElementSibling
    while (heading && !/^H[1-6]$/.test(heading.tagName)) heading = heading.previousElementSibling
    const text = `${heading?.textContent || ''} ${details.querySelector('summary')?.textContent || ''}`
    return { details, heading, hay: text.toLowerCase().replace(/\s+/g, ' ') }
  })
  const sections = [...root.querySelectorAll('h2')]

  const input = el('input', {
    class: 'mdbook-op-filter-input',
    type: 'search',
    placeholder: `Filter ${ops.length} operations — path, method or summary`,
    'aria-label': 'Filter operations'
  })
  const count = el('span', { class: 'mdbook-op-filter-count' })

  const apply = () => {
    const q = input.value.trim().toLowerCase()
    let shown = 0
    for (const it of items) {
      // Every word must match, so "post invoice" narrows rather than widens.
      const hit = !q || q.split(/\s+/).every((w) => it.hay.includes(w))
      it.details.hidden = !hit
      if (it.heading) it.heading.hidden = !hit
      if (hit) shown++
    }
    // A section whose operations are all filtered out is just a stray heading.
    for (const h2 of sections) {
      let n = h2.nextElementSibling
      let any = false
      while (n && n.tagName !== 'H2') {
        if (n.matches?.('details.mdbook-op') && !n.hidden) {
          any = true
          break
        }
        n = n.nextElementSibling
      }
      h2.hidden = !!q && !any
    }
    count.textContent = q ? `${shown} of ${ops.length}` : ''
  }

  input.addEventListener('input', apply)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = ''
      apply()
    }
  })

  const bar = el('div', { class: 'mdbook-op-filter' }, [input, count])
  const h1 = root.querySelector('h1')
  if (h1) h1.after(bar)
  else root.prepend(bar)
  return { bar, input, apply }
}
