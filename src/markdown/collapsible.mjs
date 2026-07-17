// TermX / Wiki.js "insert" collapsible blocks:
//
//   +++ Summary text
//   ...markdown body...
//   +++
//
// renders to <details><summary>Summary text</summary> …body… </details>.
export function collapsible(md) {
  md.block.ruler.before('fence', 'collapsible', (state, startLine, endLine, silent) => {
    const start = state.bMarks[startLine] + state.tShift[startLine]
    const max = state.eMarks[startLine]
    const line = state.src.slice(start, max)

    const open = line.match(/^\+\+\+\s+(.*)$/)
    if (!open) return false
    if (silent) return true

    // Find the closing `+++`.
    let nextLine = startLine + 1
    let closeLine = -1
    for (; nextLine < endLine; nextLine++) {
      const s = state.bMarks[nextLine] + state.tShift[nextLine]
      const e = state.eMarks[nextLine]
      if (state.src.slice(s, e).trim() === '+++') {
        closeLine = nextLine
        break
      }
    }
    if (closeLine === -1) return false

    const summary = open[1].trim()

    let token = state.push('collapsible_open', 'details', 1)
    token.block = true
    token.map = [startLine, closeLine]

    token = state.push('collapsible_summary_open', 'summary', 1)
    const inline = state.push('inline', '', 0)
    inline.content = summary
    inline.map = [startLine, startLine + 1]
    inline.children = []
    state.push('collapsible_summary_close', 'summary', -1)

    // Tokenize the body lines between the markers.
    const oldParent = state.parentType
    const oldLineMax = state.lineMax
    state.lineMax = closeLine
    state.parentType = 'collapsible'
    state.md.block.tokenize(state, startLine + 1, closeLine)
    state.lineMax = oldLineMax
    state.parentType = oldParent

    state.push('collapsible_close', 'details', -1)
    state.line = closeLine + 1
    return true
  })

  md.renderer.rules.collapsible_open = () => '<details class="mdbook-collapsible">\n'
  md.renderer.rules.collapsible_close = () => '</details>\n'
  md.renderer.rules.collapsible_summary_open = () => '<summary>'
  md.renderer.rules.collapsible_summary_close = () => '</summary>\n'
}
