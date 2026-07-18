import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deriveDescription, applySeoFrontmatter } from '../src/ingest/seo.mjs'

test('deriveDescription: first prose paragraph, markdown stripped', () => {
  const md = '# Title\n\nThis is the **first** paragraph with a [link](http://x).\n\nSecond.'
  assert.equal(deriveDescription(md), 'This is the first paragraph with a link.')
})

test('deriveDescription: skips frontmatter and a leading image', () => {
  const md = '---\nfoo: bar\n---\n![alt](files/1/x.png)\n\nReal text here.'
  assert.equal(deriveDescription(md), 'Real text here.')
})

test('deriveDescription: skips fenced code', () => {
  assert.equal(deriveDescription('```\ncode\n```\n\nProse after code.'), 'Prose after code.')
})

test('deriveDescription: truncates to max with an ellipsis', () => {
  const d = deriveDescription('word '.repeat(60), 40)
  assert.ok(d.length <= 41)
  assert.ok(d.endsWith('…'))
})

test('applySeoFrontmatter: injects when there is no frontmatter', () => {
  const out = applySeoFrontmatter('Body', { title: 'T', description: 'D' })
  assert.equal(out, '---\ntitle: "T"\ndescription: "D"\n---\n\nBody')
})

test('applySeoFrontmatter: never clobbers an existing key', () => {
  const out = applySeoFrontmatter('---\ntitle: Keep\n---\nBody', { title: 'New', description: 'D' })
  assert.match(out, /title: Keep/)
  assert.doesNotMatch(out, /"New"/)
  assert.match(out, /description: "D"/)
})

test('applySeoFrontmatter: extra keys (termxPage)', () => {
  assert.match(applySeoFrontmatter('Body', { extra: { termxPage: 'abc-123' } }), /termxPage: "abc-123"/)
})

test('applySeoFrontmatter: no-op when nothing to add', () => {
  assert.equal(applySeoFrontmatter('Body', {}), 'Body')
})
