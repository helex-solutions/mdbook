import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modelFromDocument, authFromSchemes, expandEnv } from '../src/ingest/openapi.mjs'
import { expandOpenapi, parseAttrs, typeOf, selectOperations } from '../src/ingest/openapi-render.mjs'

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
