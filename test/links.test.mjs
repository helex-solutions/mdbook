import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { auditLinks } from '../src/ingest/links.mjs'

function staging(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdbook-links-'))
  for (const [name, content] of Object.entries(files)) {
    const p = path.join(dir, name)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content)
  }
  return dir
}

test('auditLinks: flags dead routes / unknown slugs, allows valid links & assets', () => {
  const dir = staging({
    'import.md': [
      '[good page](page:about)',
      '[bad page](page:nope)',
      '[wiki route](/wiki/space/x)',
      '[valid route](/about)',
      '[asset](/attachments/a.png)',
      '[external](https://x.io)',
      '[cs link](cs:foo)',
      '![image](/nope.png)'
    ].join('\n\n'),
    'public/attachments/a.png': 'x'
  })
  const model = { contentFiles: [{ dest: 'import.md' }, { dest: 'about.md' }] }
  const hrefs = auditLinks(dir, model).map((d) => d.href).sort()
  assert.deepEqual(hrefs, ['/wiki/space/x', 'page:nope'])
})

test('auditLinks: clean content yields no findings', () => {
  const dir = staging({ 'index.md': '[home](/)\n\n[external](https://x.io)' })
  const model = { contentFiles: [{ dest: 'index.md' }] }
  assert.deepEqual(auditLinks(dir, model), [])
})
