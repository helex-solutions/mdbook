import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) return sourceFiles(abs)
    return e.isFile() && /\.(mjs|js|css)$/.test(e.name) ? [abs] : []
  })
}

// A NUL byte anywhere in a source file makes git treat the whole file as binary:
// every future change to it shows up as "Binary files … differ" and cannot be
// reviewed. Both places that used one (a regex-building sentinel, a composite
// map key) now spell it as an escape or avoid it, and this keeps it that way.
test('source files are text — no literal NUL bytes', () => {
  const offenders = sourceFiles(SRC)
    .filter((f) => fs.readFileSync(f).includes(0))
    .map((f) => path.relative(SRC, f))
  assert.deepEqual(offenders, [])
})
