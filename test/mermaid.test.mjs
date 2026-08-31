import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { mermaidInit } from '../src/theme/mermaid.mjs'

// Mermaid draws untrusted page content in the reader's browser, so these two
// settings are the whole of the defence and neither may be dropped by accident.
// They were previously arguments inside `renderMermaid`, where nothing could
// reach them; a refactor could have removed one and left CI green.

test('mermaidInit: states securityLevel strict rather than inheriting a default', () => {
  // Runs mermaid's own DOMPurify over the SVG it generates and disables `click`
  // bindings. Stated, not inherited — the installed mermaid's default is not a
  // thing this repo controls.
  for (const dark of [true, false]) {
    assert.equal(mermaidInit(dark).securityLevel, 'strict')
  }
})

test('mermaidInit: htmlLabels false is set at the ROOT, not under flowchart', () => {
  // Since mermaid 11.17 the per-diagram `flowchart.htmlLabels` is deprecated and
  // the root key overrides it, so setting only the nested one silently does
  // nothing — which is exactly the bug this asserts against. Without it a label
  // is parsed into real DOM inside a foreignObject.
  const opts = mermaidInit(false)
  assert.equal(opts.htmlLabels, false, 'root-level htmlLabels is off')
  assert.equal(opts.flowchart?.htmlLabels, undefined, 'not set under flowchart, where it is ignored')
})

test('mermaidInit: only the theme varies with dark mode', () => {
  const { theme: dark, ...darkRest } = mermaidInit(true)
  const { theme: light, ...lightRest } = mermaidInit(false)
  assert.equal(dark, 'dark')
  assert.equal(light, 'default')
  assert.deepEqual(darkRest, lightRest, 'no security setting depends on the colour scheme')
})

test('the theme initializes mermaid only through mermaidInit', () => {
  // A second `initialize` call with inline options would sidestep every
  // assertion above, so there must not be one.
  for (const f of ['../src/theme/index.mjs', '../src/theme/mermaid.mjs']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8')
    for (const call of src.match(/mermaid\.initialize\([^)]*\)/g) || []) {
      assert.match(call, /mermaid\.initialize\(mermaidInit\(/, `${f}: ${call}`)
    }
  }
})
