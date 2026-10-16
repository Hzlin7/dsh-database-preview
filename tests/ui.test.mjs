/**
 * Browser-half rendering tests.
 *
 * These render the shipped bundle — the same `lib/client.js` the module loader
 * serves — into a real DOM, with `fetch` answering canned RPC payloads. That
 * covers what the wiring tests cannot: components mounting, effects running,
 * cells converting, and the structure view switching.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { en } from '../src/client/i18n.js'
import { PREFIX, STYLES } from '../src/client/styles.js'

const require = createRequire(import.meta.url)

let dom
let React
let createRoot
let act
let plugin
let container

/**
 * Translator stub backed by the English dictionary.
 *
 * Returning the key itself would be indistinguishable from a miss — the plugin
 * falls back to its own copy in that case — so the stub answers with real copy
 * and the assertions below read prose.
 */
const t = (key, params) => {
  const template = en[key] ?? key
  return params === undefined ? template : template.replace(/\{(\w+)\}/g, (match, name) => (Object.hasOwn(params, name) ? String(params[name]) : match))
}

before(async () => {
  dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:19387/' })
  // Only window and document are lifted onto the global: `navigator` is a
  // read-only getter in Node, and react-dom reaches the rest through
  // `document.defaultView` anyway.
  globalThis.window = dom.window
  globalThis.document = dom.window.document
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  React = require('react')
  ;({ createRoot } = require('react-dom/client'))
  act = React.act

  let captured
  dom.window.__ModuleLoader__ = { load: (entry) => (captured = entry) }
  await import(`../lib/client.js?ui=${Date.now()}`)
  plugin = captured.factory(require)
  container = dom.window.document.getElementById('root')
})

after(() => {
  dom.window.close()
})

/** Apply a plugin instance and return its registered slot bodies keyed by type id. */
function registeredBodies(instance = plugin) {
  const bodies = new Map()
  instance.apply({
    locale: { register: () => () => {}, bind: () => (key) => key },
    effect: (fn) => fn(),
    get: () => undefined,
    slots: {
      register: (definition, body) => {
        bodies.set(definition.key, body)
        return () => {}
      },
      inject: (_name, factory) => factory(),
    },
    sidebarRightTabs: { register: () => () => {} },
  })
  return bodies
}

/** The file body for a Session file address. */
function fileBodyFor(address) {
  const body = registeredBodies().get('dsh-database-preview')
  return { body, useTabInfo: () => ({ tab: { contentId: address } }) }
}

/**
 * Load the bundle once more through a supplied `require`, so a test can decide
 * whether the kernel's shared primitives are present.
 */
async function loadPluginWith(requireFn) {
  let captured
  dom.window.__ModuleLoader__ = { load: (entry) => (captured = entry) }
  await import(`../lib/client.js?loader=${Date.now()}-${Math.random()}`)
  return captured.factory(requireFn)
}

/**
 * Set a native control's value the way a user would. React's change plugin
 * compares against the value it last saw, so assigning `.value` directly is
 * ignored; going through the prototype setter makes the change observable.
 */
function setNativeValue(element, value) {
  const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value)
}

/** Answer RPC calls from a canned table of payloads. */
function stubFetch(payloads) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    const method = decodeURIComponent(String(url).split('/').pop())
    calls.push({ method, args: init?.body === undefined ? undefined : JSON.parse(init.body) })
    const payload = payloads[method]
    if (payload === undefined) return { ok: false, status: 404, text: async () => JSON.stringify({ error: `no stub for ${method}` }) }
    return { ok: true, status: 200, text: async () => JSON.stringify(payload) }
  }
  return calls
}

const CATALOG = {
  engine: 'sqlite',
  version: '3.45.0',
  databases: [],
  schemas: [],
  tables: [
    { name: 'users', type: 'table', schema: '' },
    { name: 'orders', type: 'table', schema: '' },
  ],
}

