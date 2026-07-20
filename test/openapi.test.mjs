import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelFromDocument, authFromSchemes, expandEnv, effectiveServers } from '../src/ingest/openapi.mjs'
import { expandOpenapi, parseAttrs, typeOf, selectOperations, sortOperations } from '../src/ingest/openapi-render.mjs'

const DOC = {
  openapi: '3.1.0',
  info: { title: 'Petstore', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com/v1' }],
  components: {
    securitySchemes: {
      oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://id.example.com/.well-known/openid-configuration' }
    },
    schemas: {
      Pet: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'integer', format: 'int64' }, name: { type: 'string', description: 'Name' } }
      }
    }
  },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        summary: 'List all pets',
        tags: ['Pets'],
        parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
        responses: {
          200: { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } } } } }
        }
      },
      post: { operationId: 'createPet', tags: ['Pets'], responses: { 201: { description: 'created' } } }
    },
    '/health': { get: { operationId: 'health', tags: ['Ops'], responses: { 200: { description: 'ok' } } } }
  },
  webhooks: { newPet: { post: { operationId: 'newPetHook', responses: { 200: { description: 'ok' } } } } }
}

const model = modelFromDocument('petstore', DOC)
const specs = { petstore: model }

test('modelFromDocument: flattens paths and 3.1 webhooks', () => {
  assert.equal(model.title, 'Petstore')
  assert.equal(model.operations.length, 4)
  assert.ok(model.operations.some((o) => o.kind === 'webhook' && o.operationId === 'newPetHook'))
  assert.deepEqual(model.servers, [{ url: 'https://api.example.com/v1' }])
})

test('modelFromDocument: maps a Swagger 2.0 document onto the 3.x shape', () => {
  const m = modelFromDocument('legacy', {
    swagger: '2.0',
    info: { title: 'Legacy' },
    host: 'api.legacy.test',
    basePath: '/v2',
    schemes: ['https'],
    definitions: { Thing: { type: 'object' } },
    securityDefinitions: { oauth: { type: 'oauth2' } },
    paths: { '/things': { get: { operationId: 'listThings', responses: {} } } }
  })
  assert.equal(m.servers[0].url, 'https://api.legacy.test/v2')
  assert.ok(m.schemas.Thing, 'definitions become component schemas')
  assert.equal(m.operations.length, 1)
})

test('authFromSchemes: prefers an openIdConnect discovery URL', () => {
  const a = authFromSchemes(DOC.components.securitySchemes)
  assert.equal(a.kind, 'openIdConnect')
  assert.match(a.discoveryUrl, /openid-configuration$/)

  const oauth = authFromSchemes({
    o: { type: 'oauth2', flows: { authorizationCode: { authorizationUrl: 'https://a/auth', tokenUrl: 'https://a/token', scopes: { read: '' } } } }
  })
  assert.equal(oauth.kind, 'oauth2')
  assert.equal(oauth.tokenUrl, 'https://a/token')
  assert.deepEqual(oauth.scopes, ['read'])

  assert.equal(authFromSchemes({}), null)
})

test('parseAttrs / typeOf', () => {
  assert.deepEqual(parseAttrs('src="petstore" path="/pets" method="get"'), {
    src: 'petstore', path: '/pets', method: 'get'
  })
  assert.equal(typeOf({ $ref: '#/components/schemas/Pet' }), 'Pet', 'a $ref renders as its name')
  assert.equal(typeOf({ type: 'array', items: { $ref: '#/components/schemas/Pet' } }), 'Pet[]')
  assert.equal(typeOf({ type: 'string', format: 'date-time' }), 'string (date-time)')
})

test('selectOperations: every scope from whole document down to one operation', () => {
  assert.equal(selectOperations(model, {}).length, 4, 'root = the whole document')
  assert.equal(selectOperations(model, { tag: 'Pets' }).length, 2, 'a tag branch')
  assert.equal(selectOperations(model, { path: '/pets' }).length, 2, 'a path branch')
  assert.equal(selectOperations(model, { path: '/pets', method: 'get' }).length, 1, 'one operation')
  assert.equal(selectOperations(model, { operation: 'listPets' })[0].method, 'GET', 'by operationId')
  assert.equal(selectOperations(model, { webhook: 'newPet' })[0].kind, 'webhook')
})

