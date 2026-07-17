// Expands TermX `{{csc:…}}` / `{{vsc:…}}` include directives into concept tables
// by fetching from a FHIR terminology server at build time (config `txServer`).
//
//   {{csc:code|version; properties=display,code; langs=en; limit=10}}
//   {{vsc:code|version; properties=display,code; langs=en; limit=10}}
//
// Uses standard FHIR (as the Terminology eXplorer does):
//   VSC -> GET {txServer}/ValueSet/{code}/$expand?count=N&includeDesignations=true
//          -> expansion.contains[]
//   CSC -> GET {txServer}/CodeSystem/{code}  (inline concept[] when content=complete)
//
// On any failure the directive is left untouched, so the include-card fallback
// still applies.
import fs from 'node:fs'
import { walkMarkdown } from './util.mjs'

const CSC_RE = /\{\{\s*csc\s*:\s*([^};]+?)\s*(?:;\s*(.*?))?\s*\}\}/g
const VSC_RE = /\{\{\s*vsc\s*:\s*([^};]+?)\s*(?:;\s*(.*?))?\s*\}\}/g

function parseParams(s) {
  const out = {}
  for (const part of (s || '').split(';')) {
    const [k, v] = part.split('=').map((x) => x?.trim())
    if (k) out[k] = v ?? ''
  }
  return out
}

async function fetchJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { headers: { Accept: 'application/fhir+json' }, signal: ctrl.signal })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

// Value of one property column for a concept/expansion item.
function cellValue(item, prop, langs) {
  if (prop === 'code') return item.code || ''
  const designations = item.designation || []
  const byLang = (ds) => (langs?.length ? ds.filter((d) => langs.includes(d.language)) : ds)
  if (prop === 'display') {
    const disp = byLang(designations.filter((d) => d.use?.code === 'display')).map((d) => d.value)
    return (disp.length ? [...new Set(disp)] : [item.display]).filter(Boolean).join(' / ')
  }
  if (prop === 'definition') return item.definition || ''
  // other property: a designation with that use, else a concept.property
  const dz = byLang(designations.filter((d) => d.use?.code === prop)).map((d) => d.value)
  if (dz.length) return [...new Set(dz)].join(' / ')
  const pv = (item.property || []).find((p) => p.code === prop)
  if (pv) return pv.valueString ?? pv.valueCode ?? pv.valueBoolean ?? pv.valueInteger ?? ''
  return ''
}

function renderTable(kind, code, items, properties, langs) {
  const cols = properties.length ? properties : ['code', 'display']
  const head = cols.map((c) => `<th>${esc(c)}</th>`).join('')
  const rows = items
    .map((it) => `<tr>${cols.map((c) => `<td>${esc(cellValue(it, c, langs))}</td>`).join('')}</tr>`)
    .join('')
  return (
    `<div class="mdbook-concept-matrix" data-kind="${kind}" data-code="${esc(code)}">` +
    `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>` +
    `</div>`
  )
}

// Resolve one directive to a table (or null to keep the directive).
async function expandOne(kind, code, version, params, txServer) {
  const limit = Number(params.limit) || 50
  const properties = (params.properties || 'code,display').split(',').map((s) => s.trim())
  const langs = params.langs ? params.langs.split(',').map((s) => s.trim()) : []

  let items = null
  if (kind === 'vsc') {
    const vs = await fetchJson(
      `${txServer}/ValueSet/${encodeURIComponent(code)}/$expand?count=${limit}&includeDesignations=true`
    )
    items = vs?.expansion?.contains?.slice(0, limit)
  } else {
    const cs = await fetchJson(`${txServer}/CodeSystem/${encodeURIComponent(code)}`)
    items = cs?.concept?.slice(0, limit)
  }
  if (!items?.length) return null
  return renderTable(kind, code, items, properties, langs)
}

export async function expandConceptMatrices(staging, txServer) {
  if (!txServer) return
  const cache = new Map()
  const files = walkMarkdown(staging, { exclude: ['node_modules', 'public'] })

  for (const file of files) {
    let text = fs.readFileSync(file, 'utf8')
    if (!/\{\{\s*(csc|vsc)\s*:/.test(text)) continue
    let changed = false

    for (const [kind, RE] of [['csc', CSC_RE], ['vsc', VSC_RE]]) {
      const matches = [...text.matchAll(RE)]
      for (const m of matches) {
        const [whole, idv, paramStr] = m
        const [code, version] = idv.split('|').map((s) => s.trim())
        const key = `${kind}:${idv}:${paramStr || ''}`
        if (!cache.has(key)) {
          cache.set(key, await expandOne(kind, code, version, parseParams(paramStr), txServer))
        }
        const html = cache.get(key)
        if (html) {
          text = text.replace(whole, html)
          changed = true
        }
      }
    }
    if (changed) fs.writeFileSync(file, text)
  }
}
