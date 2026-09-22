// Normalizes the `pdf:` config block.
//
//   pdf:
//     server: http://md2pdf:18509     # REQUIRED — unset means no PDF export
//     token: ${MD2PDF_TOKEN}         # when the service requires one
//     scope: [page, book]            # which buttons the theme shows
//     theme: site                    # site | plain | helex | … (GET /themes lists them)
//     logo: ./.mdbook/logo.png       # inlined for a named theme's title block
//     numbered: true                 # prefix 1. / 1.1 into heading text
//     format: A4
//     landscape: false
//     margin: { top: 18mm, right: 16mm, bottom: 20mm, left: 16mm }
//     scale: 1
//     footer: true                   # page numbers + site title in the margin
//     css: ./.mdbook/pdf.css         # extra stylesheet appended last
//     timeout: 60000
//
// There is deliberately no `pdf: true`. Rendering needs the md2pdf service
// (docs/pdf-design.md), so naming the server IS the switch and the two can never
// disagree — the same shape `diagrams.plantumlServer` already uses, for the same
// reason: a feature that reaches out to another process is configured or absent,
// never defaulted to an endpoint nobody chose.
import fs from 'node:fs'
import path from 'node:path'

const SCOPES = ['page', 'book']

// `${VAR}` from the environment — a token belongs in the deployment, not in a
// config file, and is never written into the built site.
function fromEnv(value) {
  if (typeof value !== 'string') return value || null
  const m = /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value.trim())
  return m ? process.env[m[1]] || null : value
}

const LENGTH = /^\d+(\.\d+)?(mm|cm|in|px|pt)$/
const length = (v, fallback) => (typeof v === 'string' && LENGTH.test(v.trim()) ? v.trim() : fallback)

export function normalizePdf(data, projectRoot) {
  if (!data || data.enabled === false) return null
  const server = (fromEnv(data.server) || '').replace(/\/+$/, '')
  if (!server) return null

  const rawScope = data.scope == null ? SCOPES : [].concat(data.scope)
  const scope = rawScope.map((s) => String(s).toLowerCase()).filter((s) => SCOPES.includes(s))
  if (!scope.length) return null // `scope: []` is a deliberate off switch

  const m = data.margin || {}
  // Read at build time, not at request time: the file is part of the project
  // being built, and a deployment serving a pre-built dist has no access to it.
  let css = null
  if (data.css) {
    const p = path.resolve(projectRoot, data.css)
    if (fs.existsSync(p)) css = fs.readFileSync(p, 'utf8')
  }

  // A named theme's title block can carry a mark. It is read and inlined here
  // rather than sent as a URL: the renderer fetches nothing (docs/pdf-design.md
  // §3.4), so a URL would simply be a blocked request and a missing logo.
  let logo = null
  if (data.logo) {
    const p = path.resolve(projectRoot, data.logo)
    if (fs.existsSync(p)) {
      const ext = path.extname(p).toLowerCase()
      const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[ext]
      if (mime) logo = `data:${mime};base64,${fs.readFileSync(p).toString('base64')}`
    }
  }

  return {
    server,
    token: fromEnv(data.token) || null,
    scope,
    theme: data.theme || 'site',
    logo,
    logoPath: data.logo || null, // kept for the "configured but missing" warning
    numbered: data.numbered ?? true,
    footer: data.footer ?? true,
    format: data.format || 'A4',
    landscape: data.landscape === true,
    scale: typeof data.scale === 'number' ? data.scale : 1,
    margin: {
      top: length(m.top, '18mm'),
      right: length(m.right, '16mm'),
      bottom: length(m.bottom, '20mm'),
      left: length(m.left, '16mm')
    },
    css,
    cssPath: data.css || null, // kept for the "configured but missing" warning
    timeout: typeof data.timeout === 'number' ? data.timeout : 60000
  }
}

// What the theme is told. The server URL and the token never enter the bundle:
// the browser talks to `mdbook serve`, never to the renderer (docs/pdf-design.md §2).
export function pdfBundle(pdf) {
  return pdf ? { scope: pdf.scope } : null
}
