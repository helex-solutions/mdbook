// Fence languages TermX content uses that Shiki doesn't know, mapped to real
// language ids (an unknown fence language hard-fails the VitePress build).
const FENCE_LANG_ALIAS = { s: 'sh' }

// Cleans up TermX / Wiki.js markdown artifacts that break VitePress's Vue
// template compiler (which, unlike markdown-it, requires well-formed HTML).
export function sanitizeTermxMarkdown(text) {
  let out = text

  // Wiki.js inserts empty/standalone <span> tags to break auto-linking
  // (e.g. "Draw.<span>io"). They carry no meaning and are frequently unclosed,
  // which Vue rejects ("Element is missing end tag"). Drop them.
  out = out.replace(/<\/?span[^>]*>/gi, '')

  // A standalone `{.dense}` after a multimd table can't be attached by
  // markdown-it-attrs (different token shape) and would render as literal text.
  // Drop the orphan so it doesn't show; dense styling on tables is not applied.
  out = out.replace(/^\{\.dense\}\s*$/gm, '')

  // Normalize stray/aliased fence languages — an unknown language hard-fails the
  // VitePress (Shiki) build, so map the ones TermX content uses to real ids.
  out = out.replace(/^(\s*```)([A-Za-z0-9_+-]+)(\s*)$/gm, (m, open, lang, tail) =>
    FENCE_LANG_ALIAS[lang] ? `${open}${FENCE_LANG_ALIAS[lang]}${tail}` : m
  )

  return out
}
