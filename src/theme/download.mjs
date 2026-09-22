// Handing a fetched blob to the browser as a download.
//
// Kept out of `pdf.mjs` because that module imports `vitepress`, which only
// resolves inside a VitePress build — the same reason `mermaid.mjs` and
// `auth/nav.mjs` exist. What that buys here is that the three details below are
// ordinary functions a test can reach, and each one is a defect in the
// reference implementation this mirrors (helex-tx `wikiClient.ts`
// `downloadExport`, L169-185), so they are worth pinning:
//
//   1. the anchor is APPENDED to the document before clicking and removed
//      after — a detached anchor has historically not fired in Safari;
//   2. the object URL is revoked on a LATER TICK — revoking it synchronously
//      after .click() races the download, and some browsers cancel it;
//   3. the filename prefers `filename*`, so a Lithuanian or Czech title is not
//      saved as a row of dashes.
//
// The fourth defect — swallowing errors, so a 403 showed the reader nothing —
// is the caller's to avoid, and `pdf.mjs` renders what it catches.

/** How long the object URL stays alive after the click. */
const REVOKE_AFTER = 60_000

export function saveBlob(blob, filename, doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return
  const url = URL.createObjectURL(blob)
  const a = doc.createElement('a')
  a.href = url
  a.download = filename
  a.style.display = 'none'
  doc.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER)
}

/**
 * The filename from a Content-Disposition header.
 *
 * `mdbook serve` sends both forms; prefer `filename*=UTF-8''…` because the
 * ASCII `filename=` is unavoidably lossy for a non-Latin title. A malformed
 * encoding falls back rather than throwing — a download with an awkward name
 * beats no download.
 */
export function filenameFrom(disposition, fallback = 'document.pdf') {
  if (!disposition) return fallback
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim())
    } catch {
      /* fall through to the ASCII form */
    }
  }
  return /filename="([^"]+)"/i.exec(disposition)?.[1] || fallback
}
