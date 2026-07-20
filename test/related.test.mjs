import { test } from 'node:test'
import assert from 'node:assert/strict'
import { docIdOf, buildDocIndex, relatedFor } from '../src/ingest/related.mjs'

test('docIdOf: recognises dotted spec ids and dashed story ids', () => {
  assert.equal(docIdOf('specifications/acc/ACC.11-posting-rules.md'), 'ACC.11')
  assert.equal(docIdOf('specifications/acc/ACC.11.3-invoice-posting.md'), 'ACC.11.3')
  assert.equal(docIdOf('user-stories/use-cases/acc/ACC-US-010-define-coa.md'), 'ACC-US-010')
  assert.equal(docIdOf('user-stories/blueprints/flow/FLOW-BP-003-reception.md'), 'FLOW-BP-003')
  assert.equal(docIdOf('knowledge-base/fhir.md'), null, 'ordinary pages have no doc id')
})

const files = [
  { dest: 'specifications/acc/ACC.11-posting-rules.md', lang: 'en' },
  { dest: 'validations/specifications/acc/ACC.11-posting-rules-validation.md', lang: 'en' },
  { dest: 'specifications/acc/ACC.12-other.md', lang: 'en' },
  { dest: 'user-stories/use-cases/acc/ACC-US-010-define-coa.md', lang: 'en' }
]

test('relatedFor: links a spec to its validation in the mirrored tree', () => {
  const index = buildDocIndex(files)
  const related = relatedFor(files[0], index, '# ACC.11\n', {
    validations: 'Validations'
  })
  assert.equal(related.length, 1)
  assert.equal(related[0].link, '/validations/specifications/acc/ACC.11-posting-rules-validation')
  assert.equal(related[0].text, 'ACC.11')
  assert.equal(related[0].section, 'Validations')
})

test('relatedFor: the link is symmetric (validation points back at the spec)', () => {
  const index = buildDocIndex(files)
  const related = relatedFor(files[1], index, '# ACC.11 validation\n')
  assert.equal(related.length, 1)
  assert.equal(related[0].link, '/specifications/acc/ACC.11-posting-rules')
})

test('relatedFor: resolves ids named in traces-from frontmatter', () => {
  const index = buildDocIndex(files)
  const text = '---\nid: ACC.11\ntraces-from: [ACC-US-010]\n---\n\n# ACC.11\n'
  const related = relatedFor(files[0], index, text)
  const links = related.map((r) => r.link)
  assert.ok(links.includes('/user-stories/use-cases/acc/ACC-US-010-define-coa'), 'traced story linked')
  assert.ok(links.includes('/validations/specifications/acc/ACC.11-posting-rules-validation'))
})

test('relatedFor: a page with no counterpart gets nothing, and never links itself', () => {
  const index = buildDocIndex(files)
  assert.deepEqual(relatedFor(files[2], index, '# ACC.12\n'), [])
})