const TABLE = {
  engine: 'sqlite',
  table: 'users',
  page: 1,
  pageSize: 100,
  offset: 0,
  columns: [
    { name: 'id', type: 'INTEGER', nullable: false, defaultValue: null, primaryKey: true },
    { name: 'name', type: 'TEXT', nullable: false, defaultValue: null, primaryKey: false },
    { name: 'avatar', type: 'BLOB', nullable: true, defaultValue: null, primaryKey: false },
  ],
  indexes: [{ name: 'users_name', unique: true, columns: ['name'] }],
  primaryKey: ['id'],
  rows: [
    [1, 'ada', null],
    [2, 'grace', { $type: 'bytes', length: 3, hex: '010203', truncated: false }],
  ],
  hasMore: false,
}

/** Render one element and let every pending effect settle. */
async function render(element) {
  const root = createRoot(container)
  await act(async () => {
    root.render(element)
  })
  // The catalog fetch resolves, then the table fetch; give both a turn.
  await act(async () => {})
  await act(async () => {})
  return root
}

test('the file body renders the table grid with converted cells', async () => {
  const calls = stubFetch({ 'db.catalog': CATALOG, 'db.table': TABLE })
  const { body, useTabInfo } = fileBodyFor('dsh-resource://file/session/s/data/shop.db')
  const root = await render(React.createElement(body, { useTabInfo, t }))

  assert.deepEqual(
    calls.map((call) => call.method),
    ['db.catalog', 'db.table'],
  )
  assert.deepEqual(calls[0].args.target, { kind: 'file', sessionId: 's', path: 'data/shop.db' })
  // Undefined database/schema are dropped by JSON.stringify, so a file request
  // carries only what it needs.
  assert.deepEqual(calls[1].args, {
    target: { kind: 'file', sessionId: 's', path: 'data/shop.db' },
    table: 'users',
    page: 1,
    pageSize: 100,
  })

  const headers = [...container.querySelectorAll('thead th')].map((node) => node.textContent)
  assert.equal(headers.length, 3)
  assert.match(headers[0], /^id/)
  assert.match(headers[1], /^name/)
  assert.match(headers[0], /PK/, 'the primary key column is marked')

  const cells = [...container.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent))
  assert.deepEqual(cells[0], ['1', 'ada', 'NULL'])
  assert.equal(cells[1][0], '2')
  assert.match(cells[1][2], /0x010203/)
  assert.match(cells[1][2], /3 bytes/)

  await act(async () => root.unmount())
})

