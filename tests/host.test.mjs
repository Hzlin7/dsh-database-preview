/**
 * Host-half behavior tests.
 *
 * These drive the exported RPC methods directly, so they cover the same path a
 * browser request takes: target resolution, the SQLite magic-header guard, the
 * worker round trip, JSON-safe cell conversion, and the connection-profile store
 * including the rule that editing a profile cannot silently drop its password.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const workDir = mkdtempSync(join(tmpdir(), 'dsh-database-preview-'))
process.env.DSH_DB_PREVIEW_DIR = join(workDir, 'plugin-data')
const dbPath = join(workDir, 'shop.db')
const notADatabase = join(workDir, 'notes.txt')

let ROUTES
let store

before(async () => {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      avatar BLOB,
      score REAL,
      huge INTEGER,
      created TEXT DEFAULT 'now'
    );
    CREATE UNIQUE INDEX users_name ON users (name);
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      total REAL
    );
  `)
  const insert = db.prepare('INSERT INTO users (id, name, avatar, score, huge) VALUES (?, ?, ?, ?, ?)')
  insert.run(1, 'ada', new Uint8Array([1, 2, 3]), 9.5, 42)
  insert.run(2, 'grace', null, 8.25, 9223372036854775807n)
  insert.run(3, 'linus', null, 7, 0)
  db.prepare('INSERT INTO orders (id, user_id, total) VALUES (?, ?, ?)').run(1, 1, 19.99)
  db.close()
  writeFileSync(notADatabase, 'this file is not a database\n')
  ROUTES = (await import('../lib/index.js')).ROUTES
  store = await import('../lib/host/store.js')
})

after(() => {
  rmSync(workDir, { recursive: true, force: true })
})

/** A context stub standing in for the host: no workspace-files service, so absolute paths resolve directly. */
const ctx = {
  get: () => undefined,
  logger: { info: () => {}, warn: () => {} },
}

const fileTarget = { kind: 'file', sessionId: 'session-1', path: dbPath }

test('db.catalog lists tables and views for a SQLite file', async () => {
  const catalog = await ROUTES['db.catalog'](ctx, { target: fileTarget })
  assert.equal(catalog.engine, 'sqlite')
  assert.deepEqual(
    catalog.tables.map((entry) => entry.name).sort(),
    ['orders', 'users'],
  )
  assert.ok(catalog.version.length > 0, 'sqlite_version() should be reported')
  assert.equal(catalog.target.kind, 'file')
})

test('db.table pages rows, reports structure, and marks the primary key', async () => {
  const page = await ROUTES['db.table'](ctx, { target: fileTarget, table: 'users', pageSize: 2, page: 1 })
  assert.equal(page.rows.length, 2)
  assert.equal(page.hasMore, true)
  assert.deepEqual(page.primaryKey, ['id'])
  assert.equal(page.columns[0].name, 'id')
  assert.equal(page.columns.find((column) => column.name === 'name').nullable, false)
  assert.deepEqual(page.indexes.map((index) => index.name), ['users_name'])
  assert.equal(page.indexes[0].unique, true)
})

test('db.table converts blobs and wide integers without losing information', async () => {
  const page = await ROUTES['db.table'](ctx, { target: fileTarget, table: 'users', pageSize: 10, page: 1 })
  const [ada, grace] = page.rows
  const avatarIndex = page.columns.findIndex((column) => column.name === 'avatar')
  const hugeIndex = page.columns.findIndex((column) => column.name === 'huge')
  assert.deepEqual(ada[avatarIndex], { $type: 'bytes', length: 3, hex: '010203', truncated: false })
  assert.equal(grace[avatarIndex], null)
  assert.equal(grace[hugeIndex], '9223372036854775807', 'a value beyond Number.MAX_SAFE_INTEGER must survive as a string')
  assert.equal(ada[hugeIndex], 42)
})

test('db.table reports the second page and stops offering more', async () => {
  const page = await ROUTES['db.table'](ctx, { target: fileTarget, table: 'users', pageSize: 2, page: 2 })
  assert.equal(page.rows.length, 1)
  assert.equal(page.hasMore, false)
})

test('db.table refuses a table that does not exist', async () => {
  await assert.rejects(() => ROUTES['db.table'](ctx, { target: fileTarget, table: 'nope' }), /unknown table "nope"/)
})

test('a file that is not a SQLite database is refused before any worker starts', async () => {
  await assert.rejects(
    () => ROUTES['db.catalog'](ctx, { target: { kind: 'file', sessionId: 'session-1', path: notADatabase } }),
    /is not a SQLite database/,
  )
})

test('a missing file is reported rather than thrown raw', async () => {
  await assert.rejects(
    () => ROUTES['db.catalog'](ctx, { target: { kind: 'file', sessionId: 'session-1', path: join(workDir, 'gone.db') } }),
    /cannot open/,
  )
})

test('an unknown engine or target shape is a caller error', async () => {
  await assert.rejects(() => ROUTES['db.catalog'](ctx, { target: { kind: 'nope' } }), /target\.kind must be/)
  await assert.rejects(() => ROUTES['db.catalog'](ctx, {}), /target is required/)
})

