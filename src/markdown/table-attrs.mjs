// markdown-it-attrs can't attach a `{.class #id key=val}` block that sits on its
// own line after a multi-column (multimd) table — the multimd table token has a
// different shape, so the curly block is left as a literal paragraph. This rule
// runs after markdown-it-attrs, finds such an orphaned `{…}` paragraph immediately
// after a table, and applies it to the table element instead (then drops the
// paragraph). This is what makes `{.dense}` (and other attrs) work on tables, so
// they render the same as in the wiki. See docs/owliki-compatibility.md §7.1.
const CURLY_ONLY = /^\s*(\{[.#][^}]*\})\s*$/

function applyCurly(token, curly) {
  const inner = curly.slice(1, -1).trim() // drop the surrounding { }
  for (const part of inner.split(/\s+/)) {
    if (!part) continue
    if (part.startsWith('.')) {
      const cls = token.attrGet('class')
      token.attrSet('class', cls ? `${cls} ${part.slice(1)}` : part.slice(1))
    } else if (part.startsWith('#')) {
      token.attrSet('id', part.slice(1))
    } else if (part.includes('=')) {
      const eq = part.indexOf('=')
      token.attrSet(part.slice(0, eq), part.slice(eq + 1).replace(/^["']|["']$/g, ''))
    }
  }
}

export function tableAttrs(md) {
  // VitePress overrides the table renderer to emit a fixed `<table tabindex="0">`,
  // which drops any class we attach to the table token. mdbook's markdown `config`
  // hook runs last, so re-render tables from their own attrs while preserving the
  // accessibility tabindex VitePress adds.
  md.renderer.rules.table_open = (tokens, idx, options, _env, self) => {
    const token = tokens[idx]
    if (token.attrIndex('tabindex') < 0) token.attrSet('tabindex', '0')
    return self.renderToken(tokens, idx, options)
  }

  md.core.ruler.after('curly_attributes', 'mdbook_table_attrs', (state) => {
    const t = state.tokens
    for (let i = 0; i < t.length - 2; i++) {
      if (
        t[i].type === 'paragraph_open' &&
        t[i + 1].type === 'inline' &&
        t[i + 2].type === 'paragraph_close' &&
        t[i - 1]?.type === 'table_close'
      ) {
        const m = CURLY_ONLY.exec(t[i + 1].content)
        if (!m) continue
        let k = i - 1
        while (k >= 0 && t[k].type !== 'table_open') k--
        if (k < 0) continue
        applyCurly(t[k], m[1])
        t.splice(i, 3) // remove the orphaned paragraph
        i--
      }
    }
    return false
  })
}