test('the view dropdown switches between data and structure', async () => {
  stubFetch({ 'db.catalog': CATALOG, 'db.table': TABLE })
  const { body, useTabInfo } = fileBodyFor('dsh-resource://file/session/s/data/shop.db')
  const root = await render(React.createElement(body, { useTabInfo, t }))

  // Data and structure are one choice among a few modes, so they are a dropdown
  // rather than a pair of buttons.
  const viewSelect = [...container.querySelectorAll('select')].find((node) =>
    [...node.options].some((option) => option.value === 'structure'),
  )
  assert.ok(viewSelect !== undefined, 'the view dropdown offers the structure view')
  assert.deepEqual([...viewSelect.options].map((option) => option.value), ['rows', 'structure'])
  assert.equal(viewSelect.value, 'rows', 'the data view is selected first')

  await act(async () => {
    setNativeValue(viewSelect, 'structure')
    viewSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })

  const headers = [...container.querySelectorAll('thead th')].map((node) => node.textContent)
  assert.ok(headers.includes('Column'))
  assert.ok(headers.includes('Type'))
  assert.ok(headers.includes('Index'))
  assert.match(container.textContent, /users_name/)
  assert.match(container.textContent, /Yes/, 'the unique index reports yes')

  await act(async () => {
    setNativeValue(viewSelect, 'rows')
    viewSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  assert.deepEqual(
    [...container.querySelectorAll('thead th')].map((node) => node.textContent.replace(/PK$/, '')),
    ['id', 'name', 'avatar'],
  )
  assert.ok(
    [...container.querySelectorAll('button')].some((node) => node.textContent.includes('Previous')),
    'the pager returns with the data view',
  )

  await act(async () => root.unmount())
})

test('one chrome row holds every picker and action, packed left', async () => {
  stubFetch({ 'db.catalog': CATALOG, 'db.table': TABLE })
  const { body, useTabInfo } = fileBodyFor('dsh-resource://file/session/s/data/shop.db')
  const root = await render(React.createElement(body, { useTabInfo, t }))

  const fieldFor = (text) =>
    [...container.querySelectorAll(`label.${PREFIX}-field`)].find(
      (node) => node.querySelector(`.${PREFIX}-fieldLabel`)?.textContent === text,
    )
  const tableField = fieldFor('Table')
  const viewField = fieldFor('View')
  assert.ok(tableField !== undefined, 'the table field is rendered')
  assert.ok(viewField !== undefined, 'the view field is rendered')
  assert.equal(viewField.parentElement, tableField.parentElement, 'both pickers share one row')

  const bar = tableField.parentElement
  const refresh = [...bar.querySelectorAll('button')].find((node) => node.textContent.includes('Refresh'))
  assert.ok(refresh !== undefined, 'the refresh action sits in the same row')
  assert.ok(bar.textContent.includes('3.45.0'), 'the engine version shares the row')

  // Packed left, with the slack between the actions and the metadata: nothing
  // grows, so no control is pushed away from the group, and the engine version
  // and read-only tag sit at the right edge.
  assert.ok(tableField.className.includes(`${PREFIX}-fieldTable`), 'the table picker may shrink but not grow')
  assert.ok(viewField.className.includes(`${PREFIX}-fieldNarrow`), 'the view picker keeps its content width')
  assert.equal(container.querySelectorAll(`.${PREFIX}-fieldGrow`).length, 0, 'no field grows')

  const children = [...bar.children]
  const spacerIndex = children.findIndex((node) => node.className.includes(`${PREFIX}-spacer`))
  const versionIndex = children.findIndex((node) => node.textContent.includes('3.45.0'))
  const refreshIndex = children.indexOf(refresh.closest('button'))
  assert.ok(spacerIndex !== -1, 'the row carries a spacer')
  assert.ok(versionIndex > spacerIndex, 'the engine version is pushed right of the slack')
  assert.ok(spacerIndex > refreshIndex, 'the slack closes the left-hand group of controls')
  assert.match(children.at(-1).textContent, /Read-only preview/, 'the read-only tag closes the right-hand group')

  const viewSelect = container.querySelector(`select[aria-label="View"]`)
  await act(async () => {
    setNativeValue(viewSelect, 'structure')
    viewSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
  })
  assert.equal(
    [...container.querySelectorAll('button')].some((node) => node.textContent.includes('Previous')),
    false,
    'the pager belongs to the data view alone',
  )
  // The row that holds the pickers survives the switch.
  assert.equal(fieldFor('Table').parentElement, fieldFor('View').parentElement)

  await act(async () => root.unmount())
})

test('a failed catalog read is reported with a retry instead of an empty panel', async () => {
  stubFetch({ 'db.table': TABLE })
  const { body, useTabInfo } = fileBodyFor('dsh-resource://file/session/s/data/shop.db')
  const root = await render(React.createElement(body, { useTabInfo, t }))

  assert.match(container.textContent, /Could not read the database/)
  assert.match(container.textContent, /no stub for db\.catalog/)
  assert.ok([...container.querySelectorAll('button')].some((node) => node.textContent === 'Retry'))

  await act(async () => root.unmount())
})

test('an address that is not a Session file address explains itself', async () => {
  const { body, useTabInfo } = fileBodyFor('dsh-resource://file/absolute/D:/data/shop.db')
  const root = await render(React.createElement(body, { useTabInfo, t }))
  assert.match(container.textContent, /Could not read the database/)
  assert.match(container.textContent, /unsupported address/)
  await act(async () => root.unmount())
})

test('the connection page lists saved profiles without their passwords', async () => {
  const bodies = registeredBodies()
  const connectionsBody = bodies.get('dsh-database-preview/connections')
  stubFetch({
    'connections.list': {
      engines: ['sqlite', 'mysql', 'postgres', 'mssql'],
      defaultPort: { mysql: 3306, postgres: 5432, mssql: 1433 },
      connections: [
        { id: 'prod-pg', label: 'Prod PG', engine: 'postgres', host: 'db.internal', port: 5432, user: 'reader', hasPassword: true },
      ],
    },
  })
  const root = await render(React.createElement(connectionsBody, { t }))
  assert.match(container.textContent, /Prod PG/)
  assert.match(container.textContent, /db\.internal:5432/)
  assert.match(container.textContent, /PostgreSQL/)
  assert.doesNotMatch(container.textContent, /hunter2/)
  assert.ok([...container.querySelectorAll('button')].some((node) => node.textContent === 'New connection'))
  await act(async () => root.unmount())
})

test('a long table list is one select with no filter field, and the grid fills the pane', async () => {
  // Ten tables is the case that used to grow a filter field above the select.
  const manyTables = Array.from({ length: 10 }, (_, index) => ({
    name: index === 0 ? 'application' : `table_${index}`,
    type: 'table',
    schema: '',
  }))
  stubFetch({
    'db.catalog': { ...CATALOG, tables: manyTables },
    'db.table': { ...TABLE, table: 'application' },
  })
  const { body, useTabInfo } = fileBodyFor('dsh-resource://file/session/s/data/app.db')
  const root = await render(React.createElement(body, { useTabInfo, t }))

  assert.equal(container.querySelectorAll('input[type="search"]').length, 0, 'the filter field is gone')
  assert.equal(container.querySelectorAll('input').length, 0, 'the picker holds no text field at all')

  const tableSelect = [...container.querySelectorAll('select')].find((node) => [...node.options].some((option) => option.value === 'application'))
  assert.ok(tableSelect !== undefined, 'the table select is rendered')
  assert.equal(tableSelect.options.length, 10, 'every table is offered, unfiltered')

  // jsdom performs no layout, so the width rule is asserted on the stylesheet.
  assert.match(STYLES, /\.dbp-grid\s*\{[^}]*width:\s*100%/, 'the grid declares a full width')
  assert.equal(STYLES.includes(`${PREFIX}-grid`), true)

  await act(async () => root.unmount())
})

/**
 * A stand-in for `@deepseek-ai/dsh-client-ui-primitives`, which exists only
 * inside the browser kernel and cannot be loaded here. Handing the loader a
 * supplier is how the plugin's resolution path gets exercised.
 *
 * `Button` and `Input` are built with `forwardRef` exactly as the real package
 * builds them — an earlier revision resolved the primitives with a
 * `typeof === 'function'` test, which those objects fail, so both controls
 * silently fell back and the whole panel lost the application's styling. The
 * stub keeps that shape so the mistake cannot come back unnoticed.
 */
function makePrimitivesStub(counts = { button: 0, tag: 0, icon: 0 }) {
  return {
    counts,
    Button: React.forwardRef(function StubButton({ variant, size, icon: leading, className, children, ...rest }, ref) {
      counts.button += 1
      return React.createElement('button', { ...rest, ref, className, 'data-stub': `button:${variant}:${size}` }, leading ?? null, children)
    }),
    Input: React.forwardRef(function StubInput({ icon: leading, className, ...rest }, ref) {
      return React.createElement('input', { ...rest, ref, 'data-stub': 'input' })
    }),
    Checkbox: ({ checked, onChange, label }) =>
      React.createElement(
        'label',
        { 'data-stub': 'checkbox' },
        React.createElement('input', { type: 'checkbox', checked, onChange: (event) => onChange(event.target.checked) }),
        label,
      ),
    Tag: ({ children }) => {
      counts.tag += 1
      return React.createElement('span', { 'data-stub': 'tag' }, children)
    },
    Menu: ({ open, anchor, items = [], selectedId, onSelect, className }) =>
      React.createElement(
        'div',
        { 'data-stub': 'menu', className, 'data-open': String(open) },
        anchor,
        open
          ? React.createElement(
              'ul',
              { 'data-stub': 'menu-list' },
              items.map((item) =>
                React.createElement(
                  'li',
                  { key: item.id },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      'data-item': item.id,
                      'data-selected': String(item.id === selectedId),
                      onClick: () => onSelect(item.id),
                    },
                    item.label,
                  ),
                ),
              ),
            )
          : null,
      ),
    IconChevronLeftOutlineRegular: () => {
      counts.icon += 1
      return React.createElement('i', { 'data-stub': 'icon' })
    },
    IconChevronRightOutlineRegular: () => {
      counts.icon += 1
      return React.createElement('i', { 'data-stub': 'icon' })
    },
    IconRefreshOutlineRegular: () => null,
    IconChevronDownOutlineRegular: () => null,
    IconPlusOutlineRegular: () => null,
  }
}

