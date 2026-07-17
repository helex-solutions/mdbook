// Turns TermX / Wiki.js tab groups into pure-CSS tabs.
//
//   ## {.tabset}
//   ### First Tab
//   …content…
//   ### Second Tab
//   …content…
//   ##                <- optional closing empty h2
//
// becomes interleaved <input><label><div class="mdbook-tab">…</div> inside a
// .mdbook-tabset, matching the tutorial.termx.org markup so the CSS
// `input:checked + label + .tab` toggles panels with no JavaScript.
//
// Runs as a core rule (after markdown-it-attrs, so the h2 carries `.tabset`).
export function tabset(md) {
  let counter = 0
  md.core.ruler.push('mdbook_tabset', (state) => {
    const tokens = state.tokens
    const starts = []
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]
      if (t.type === 'heading_open' && t.tag === 'h2' && /\btabset\b/.test(t.attrGet('class') || '')) {
        starts.push(i)
      }
    }
    // Process last-to-first so earlier indices stay valid after splicing.
    for (let s = starts.length - 1; s >= 0; s--) {
      processOne(state, starts[s], () => counter++)
    }
  })
}

function processOne(state, openIdx, nextId) {
  const tokens = state.tokens
  const bodyStart = openIdx + 3 // skip heading_open, inline, heading_close

  // End = the next h2. Consume it too if it's an empty closing `##`.
  let k = -1
  for (let j = bodyStart; j < tokens.length; j++) {
    if (tokens[j].type === 'heading_open' && tokens[j].tag === 'h2') {
      k = j
      break
    }
  }
  let bodyEnd, removeEnd
  if (k === -1) {
    bodyEnd = removeEnd = tokens.length
  } else {
    const inline = tokens[k + 1]
    const empty = inline?.type === 'inline' && !inline.content?.trim()
    bodyEnd = k
    removeEnd = empty ? k + 3 : k
  }

  // Split the body into tabs by h3 headings.
  const tabs = []
  let cur = null
  for (let j = bodyStart; j < bodyEnd; j++) {
    const t = tokens[j]
    if (t.type === 'heading_open' && t.tag === 'h3') {
      cur = { label: tokens[j + 1]?.content || `Tab ${tabs.length + 1}`, tokens: [] }
      tabs.push(cur)
      j += 2 // skip inline + heading_close
      continue
    }
    if (cur) cur.tokens.push(t)
  }
  if (!tabs.length) return

  const esc = state.md.utils.escapeHtml
  const name = `mdbook-ts-${nextId()}`
  const html = (content) => {
    const tk = new state.Token('html_block', '', 0)
    tk.content = content
    tk.block = true
    return tk
  }

  const out = [html('<div class="mdbook-tabset">\n')]
  tabs.forEach((tab, ti) => {
    const id = `${name}-${ti}`
    out.push(
      html(
        `<input class="mdbook-tab-radio" type="radio" name="${name}" id="${id}"${ti === 0 ? ' checked' : ''}>\n` +
          `<label class="mdbook-tab-label" for="${id}">${esc(tab.label)}</label>\n` +
          `<div class="mdbook-tab">\n`
      ),
      ...tab.tokens,
      html('</div>\n')
    )
  })
  out.push(html('</div>\n'))

  tokens.splice(openIdx, removeEnd - openIdx, ...out)
}
