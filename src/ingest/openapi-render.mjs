// Expands `{% openapi … %}` / `{% openapi-schema … %}` blocks into markdown.
//
// Markdown, not HTML, on purpose: VitePress then renders it like any other page
// content, so every operation, parameter and response lands in the static HTML
// and therefore in the search index. Only the interactive console is an HTML
// island, mounted client-side by src/theme/openapi.mjs.
//
// Scopes, from whole document down to a single operation:
//   {% openapi src="petstore" %}                            the whole document
//   {% openapi src="petstore" tag="Pets" %}                 one tag
//   {% openapi src="petstore" path="/pets" %}               every method on a path
//   {% openapi src="petstore" path="/pets" method="get" %}  one operation
//   {% openapi src="petstore" operation="listPets" %}       one operation, by id
//   {% openapi src="petstore" webhook="newPet" %}           a 3.1 webhook
//   {% openapi-schema src="petstore" name="Pet" %}          one schema
//
// Each operation's detail is collapsed by default (`openapi.collapsed`), so a
// large document reads as a scannable list; `collapsed="false"` expands a block.

const BLOCK_RE = /^\{%\s*(openapi|openapi-schema)\s+([^%]*?)\s*%\}\s*$/gm

// `src="petstore" path="/pets"` -> { src: 'petstore', path: '/pets' }
export function parseAttrs(s) {
  const out = {}
  for (const m of String(s || '').matchAll(/([A-Za-z-]+)\s*=\s*"([^"]*)"|([A-Za-z-]+)\s*=\s*'([^']*)'/g)) {
    out[(m[1] || m[3]).toLowerCase()] = m[2] ?? m[4]
  }
  return out
}

