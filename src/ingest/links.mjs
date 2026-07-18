// Audits internal markdown links in the staged content and reports the ones
// that won't resolve on the static site — e.g. wiki app routes (`/wiki/…`,
// `/spaces`), missing local assets, or `page:` links to unknown slugs. Purely a
// build-time warning; it never fails the build.
import fs from 'node:fs'
import path from 'node:path'
import { walkMarkdown } from './util.mjs'

// [text](href) but NOT ![alt](src) — images are handled by fixStagedImages.
const LINK_RE = /(?<!!)\[[^\]]*\]\(\s*([^)\s]+)(?:\s+"[^"]*")?\s*\)/g
const EXTERNAL = /^(https?:|mailto:|tel:|data:|#|\/\/)/i
// TermX/web link namespaces resolved elsewhere (they point at the web UI).
const NAMESPACE = /^(cs|vs|ms|concept|def|csc|vsc):/i

function routeOf(dest) {
  return '/' + dest.replace(/(^|\/)index\.md$/, '$1').replace(/\.md$/, '')
}

// Returns the list of internal links that don't resolve, as { file, href, why }.
export function auditLinks(staging, model) {
  const mdFiles = (model.contentFiles || []).filter((f) => f.dest.endsWith('.md'))
  const routes = new Set(mdFiles.map((f) => routeOf(f.dest).replace(/\/$/, '') || '/'))
  const slugs = new Set(mdFiles.map((f) => path.basename(f.dest, '.md')).filter((s) => s !== 'index'))
  const dead = []

  const assetExists = (href) => {
    const clean = decodeURI(href.split(/[?#]/)[0])
    return (
      fs.existsSync(path.join(staging, 'public', clean)) ||
      fs.existsSync(path.join(staging, clean.replace(/^\//, '')))
    )
  }

  for (const file of walkMarkdown(staging, { exclude: ['node_modules', 'public'] })) {
    const text = fs.readFileSync(file, 'utf8')
    let m
    LINK_RE.lastIndex = 0
    while ((m = LINK_RE.exec(text))) {
      const href = m[1]
      if (EXTERNAL.test(href) || NAMESPACE.test(href)) continue
      if (href.startsWith('page:')) {
        const slug = href.slice(5).split(/[?#]/)[0].split('/').pop()
        if (slug && !slugs.has(slug)) dead.push({ file, href, why: 'unknown page slug' })
        continue
      }
      if (href.startsWith('/')) {
        const routePath = href.split(/[?#]/)[0].replace(/\/$/, '') || '/'
        if (routes.has(routePath) || assetExists(href)) continue
        dead.push({ file, href, why: 'no matching page or asset' })
      }
    }
  }
  return dead
}
