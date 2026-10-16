/**
 * Plugin wiring tests: the two halves are loaded exactly the way the harness
 * loads them, with the host and browser services stubbed out.
 *
 * These catch what a unit test of the internals cannot — a bad import in either
 * entry point, a registration the framework would reject, or a body that throws
 * before it ever reaches the browser.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

/** Collect the registrations the client half makes. */
function makeClientContext() {
  const types = []
  const slots = []
  return {
    types,
    slots,
    ctx: {
      locale: { register: () => () => {}, bind: () => (key) => key },
      effect: (fn) => fn(),
      get: () => undefined,
      slots: {
        register: (definition, body) => {
          slots.push({ definition, body })
          return () => {}
        },
        inject: (_name, factory) => factory(),
      },
      sidebarRightTabs: {
        register: (definition) => {
          types.push(definition)
          return () => {}
        },
      },
    },
  }
}

/**
 * The browser globals the client half touches. They stay installed for the whole
 * file, because `apply` injects the stylesheet and registration calls happen
 * after the bundle has already loaded.
 */
let captured
globalThis.window = { __ModuleLoader__: { load: (entry) => (captured = entry) } }
globalThis.document = {
  createElement: () => ({ setAttribute: () => {}, remove: () => {}, textContent: '' }),
  head: { appendChild: () => {} },
}

/** Load `lib/client.js` through the stub module loader and return the plugin object. */
async function loadClientPlugin() {
  captured = undefined
  await import(`../lib/client.js?cache=${Date.now()}-${Math.random()}`)
  assert.ok(captured !== undefined, 'the bundle must register itself with the module loader')
  assert.equal(captured.id, 'dsh-database-preview')
  return captured.factory(require)
}

test('the client bundle registers one plugin with the declared services', async () => {
  const plugin = await loadClientPlugin()
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual([...plugin.inject].sort(), ['locale', 'sidebarRightTabs', 'slots'])
})

test('the client half claims the database file suffixes and contributes a guide page', async () => {
  const plugin = await loadClientPlugin()
  const { ctx, types, slots } = makeClientContext()
  plugin.apply(ctx)

  assert.equal(types.length, 2, 'one resource type and one page type')
  const [fileType, connectionsType] = types
  assert.equal(fileType.id, 'dsh-database-preview')
  assert.equal(fileType.kind, 'database')
  for (const extension of ['*.db', '*.sqlite', '*.sqlite3', '*.db3']) {
    assert.ok(fileType.patterns.includes(extension), `patterns must include ${extension}`)
  }
  // A pattern without a colon matches the URI path at any depth, which is how a
  // narrower extension band outranks the document preview's fallback type.
  for (const pattern of fileType.patterns) assert.ok(!pattern.includes(':'), `${pattern} must be a path glob`)
  assert.equal(fileType.title('dsh-resource://file/session/s/data/shop%20db.sqlite'), 'shop db.sqlite')
  assert.equal(fileType.title('dsh-resource://file/session/s/a/b.db'), 'b.db')

  assert.equal(connectionsType.kind, 'database-connections')
  assert.equal(connectionsType.patterns, undefined, 'a page type names no patterns')
  assert.equal(connectionsType.guide.length, 1)
  assert.equal(typeof connectionsType.guide[0].order, 'number', 'guide entries are ordered by a number')
  assert.equal(connectionsType.guide[0].id, 'database-connections')

  // Two right-Sidebar tab bodies plus this bundle's own page in the plugin
  // manager. The page registers under the same key value as the file body —
  // keyed slots scope keys to the slot — so the assertions match on slot and key.
  assert.equal(slots.length, 3)
  assert.deepEqual(
    slots.map((entry) => `${entry.definition.name}:${entry.definition.key}`).sort(),
    ['plugins.bundle.config:dsh-database-preview', 'sidebar.right.pane.tab:dsh-database-preview', 'sidebar.right.pane.tab:dsh-database-preview/connections'],
  )
  for (const entry of slots) {
    assert.equal(entry.definition.locale, 'databasePreview')
    assert.equal(typeof entry.body, 'function')
  }
  for (const entry of slots.filter((candidate) => candidate.definition.name === 'sidebar.right.pane.tab')) {
    assert.equal(typeof entry.definition.key, 'string')
  }

  const pluginPage = slots.find((entry) => entry.definition.name === 'plugins.bundle.config')
  assert.equal(pluginPage.definition.key, 'dsh-database-preview', 'the plugin page is keyed by the bundle package name')
  assert.equal(typeof pluginPage.definition.label, 'function', 'the plugin list needs a display name')
})

test('the file body parses its tab address into a Session target', async () => {
  const plugin = await loadClientPlugin()
  const { ctx, slots } = makeClientContext()
  plugin.apply(ctx)

  const fileBody = slots.find((entry) => entry.definition.name === 'sidebar.right.pane.tab' && entry.definition.key === 'dsh-database-preview').body
  const element = fileBody({ useTabInfo: () => ({ tab: { contentId: 'dsh-resource://file/session/session-9/data/shop.db' } }) })
  assert.equal(typeof element.type, 'function')
  assert.equal(element.props.address, 'dsh-resource://file/session/session-9/data/shop.db')
  assert.deepEqual(element.props.file, { scope: 'session', sessionId: 'session-9', path: 'data/shop.db' })
})

