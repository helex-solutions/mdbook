// Resolves GitBook `icon:` frontmatter names to inline SVGs.
// GitBook uses Font Awesome; we read the matching SVG from Font Awesome Free.
// Pro-only names are aliased to a free equivalent. SVGs use fill=currentColor,
// so they inherit the menu text/active colour automatically.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FA_ROOT = path.resolve(HERE, '..', 'node_modules', '@fortawesome', 'fontawesome-free', 'svgs')
const STYLES = ['solid', 'regular', 'brands']

// Font Awesome Pro names GitBook may use -> free equivalents.
const ALIASES = {
  'hand-wave': 'hand',
  'briefcase-blank': 'briefcase'
}

const cache = new Map()

export function getIconSvg(rawName) {
  if (!rawName) return null
  const name = ALIASES[rawName] || rawName
  if (cache.has(name)) return cache.get(name)

  let svg = null
  for (const style of STYLES) {
    const p = path.join(FA_ROOT, style, `${name}.svg`)
    if (fs.existsSync(p)) {
      svg = fs
        .readFileSync(p, 'utf8')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<svg /, '<svg class="mdbook-icon-svg" aria-hidden="true" ')
        .trim()
      break
    }
  }
  cache.set(name, svg)
  return svg
}

// Wrap an icon SVG for injection into a v-html menu label.
export function iconMarkup(name) {
  const svg = getIconSvg(name)
  return svg ? `<span class="mdbook-icon">${svg}</span>` : ''
}
