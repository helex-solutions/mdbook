// Renders TermX diagram fences, mirroring the termx-web wiki plugins:
//   ```drawio    <base64-svg>       -> inline <img> from a data: URI
//   ```plantuml  <uml source>       -> <img> from the PlantUML server
//   ```mermaid   <mermaid source>   -> <div> rendered client-side by mermaid
import plantumlEncoder from 'plantuml-encoder'

const PLANTUML_SERVER = 'https://www.plantuml.com/plantuml/svg'

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
  const plantumlServer = opts.plantumlServer || PLANTUML_SERVER

  // drawio: the fence body is base64-encoded SVG.
  fencedBlock(md, 'drawio', 'drawio', (content) => {
    const b64 = content.trim()
    return `<div class="mdbook-drawio"><img class="drawio" src="data:image/svg+xml;base64,${b64}" alt="diagram"></div>`
  })

  // plantuml: encode the source for the PlantUML server.
  fencedBlock(md, 'plantuml', 'plantuml', (content) => {
    let encoded
    try {
      encoded = plantumlEncoder.encode(content)
    } catch {
      return `<pre>${esc(content)}</pre>`
    }
    return `<div class="mdbook-plantuml"><img class="plantuml" src="${plantumlServer}/${encoded}" alt="PlantUML diagram" loading="lazy"></div>`
  })

  // mermaid: rendered client-side; source carried url-encoded to stay Vue-safe.
  fencedBlock(md, 'mermaid', 'mermaid', (content) => {
    return `<div class="mermaid-diagram" data-src="${encodeURIComponent(content)}"><pre v-pre class="mermaid-fallback">${esc(content)}</pre></div>`
  })
}
