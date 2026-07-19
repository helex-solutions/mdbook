// mdbook markdown layer.
// VitePress uses markdown-it, so TermX Wiki's markdown-it plugins run here
// directly. `applyMarkdown(md, opts)` is called from the VitePress `markdown.config`
// hook. Each plugin is small and independently toggleable.
import attrs from 'markdown-it-attrs'
import multimdTable from 'markdown-it-multimd-table'
import mark from 'markdown-it-mark'
import sub from 'markdown-it-sub'
import sup from 'markdown-it-sup'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import { termxLinks } from './termx-links.mjs'
import { termxImages } from './termx-images.mjs'
import { termxEmbeds } from './termx-embeds.mjs'
import { collapsible } from './collapsible.mjs'
import { tabset } from './tabset.mjs'
import { cardGrid } from './card-grid.mjs'
import { diagrams } from './diagrams.mjs'
import { tableAttrs } from './table-attrs.mjs'

export function applyMarkdown(md, opts = {}) {
  // Community plugins matching the TermX Wiki renderer's syntax.
  md.use(attrs, { allowedAttributes: [] }) // {.is-info} {width=800 align=right} …
  md.use(multimdTable, { multiline: true, rowspan: true, headerless: true }) // ^^ ||| headerless tables

  // markdown-it-attrs' table transform reads token.meta.colsnum; multimd-table
  // tokens can have a null meta, which crashes it. Ensure every block token has
  // a meta object before curly_attributes runs.
  md.core.ruler.before('curly_attributes', 'mdbook_ensure_meta', (state) => {
    for (const t of state.tokens) if (t.meta == null) t.meta = {}
    return false
  })
  md.use(tableAttrs) // attach an orphaned `{.dense}`/`{…}` after a multimd table to the table
  md.use(mark) // ==highlight==
  md.use(sub) // H~2~O
  md.use(sup) // x^2^
  md.use(footnote) // [^1]
  md.use(taskLists, { label: false })

  // TermX-specific "smart text".
  md.use(termxEmbeds) // {{def:…}} {{csc:…}} {{vsc:…}} -> Vue-safe inline code
  md.use(collapsible) // +++ Title … +++  ->  <details>
  md.use(tabset) // ## {.tabset} + ### tabs  ->  pure-CSS tabs
  md.use(cardGrid) // list {.card-grid}  ->  card grid with cover/title/desc/buttons
  md.use(diagrams, opts) // ```drawio ```plantuml ```mermaid
  md.use(termxLinks, opts) // [t](page:slug) [t](cs:code) [t](vs:code) [t](concept:cs|code)
  md.use(termxImages, opts) // ![](files/<pageId>/<file>)

  for (const p of opts.extraPlugins || []) md.use(p, opts)

  // Make inline code Vue-safe: `{{ … }}` inside backticks must not be parsed as
  // interpolation. VitePress marks fenced code v-pre but not inline code.
  const escapeHtml = md.utils.escapeHtml
  md.renderer.rules.code_inline = (tokens, idx) => {
    const t = tokens[idx]
    const cls = t.attrGet('class')
    return `<code v-pre${cls ? ` class="${cls}"` : ''}>${escapeHtml(t.content)}</code>`
  }
}

export { termxLinks, termxImages, collapsible, cardGrid }
