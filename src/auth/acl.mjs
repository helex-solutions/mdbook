// ACL model shared by the build (which resolves and emits acl.json), the serve
// command (which enforces it) and the theme (which cosmetically filters menus).
// Pure functions only — this module is bundled into the client, so no node deps.
//
// Access requirement values: 'public' | 'authenticated' | [role, …].
// Resolution order for a page: frontmatter override -> longest matching rule
// -> site default (Confluence-style: the page override replaces the rule).

// A rule `path` uses the source glob convention: `*` within a path segment,
// `**` across segments; matched against the staged path (e.g. `internal/x.md`)
// both with and without a leading locale segment, so one rule covers every
// translation of a section.
export function ruleRegex(pattern) {
  const norm = String(pattern).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '').replace(/\/+$/, '')
  const esc = norm
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    // One pass, `**` first. Expanding `*` first and parking `**` behind a
    // placeholder needs a character no path can contain — a space was used, so
    // a rule on a path that has one (`my docs/**`) had that space rewritten to
    // `.*` and silently gated more than it named.
    .replace(/\*\*|\*/g, (m) => (m === '**' ? '.*' : '[^/]*'))
  // Optional single leading locale segment (e.g. `de/`), then the pattern; a
  // directory pattern also matches everything beneath it.
  return new RegExp(`^(?:[a-z]{2}(?:-[A-Za-z0-9]+)?/)?${esc}(?:/.*)?$`)
}

// Effective access for one staged file. `pageAccess` is the page's own
// override (frontmatter / pages.json), `rules` come from config (already
// sorted most-specific-first), `siteDefault` is auth.access.
export function resolveAccess(dest, { pageAccess = null, rules = [], siteDefault = 'public' } = {}) {
  if (pageAccess) return pageAccess
  const rel = String(dest).replace(/\.(md|html)$/i, '')
  for (const r of rules) {
    const re = r._re || (r._re = ruleRegex(r.path))
    if (re.test(rel) || re.test(dest)) return r.access
  }
  return siteDefault
}

// Site route for a staged file: `internal/page.md` -> `/internal/page`,
// `de/index.md` -> `/de/`. Base-relative (no site base prefix).
export function routeForDest(dest) {
  let p = String(dest).replace(/\\/g, '/').replace(/\.(md|html)$/i, '')
  p = p.replace(/(^|\/)index$/, '$1')
  return '/' + p
}

const isProtected = (access) => access && access !== 'public'

// Build the acl.json manifest. `entries` = [{dest, access}], `assets` =
// [{prefix, access}] (already protected-only), `rules` from config.
export function buildAclManifest({ entries = [], rules = [], assets = [], siteDefault = 'public' }) {
  const pages = {}
  for (const e of entries) {
    if (isProtected(e.access)) pages[routeForDest(e.dest)] = e.access
  }
  return {
    default: siteDefault,
    rules: rules.map((r) => ({ path: r.path, access: r.access })),
    pages,
    assets: assets.filter((a) => isProtected(a.access))
  }
}

// Requirement for a request route ('/internal/page', '/attachments/42/x.png').
// Mirrors resolveAccess, but over the manifest: exact page -> asset prefix ->
// longest rule -> default. serve() and the theme both call this.
export function requirementFor(manifest, route) {
  if (!manifest) return 'public'
  let r = String(route)
  if (!r.startsWith('/')) r = '/' + r
  r = r.replace(/\.html$/i, '').replace(/\/index$/, '/')
  // The sign-in machinery is never content, so it never inherits the site
  // default. It used to: on a site whose default is a role, `/auth/signed-out`
  // required that role, so signing out bounced the (now anonymous) reader
  // straight back to the login page instead of showing that they had signed
  // out. These pages carry no documentation — only the words on them.
  if (r === '/auth' || r.startsWith('/auth/')) return 'public'
  const page = manifest.pages?.[r] ?? manifest.pages?.[r.replace(/\/$/, '') || '/']
  if (page) return page
  for (const a of manifest.assets || []) {
    if (r.startsWith(a.prefix)) return a.access
  }
  const rel = r.replace(/^\//, '')
  const rules = [...(manifest.rules || [])].sort((a, b) => b.path.length - a.path.length)
  for (const rule of rules) {
    const re = rule._re || (rule._re = ruleRegex(rule.path))
    if (re.test(rel)) return rule.access
  }
  return manifest.default || 'public'
}

// Does a session (null when anonymous, else {roles: []}) meet a requirement?
export function isAllowed(requirement, session) {
  if (!requirement || requirement === 'public') return true
  if (!session) return false
  if (requirement === 'authenticated') return true
  const roles = session.roles || []
  return requirement.some((r) => roles.includes(r))
}

// Read an `access:` value from a markdown file's leading frontmatter without a
// full YAML parse (the block may be hand-written and imperfect — the same
// stance the GitBook ingester takes). Accepts scalar, flow array and the
// two-space dash list.
export function readAccessFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text))
  if (!m) return null
  const block = m[1]
  const line = /^access:[ \t]*(.*)$/m.exec(block)
  if (!line) return null
  const value = line[1].trim()
  if (value.startsWith('[')) {
    const inner = value.replace(/^\[/, '').replace(/\]$/, '')
    const roles = inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    return roles.length ? roles : null
  }
  if (value) {
    const v = value.replace(/^['"]|['"]$/g, '')
    return v === 'public' || v === 'authenticated' ? v : v ? [v] : null
  }
  // Dash list on the following lines.
  const rest = block.slice(line.index + line[0].length)
  const roles = []
  for (const l of rest.split(/\r?\n/)) {
    const item = /^[ \t]+-[ \t]*(.+)$/.exec(l)
    if (item) roles.push(item[1].trim().replace(/^['"]|['"]$/g, ''))
    else if (l.trim() === '' && !roles.length) continue
    else break
  }
  return roles.length ? roles : null
}

// Which pages may go into the local search index.
//
// The index ships as ONE static chunk (`assets/chunks/@localSearchIndex*.js`),
// so everyone who can fetch that chunk can read the title and body text of
// every page inside it. `serve` gates the chunk like any other file, and
// `SEARCH_INDEX_PREFIX` is pinned in the manifest at the site default — so the
// chunk's audience is exactly "sessions that satisfy the site default".
//
// A page is therefore safe to index only when every session that can fetch the
// chunk can also open the page: the page must be no stricter than the site
// default. Excluding protected pages outright (v1) was safe but left a wholly
// gated site with an empty index — nothing was public, so nothing was indexed.
//
// Both arguments are 'public' | 'authenticated' | [role, …].
export function isSearchable(access, siteDefault) {
  const page = access || 'public'
  const chunk = siteDefault || 'public'
  // A public page is readable by everyone, so it is safe in any chunk.
  if (page === 'public') return true
  // A public chunk can hold nothing but public pages.
  if (chunk === 'public') return false
  // The chunk needs at least a session, and any session satisfies the page.
  if (page === 'authenticated') return true
  // The page needs roles the chunk does not ask for.
  if (chunk === 'authenticated') return false
  // Both are role sets: every role that opens the chunk must also open the page.
  return chunk.every((r) => page.includes(r))
}

// Prefix of the generated search-index chunk, pinned in acl.json so the chunk's
// requirement is the site default whatever else the rules say.
export const SEARCH_INDEX_PREFIX = '/assets/chunks/@localSearchIndex'