test('connection profiles round-trip with the password redacted', async () => {
  const saved = await ROUTES['connections.save'](ctx, {
    profile: { label: 'Local MySQL', engine: 'mysql', host: '127.0.0.1', port: 3306, user: 'root', password: 'secret' },
  })
  assert.equal(saved.connection.password, undefined, 'the password must never be returned')
  assert.equal(saved.connection.hasPassword, true)
  assert.equal(saved.connection.passwordResolved, true)

  const listed = await ROUTES['connections.list'](ctx, {})
  assert.equal(listed.connections.length, 1)
  assert.equal(listed.connections[0].password, undefined)
  assert.ok(listed.engines.includes('postgres'))
})

test('editing a profile without a password keeps the stored secret, and clearing needs the flag', async () => {
  const saved = await ROUTES['connections.save'](ctx, {
    profile: { label: 'Edited MySQL', engine: 'mysql', host: '127.0.0.1', port: 3307, user: 'root', password: 'secret-2' },
  })
  assert.equal(store.findProfile(saved.connection.id).password, 'secret-2')

  await ROUTES['connections.save'](ctx, {
    profile: { id: saved.connection.id, label: 'Edited MySQL', engine: 'mysql', host: '127.0.0.1', port: 3308, user: 'root' },
  })
  assert.equal(store.findProfile(saved.connection.id).password, 'secret-2', 'a blank field must not drop the secret')
  assert.equal(store.findProfile(saved.connection.id).port, 3308)

  await ROUTES['connections.save'](ctx, {
    profile: { id: saved.connection.id, label: 'Edited MySQL', engine: 'mysql', host: '127.0.0.1', port: 3308, user: 'root', clearPassword: true },
  })
  assert.equal(store.findProfile(saved.connection.id).password, undefined)

  await ROUTES['connections.delete'](ctx, { connectionId: saved.connection.id })
  assert.equal((await ROUTES['connections.list'](ctx, {})).connections.length, 1)
})

test('profiles are validated: engine, required fields, port range and env-var grammar', () => {
  assert.throws(() => store.normalizeProfile({ label: 'x', engine: 'oracle', host: 'h', user: 'u' }, undefined, new Set()), /engine must be one of/)
  assert.throws(() => store.normalizeProfile({ label: 'x', engine: 'postgres', host: 'h', user: 'u', port: 70000 }, undefined, new Set()), /port must be/)
  assert.throws(() => store.normalizeProfile({ label: 'x', engine: 'sqlite' }, undefined, new Set()), /path is required/)
  assert.throws(
    () => store.normalizeProfile({ label: 'x', engine: 'mysql', host: 'h', user: 'u', passwordEnv: 'not a name' }, undefined, new Set()),
    /passwordEnv must be an environment variable name/,
  )
  const defaults = store.normalizeProfile({ label: 'My Server', engine: 'postgres', host: 'h', user: 'u' }, undefined, new Set())
  assert.equal(defaults.port, 5432, 'an omitted port takes the engine default')
  assert.match(defaults.id, /^my-server$/)
})

test('a password environment variable takes precedence over a stored literal', () => {
  process.env.DBP_TEST_PASSWORD = 'from-env'
  const profile = store.normalizeProfile(
    { label: 'x', engine: 'mysql', host: 'h', user: 'u', password: 'literal', passwordEnv: 'DBP_TEST_PASSWORD' },
    undefined,
    new Set(),
  )
  assert.equal(store.resolvePassword(profile), 'from-env')
  delete process.env.DBP_TEST_PASSWORD
  assert.equal(store.resolvePassword(profile), 'literal')
})

test('identifiers are quoted per engine and escape their own quote character', async () => {
  const { quoteIdent, quotePath, clampInt } = await import('../lib/host/util.js')
  assert.equal(quoteIdent('sqlite', 'odd"name'), '"odd""name"')
  assert.equal(quoteIdent('mysql', 'odd`name'), '`odd``name`')
  assert.equal(quoteIdent('mssql', 'odd]name'), '[odd]]name]')
  assert.equal(quotePath('postgres', ['public', 'users']), '"public"."users"')
  assert.equal(clampInt(9999, 1, 500, 100), 500)
  assert.equal(clampInt('nonsense', 1, 500, 100), 100)
  assert.equal(clampInt(-5, 1, 500, 100), 1)
})

/** A package directory with the given name and version, for the update tests. */
function makePackageDir(root, name, version) {
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name, version }))
  return root
}

/** A fetch stand-in that answers one registry lookup. */
function registryAnswer(status, body) {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body })
}