/** A `require` that answers the primitives specifier with the stub. */
function supplierFor(primitives) {
  return (id) => (id === '@deepseek-ai/dsh-client-ui-primitives' ? primitives : require(id))
}

test('the shared control primitives are used whenever the shell seeds them', async () => {
  const primitives = makePrimitivesStub()
  const stubbed = await loadPluginWith(supplierFor(primitives))
  const body = registeredBodies(stubbed).get('dsh-database-preview')
  const useTabInfo = () => ({ tab: { contentId: 'dsh-resource://file/session/s/data/shop.db' } })
  stubFetch({ 'db.catalog': CATALOG, 'db.table': TABLE })
  const root = await render(React.createElement(body, { useTabInfo, t }))

  assert.ok(primitives.counts.button > 0, 'actions render through the shared Button')
  assert.ok(primitives.counts.tag > 0, 'the read-only badge renders through the shared Tag')
  assert.ok(primitives.counts.icon > 0, 'the pager glyphs come from the primitive package')
  assert.ok(container.querySelector('[data-stub^="button:"]') !== null)
  assert.ok(container.querySelector('[data-stub="tag"]') !== null)
  assert.equal(container.querySelectorAll('select').length, 0, 'no control falls back to a native select')

  // The refresh action shares the dropdown trigger's surface: the ghost variant
  // (borderless), the default 36px, and that trigger's own fill — not the shared
  // Button's `toolbar` fill, which is a different colour.
  const refresh = [...container.querySelectorAll('button')].find((node) => node.textContent === 'Refresh')
  assert.ok(refresh !== undefined, 'the refresh action is rendered')
  assert.equal(refresh.getAttribute('data-stub'), 'button:ghost:md')
  assert.match(refresh.className, new RegExp(`${PREFIX}-chip`), 'it carries the dropdown surface')
  assert.equal(refresh.querySelector('[data-stub="icon"]'), null, 'no glyph to centre against the label')
  assert.match(STYLES, new RegExp(`\\.${PREFIX}-chip\\s*\\{[^}]*--dsw-alias-bg-module-platform`), 'filled with the dropdown token')

  await act(async () => root.unmount())
})

