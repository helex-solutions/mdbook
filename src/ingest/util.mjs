import fs from 'node:fs'
import path from 'node:path'

// Recursively collect *.md files under `dir`, skipping excluded names/dirs.
export function walkMarkdown(dir, { exclude = [] } = {}) {
  const out = []
  const skip = new Set(['.git', ...exclude])
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (skip.has(entry.name) || entry.name.startsWith('.git')) continue
      const abs = path.join(d, entry.name)
      if (entry.isDirectory()) {
        if (skip.has(entry.name)) continue
        walk(abs)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        out.push(abs)
      }
    }
  }
  walk(dir)
  return out
}

// Recursively copy a directory.
export function copyDir(srcDir, destDir) {
  fs.mkdirSync(destDir, { recursive: true })
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name)
    const d = path.join(destDir, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else if (entry.isFile()) fs.copyFileSync(s, d)
  }
}
