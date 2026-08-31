// Which stored file a `{{drawio:name}}` macro means.
//
// A diagram is a page attachment in draw.io's `xmlpng` format — a PNG carrying its
// own source XML in a `tEXt` chunk, so one file is both the picture a reader sees
// and the document the wiki's editor reopens. Attachments are immutable by name
// (the wiki answers 409 to a repeated file name, so a past revision embedding a
// file keeps rendering what it rendered), which makes every save a NEW file:
//
//   architecture.v1.drawio.png, architecture.v2.drawio.png, architecture.v10.drawio.png
//
// The macro names the DIAGRAM, never the version, and always resolves to the
// highest version present — by parsed number, never by filename sort order (`v10`
// beats `v2`), listing order, or upload time.
//
// PARITY. The wiki SPA resolves the same macro at read time from the live
// attachment list, in `modules/owliki/frontend/src/components/diagramLinks.ts`
// (helex-tx), tested in `src/__tests__/diagramLinks.spec.ts`. Two implementations
// of "which file does this macro mean" can drift silently, and the failure mode is
// a published page showing an older diagram than the wiki — so the rules below are
// a deliberate transcription of that file, and `test/drawio.test.mjs` mirrors its
// cases. Change one, change both.

/** The suffix every stored diagram carries — draw.io's own round-trip format. */
export const DIAGRAM_SUFFIX = '.drawio.png'

// What a `{{drawio:name}}` argument may be. No dots: the stored name puts the
// version between the diagram's name and the suffix, and a dot in the name would
// make `a.b.v2.drawio.png` ambiguous about where the name ends. No slashes or
// spaces either — this ends up in a URL path segment.
const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const FILE = /^([A-Za-z0-9][A-Za-z0-9_-]*)\.v(\d+)\.drawio\.png$/

export function isDiagramName(name) {
  return NAME.test(name)
}

/** Where version `version` of diagram `name` is stored. */
export function diagramFileName(name, version) {
  return `${name}.v${version}${DIAGRAM_SUFFIX}`
}

// The diagram and version a stored file belongs to, or null if it is not one of
// ours. A file with no `.vN.` segment is NOT one of ours: pre-macro diagrams are
// plain `![](files/…drawio.png)` embeds and must keep rendering as ordinary
// images rather than being mistaken for version 0 of something.
export function parseDiagramFile(fileName) {
  const m = FILE.exec(fileName)
  return m ? { name: m[1], version: Number(m[2]) } : null
}

// The newest stored version of a diagram, or null when the folder has none.
// Newest rather than "the one this revision referenced": the macro names a
// diagram, not a version, so a page always shows the current one.
export function latestDiagram(fileNames, name) {
  let best = null
  for (const fileName of fileNames || []) {
    const parsed = parseDiagramFile(fileName)
    if (!parsed || parsed.name !== name) continue
    if (!best || parsed.version > best.version) best = { fileName, version: parsed.version }
  }
  return best
}
