// Rewrites TermX Wiki link schemes to real URLs.
//   page:<slug>            -> internal /<slug>            (clean URL, locale-aware)
//   page:<space>/<slug>    -> internal /<slug>
//   cs:<code>              -> <web>/resources/code-systems/<code>/summary
//   csv:<code>|<version>   -> …/code-systems/<code>/versions/<version>/summary
//   vs:<code> / vsv:…      -> …/value-sets/…
//   ms:<code> / msv:…      -> …/map-sets/…
//   concept:<cs>|<code>    -> …/code-systems/<cs>/concepts/<code>/view
//
// `web` (from space.json) is the TermX instance base for terminology links.
// `langPrefix` prefixes internal page links for non-default locales.
const RESOURCE = {
  cs: (v) => `resources/code-systems/${v}/summary`,
  vs: (v) => `resources/value-sets/${v}/summary`,
  ms: (v) => `resources/map-sets/${v}/summary`,
  csv: (v) => withVersion('code-systems', v),
  vsv: (v) => withVersion('value-sets', v),
  msv: (v) => withVersion('map-sets', v)
}

function withVersion(kind, v) {
  const [code, version] = v.split('|')
  return `resources/${kind}/${code}/versions/${version}/summary`
}

export function termxLinks(md, opts = {}) {
  const web = (opts.web || '').replace(/\/$/, '')
  const txServer = (opts.txServer || '').replace(/\/$/, '')
  const langPrefix = opts.langPrefix ? `/${opts.langPrefix}` : ''
  const defaultRender =
    md.renderer.rules.link_open || ((tokens, idx, o, env, self) => self.renderToken(tokens, idx, o))

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const hrefIdx = token.attrIndex('href')
    if (hrefIdx >= 0) {
      const raw = decodeURIComponent(token.attrs[hrefIdx][1])
      const resolved = resolve(raw, web, txServer, langPrefix)
      if (resolved != null) token.attrs[hrefIdx][1] = resolved
    }
    return defaultRender(tokens, idx, options, env, self)
  }
}

// FHIR resource type per link scheme (used when only txServer is configured).
const FHIR_TYPE = { cs: 'CodeSystem', csv: 'CodeSystem', vs: 'ValueSet', vsv: 'ValueSet', ms: 'ConceptMap', msv: 'ConceptMap' }

function resolve(href, web, txServer, langPrefix) {
  const m = href.match(/^([a-z]+):(.+)$/i)
  if (!m) return null
  const scheme = m[1].toLowerCase()
  const value = m[2]

  if (scheme === 'page') {
    const slug = value.includes('/') ? value.split('/').pop() : value
    return `${langPrefix}/${slug}`.replace(/\/+/g, '/')
  }

  // Prefer the TermX web UI (nice pages); fall back to FHIR resource URLs on
  // txServer when no web UI base is configured.
  if (scheme === 'concept') {
    const [cs, code] = value.split('|')
    if (web) {
      if (cs === 'snomed-ct') return `${web}/integration/snomed/dashboard/${code}`
      return `${web}/resources/code-systems/${cs}/concepts/${code}/view`
    }
    if (txServer) return `${txServer}/CodeSystem/${cs}`
    return null
  }
  if (scheme === 'namespace') {
    const [ns] = value.split('|')
    return web ? `${web}/resources/namespaces/${ns}` : null
  }
  if (RESOURCE[scheme]) {
    if (web) return `${web}/${RESOURCE[scheme](value)}`
    if (txServer && FHIR_TYPE[scheme]) return `${txServer}/${FHIR_TYPE[scheme]}/${value.split('|')[0]}`
    return null
  }
  return null // http(s), mailto, etc. — leave untouched
}
