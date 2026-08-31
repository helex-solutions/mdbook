// Rewrites Owliki link schemes to real URLs.
//   page:<slug>            -> internal /<slug>            (clean URL, locale-aware)
//   page:<space>/<slug>    -> internal /<slug>
//   cs:<code>              -> <web>/resources/code-systems/<code>/summary
//   csv:<code>|<version>   -> …/code-systems/<code>/versions/<version>/summary
//   vs:<code> / vsv:…      -> …/value-sets/…
//   ms:<code> / msv:…      -> …/map-sets/…
//   concept:<cs>|<code>    -> …/code-systems/<cs>/concepts/<code>/view
//
// `web` (from space.json) is the wiki instance base for terminology links.
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

// Portal builds: which mount (space) a page belongs to, from the page's
// staging-relative path — an optional locale segment, then the mount.
export function mountFromPath(relativePath, { langs = [], mounts = [] } = {}) {
  const segs = String(relativePath || '').split('/')
  const first = langs.includes(segs[0]) ? segs[1] : segs[0]
  return mounts.includes(first) ? first : null
}

export function owlikiLinks(md, opts = {}) {
  const web = (opts.web || '').replace(/\/$/, '')
  const txServer = (opts.txServer || '').replace(/\/$/, '')
  const langPrefix = opts.langPrefix ? `/${opts.langPrefix}` : ''
  // Portal context: per-mount slug sets and space-code -> mount, so page:
  // links resolve within the page's own space and across mounted spaces.
  const portal = opts.portal
    ? {
        langs: opts.langs || [],
        mounts: Object.keys(opts.spaceSlugs || {}),
        slugs: Object.fromEntries(
          Object.entries(opts.spaceSlugs || {}).map(([m, v]) => [m, new Set(v)])
        ),
        byCode: opts.spaceMounts || {}
      }
    : null
  const ctx = { web, txServer, langPrefix, spaceCode: opts.spaceCode, pageSlugs: new Set(opts.pageSlugs || []) }
  const defaultRender =
    md.renderer.rules.link_open || ((tokens, idx, o, env, self) => self.renderToken(tokens, idx, o))

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const hrefIdx = token.attrIndex('href')
    if (hrefIdx >= 0) {
      const raw = decodeURIComponent(token.attrs[hrefIdx][1])
      const mount = portal ? mountFromPath(env?.relativePath, portal) : null
      const resolved = resolve(raw, { ...ctx, portal, mount })
      if (resolved != null) token.attrs[hrefIdx][1] = resolved
    }
    return defaultRender(tokens, idx, options, env, self)
  }
}

// FHIR resource type per link scheme (used when only txServer is configured).
const FHIR_TYPE = { cs: 'CodeSystem', csv: 'CodeSystem', vs: 'ValueSet', vsv: 'ValueSet', ms: 'ConceptMap', msv: 'ConceptMap' }

function resolve(href, ctx) {
  const { web, txServer, langPrefix, spaceCode, pageSlugs, portal, mount } = ctx
  const m = href.match(/^([a-z]+):(.+)$/i)
  if (!m) return null
  const scheme = m[1].toLowerCase()
  const value = m[2]

  if (scheme === 'page') {
    // page:space/slug -> another space; page:slug -> this space.
    if (value.includes('/')) {
      const [space, ...rest] = value.split('/')
      const slug = rest.join('/')
      // On a portal a cross-space link stays internal when that space is mounted.
      const target = portal && (portal.byCode[space] || (portal.slugs[space] && space))
      if (target && portal.slugs[target]?.has(slug)) return `/${target}/${slug}`
      return web ? `${web}/wiki/${space}/${slug}` : `${langPrefix}/${slug}`.replace(/\/+/g, '/')
    }
    // Same-space: internal link when the page exists in this build; otherwise
    // fall back to the page in the live wiki.
    if (portal && mount) {
      if (portal.slugs[mount]?.has(value)) return `/${mount}/${value}`
      if (web && spaceCode) return `${web}/wiki/${spaceCode}/${value}`
      return `/${mount}/${value}`
    }
    if (pageSlugs.has(value)) return `${langPrefix}/${value}`.replace(/\/+/g, '/')
    if (web && spaceCode) return `${web}/wiki/${spaceCode}/${value}`
    return `${langPrefix}/${value}`.replace(/\/+/g, '/')
  }

  // Prefer the Helex TX web UI (nice pages); fall back to FHIR resource URLs on
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