// Escape a value for use inside a markdown table cell.
const cell = (v) =>
  String(v ?? '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()

// Follow an internal $ref (`#/components/schemas/Pet`) inside the document.
// bundle() leaves these in place, so the renderer resolves them on demand — one
// level at a time, which is what keeps a recursive schema from expanding forever.
export function deref(schema, model, seen = 0) {
  if (!schema?.$ref || seen > 8) return schema
  const parts = String(schema.$ref).replace(/^#\//, '').split('/')
  let node = model?.doc
  for (const part of parts) node = node?.[part.replace(/~1/g, '/').replace(/~0/g, '~')]
  return node ? deref(node, model, seen + 1) : schema
}

// A readable type for a schema. A $ref renders as its name, never expanded.
export function typeOf(schema, depth = 0) {
  if (!schema || depth > 4) return ''
  if (schema.$ref) return String(schema.$ref).split('/').pop()
  for (const key of ['oneOf', 'anyOf', 'allOf']) {
    if (Array.isArray(schema[key])) {
      return schema[key].map((s) => typeOf(s, depth + 1)).filter(Boolean).join(key === 'allOf' ? ' & ' : ' \\| ')
    }
  }
  if (schema.enum) return `enum(${schema.enum.slice(0, 6).map((v) => JSON.stringify(v)).join(', ')})`
  const t = Array.isArray(schema.type) ? schema.type.join(' | ') : schema.type
  if (t === 'array') return `${typeOf(schema.items, depth + 1) || 'any'}[]`
  if (schema.format) return `${t || 'string'} (${schema.format})`
  return t || (schema.properties ? 'object' : '')
}

// Select the operations a block refers to.
export function selectOperations(model, attrs) {
  if (!model) return []
  let ops = model.operations
  if (attrs.webhook) return ops.filter((o) => o.kind === 'webhook' && o.path === attrs.webhook)
  if (attrs.operation) return ops.filter((o) => o.operationId === attrs.operation)
  if (attrs.tag) ops = ops.filter((o) => o.tags.includes(attrs.tag))
  if (attrs.path) ops = ops.filter((o) => o.path === attrs.path)
  if (attrs.method) ops = ops.filter((o) => o.method === attrs.method.toUpperCase())
  // A bare {% openapi src=… %} means the whole document, webhooks included.
  return ops
}

function paramTable(params) {
  if (!params?.length) return ''
  const rows = params.map(
    (p) =>
      `| \`${cell(p.name)}\` | ${cell(p.in)} | ${cell(typeOf(p.schema) || typeOf(p))} | ${p.required ? 'yes' : 'no'} | ${cell(p.description)} |`
  )
  return ['**Parameters**', '', '| Name | In | Type | Required | Description |', '|---|---|---|---|---|', ...rows, ''].join('\n')
}

function bodyTable(requestBody, model) {
  if (!requestBody) return ''
  const content = requestBody.content || {}
  const type = Object.keys(content)[0]
  if (!type) return ''
  const schema = deref(content[type]?.schema, model)
  const items = deref(schema?.items, model)
  const props = schema?.properties || items?.properties || null
  const required = new Set(schema?.required || items?.required || [])
  const head = `**Request body** — \`${cell(type)}\`${requestBody.required ? ' (required)' : ''}`
  if (!props) {
    const t = typeOf(content[type]?.schema)
    return [head, '', t ? `Type: \`${cell(t)}\`` : '', ''].filter(Boolean).join('\n')
  }
  const rows = Object.entries(props).map(
    ([k, v]) => `| \`${cell(k)}\` | ${cell(typeOf(v))} | ${required.has(k) ? 'yes' : 'no'} | ${cell(v?.description)} |`
  )
  return [head, '', '| Field | Type | Required | Description |', '|---|---|---|---|', ...rows, ''].join('\n')
}

function responseTable(responses) {
  const entries = Object.entries(responses || {})
  if (!entries.length) return ''
  const rows = entries.map(([status, r]) => {
    const types = Object.keys(r?.content || {}).join(', ')
    const schema = Object.values(r?.content || {})[0]?.schema
    return `| \`${cell(status)}\` | ${cell(r?.description)} | ${cell(types)} | ${cell(typeOf(schema))} |`
  })
  return ['**Responses**', '', '| Status | Description | Content | Schema |', '|---|---|---|---|', ...rows, ''].join('\n')
}

// Stable anchor for an operation, so pages can deep-link to it.
export const opAnchor = (op) =>
  (op.operationId || `${op.method}-${op.path}`).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// Wrap an operation's detail in a <details>, so a long document reads as a
// scannable list of operations. <details> (rather than JS) keeps the content in
// the static HTML: it is still indexed by search and still printable, it just
// starts closed. The heading stays outside so anchors and the page outline are
// unaffected.
function collapse(summary, body) {
  return ['<details class="mdbook-op">', `<summary>${summary}</summary>`, '', body, '', '</details>'].join('\n')
}

function renderOperation(op, model, opts) {
  // The path goes in a code span: templated segments like `/pets/{petId}` would
  // otherwise look like an attribute block to markdown-it-attrs, which turns
  // `{petId}` into an empty HTML attribute. Code spans are left alone.
  const heading =
    op.kind === 'webhook' ? `\`${op.method}\` \`${op.path}\` (webhook)` : `\`${op.method}\` \`${op.path}\``
  const out = [`### ${heading} {#${opAnchor(op)}}`, '']
  if (op.deprecated) out.push('> **Deprecated**', '')
  if (op.summary) out.push(`_${op.summary}_`, '')

  // Everything below the heading is the "detail" — optionally collapsed.
  const detail = []
  if (op.description) detail.push(op.description, '')
  const p = paramTable(op.parameters)
  if (p) detail.push(p)
  const b = bodyTable(op.requestBody, model)
  if (b) detail.push(b)
  const r = responseTable(op.responses)
  if (r) detail.push(r)
  if (opts.tryIt && op.kind !== 'webhook') {
    // Island for the console; everything above stays plain, searchable markdown.
    // The parameters travel as data rather than being scraped back out of the
    // rendered table — the table is for humans and its shape may change.
    const server = op.servers?.[0]?.url || model.servers?.[0]?.url || ''
    const params = (op.parameters || [])
      .filter((p) => ['path', 'query', 'header'].includes(p.in))
      .map((p) => ({ name: p.name, in: p.in, required: !!p.required }))
    const data = JSON.stringify(params).replace(/"/g, '&quot;')
    detail.push(
      `<div class="mdbook-tryit" data-spec="${model.name}" data-method="${op.method}" ` +
        `data-path="${encodeURI(op.path)}" data-server="${encodeURI(server)}" ` +
        `data-params="${data}"></div>`,
      ''
    )
  }

  const body = detail.join('\n').trim()
  if (!body) return out.join('\n')
  out.push(opts.collapsed ? collapse(op.summary || 'Details', body) : body)
  return out.join('\n')
}

function renderSchema(model, name) {
  const schema = deref(model.schemas?.[name], model)
  if (!schema) return `> OpenAPI: schema \`${name}\` not found in \`${model.name}\`.`
  const out = [`### ${name} {#schema-${name.toLowerCase()}}`, '']
  if (schema.description) out.push(schema.description, '')
  const props = schema.properties || {}
  const required = new Set(schema.required || [])
  if (!Object.keys(props).length) {
    out.push(`Type: \`${typeOf(schema) || 'object'}\``, '')
    return out.join('\n')
  }
  out.push(
    '| Field | Type | Required | Description |',
    '|---|---|---|---|',
    ...Object.entries(props).map(
      ([k, v]) => `| \`${cell(k)}\` | ${cell(typeOf(v))} | ${required.has(k) ? 'yes' : 'no'} | ${cell(v?.description)} |`
    ),
    ''
  )
  return out.join('\n')
}

// Replace every block in `text`. `specs` is { name: model }.
export function expandOpenapi(text, specs, opts = {}) {
  if (!text.includes('{% openapi')) return text
  const tryIt = opts.tryIt ?? true
  const collapsedDefault = opts.collapsed ?? true
  // Names declared in config, so a spec that is configured but failed to load
  // this build is not reported as if the author had mistyped it.
  const configured = new Set(opts.configured || [])
  return text.replace(BLOCK_RE, (whole, kind, attrStr) => {
    const attrs = parseAttrs(attrStr)
    const model = specs?.[attrs.src]
    if (!model) {
      // A configured spec that isn't in this build is a normal, temporary state
      // (the service isn't up yet, or was unreachable). Say so in the reader's
      // terms — a build-log reference means nothing to someone reading the site.
      return configured.has(attrs.src)
        ? [
            `> **API reference unavailable**`,
            `>`,
            `> The \`${attrs.src}\` service did not return an OpenAPI document when this site was`,
            `> built. This page fills in automatically once the service publishes one.`,
            `{.is-warning}`
          ].join('\n')
        : `> OpenAPI: no spec named \`${attrs.src || '(missing src)'}\` is configured.`
    }

    if (kind === 'openapi-schema') return renderSchema(model, attrs.name || '')

    const ops = selectOperations(model, attrs)
    if (!ops.length) return `> OpenAPI: no operation in \`${attrs.src}\` matched this selector.`
    // A block may override the site default: collapsed="false" to expand.
    const collapsed = attrs.collapsed == null ? collapsedDefault : !/^(false|no|0)$/i.test(attrs.collapsed)
    return ops.map((op) => renderOperation(op, model, { tryIt, collapsed })).join('\n\n')
  })
}