test('a dropdown opens the shared Menu list, not a platform popup', async () => {
  const primitives = makePrimitivesStub()
  const stubbed = await loadPluginWith(supplierFor(primitives))
  const body = registeredBodies(stubbed).get('dsh-database-preview')
  const useTabInfo = () => ({ tab: { contentId: 'dsh-resource://file/session/s/data/shop.db' } })
  stubFetch({ 'db.catalog': CATALOG, 'db.table': TABLE })
  const root = await render(React.createElement(body, { useTabInfo, t }))

  const trigger = container.querySelector('button[aria-label="View"]')
  assert.ok(trigger !== null, 'the dropdown trigger is rendered')
  assert.equal(trigger.getAttribute('aria-haspopup'), 'menu')
  assert.equal(trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(container.querySelector('[data-stub="menu-list"]'), null, 'the list starts closed')

  await act(async () => {
    trigger.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  const list = container.querySelector('[data-stub="menu-list"]')
  assert.ok(list !== null, 'the shared Menu list opened')
  assert.equal(container.querySelector('[data-item="rows"]').getAttribute('data-selected'), 'true', 'the current view is marked')

  await act(async () => {
    container.querySelector('[data-item="structure"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  })
  assert.ok(
    [...container.querySelectorAll('thead th')].some((node) => node.textContent === 'Column'),
    'picking the structure row switched the view',
  )
  assert.equal(container.querySelector('[data-stub="menu-list"]'), null, 'the list closed on selection')

  await act(async () => root.unmount())
})

test('the pager actions are glyph-only chips on the dropdown surface', async () => {
  const primitives = makePrimitivesStub()
  const stubbed = await loadPluginWith(supplierFor(primitives))
  const body = registeredBodies(stubbed).get('dsh-database-preview')
  const useTabInfo = () => ({ tab: { contentId: 'dsh-resource://file/session/s/data/shop.db' } })
  stubFetch({ 'db.catalog': CATALOG, 'db.table': TABLE })
  const root = await render(React.createElement(body, { useTabInfo, t }))

  const prev = container.querySelector('button[aria-label="Previous"]')
  const next = container.querySelector('button[aria-label="Next"]')
  assert.ok(prev !== null, 'the previous action is rendered')
  assert.ok(next !== null, 'the next action is rendered')
  for (const node of [prev, next]) {
    assert.equal(node.textContent, '', 'no visible label')
    assert.match(node.className, new RegExp(`${PREFIX}-chip`), 'shares the dropdown surface')
    assert.match(node.className, new RegExp(`${PREFIX}-iconButton`), 'square, at the row height')
    assert.ok(node.querySelector('[data-stub="icon"]') !== null, 'the glyph rides the icon slot')
  }
  assert.equal(prev.getAttribute('title'), 'Previous', 'the label still reaches the tooltip')
  assert.match(STYLES, new RegExp(`\\.${PREFIX}-iconButton\\s*\\{[^}]*width:\\s*36px`), 'the square is the row height')

  await act(async () => root.unmount())
})

test('every class the components ask for is defined in the stylesheet', async () => {
  // jsdom performs no layout, so a class name that no rule matches is invisible
  // to every other test here; this is the only guard against that silent loss.
  const used = new Set()
  for (const file of ['browse.jsx', 'connections.jsx', 'controls.jsx', 'pages.jsx']) {
    const text = readFileSync(new URL(`../src/client/${file}`, import.meta.url), 'utf8')
    for (const match of text.matchAll(/\$\{PREFIX\}-([A-Za-z][\w]*)/g)) used.add(match[1])
  }
  assert.ok(used.size > 8, 'the scan found the component class names')

  const defined = new Set([...STYLES.matchAll(/\.dbp-([A-Za-z][\w]*)/g)].map((match) => match[1]))
  const missing = [...used].filter((name) => !defined.has(name)).sort()
  assert.deepEqual(missing, [], `classes used but never styled: ${missing.join(', ')}`)
})

test('a shell without the primitives still renders the panel', async () => {
  const bare = await loadPluginWith((id) => require(id))
  const body = registeredBodies(bare).get('dsh-database-preview')
  const useTabInfo = () => ({ tab: { contentId: 'dsh-resource://file/session/s/data/shop.db' } })
  stubFetch({ 'db.catalog': CATALOG, 'db.table': TABLE })
  const root = await render(React.createElement(body, { useTabInfo, t }))

  // The fallback carries the stylesheet's own classes instead of the primitives.
  const buttons = [...container.querySelectorAll('button')]
  assert.ok(buttons.length > 0, 'the fallback still renders actions')
  assert.ok(buttons.every((node) => node.className.includes(`${PREFIX}-button`)))

  // A dropdown degrades to a native select, in the treatment the Settings model
  // form gives its own selects — the open list is the platform's then, which is
  // the one thing this path cannot match.
  const selects = [...container.querySelectorAll('select')]
  assert.ok(selects.length > 0, 'the dropdown degrades to a native select')
  assert.ok(selects.every((node) => node.className.includes(`${PREFIX}-select`)))
  assert.match(STYLES, /appearance:\s*none/, 'the select drops the platform chrome')

  // With no icon set, a glyph-only pager button would be a blank square, so the
  // label comes back — and the square shape is dropped with it.
  const prev = buttons.find((node) => node.textContent === 'Previous')
  assert.ok(prev !== undefined, 'the pager keeps its label when there is no glyph')
  assert.equal(prev.className.includes(`${PREFIX}-iconButton`), false, 'and is not squeezed into a square')
  assert.equal(prev.getAttribute('aria-label'), 'Previous')

  assert.deepEqual(
    [...container.querySelectorAll('tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent)),
    [
      ['1', 'ada', 'NULL'],
      ['2', 'grace', '0x010203 · 3 bytes'],
    ],
  )

  await act(async () => root.unmount())
})
