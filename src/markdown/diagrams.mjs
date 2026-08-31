// Renders Owliki diagram fences, mirroring the wiki's own renderer
// (helex-tx `modules/owliki/frontend/src/components/markdown.ts`):
//   ```drawio    <base64-svg>       -> inline <img> from a data: URI
//   ```plantuml  <uml source>       -> <img> from the configured PlantUML server
//   ```mermaid   <mermaid source>   -> <div> rendered client-side by mermaid
import plantumlEncoder from 'plantuml-encoder'

// Register a block rule that captures a ```<lang> … ``` fence and emits a
// custom token. `render(content)` returns the HTML string for that token.
function fencedBlock(md, lang, type, render) {
  const openRe = new RegExp('^```\\s*' + lang + '\\s*$')

  md.block.ruler.before('fence', type, (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine]
    const line = state.src.slice(start, state.eMarks[startLine])
    if (!openRe.test(line.trim())) return false

    let closeLine = -1
    for (let n = startLine + 1; n < endLine; n++) {
      const s = state.bMarks[n] + state.tShift[n]
      if (state.src.slice(s, state.eMarks[n]).trim() === '```') {
        closeLine = n
        break
      }
    }
    if (closeLine === -1) return false
    if (silent) return true

    const lines = []
    for (let n = startLine + 1; n < closeLine; n++) {
      lines.push(state.src.slice(state.bMarks[n], state.eMarks[n]))
    }
    const token = state.push(type, '', 0)
    token.content = lines.join('\n')
    token.block = true
    token.map = [startLine, closeLine]
    state.line = closeLine + 1
    return true
  })

  md.renderer.rules[type] = (tokens, idx) => render(tokens[idx].content)
}

export function diagrams(md, opts = {}) {
  const esc = md.utils.escapeHtml
  // No default: an unset server means the fence renders as a code block (below).
  // A trailing `/svg` is tolerated — that is how the endpoint is usually quoted.
  const plantumlServer = (opts.plantumlServer || '').replace(/\/+$/, '').replace(/\/svg$/, '') || null

  // drawio: the fence body is base64-encoded SVG.
  fencedBlock(md, 'drawio', 'drawio', (content) => {
    const b64 = content.trim()
    return `<div class="mdbook-drawio"><img class="drawio" src="data:image/svg+xml;base64,${b64}" alt="diagram"></div>`
  })

  // plantuml: rendering means sending the fence — untrusted page content — to a
  // PlantUML server, and every reader's browser fetching the picture back from
  // it. So the server is CONFIGURED or there is none: with none, the fence is a
  // code block and the build makes no third-party reference at all. Same rule as
  // the wiki's own renderer, which reads it from `PLANTUML_URL`.
  //
  // The fence is consumed either way rather than left to markdown-it: `plantuml`
  // is not a language Shiki knows, and an unknown fence language hard-fails the
  // VitePress build.
  fencedBlock(md, 'plantuml', 'plantuml', (content) => {
    const plain = () =>
      `<div class="mdbook-plantuml-source"><pre v-pre><code>${esc(content)}</code></pre></div>`
    if (!plantumlServer) return plain()
    // The wiki's reference renderer wraps the source in @startuml/@enduml, so
    // content written for it carries neither marker. Add them only when absent —
    // an explicit @startgantt/@startmindmap still works.
    const body = /^\s*@start/.test(content) ? content : `@startuml\n${content}\n@enduml`
    let encoded
    try {
      encoded = plantumlEncoder.encode(body)
    } catch {
      return plain()
    }
    const src = `${plantumlServer}/svg/${encoded}`
    return `<div class="mdbook-plantuml"><img class="plantuml" src="${esc(src)}" alt="PlantUML diagram" loading="lazy"></div>`
  })

  // mermaid: rendered client-side; source carried url-encoded to stay Vue-safe.
  fencedBlock(md, 'mermaid', 'mermaid', (content) => {
    return `<div class="mermaid-diagram" data-src="${encodeURIComponent(content)}"><pre v-pre class="mermaid-fallback">${esc(content)}</pre></div>`
  })
}
