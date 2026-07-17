// mdbook markdown layer.
// VitePress uses markdown-it, so TermX Wiki's markdown-it plugins run here
// directly. `applyMarkdown(md, opts)` is called from the VitePress `markdown.config`
// hook. Each plugin is small and independently toggleable.
import attrs from 'markdown-it-attrs'
import mark from 'markdown-it-mark'
import sub from 'markdown-it-sub'
import sup from 'markdown-it-sup'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import { termxLinks } from './termx-links.mjs'
import { termxImages } from './termx-images.mjs'
import { collapsible } from './collapsible.mjs'

export function applyMarkdown(md, opts = {}) {
  // Community plugins matching the TermX Wiki renderer's syntax.
  md.use(attrs, { allowedAttributes: [] }) // {.is-info} {width=800 align=right} …
  md.use(mark) // ==highlight==
  md.use(sub) // H~2~O
  md.use(sup) // x^2^
  md.use(footnote) // [^1]
  md.use(taskLists, { label: false })

  // TermX-specific "smart text".
  md.use(collapsible) // +++ Title … +++  ->  <details>
  md.use(termxLinks, opts) // [t](page:slug) [t](cs:code) [t](vs:code) [t](concept:cs|code)
  md.use(termxImages, opts) // ![](files/<pageId>/<file>)

  for (const p of opts.extraPlugins || []) md.use(p, opts)
}

export { termxLinks, termxImages, collapsible }
