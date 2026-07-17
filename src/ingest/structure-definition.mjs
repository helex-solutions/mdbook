// Expands standalone `{{def:code; params}}` includes into the TermX
// StructureDefinition viewer web component, using the exported FHIR JSON
// (termx-server writes it to __source/resources/structure-definition/<code>.json).
//
//   {{def:EduPatient}}            -> <tx-sd-view data=… mode="diff">
//   {{def:tobacco-use; type=diff}}
//
// The <tx-sd-view> element is registered client-side by the theme (vendored
// @termx-health/structure-definition-viewer). Lines whose JSON is missing are
// left untouched, so the markdown include-card fallback still applies.
import fs from 'node:fs'
import path from 'node:path'

const DEF_RE = /^\{\{\s*def\s*:\s*([^};]+?)\s*(?:;\s*(.*?))?\s*\}\}$/gm

// Parse `type=diff; foo=bar` -> { type: 'diff', foo: 'bar' }.
function parseParams(s) {
  const out = {}
  for (const part of (s || '').split(';')) {
    const [k, v] = part.split('=').map((x) => x?.trim())
    if (k) out[k] = v ?? ''
  }
  return out
}

export function expandStructureDefinitions(text, sdDirs) {
  if (!text.includes('{{def:') && !text.includes('{{ def')) return text
  return text.replace(DEF_RE, (whole, code, paramStr) => {
    let raw = null
    for (const dir of sdDirs) {
      const p = path.join(dir, `${code}.json`)
      if (fs.existsSync(p)) {
        raw = fs.readFileSync(p, 'utf8')
        break
      }
    }
    if (!raw) return whole // keep the directive; include-card fallback handles it

    let data
    try {
      data = encodeURIComponent(JSON.stringify(JSON.parse(raw))) // minify + encode
    } catch {
      return whole
    }
    const mode = parseParams(paramStr).type || 'diff'
    return (
      `<div class="mdbook-sd">` +
      `<tx-sd-view data="${data}" mode="${mode}" inline="true"></tx-sd-view>` +
      `</div>`
    )
  })
}
