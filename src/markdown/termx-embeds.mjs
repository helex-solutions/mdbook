// Neutralizes TermX `{{ … }}` embed directives (and any other double-brace
// sequence) so VitePress/Vue does not parse them as template interpolation.
//
// Each `{{ … }}` renders as `<code v-pre>…</code>`: `v-pre` makes the Vue
// compiler skip the element, so the literal braces are safe and visible.
// Recognised terminology embeds ({{def:…}} {{csc:…}} {{vsc:…}}) get a
// `termx-embed` class, pending real build-time expansion.
import mdIt from 'markdown-it'

const EMBED_KINDS = ['def', 'csc', 'vsc']
const escapeHtml = mdIt().utils.escapeHtml

const KIND_LABEL = {
  def: 'Structure definition',
  csc: 'Code system concepts',
  vsc: 'Value set concepts',
  namespace: 'Included resource'
}

// A standalone `{{ kind:value }}` line renders as a resource card (the live
// TermX site expands these into tables/trees via its terminology server; a
// static build shows an informative card instead).
function includeBlock(md) {
  const RE = /^\{\{\s*(def|csc|vsc|namespace)\s*:\s*([^}]+?)\s*\}\}$/

  md.block.ruler.before('paragraph', 'termx_include', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine]
    const line = state.src.slice(start, state.eMarks[startLine]).trim()
    const m = line.match(RE)
    if (!m) return false
    if (silent) return true
    const token = state.push('termx_include', '', 0)
    token.meta = { kind: m[1], value: m[2] }
    token.map = [startLine, startLine + 1]
    state.line = startLine + 1
    return true
  })

  md.renderer.rules.termx_include = (tokens, idx) => {
    const { kind, value } = tokens[idx].meta
    const code = value.split(';')[0].trim()
    const params = value.includes(';') ? value.slice(value.indexOf(';') + 1).trim() : ''
    return (
      `<div class="mdbook-include">` +
      `<div class="mdbook-include-head"><span class="mdbook-include-kind">${KIND_LABEL[kind] || kind}</span> <code v-pre>${escapeHtml(code)}</code></div>` +
      (params ? `<div class="mdbook-include-params"><code v-pre>${escapeHtml(params)}</code></div>` : '') +
      `</div>`
    )
  }
}

export function termxEmbeds(md) {
  includeBlock(md)

  md.inline.ruler.before('escape', 'termx_braces', (state, silent) => {
    const src = state.src
    const start = state.pos
    if (src.charCodeAt(start) !== 0x7b /* { */ || src.charCodeAt(start + 1) !== 0x7b) return false

    const close = src.indexOf('}}', start + 2)
    if (close === -1) return false
    const end = close + 2
    if (!silent) {
      const literal = src.slice(start, end)
      const inner = src.slice(start + 2, close).trim()
      const token = state.push('termx_embed', 'code', 0)
      token.content = literal
      token.meta = { embed: EMBED_KINDS.includes(inner.split(':')[0]) }
    }
    state.pos = end
    return true
  })

  md.renderer.rules.termx_embed = (tokens, idx) => {
    const t = tokens[idx]
    const cls = t.meta?.embed ? ' class="termx-embed"' : ''
    return `<code v-pre${cls}>${escapeHtml(t.content)}</code>`
  }
}
