// The filter is DOM code, so it runs against jsdom rather than a real browser.
// jsdom is a devDependency: the action installs with --omit=dev, so this never
// ships to a consumer's build.
import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { installFilter, FILTER_MIN_OPS } from '../src/theme/op-filter.mjs'

// One operation as the renderer emits it: an <h3> heading followed by a sibling
// <details> (not nested — see the note in op-filter.mjs).
const op = (method, path, summary = '') => `
  <h3 id="${method}-${path}"><code>${method}</code> <code>${path}</code></h3>
  <details class="mdbook-op"><summary>${summary}</summary><p>detail</p></details>`

function render(html) {
  const dom = new JSDOM(`<body><div class="vp-doc"><h1>API</h1>${html}</div></body>`)
  // el() in src/theme/dom.mjs builds via the `document` global, as it does in a
  // browser; point that at this page for the duration of the test.
  globalThis.document = dom.window.document
  globalThis.HTMLElement = dom.window.HTMLElement
  return dom.window.document.querySelector('.vp-doc')
}

const visible = (root, sel) => [...root.querySelectorAll(sel)].filter((n) => !n.hidden)

describe('openapi operation filter', () => {
  let savedDoc
  before(() => {
    savedDoc = globalThis.document
  })
  after(() => {
    globalThis.document = savedDoc
  })

  test('is not installed on a page with few operations', () => {
    const root = render(op('GET', '/pets') + op('POST', '/pets'))
    assert.equal(installFilter(root), null)
    assert.equal(root.querySelector('.mdbook-op-filter'), null)
  })

  test('installs once a page reaches the threshold, after the H1', () => {
    const root = render(Array.from({ length: FILTER_MIN_OPS }, (_, i) => op('GET', `/p${i}`)).join(''))
    const handle = installFilter(root)
    assert.ok(handle, 'expected a filter to be installed')
    // Placed directly after the title so it reads as part of the page header.
    assert.equal(root.querySelector('h1').nextElementSibling, handle.bar)
    assert.match(handle.input.placeholder, /Filter 8 operations/)
    // Nothing is filtered yet, so the count stays out of the way.
    assert.equal(root.querySelector('.mdbook-op-filter-count').textContent, '')
  })

  test('is not installed twice', () => {
    const root = render(Array.from({ length: 10 }, (_, i) => op('GET', `/p${i}`)).join(''))
    installFilter(root)
    assert.equal(installFilter(root), null)
    assert.equal(root.querySelectorAll('.mdbook-op-filter').length, 1)
  })

  const page = () =>
    render(
      op('GET', '/brokers', 'List brokers') +
        op('POST', '/brokers', 'Create a broker') +
        op('GET', '/invoices', 'List invoices') +
        op('POST', '/invoices', 'Create an invoice') +
        op('DELETE', '/invoices/{id}', 'Delete an invoice') +
        op('GET', '/ledgers', 'List ledgers') +
        op('PUT', '/ledgers/{id}', 'Replace a ledger') +
        op('PATCH', '/ledgers/{id}', 'Update a ledger')
    )

  const type = (handle, value) => {
    handle.input.value = value
    handle.apply()
  }

  test('matches on path', () => {
    const root = page()
    const handle = installFilter(root)
    type(handle, 'brokers')
    assert.equal(visible(root, 'details.mdbook-op').length, 2)
    assert.equal(root.querySelector('.mdbook-op-filter-count').textContent, '2 of 8')
  })

  test('matches on method and on summary', () => {
    const root = page()
    const handle = installFilter(root)
    type(handle, 'patch')
    assert.equal(visible(root, 'details.mdbook-op').length, 1)
    type(handle, 'replace')
    assert.equal(visible(root, 'details.mdbook-op').length, 1)
  })

  test('is case-insensitive', () => {
    const root = page()
    const handle = installFilter(root)
    type(handle, 'BROKERS')
    assert.equal(visible(root, 'details.mdbook-op').length, 2)
  })

  test('ANDs multiple words, so a second word narrows', () => {
    const root = page()
    const handle = installFilter(root)
    type(handle, 'invoices')
    assert.equal(visible(root, 'details.mdbook-op').length, 3)
    type(handle, 'post invoice')
    assert.equal(visible(root, 'details.mdbook-op').length, 1)
  })

  test('hides each operation together with its heading', () => {
    const root = page()
    const handle = installFilter(root)
    type(handle, 'brokers')
    // A heading left behind by its hidden <details> would read as an empty entry.
    assert.equal(visible(root, 'h3').length, 2)
    for (const h of root.querySelectorAll('h3')) {
      const details = h.nextElementSibling
      assert.equal(h.hidden, details.hidden, `${h.textContent} and its detail disagree`)
    }
  })

  test('restores everything when cleared', () => {
    const root = page()
    const handle = installFilter(root)
    type(handle, 'brokers')
    type(handle, '')
    assert.equal(visible(root, 'details.mdbook-op').length, 8)
    assert.equal(visible(root, 'h3').length, 8)
    assert.equal(root.querySelector('.mdbook-op-filter-count').textContent, '')
  })

  test('whitespace alone is treated as empty, not as a failed match', () => {
    const root = page()
    const handle = installFilter(root)
    type(handle, '   ')
    assert.equal(visible(root, 'details.mdbook-op').length, 8)
    // Without a trim the blank query counts as a filter and the "8 of 8" counter
    // appears, which reads as though something were filtered.
    assert.equal(root.querySelector('.mdbook-op-filter-count').textContent, '')
  })

  test('shows nothing, and says so, when a term matches no operation', () => {
    const root = page()
    const handle = installFilter(root)
    type(handle, 'zzzznope')
    assert.equal(visible(root, 'details.mdbook-op').length, 0)
    assert.equal(root.querySelector('.mdbook-op-filter-count').textContent, '0 of 8')
  })

  test('hides a section heading once all its operations are filtered out', () => {
    const root = render(
      '<h2>Brokers</h2>' +
        op('GET', '/brokers', 'List brokers') +
        op('POST', '/brokers', 'Create a broker') +
        '<h2>Invoices</h2>' +
        op('GET', '/invoices', 'List invoices') +
        op('POST', '/invoices', 'Create an invoice') +
        op('DELETE', '/invoices/{id}', 'Delete an invoice') +
        op('GET', '/ledgers', 'List ledgers') +
        op('PUT', '/ledgers/{id}', 'Replace a ledger') +
        op('PATCH', '/ledgers/{id}', 'Update a ledger')
    )
    const handle = installFilter(root)
    type(handle, 'brokers')
    const [brokers, invoices] = root.querySelectorAll('h2')
    assert.equal(brokers.hidden, false, 'the matching section should stay')
    assert.equal(invoices.hidden, true, 'a section with no matches is a stray heading')
    // Clearing brings both back.
    type(handle, '')
    assert.equal(brokers.hidden, false)
    assert.equal(invoices.hidden, false)
  })

  test('Escape clears the filter', () => {
    const root = page()
    const handle = installFilter(root)
    type(handle, 'brokers')
    handle.input.dispatchEvent(new globalThis.document.defaultView.KeyboardEvent('keydown', { key: 'Escape' }))
    assert.equal(handle.input.value, '')
    assert.equal(visible(root, 'details.mdbook-op').length, 8)
  })

  test('typing fires the filter through the input event', () => {
    const root = page()
    const handle = installFilter(root)
    handle.input.value = 'ledgers'
    handle.input.dispatchEvent(new globalThis.document.defaultView.Event('input'))
    assert.equal(visible(root, 'details.mdbook-op').length, 3)
  })

  test('removes nothing from the document, so search and no-JS still see it all', () => {
    const root = page()
    const handle = installFilter(root)
    type(handle, 'zzzznope')
    assert.equal(root.querySelectorAll('details.mdbook-op').length, 8)
    assert.match(root.textContent, /Delete an invoice/)
  })
})
