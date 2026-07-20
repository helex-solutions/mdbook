// Fence languages TermX content uses that Shiki doesn't know, mapped to real
// language ids (an unknown fence language hard-fails the VitePress build).
const FENCE_LANG_ALIAS = { s: 'sh' }

// Standard HTML element names. Anything outside this set that is written with
// angle brackets in prose (`<Patient>`, `<Registry name>`, a PascalCase FHIR
// resource, a `<placeholder>`, a stray `</content>`) is treated by VitePress's
// Vue compiler as a component or an invalid tag and hard-fails the build. Real
// HTML authored in docs uses these names, so they are passed through untouched.
const HTML_TAGS = new Set(
  (
    'a abbr address area article aside audio b base bdi bdo blockquote body br ' +
    'button canvas caption cite code col colgroup data datalist dd del details ' +
    'dfn dialog div dl dt em embed fieldset figcaption figure footer form h1 h2 ' +
    'h3 h4 h5 h6 head header hgroup hr html i iframe img input ins kbd label ' +
    'legend li link main map mark menu meta meter nav noscript object ol optgroup ' +
    'option output p param picture pre progress q rp rt ruby s samp script section ' +
    'select slot small source span strong style sub summary sup table tbody td ' +
    'template textarea tfoot th thead time title tr track u ul var video wbr'
  ).split(' ')
)

// Split markdown into code / non-code regions and run `fn` over the prose only,
// leaving fenced blocks and inline code verbatim (their `<…>` and `{{…}}` are
// already Vue-safe — fences are v-pre, inline code is escaped in the renderer).
function mapProse(text, fn) {
  const re = /```[\s\S]*?```|~~~[\s\S]*?~~~|``[\s\S]*?``|`[^`\n]*`/g
  let out = ''
  let last = 0
  let m
  while ((m = re.exec(text))) {
    out += fn(text.slice(last, m.index)) + m[0]
    last = m.index + m[0].length
  }
  return out + fn(text.slice(last))
}

// Neutralize the two Vue-template hazards in a prose (non-code) run:
//   1. Angle-bracket sequences whose tag name is not a real HTML element — escape
//      the leading `<` so Vue renders it as literal text instead of a component /
//      invalid tag. Autolinks (`<https://…>`, `<a@b.com>`), comments and
//      declarations (`<!-- -->`, `<!DOCTYPE>`) are left alone.
//   2. Mustache `{{ … }}` interpolation — escape the braces so Vue does not try
//      to evaluate it. TermX embeds (`{{def:…}}`, `{{csc:…}}`, `{{vsc:…}}`) are
//      preserved so their markdown-it plugin still fires.
function neutralizeProse(s) {
  s = s.replace(/<(\/?)([A-Za-z][A-Za-z0-9-]*)(.?)/g, (m, slash, name, next) => {
    // `<http://…>` / `<a@b.com>` are markdown autolinks, not tags — leave them.
    if (next === ':' || next === '@') return m
    if (HTML_TAGS.has(name.toLowerCase())) return m
    return `&lt;${slash}${name}${next}`
  })
  s = s.replace(/\{\{([\s\S]*?)\}\}/g, (m, inner) =>
    /^\s*(def|csc|vsc):/.test(inner) ? m : `&#123;&#123;${inner}&#125;&#125;`
  )
  return s
}

// Harden arbitrary markdown against VitePress's Vue compiler without touching
// code. Safe to run on any source format: it only rewrites constructs that would
// otherwise crash the build. Frontmatter is left untouched.
export function hardenMarkdown(text) {
  const fm = text.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n)([\s\S]*)$/)
  if (fm) return fm[1] + mapProse(fm[2], neutralizeProse)
  return mapProse(text, neutralizeProse)
}

// Cleans up TermX / Wiki.js markdown artifacts that break VitePress's Vue
// template compiler (which, unlike markdown-it, requires well-formed HTML).
export function sanitizeTermxMarkdown(text) {
  let out = text

  // Wiki.js inserts empty/standalone <span> tags to break auto-linking
  // (e.g. "Draw.<span>io"). They carry no meaning and are frequently unclosed,
  // which Vue rejects ("Element is missing end tag"). Drop them. (The convergence
  // migration rewrites these to <!-- -->; this stays as a fallback for un-migrated
  // or third-party content.)
  out = out.replace(/<\/?span[^>]*>/gi, '')

  // Note: a standalone `{.dense}` (or other `{.class}`) after a multimd table is
  // NOT stripped here — the `tableAttrs` markdown-it rule attaches it to the table
  // during rendering, so dense tables render the same as in the wiki.

  // Normalize stray/aliased fence languages — an unknown language hard-fails the
  // VitePress (Shiki) build, so map the ones TermX content uses to real ids.
  out = out.replace(/^(\s*```)([A-Za-z0-9_+-]+)(\s*)$/gm, (m, open, lang, tail) =>
    FENCE_LANG_ALIAS[lang] ? `${open}${FENCE_LANG_ALIAS[lang]}${tail}` : m
  )

  return out
}
