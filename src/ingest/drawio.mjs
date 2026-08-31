// `{{drawio:name}}` — the static half of the wiki's versioned-diagram macro.
//
// The macro names a DIAGRAM; the versioned file behind it is storage detail, so
// editing a diagram never touches page content. Resolution happens at staging,
// where the exported `attachments/` tree is on disk, and the macro is replaced
// with an ordinary attachment embed:
//
//   {{drawio:architecture}}  ->  ![architecture](files/12/architecture.v2.drawio.png)
//
// Deliberately the SAME `files/<folder>/<file>` form a page writes by hand, so
// the rest of the pipeline resolves it exactly as it resolves every other
// attachment (`ingest/images.mjs` at staging, `markdown/owliki-images.mjs` at
// render, and the per-mount namespacing a portal build applies). There is one
// attachment-path resolution in mdbook and this is not a second one.
//
// WHICH FOLDER. Attachments are published at `attachments/<pageId>/<name>`
// (OWLIKI.07 §3.4), but the macro carries no page id and `pages.json` does not
// publish one either — see `resolveFolder` for the three ways this is answered
// and `docs/owliki-compatibility.md` for the export-side follow-up that
// would make it exact.
import fs from 'node:fs'
import path from 'node:path'
import { mapProse } from './sanitize.mjs'
import { isDiagramName, latestDiagram } from './diagram-files.mjs'

// Inline or standalone; the `; params` tail every other Owliki macro accepts is
// tolerated and ignored, so a stray one degrades to the diagram rather than to
// literal braces.
const MACRO = /\{\{\s*drawio\s*:\s*([^};]+?)\s*(?:;[^}]*)?\}\}/g

// Attachment folders a page names itself. `attachments/…` as well as `files/…`
// because acl.mjs already treats both spellings as a reference to one.
const REFERENCED = /(?:files|attachments)\/([\w.-]+)\//g

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Every attachment folder under `dir`, as folder name -> file names. One shallow
// read of the export, reused for every page.
export function readAttachmentIndex(dir) {
  const index = new Map()
  let entries
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return index
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue
    try {
      index.set(
        e.name,
        fs.readdirSync(path.join(dir, e.name), { withFileTypes: true })
          .filter((f) => f.isFile())
          .map((f) => f.name)
      )
    } catch {
      index.set(e.name, [])
    }
  }
  return index
}

/**
 * Which attachment folder this page's diagrams live in.
 *
 * The macro is page-scoped in the wiki, where the page id is simply known. A
 * published page has no such context, so the folder is recovered in descending
 * order of certainty:
 *
 *   1. `folder` — the page's own attachment folder, when the export named it
 *      (`pages.json` may carry `pageId` per node; wiki-ssg contract extension,
 *      additive like `tags`/`access`). Exact, and the only exact answer.
 *   2. A folder the page already references through `files/<folder>/…`. A page
 *      that embeds any other attachment names its own folder in doing so.
 *   3. The whole export, when exactly ONE folder holds a diagram of this name.
 *      One candidate site-wide is not a guess.
 *
 * When several folders hold that name and nothing narrows them, resolution
 * FAILS rather than picking one: the wrong diagram rendered silently is the
 * failure this whole scheme exists to prevent, and diagram names collide by
 * construction — the wiki's editor names new diagrams `diagram`, `diagram-2`, …
 * per page.
 */
export function resolveFolder(name, { folder, referenced = [], index }) {
  const has = (f) => latestDiagram(index.get(f) || [], name)
  if (folder != null && index.has(String(folder))) return { folder: String(folder) }
  for (const f of referenced) if (index.has(f) && has(f)) return { folder: f }
  const all = [...index.keys()].filter(has)
  if (all.length === 1) return { folder: all[0] }
  if (all.length > 1) return { ambiguous: all }
  return {}
}

// A visible, diagnosable stand-in — never a broken image. It names what was
// looked for, because a macro whose argument was edited and a diagram deleted
// from the wiki's Files panel both land here, and the name is what makes either
// one checkable against that panel. `span` is a real HTML element, so it passes
// `hardenMarkdown` untouched.
function missing(text) {
  return `<span class="mdbook-diagram-missing">${esc(text)}</span>`
}

/**
 * Expand every `{{drawio:…}}` in one page's markdown.
 *
 * `warn` is called with a one-line reason for each macro that did not resolve,
 * so a build reports them rather than leaving them to be found by a reader.
 */
export function expandDiagrams(text, { index, folder = null, warn = () => {} } = {}) {
  if (!index || !text.includes('{{drawio')) return text
  return mapProse(text, (prose) => {
    if (!prose.includes('{{drawio')) return prose
    const referenced = [...new Set([...prose.matchAll(REFERENCED)].map((m) => m[1]))]
    return prose.replace(MACRO, (whole, rawName) => {
      const name = rawName.trim()
      if (!isDiagramName(name)) {
        warn(`not a diagram name: ${whole}`)
        return missing(`Not a diagram name: ${name}`)
      }
      const site = resolveFolder(name, { folder, referenced, index })
      if (site.ambiguous) {
        warn(`{{drawio:${name}}} matches ${site.ambiguous.length} pages (${site.ambiguous.join(', ')}) — the export names no page id`)
        return missing(`Diagram “${name}” is ambiguous: ${site.ambiguous.length} pages have one`)
      }
      const found = site.folder ? latestDiagram(index.get(site.folder), name) : null
      if (!found) {
        warn(`no diagram named "${name}"${site.folder ? ` in attachments/${site.folder}` : ''}`)
        return missing(`No diagram named “${name}” on this page`)
      }
      return `![${name}](files/${site.folder}/${found.fileName})`
    })
  })
}