test('expandOpenapi: renders searchable markdown for an operation', () => {
  const out = expandOpenapi('{% openapi src="petstore" operation="listPets" %}', specs, { tryIt: true })
  assert.match(out, /^### `GET` `\/pets` \{#listpets\}/m, 'heading carries method, path and an anchor')
  assert.match(out, /_List all pets_/, 'summary')
  assert.match(out, /\| `limit` \| query \| integer \| no \|/, 'parameter row')
  assert.match(out, /\| `200` \| ok \| application\/json \| Pet\[\] \|/, 'response keeps the schema name')
  assert.match(out, /<div class="mdbook-tryit" data-spec="petstore" data-method="GET"/, 'console island')
  assert.match(out, /data-params="\[\{&quot;name&quot;:&quot;limit&quot;,&quot;in&quot;:&quot;query&quot;/, 'parameters travel as data, not scraped from the table')
})

test('expandOpenapi: operations collapse by default, and a block can expand them', () => {
  const def = expandOpenapi('{% openapi src="petstore" operation="listPets" %}', specs, { tryIt: false })
  assert.match(def, /<details class="mdbook-op">/, 'collapsed by default')
  assert.match(def, /<summary>List all pets<\/summary>/, 'summary line labels the collapsed row')
  assert.match(def, /\| `limit` \| query \|/, 'the detail is still in the HTML, so search finds it')
  assert.match(def, /^### `GET` `\/pets`/m, 'the heading stays outside, keeping the anchor and outline')

  const open = expandOpenapi('{% openapi src="petstore" operation="listPets" collapsed="false" %}', specs, { tryIt: false })
  assert.doesNotMatch(open, /<details/, 'collapsed="false" expands')
  assert.match(open, /\| `limit` \| query \|/)

  const off = expandOpenapi('{% openapi src="petstore" operation="listPets" %}', specs, { tryIt: false, collapsed: false })
  assert.doesNotMatch(off, /<details/, 'the site default can turn collapsing off')
})

test('expandOpenapi: tryIt:false omits the console but keeps the docs', () => {
  const out = expandOpenapi('{% openapi src="petstore" operation="listPets" %}', specs, { tryIt: false })
  assert.doesNotMatch(out, /mdbook-tryit/)
  assert.match(out, /### `GET` `\/pets`/)
})

test('expandOpenapi: a templated path cannot become an empty HTML attribute', () => {
  // `/pets/{petId}` in bare heading text would be read as an attribute block by
  // markdown-it-attrs, yielding id="" — and duplicates of that crash VitePress.
  const m = modelFromDocument('t', {
    openapi: '3.1.0',
    paths: { '/pets/{petId}': { get: { operationId: 'getPet', responses: {} } } }
  })
  const out = expandOpenapi('{% openapi src="t" %}', { t: m }, { tryIt: false })
  assert.match(out, /^### `GET` `\/pets\/\{petId\}` \{#getpet\}/m, 'the path is a code span')
})

test('expandOpenapi: schema block renders a field table', () => {
  const out = expandOpenapi('{% openapi-schema src="petstore" name="Pet" %}', specs)
  assert.match(out, /### Pet \{#schema-pet\}/)
  assert.match(out, /\| `id` \| integer \(int64\) \| yes \|/)
  assert.match(out, /\| `name` \| string \| no \| Name \|/)
})

test('expandOpenapi: unknown spec or empty selector degrades to a visible note', () => {
  assert.match(expandOpenapi('{% openapi src="nope" %}', specs), /no spec named `nope`/)
  // Configured but absent from this build (e.g. the fetch failed) reads
  // differently — telling a reader it "is not configured" would be wrong.
  const pending = expandOpenapi('{% openapi src="acc" %}', specs, { configured: ['acc'] })
  assert.match(pending, /API reference unavailable/)
  assert.match(pending, /fills in automatically once the service publishes one/)
  assert.doesNotMatch(pending, /build log/, 'a reader is not sent to a build log')
  assert.match(expandOpenapi('{% openapi src="petstore" tag="Ghost" %}', specs), /no operation .* matched/)
})

test('expandOpenapi: text without a block is returned untouched', () => {
  const src = '# Title\n\nJust prose.\n'
  assert.equal(expandOpenapi(src, specs), src)
})

test('expandEnv: resolves ${VAR} from the build environment', () => {
  const missing = []
  assert.equal(expandEnv('Bearer ${TOK}', missing, { TOK: 'abc' }), 'Bearer abc')
  assert.deepEqual(missing, [])
})

test('expandEnv: an unset or empty variable is reported, never substituted literally', () => {
  const missing = []
  // Empty string counts as unset: sending "Bearer " upstream would just 401.
  const out = expandEnv('Bearer ${TOK} ${OTHER}', missing, { TOK: '' })
  assert.doesNotMatch(out, /\$\{/, 'no literal ${VAR} is ever sent upstream')
  assert.deepEqual(missing.sort(), ['OTHER', 'TOK'], 'both names are reported')
})

test('effectiveServers: a loopback server is replaced by the origin it was fetched from', () => {
  // springdoc emits http://127.0.0.1:8080 — the address the service sees itself
  // on, which no reader can reach. The fetch origin demonstrably works.
  const out = effectiveServers([{ url: 'http://127.0.0.1:8080' }], {
    sourceUrl: 'https://emr.example.com/api/acc/api-docs'
  })
  assert.deepEqual(out, [{ url: 'https://emr.example.com' }])
})

test('effectiveServers: a routable declared server is left alone', () => {
  const declared = [{ url: 'https://api.example.com/v1' }]
  assert.deepEqual(effectiveServers(declared, { sourceUrl: 'https://elsewhere/spec' }), declared)
})

test('effectiveServers: an explicit override beats everything', () => {
  const out = effectiveServers([{ url: 'https://api.example.com' }], { server: 'https://staging.example.com/' })
  assert.deepEqual(out, [{ url: 'https://staging.example.com' }], 'trailing slash trimmed')
})

test('effectiveServers: a local file spec with only a loopback server keeps it', () => {
  const declared = [{ url: 'http://localhost:3000' }]
  assert.deepEqual(effectiveServers(declared, { sourceUrl: '/tmp/api.yaml' }), declared)
})

test('modelFromDocument: the reachable server reaches operations too', () => {
  const m = modelFromDocument('acc', {
    openapi: '3.1.0',
    servers: [{ url: 'http://127.0.0.1:8080' }],
    paths: { '/api/acc/x': { get: { operationId: 'getX', responses: {} } } }
  }, { sourceUrl: 'https://emr.example.com/api/acc/api-docs' })
  assert.deepEqual(m.servers, [{ url: 'https://emr.example.com' }])
  assert.deepEqual(m.operations[0].servers, [{ url: 'https://emr.example.com' }])
})

test('sortOperations: by path, then conventional REST method order', () => {
  const ops = [
    { path: '/zebra', method: 'GET' },
    { path: '/alpha', method: 'DELETE' },
    { path: '/alpha', method: 'GET' },
    { path: '/alpha', method: 'POST' }
  ]
  assert.deepEqual(
    sortOperations(ops).map((o) => `${o.method} ${o.path}`),
    ['GET /alpha', 'POST /alpha', 'DELETE /alpha', 'GET /zebra'],
    'paths alphabetical; GET before DELETE rather than alphabetical by method'
  )
})

test('sortOperations: numeric-aware, and `none` keeps document order', () => {
  const ops = [{ path: '/v10/a', method: 'GET' }, { path: '/v2/a', method: 'GET' }]
  assert.deepEqual(sortOperations(ops).map((o) => o.path), ['/v2/a', '/v10/a'], 'v2 before v10')
  assert.deepEqual(sortOperations(ops, 'none'), ops, 'document order preserved')
})

test('expandOpenapi: operations render sorted by default', () => {
  const out = expandOpenapi('{% openapi src="petstore" tag="Pets" %}', specs, { tryIt: false })
  const order = [...out.matchAll(/^### `(\w+)` `([^`]+)`/gm)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual(order, ['GET /pets', 'POST /pets'])
})
