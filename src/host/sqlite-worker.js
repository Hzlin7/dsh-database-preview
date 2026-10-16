/**
 * SQLite reader that runs on a worker thread.
 *
 * `node:sqlite` is synchronous, so a pathological query (a deep OFFSET over an
 * unindexed table, a huge BLOB) would otherwise block the host's event loop and
 * freeze the whole GUI. Living on a worker lets the caller impose a wall-clock
 * deadline and terminate the thread, which is the only reliable way to cancel
 * synchronous SQLite work.
 *
 * `workerData` carries one task; the worker answers with exactly one message.
 * @module dsh-database-preview/host/sqlite-worker
 */
import { parentPort, workerData } from 'node:worker_threads'
import { toJsonValue } from './util.js'

/** Largest integer JavaScript represents exactly; anything wider stays a string. */
const MAX_SAFE = 9007199254740991n

/**
 * Convert one SQLite value into a JSON-safe cell.
 *
 * Integers arrive as bigints because the statement reads them that way, so a
 * value that fits a JavaScript number becomes one and anything wider keeps full
 * precision as a string. Blobs and dates go through the shared converter.
 * @param value - value returned by `node:sqlite`.
 * @returns a JSON-safe value.
 */
function cell(value) {
  if (typeof value === 'bigint') return value <= MAX_SAFE && value >= -MAX_SAFE ? Number(value) : value.toString()
  if (value !== null && typeof value === 'object') return toJsonValue(value)
  return value
}

/** Convert one row object into an array following the statement's column order. */
function rowToArray(row, columnNames) {
  return columnNames.map((name) => cell(row[name]))
}

/**
 * Describe a table: columns, indexes and primary key.
 * @param db - the open read-only database.
 * @param table - table name already validated against the catalog.
 * @returns the structure report.
 */
function describeTable(db, table) {
  const quoted = `"${table.replace(/"/g, '""')}"`
  const columns = db.prepare(`PRAGMA table_info(${quoted})`).all().map((entry) => ({
    name: String(entry.name),
    type: entry.type === '' ? '' : String(entry.type),
    nullable: Number(entry.notnull) === 0,
    defaultValue: entry.dflt_value === null ? null : String(entry.dflt_value),
    primaryKey: Number(entry.pk) > 0,
  }))
  const primaryKey = columns.filter((column) => column.primaryKey).map((column) => column.name)
  const indexes = []
  for (const entry of db.prepare(`PRAGMA index_list(${quoted})`).all()) {
    const indexName = String(entry.name)
    const quotedIndex = `"${indexName.replace(/"/g, '""')}"`
    const members = db.prepare(`PRAGMA index_info(${quotedIndex})`).all()
      .sort((left, right) => Number(left.seqno) - Number(right.seqno))
      .map((member) => String(member.name))
    indexes.push({ name: indexName, unique: Number(entry.unique) === 1, origin: String(entry.origin ?? ''), columns: members })
  }
  return { columns, indexes, primaryKey }
}

/**
 * Run the requested task and post its result.
 * @returns nothing; the answer leaves through `parentPort`.
 */
async function main() {
  const sqlite = await import('node:sqlite')
  const dbPath = String(workerData.dbPath)
  let db
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true })
  } catch (error) {
    const message = String(error?.message ?? error)
    const hint = /unable to open|CANTOPEN/i.test(message)
      ? ' The file may be missing, unreadable, or a WAL database whose directory is not writable.'
      : ''
    throw new Error(`${message}${hint}`)
  }
  try {
    // Belt and braces: even a read-only handle is told to refuse writes.
    try {
      db.exec('PRAGMA query_only = ON')
    } catch {
      // query_only is unavailable on some builds; readOnly already covers us.
    }
    const version = String(db.prepare('SELECT sqlite_version() AS version').get()?.version ?? 'unknown')
    const op = String(workerData.op)
    if (op === 'probe') {
      const count = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type IN ('table','view')").get()
      return { engine: 'sqlite', version, tables: Number(count?.n ?? 0) }
    }
    if (op === 'catalog') {
      const rows = db.prepare(
        "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
      ).all()
      return {
        engine: 'sqlite',
        version,
        databases: [],
        schemas: [],
        tables: rows.map((row) => ({ name: String(row.name), type: String(row.type) === 'view' ? 'view' : 'table', schema: '' })),
      }
    }
    if (op === 'table') {
      const table = String(workerData.table)
      const structure = describeTable(db, table)
      if (structure.columns.length === 0) throw new Error(`unknown table "${table}"`)
      const pageSize = Number(workerData.pageSize)
      const offset = Number(workerData.offset)
      const quoted = `"${table.replace(/"/g, '""')}"`
      const statement = db.prepare(`SELECT * FROM ${quoted} LIMIT ? OFFSET ?`)
      statement.setReadBigInts(true)
      const columnNames = statement.columns().map((column) => String(column.name))
      const rows = statement.all(pageSize + 1, offset).map((row) => rowToArray(row, columnNames))
      const hasMore = rows.length > pageSize
      return {
        engine: 'sqlite',
        columns: structure.columns,
        indexes: structure.indexes,
        primaryKey: structure.primaryKey,
        rows: hasMore ? rows.slice(0, pageSize) : rows,
        hasMore,
      }
    }
    throw new Error(`unknown operation "${op}"`)
  } finally {
    try {
      db.close()
    } catch {
      // Closing a handle we already gave up on must not mask the real error.
    }
  }
}

try {
  const value = await main()
  parentPort.postMessage({ ok: true, value })
} catch (error) {
  parentPort.postMessage({ ok: false, error: { message: String(error?.message ?? error) } })
}
