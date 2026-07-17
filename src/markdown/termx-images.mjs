// Rewrites TermX attachment image references.
//   ![alt](files/<pageId>/<file>)  ->  <assetBase>/<pageId>/<file>
// Attachments are exported by termx-server to `attachments/<pageId>/<file>`;
// mdbook stages them under a public assets dir. `assetBase` defaults to
// `/attachments` (served from the site root).
const FILE_RE = /^files\/(\d+)\/(.+)$/

export function termxImages(md, opts = {}) {
  const assetBase = (opts.assetBase || '/attachments').replace(/\/$/, '')
  const defaultRender =
    md.renderer.rules.image || ((tokens, idx, o, env, self) => self.renderToken(tokens, idx, o))

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx]
    const srcIdx = token.attrIndex('src')
    if (srcIdx >= 0) {
      const src = token.attrs[srcIdx][1]
      const m = src.match(FILE_RE)
      if (m) token.attrs[srcIdx][1] = `${assetBase}/${m[1]}/${m[2]}`
    }
    return defaultRender(tokens, idx, options, env, self)
  }
}
