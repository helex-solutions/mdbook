// Resolves markdown image references in staged content so the bundler never
// fails on a missing asset. Existing local images and remote/data URIs are kept;
// broken local references are replaced with their alt text.
import fs from 'node:fs'
import path from 'node:path'
import { walkMarkdown } from './util.mjs'

const IMG_RE = /!\[([^\]]*)\]\(([^)\s]+)(\s+"[^"]*")?\)/g
const EXTERNAL = /^(https?:)?\/\//i

function exists(p) {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

// Decide the replacement for one image reference.
function resolveOne(alt, src, fileDir, staging) {
  if (EXTERNAL.test(src) || src.startsWith('data:')) return null // keep as-is

  // TermX attachment convention -> public/attachments/<id>/<file>.
  const filesM = src.match(/^files\/(\d+)\/(.+)$/)
  if (filesM) {
    const pub = path.join(staging, 'public', 'attachments', filesM[1], filesM[2])
    return exists(pub) ? `![${alt}](/attachments/${filesM[1]}/${filesM[2]})` : `*${alt || 'image'}*`
  }

  // Absolute (public) path.
  if (src.startsWith('/')) {
    return exists(path.join(staging, 'public', src)) || exists(path.join(staging, src))
      ? null
      : `*${alt || 'image'}*`
  }

  // Relative path next to the page.
  const rel = path.join(fileDir, src)
  return exists(rel) ? null : `*${alt || 'image'}*`
}

export function fixStagedImages(staging) {
  for (const file of walkMarkdown(staging, { exclude: ['node_modules', 'public'] })) {
    const dir = path.dirname(file)
    const text = fs.readFileSync(file, 'utf8')
    let changed = false
    const next = text.replace(IMG_RE, (whole, alt, src, title) => {
      const repl = resolveOne(alt, decodeURI(src), dir, staging)
      if (repl == null) return whole
      changed = true
      return repl
    })
    if (changed) fs.writeFileSync(file, next)
  }
}
