// A link to a folder's README.md reaches the folder's own page.
//
// Staging publishes every README.md as its folder's index.md (ingest/gitbook.mjs), so
// the page lives at `x/`. VitePress normalises content links itself and knows one
// index rule only — `index.md` becomes the folder URL — so a link written the way a
// repository reads, `x/README.md`, came out as `x/README`: a page that does not
// exist, on every site built from a plain doc tree, with nothing reporting it
// (ignoreDeadLinks is on). Handing VitePress the staged name leaves its own
// normalisation — base, cleanUrls, the anchor — in charge of the rest.
const EXTERNAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i
const README_RE = /^((?:[^?#]*\/)?)README\.md((?:[?#].*)?)$/i

export function readmeLinks(md) {
  const defaultRender =
    md.renderer.rules.link_open || ((tokens, idx, o, env, self) => self.renderToken(tokens, idx, o))

  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const hrefIdx = token.attrIndex('href')
    if (hrefIdx >= 0) {
      const href = token.attrs[hrefIdx][1]
      const m = !EXTERNAL_RE.test(href) && href.match(README_RE)
      if (m) token.attrs[hrefIdx][1] = `${m[1]}index.md${m[2]}`
    }
    return defaultRender(tokens, idx, options, env, self)
  }
}