test('the file body refuses an address it cannot resolve instead of guessing', async () => {
  const plugin = await loadClientPlugin()
  const { ctx, slots } = makeClientContext()
  plugin.apply(ctx)

  const fileBody = slots.find((entry) => entry.definition.name === 'sidebar.right.pane.tab' && entry.definition.key === 'dsh-database-preview').body
  const element = fileBody({ useTabInfo: () => ({ tab: { contentId: 'https://example.com/not-a-file' } }) })
  // FilePage renders the explanatory notice rather than a browser.
  assert.equal(typeof element.type, 'function')
  assert.equal(element.props.file, undefined)
  assert.equal(element.props.address, 'https://example.com/not-a-file')
})

test('the connections body renders the connection page', async () => {
  const plugin = await loadClientPlugin()
  const { ctx, slots } = makeClientContext()
  plugin.apply(ctx)

  const body = slots.find((entry) => entry.definition.name === 'sidebar.right.pane.tab' && entry.definition.key === 'dsh-database-preview/connections').body
  const element = body({ useTabInfo: () => ({ tab: { contentId: 'dsh-sidebar-right://page/database-connections' } }) })
  assert.equal(typeof element.type, 'function')
})

test('the host half claims its route, enforces the request boundary, and answers JSON', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-database-preview-host-'))
  process.env.DSH_DB_PREVIEW_DIR = dataDir
  try {
    const host = (await import('../lib/index.js')).default
    assert.equal(typeof host.apply, 'function')

    let route
    let effectLabels = []
    const ctx = {
      get: () => undefined,
      logger: { info: () => {}, warn: () => {} },
      inject: (names, callback) => {
        assert.deepEqual(names, ['connection', 'webServer'])
        callback({
          effect: (fn, label) => {
            effectLabels.push(label)
            return fn()
          },
          connection: { requestRejection: () => undefined },
          webServer: {
            register: (definition) => {
              route = definition
              return () => {}
            },
          },
        })
      },
    }
    host.apply(ctx)

    assert.equal(route.kind, 'prefix')
    assert.equal(route.path, '/_dsh/dsh-database-preview')
    assert.ok(effectLabels.some((label) => label.includes('Web routes')))

    /** Drive the registered handler once and return the response. */
    const call = async (url, method = 'GET', body) => {
      const text = body === undefined ? '' : JSON.stringify(body)
      const req = {
        url,
        method,
        on(event, handler) {
          if (event === 'data' && text !== '') handler(Buffer.from(text))
          if (event === 'end') handler()
          return this
        },
        destroy() {},
      }
      const chunks = []
      const res = {
        status: 0,
        headers: undefined,
        writeHead(status, headers) {
          this.status = status
          this.headers = headers
        },
        end(chunk) {
          if (chunk !== undefined) chunks.push(chunk)
        },
      }
      await route.handler(req, res)
      const payload = chunks.join('')
      return { status: res.status, headers: res.headers, payload: payload === '' ? undefined : JSON.parse(payload) }
    }

    const listed = await call('/_dsh/dsh-database-preview/connections.list')
    assert.equal(listed.status, 200)
    assert.equal(listed.headers['Content-Type'], 'application/json; charset=utf-8')
    assert.deepEqual(listed.payload.connections, [])
    assert.ok(listed.payload.engines.includes('sqlite'))

    const unknown = await call('/_dsh/dsh-database-preview/nope.nope')
    assert.equal(unknown.status, 404)
    assert.match(unknown.payload.error, /unknown method/)

    const outside = await call('/somewhere/else')
    assert.equal(outside.status, 404)

    // A mutating method must not be reachable by a plain GET.
    const wrongMethod = await call('/_dsh/dsh-database-preview/connections.delete')
    assert.equal(wrongMethod.status, 405)

    const missingId = await call('/_dsh/dsh-database-preview/connections.delete', 'POST', {})
    assert.equal(missingId.status, 400)
    assert.match(missingId.payload.error, /connectionId is required/)

    const saved = await call('/_dsh/dsh-database-preview/connections.save', 'POST', {
      profile: { label: 'Prod PG', engine: 'postgres', host: 'db.internal', user: 'reader', password: 'hunter2' },
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.payload.connection.password, undefined, 'the password must never be echoed back')
    assert.equal(saved.payload.connection.hasPassword, true)

    const badBody = await call('/_dsh/dsh-database-preview/connections.save', 'POST', undefined)
    // An empty body parses as {} and fails validation rather than the JSON parse.
    assert.equal(badBody.status, 400)

    const removed = await call('/_dsh/dsh-database-preview/connections.delete', 'POST', { connectionId: saved.payload.connection.id })
    assert.equal(removed.status, 200)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('the host route rejects a request the connection boundary refuses', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'dsh-database-preview-boundary-'))
  process.env.DSH_DB_PREVIEW_DIR = dataDir
  try {
    const host = (await import('../lib/index.js')).default
    let route
    host.apply({
      get: () => undefined,
      logger: { info: () => {}, warn: () => {} },
      inject: (_names, callback) =>
        callback({
          effect: (fn) => fn(),
          connection: { requestRejection: () => 401 },
          webServer: { register: (definition) => ((route = definition), () => {}) },
        }),
    })
    const res = { status: 0, writeHead(status) { this.status = status }, end() {} }
    await route.handler(
      {
        url: '/_dsh/dsh-database-preview/connections.list',
        method: 'GET',
        on(event, handler) {
          if (event === 'end') handler()
          return this
        },
        destroy() {},
      },
      res,
    )
    assert.equal(res.status, 401)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
