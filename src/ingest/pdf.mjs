// PDFs stored in the content repo are published like markdown pages: each one
// gets a generated page that previews it inline, and the file itself is staged
// under public/ so both the preview and the Download button resolve on the
// built site (Vite only bundles assets a page imports; a raw-HTML <iframe> src
// is not one, and public/ is what `mdbook serve` and GitHub Pages both serve).
//
// The page body is a `{% file %}` embed, so the preview/download card is the one
// already used for GitBook file embeds (src/ingest/file-embed.mjs) — one card,
// rendered and styled in one place, base path baked in at staging time.
import path from 'node:path'
import { walkFiles } from './util.mjs'

const PDF_EXT = /\.pdf$/i
const README_PDF = /(^|\/)README\.pdf$/i

// Human-friendly page title from a file name: "annual-report_2026.pdf" ->
// "Annual Report 2026". Deliberately the same shape the folder-tree menu uses
// for markdown pages, so a PDF entry doesn't look foreign next to them.
export function prettifyPdfName(name) {
  return name
    .replace(PDF_EXT, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

// Staged page path for a PDF: `docs/spec.pdf` -> `docs/spec.md`. A README is the
// folder's index at any depth — the same rule the markdown ingest applies — so
// `docs/README.pdf` becomes `docs/index.md`.
export function pdfPageDest(rel) {
  return rel.replace(README_PDF, '$1index.pdf').replace(PDF_EXT, '.md')
}

// Body of a generated PDF page: the heading (page title, menu label and search
// result) and the embed that renders the preview + Open/Download actions.
export function pdfPageMarkdown(title, route) {
  return `# ${title}\n\n{% file src="${route}" %}\n`
}

// Collect the content-file entries for every PDF under `dir`.
//
// Each PDF yields two entries: the file itself (copied verbatim into
// `public/`) and — unless a markdown page already claims that path — the
// generated page. `taken` is the set of staged markdown dests already produced
// for this tree, so a `spec.md` sitting next to its `spec.pdf` export keeps the
// URL and the PDF stays a plain download.
export function collectPdfs({
  dir,
  destPrefix = '',
  lang,
  excludeDirs = [],
  isExcluded,
  assetsDir = null,
  taken = new Set()
} = {}) {
  const exclude = ['node_modules', 'public', '.mdbook', ...excludeDirs]
  if (assetsDir) exclude.push(assetsDir.replace(/\\/g, '/').split('/')[0])
  const files = walkFiles(dir, {
    match: (n) => PDF_EXT.test(n),
    exclude,
    isExcluded,
    skipDotDirs: true
  })

  const out = []
  for (const abs of files.sort()) {
    const rel = path.relative(dir, abs).split(path.sep).join('/')
    const route = `/${destPrefix}${rel}`
    // The file, served from the site root at its repo-relative path.
    out.push({ src: abs, dest: `public/${destPrefix}${rel}`, asset: true })

    const dest = destPrefix + pdfPageDest(rel)
    if (taken.has(dest)) continue
    taken.add(dest)
    const name = path.basename(rel)
    const title = prettifyPdfName(name)
    out.push({
      dest,
      lang,
      title,
      description: `${title} (PDF)`,
      content: pdfPageMarkdown(title, route),
      pdf: route // the asset this page previews (inherits the page's access)
    })
  }
  return out
}