test('versions are compared the way an update decision needs', async () => {
  const { parseVersion, compareVersions } = await import('../lib/host/update.js')
  assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: null })
  assert.deepEqual(parseVersion('1.2.3-beta.1').prerelease, 'beta.1')
  assert.equal(parseVersion('1.2'), undefined)
  assert.equal(parseVersion('not a version'), undefined)
  assert.equal(parseVersion(undefined), undefined)

  assert.equal(compareVersions('0.1.0', '0.1.0'), 0)
  assert.equal(compareVersions('0.1.1', '0.1.0'), 1)
  assert.equal(compareVersions('0.2.0', '0.1.9'), 1)
  assert.equal(compareVersions('1.0.0', '0.9.9'), 1)
  assert.equal(compareVersions('0.1.0', '0.1.1'), -1)
  // A prerelease ranks below its own release, and identifiers compare per semver.
  assert.equal(compareVersions('1.0.0-rc.1', '1.0.0'), -1)
  assert.equal(compareVersions('1.0.0-rc.2', '1.0.0-rc.10'), -1)
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-beta'), -1)
  // Unparsable input must not be guessed at.
  assert.equal(compareVersions('nonsense', '1.0.0'), undefined)
})

test('the install shape tells a linked checkout apart from an installed copy', async () => {
  const { installShape } = await import('../lib/host/update.js')
  assert.deepEqual(installShape(join(workDir, 'checkout')), { kind: 'link' })

  const profile = join(workDir, 'profiles', 'desktop')
  const installed = join(profile, 'node_modules', 'dsh-database-preview')
  mkdirSync(installed, { recursive: true })
  assert.deepEqual(installShape(installed), { kind: 'copy', profileDir: profile, profileName: 'desktop' })

  // pnpm's isolated layout keeps the real files one level deeper; the profile is
  // still the last `profiles/<name>/node_modules` ancestor.
  const pnpm = join(profile, 'node_modules', '.pnpm', 'dsh-database-preview@0.1.0', 'node_modules', 'dsh-database-preview')
  mkdirSync(pnpm, { recursive: true })
  assert.deepEqual(installShape(pnpm), { kind: 'copy', profileDir: profile, profileName: 'desktop' })
})

test('an unpublished package reports the registry gap instead of "up to date"', async () => {
  const { updateStatus } = await import('../lib/host/update.js')
  const dir = makePackageDir(mkdtempSync(join(workDir, 'unpublished-')), 'probe-unpublished', '0.1.0')
  const status = await updateStatus({ packageDir: dir, fetchImpl: registryAnswer(404, {}) })
  assert.equal(status.ok, true)
  assert.deepEqual(status.latest, { known: false, reason: 'not-published' })
  // Unknown is not the same answer as "current", so no verdict is invented.
  assert.equal(status.updateAvailable, undefined)
  assert.equal(status.runningVersion, '0.1.0')
  assert.equal(status.canDelegate, false, 'a directory outside node_modules is a checkout')
})

test('an update is offered only when the registry has a strictly newer version', async () => {
  const { updateStatus } = await import('../lib/host/update.js')
  const newer = makePackageDir(mkdtempSync(join(workDir, 'newer-')), 'probe-newer', '0.1.0')
  const ahead = await updateStatus({ packageDir: newer, fetchImpl: registryAnswer(200, { version: '0.2.0' }) })
  assert.equal(ahead.updateAvailable, true)

  const same = makePackageDir(mkdtempSync(join(workDir, 'same-')), 'probe-same', '0.1.0')
  const level = await updateStatus({ packageDir: same, fetchImpl: registryAnswer(200, { version: '0.1.0' }) })
  assert.equal(level.updateAvailable, false)

  // A registry that answers with something older must never offer a downgrade.
  const older = makePackageDir(mkdtempSync(join(workDir, 'older-')), 'probe-older', '0.2.0')
  const behind = await updateStatus({ packageDir: older, fetchImpl: registryAnswer(200, { version: '0.1.0' }) })
  assert.equal(behind.updateAvailable, false)
})

test('a failed registry lookup is reported, not swallowed', async () => {
  const { updateStatus } = await import('../lib/host/update.js')
  const dir = makePackageDir(mkdtempSync(join(workDir, 'offline-')), 'probe-offline', '0.1.0')
  const refused = await updateStatus({
    packageDir: dir,
    fetchImpl: async () => {
      throw new Error('getaddrinfo ENOTFOUND registry.npmjs.org')
    },
  })
  assert.equal(refused.latest.known, false)
  assert.match(refused.latest.reason, /ENOTFOUND/)
  assert.equal(refused.updateAvailable, undefined)
})

test('a newer version on disk than the loaded code is reported as restart-pending', async () => {
  const { updateStatus } = await import('../lib/host/update.js')
  const dir = makePackageDir(mkdtempSync(join(workDir, 'pending-')), 'probe-pending', '0.2.0')
  const status = await updateStatus({ packageDir: dir, runningVersion: '0.1.0', fetchImpl: registryAnswer(200, { version: '0.2.0' }) })
  assert.equal(status.diskVersion, '0.2.0')
  assert.equal(status.runningVersion, '0.1.0')
  assert.equal(status.pendingRestart, true)
  assert.equal(status.updateAvailable, false, 'the target already sits on disk')
})

test('the shipped package reports its own name and version', async () => {
  const { updateStatus } = await import('../lib/host/update.js')
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const status = await updateStatus({ fetchImpl: registryAnswer(404, {}) })
  assert.equal(status.ok, true)
  assert.equal(status.packageName, manifest.name)
  assert.equal(status.diskVersion, manifest.version)
  assert.equal(status.runningVersion, manifest.version)
})
