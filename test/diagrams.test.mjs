import { test } from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import plantumlEncoder from 'plantuml-encoder'
import { applyMarkdown } from '../src/markdown/index.mjs'

function render(src, opts = {}) {
  const md = new MarkdownIt({ html: true })
  applyMarkdown(md, opts)
  return md.render(src)
}

const UML = '```plantuml\nAlice -> Bob: hi\n```\n'

test('plantuml: with no server configured nothing is fetched and the source stays readable', () => {
  const out = render(UML)
  assert.doesNotMatch(out, /<img/, 'no third-party image reference is emitted')
  assert.doesNotMatch(out, /https?:/, 'no URL at all')
  assert.match(out, /Alice -&gt; Bob: hi/, 'the fence renders as a code block')
})

test('plantuml: a configured server gets the deflate+base64 encoding of the source', () => {
  const out = render(UML, { plantumlServer: 'https://uml.example.org/plantuml' })
  const expected = plantumlEncoder.encode('@startuml\nAlice -> Bob: hi\n@enduml')
  assert.match(out, new RegExp(`src="https://uml\\.example\\.org/plantuml/svg/${expected}"`))
})

test('plantuml: @startuml/@enduml are added only when the source carries no @start marker', () => {
  const server = 'https://uml.example.org/plantuml'
  const explicit = render('```plantuml\n@startgantt\n[x] lasts 2 days\n@endgantt\n```\n', {
    plantumlServer: server
  })
  const asWritten = plantumlEncoder.encode('@startgantt\n[x] lasts 2 days\n@endgantt')
  assert.match(explicit, new RegExp(`/svg/${asWritten}"`), 'an explicit @start is passed through')
})

test('plantuml: a server quoted with its /svg suffix is not doubled', () => {
  const out = render(UML, { plantumlServer: 'https://uml.example.org/plantuml/svg/' })
  assert.match(out, /src="https:\/\/uml\.example\.org\/plantuml\/svg\/[^/"]+"/)
})

test('mermaid: the fence is carried to the client escaped, with a readable fallback', () => {
  const out = render('```mermaid\nflowchart LR\n  A["<img src=x onerror=alert(1)>"] --> B\n```\n')
  assert.match(out, /<div class="mermaid-diagram" data-src="/)
  assert.doesNotMatch(out, /<img src=x/, 'the source never reaches the document as markup')
  assert.match(out, /<pre v-pre class="mermaid-fallback">/, 'and stays legible if the chunk fails')
})
