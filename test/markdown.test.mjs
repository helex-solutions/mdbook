import { test } from 'node:test'
import assert from 'node:assert/strict'
import MarkdownIt from 'markdown-it'
import { applyMarkdown } from '../src/markdown/index.mjs'

function render(src) {
  const md = new MarkdownIt({ html: true })
  applyMarkdown(md, {})
  return md.render(src)
}

test('tableAttrs: {.dense} after a multimd (colspan) table attaches to the table', () => {
  // `| 1 ||` is a multimd colspan cell, which markdown-it-attrs can't attach to.
  const out = render('| a | b |\n|---|---|\n| 1 ||\n{.dense}\n')
  assert.match(out, /<table[^>]*class="[^"]*\bdense\b/, 'table carries the dense class')
  assert.doesNotMatch(out, /\{\.dense\}/, 'the orphan marker is not left as literal text')
})

test('tableAttrs: a {.dense} not after a table is left to markdown-it-attrs (no table touched)', () => {
  const out = render('Some text\n\n{.dense}\n')
  assert.doesNotMatch(out, /<table/, 'no table is involved')
  assert.match(out, /Some text/, 'surrounding content is preserved')
})

test('cardGrid: {.card-grid} list becomes cards with cover, title, description and buttons', () => {
  const src = [
    '- ![](/.gitbook/assets/base.png)',
    '  ### LT Base',
    '  Core Lithuanian FHIR Implementation Guide.',
    '  [Latest Build](https://build.fhir.org/ig/HL7LT/ig-lt-base){.button}',
    '  [History](https://hl7.lt/fhir/base/history.html){.button .secondary}',
    '{.card-grid}',
    ''
  ].join('\n')
  const out = render(src)
  assert.match(out, /<div class="mdbook-cards">/, 'wrapper is rendered')
  assert.match(out, /<div class="mdbook-card">/, 'a card is rendered')
  assert.match(out, /class="mdbook-card-cover"[^>]*src="\/\.gitbook\/assets\/base\.png"/, 'cover image')
  assert.match(out, /<div class="mdbook-card-title">LT Base<\/div>/, 'title from heading')
  assert.match(out, /Core Lithuanian FHIR Implementation Guide\./, 'description text')
  assert.match(out, /<a href="https:\/\/build\.fhir\.org\/ig\/HL7LT\/ig-lt-base" class="mdbook-card-btn">Latest Build<\/a>/, 'primary button')
  assert.match(out, /class="mdbook-card-btn secondary"[^>]*>History<\/a>/, 'secondary button')
  assert.doesNotMatch(out, /<ul/, 'the source list is fully consumed')
})

test('attrs: a trailing {word} in prose does not become an empty HTML attribute', () => {
  // Docs written for other renderers end headings/lines with API params like
  // `{id}` — markdown-it-attrs would turn those into empty attributes, and a
  // duplicate empty `id` crashes VitePress. They must be dropped.
  const out = render('# GET /api/x/{id}\n\n## GET /api/y/{id}\n\ntext ending {recordingId}\n')
  assert.doesNotMatch(out, /id=""/, 'no empty id attribute is emitted')
  assert.doesNotMatch(out, /recordingId/, 'a bare placeholder word is not turned into an attribute')
})

test('attrs: real {.class}/{#id}/{k=v} attributes still apply', () => {
  const out = render('# Heading {.foo #bar}\n\ntext {width=800}\n')
  assert.match(out, /<h1[^>]*class="foo"/, 'class applies')
  assert.match(out, /<h1[^>]*id="bar"/, 'non-empty id applies')
  assert.match(out, /width="800"/, 'key=value applies')
})

test('attrs: an image keeps its (legitimately empty) alt attribute', () => {
  const out = render('![](/x.png)\n')
  assert.match(out, /<img[^>]*alt=""/, 'empty alt is preserved for images')
})

test('cardGrid: extra classes (e.g. cards-row) pass through to the wrapper', () => {
  const src = ['- ### A', '  text', '{.card-grid .cards-row}', ''].join('\n')
  const out = render(src)
  assert.match(out, /<div class="mdbook-cards cards-row">/, 'wrapper carries the extra class')
})

test('cardGrid: a plain list without {.card-grid} is untouched', () => {
  const out = render('- one\n- two\n')
  assert.match(out, /<ul>/, 'ordinary list is left alone')
  assert.doesNotMatch(out, /mdbook-cards/, 'no card grid produced')
})

// A link written the way a repository reads — x/README.md — must reach the folder page. Staging
// publishes README.md as index.md, and VitePress turns only index.md into the folder URL, so the
// renderer hands it the staged name. Without this, x/README.md rendered as a missing x/README.
test('readmeLinks: a link to a README.md targets the staged index.md', () => {
  const href = (src) => render(src).match(/href="([^"]*)"/)[1]
  assert.equal(href('[m](manuals/README.md)'), 'manuals/index.md')
  assert.equal(href('[up](../README.md#part)'), '../index.md#part', 'the anchor is kept')
  assert.equal(href('[here](README.md)'), 'index.md')
  assert.equal(href('[abs](/specs/tedy/README.md)'), '/specs/tedy/index.md')
})

test('readmeLinks: other links are left alone', () => {
  const href = (src) => render(src).match(/href="([^"]*)"/)[1]
  assert.equal(href('[ext](https://github.com/o/r/blob/main/README.md)'), 'https://github.com/o/r/blob/main/README.md')
  assert.equal(href('[page](other.md)'), 'other.md')
  assert.equal(href('[near](READMEs.md)'), 'READMEs.md')
  assert.equal(href('[folder](manuals/)'), 'manuals/')
})
