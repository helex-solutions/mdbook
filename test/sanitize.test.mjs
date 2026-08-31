import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hardenMarkdown, MDBOOK_ELEMENTS } from '../src/ingest/sanitize.mjs'

test('hardenMarkdown: escapes non-HTML tags used as prose placeholders', () => {
  const out = hardenMarkdown('Return a `<Patient>` — actually <Patient> and <Registry name>.')
  assert.match(out, /&lt;Patient/, 'PascalCase component-like tag is escaped')
  assert.match(out, /&lt;Registry name>/, 'multi-word placeholder tag is escaped')
  assert.match(out, /`<Patient>`/, 'the same tag inside inline code is left untouched')
})

test('hardenMarkdown: neutralizes a stray/unbalanced end tag', () => {
  assert.match(hardenMarkdown('text\n</content>\n'), /&lt;\/content>/)
  assert.match(hardenMarkdown('done </invoke>'), /&lt;\/invoke>/)
})

test('hardenMarkdown: keeps real HTML elements intact', () => {
  const out = hardenMarkdown('Line<br/>break\n\n<details>\n<summary>x</summary>\n</details>\n\n<a id="anchor">y</a>')
  assert.match(out, /<br\/>/, '<br> is kept')
  assert.match(out, /<details>/, '<details> is kept')
  assert.match(out, /<summary>/, '<summary> is kept')
  assert.match(out, /<a id="anchor">/, '<a> is kept')
})

test('hardenMarkdown: neutralizes Vue {{ }} interpolation but preserves Owliki embeds', () => {
  const out = hardenMarkdown('Title with {{version}} and {{ name }}.\n\nSee {{def:my-sd}} and {{csc:x}}.')
  assert.doesNotMatch(out, /\{\{version\}\}/, 'generic interpolation is defused')
  assert.doesNotMatch(out, /\{\{ name \}\}/, 'spaced interpolation is defused')
  assert.match(out, /\{\{def:my-sd\}\}/, 'Owliki {{def:}} embed is preserved')
  assert.match(out, /\{\{csc:x\}\}/, 'Owliki {{csc:}} embed is preserved')
})

test('hardenMarkdown: leaves fenced code and autolinks alone', () => {
  const src = '```js\nconst x = <T>foo() // {{keep}}\n```\n\nVisit <https://example.com> and <a@b.com>.'
  const out = hardenMarkdown(src)
  assert.match(out, /<T>foo\(\) \/\/ \{\{keep\}\}/, 'code fence content is untouched')
  assert.match(out, /<https:\/\/example\.com>/, 'URL autolink is untouched')
  assert.match(out, /<a@b\.com>/, 'email autolink is untouched')
})

test('hardenMarkdown: does not touch frontmatter', () => {
  const out = hardenMarkdown('---\ntitle: "A {{x}} <Thing>"\n---\n\nBody <Thing> and {{x}}.')
  assert.match(out, /title: "A \{\{x\}\} <Thing>"/, 'frontmatter is preserved verbatim')
  assert.match(out, /&lt;Thing> and &#123;&#123;x&#125;&#125;/, 'body is still hardened')
})

test('hardenMarkdown: a declared custom element survives, an undeclared one does not', () => {
  // The exemption list is empty, and the pair it belongs to is what matters: a tag
  // exempted here but not declared to Vue (or the reverse) renders as escaped
  // literal markup. This pins the mechanism so the next element that needs it
  // cannot be added to only one half.
  assert.match(hardenMarkdown('<my-widget a="1"></my-widget>'), /&lt;my-widget/, 'undeclared is escaped')
  MDBOOK_ELEMENTS.add('my-widget')
  try {
    assert.match(hardenMarkdown('<my-widget a="1"></my-widget>'), /<my-widget a="1">/, 'declared survives')
  } finally {
    MDBOOK_ELEMENTS.delete('my-widget')
  }
})
