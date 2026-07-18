// Per-page SEO frontmatter. Injects a `title` (the page's name) and a
// `description` (derived from the first prose paragraph) so every page gets a
// unique <title> and <meta name="description">, instead of all pages falling
// back to the site-wide defaults. Existing frontmatter keys are never clobbered.

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function hasKey(fm, key) {
  return new RegExp(`^${key}\\s*:`, 'm').test(fm)
}

// Reduce a chunk of markdown to a plain-text description (~160 chars). Skips
// headings, images, tables, blockquotes, code fences and raw HTML, then strips
// inline markdown from the first prose it finds.
export function deriveDescription(markdown, max = 160) {
  let s = markdown
    .replace(FM_RE, '') // drop frontmatter
    .replace(/```[\s\S]*?```/g, ' ') // fenced code
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/^\+\+\+.*$/gm, ' ') // collapsible markers
    .replace(/^\{[.#][^}]*\}\s*$/gm, ' ') // block-attribute lines ({.is-info})

  const buf = []
  for (let line of s.split(/\r?\n/)) {
    line = line.trim()
    if (!line) {
      if (buf.length) break // blank line ends the first paragraph
      continue
    }
    if (/^#{1,6}\s/.test(line)) {
      if (buf.length) break
      continue // heading
    }
    if (/^(!\[|[|>]|<)/.test(line)) {
      if (buf.length) break
      continue // image-only / table / blockquote / raw HTML
    }
    buf.push(line)
    if (buf.join(' ').length >= max) break
  }

  let text = buf
    .join(' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links -> text
    .replace(/[*_`~]+/g, '') // emphasis / code marks
    .replace(/^[-*+]\s+|^\d+\.\s+/g, '') // leading list marker
    .replace(/\{[.#][^}]*\}/g, '') // inline attributes
    .replace(/<[^>]+>/g, '') // stray HTML tags
    .replace(/\s+/g, ' ')
    .trim()

  if (text.length > max) text = text.slice(0, max).replace(/\s+\S*$/, '').trim() + '…'
  return text
}

// Merge title/description into the file's YAML frontmatter, preserving any keys
// the page already defines. Values are JSON-encoded (a valid YAML flow scalar).
export function applySeoFrontmatter(text, { title, description }) {
  const m = text.match(FM_RE)
  const existing = m ? m[1] : ''
  const additions = []
  if (title && !hasKey(existing, 'title')) additions.push(`title: ${JSON.stringify(title)}`)
  if (description && !hasKey(existing, 'description')) {
    additions.push(`description: ${JSON.stringify(description)}`)
  }
  if (!additions.length) return text
  if (m) return text.replace(FM_RE, `---\n${existing}\n${additions.join('\n')}\n---\n`)
  return `---\n${additions.join('\n')}\n---\n\n${text}`
}
