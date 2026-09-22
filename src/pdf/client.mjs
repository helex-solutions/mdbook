// The md2pdf call. One place, so the timeout, the token and the failure
// wording are decided once.
import { footerTemplate } from './document.mjs'

/** Ask md2pdf which themes it has. Used at build time to validate `pdf.theme`. */
export async function fetchThemes(pdf, { timeout = 5000 } = {}) {
  const res = await fetch(`${pdf.server}/themes`, {
    headers: pdf.token ? { Authorization: `Bearer ${pdf.token}` } : {},
    signal: AbortSignal.timeout(timeout)
  })
  if (!res.ok) throw new Error(`md2pdf /themes -> HTTP ${res.status}`)
  return (await res.json()).themes || []
}

/**
 * Render one assembled document.
 *
 * A failure here is reported with the reason and the endpoint, because the
 * person who has to fix it is an operator reading a log, not the reader who
 * clicked — and "500 internal error" tells them nothing about which of the two
 * processes is down.
 */
export async function renderPdf(pdf, { html, filename, title, site, options = null }) {
  let res
  try {
    res = await fetch(`${pdf.server}/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(pdf.token ? { Authorization: `Bearer ${pdf.token}` } : {})
      },
      body: JSON.stringify({
        html,
        filename,
        title,
        site,
        options: {
          theme: pdf.theme,
          logo: pdf.logo,
          format: pdf.format,
          landscape: pdf.landscape,
          margin: pdf.margin,
          scale: pdf.scale,
          timeout: pdf.timeout,
          // A page's own directives win over the site's defaults; undefined
          // entries are dropped by md2pdf's merge, so a partial one is fine.
          ...Object.fromEntries(Object.entries(options || {}).filter(([, v]) => v != null)),
          // Only for the unthemed case: a named theme brings its own, and
          // overriding it would drop the brand furniture it was ported to keep.
          ...(pdf.footer && (!pdf.theme || pdf.theme === 'site')
            ? { footerTemplate: footerTemplate(site) }
            : {})
        }
      }),
      signal: AbortSignal.timeout(pdf.timeout + 5000)
    })
  } catch (e) {
    const why = e?.name === 'TimeoutError' ? 'timed out' : String(e?.message || e)
    throw Object.assign(new Error(`md2pdf at ${pdf.server} is unreachable (${why})`), { status: 502 })
  }
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.json()).error || ''
    } catch {
      /* not JSON — the status is what we have */
    }
    throw Object.assign(new Error(`md2pdf returned HTTP ${res.status}${detail ? `: ${detail}` : ''}`), {
      status: res.status === 429 ? 503 : 502
    })
  }
  return Buffer.from(await res.arrayBuffer())
}
