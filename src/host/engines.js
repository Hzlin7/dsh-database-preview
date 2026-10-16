/**
 * Read-only database engines.
 *
 * Every query this module issues is generated here from an introspected
 * catalog; no caller-supplied SQL ever reaches a driver. Identifiers are quoted
 * per engine and validated against introspection first, and SQ-parameter
 * placeholders carry the only caller-supplied values (page size and offset).
 *
 * SQLite runs on a worker thread (see `sqlite-worker.js`); the server engines
 * open one short-lived connection per call, so no handle outlives a request and
 * a disabled connection can never keep a socket alive in the host.
 * @module dsh-database-preview/host/engines
 */
import { Worker } from 'node:worker_threads'
import { RpcError, quotePath, toJsonRow, toJsonValue } from './util.js'
import { resolvePassword } from './store.js'

/** Wall-clock deadline for one SQLite task, enforced by terminating the worker. */
const SQLITE_TIMEOUT_MS = 20000
/** Wall-clock deadline for one server round trip. */
const SERVER_TIMEOUT_MS = 20000
/** Connect timeout for a server engine. */
const CONNECT_TIMEOUT_MS = 10000

/**
 * Import a database driver, turning a missing dependency into actionable copy.
 * @param specifier - bare module specifier.
 * @returns the driver module namespace.
 * @throws RpcError when the driver is not installed.
 */
async function loadDriver(specifier) {
  try {
    return await import(specifier)
  } catch (error) {
    throw new RpcError(500, `the "${specifier}" driver is not available to this plugin: ${String(error?.message ?? error)}`)
  }
}

/** Build the `{ ok, value }` / `{ ok, error }` protocol the worker answers with. */
function runSqliteWorker(dbPath, task) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    const worker = new Worker(new URL('./sqlite-worker.js', import.meta.url), {
      workerData: { dbPath, ...task },
    })
    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.terminate().catch(() => {})
      if (error !== null) reject(error)
      else resolve(value)
    }
    timer = setTimeout(() => {
      finish(new RpcError(504, `SQLite did not answer within ${SQLITE_TIMEOUT_MS} ms; the database may be very large or locked`))
    }, SQLITE_TIMEOUT_MS)
    worker.once('message', (message) => {
      if (message !== null && typeof message === 'object' && message.ok === true) finish(null, message.value)
      else finish(new RpcError(400, String(message?.error?.message ?? 'SQLite worker failed')), undefined)
    })
    worker.once('error', (error) => finish(new RpcError(500, String(error?.message ?? error)), undefined))
    worker.once('exit', (code) => {
      if (code !== 0) finish(new RpcError(500, `SQLite worker exited with code ${code}`), undefined)
    })
  })
}

/**
 * Normalize a driver's cell values, keeping array rows aligned with their column order.
 * @param rows - rows as arrays (pg, mysql) or objects (mssql).
 * @param columnNames - column names in select order.
 * @param arrayRows - whether `rows` already hold arrays.
 * @returns JSON-safe row arrays.
 */
function serializeRows(rows, columnNames, arrayRows) {
  if (arrayRows) return rows.map((row) => toJsonRow(row))
  return rows.map((row) => columnNames.map((name) => toJsonValue(row[name])))
}

/** Whether a driver error means "the connection died", worth reporting as a gateway failure. */
function connectionFailure(error) {
  return new RpcError(502, String(error?.message ?? error))
}

/** MySQL/MariaDB adapter. */
const mysql = {
  /** @param profile - connection profile. @param database - database to open, or undefined for none. */
  async connect(profile, database, onConnected) {
    const driver = await loadDriver('mysql2/promise')
    const connection = await driver.createConnection({
      host: profile.host,
      port: profile.port,
      user: profile.user,
      password: resolvePassword(profile),
      database: database ?? profile.database,
      connectTimeout: CONNECT_TIMEOUT_MS,
      multipleStatements: false,
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
      rowsAsArray: true,
    }).catch((error) => {
      throw connectionFailure(error)
    })
    try {
      await connection.query('SET SESSION TRANSACTION READ ONLY')
      return await onConnected(connection)
    } finally {
      await connection.end().catch(() => {})
    }
  },
  /** @param profile - connection profile. */
  async catalog(profile, selection) {
    return mysql.connect(profile, selection.database, async (connection) => {
      const [[versionRow]] = await connection.query('SELECT VERSION() AS v')
      const [databases] = await connection.query('SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME')
      const current = selection.database ?? profile.database ?? null
      let tables = []
      if (current !== null && current !== undefined) {
        const [rows] = await connection.query(
          'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
          [current],
        )
        tables = rows.map((row) => ({ name: String(row[0]), type: String(row[1]).includes('VIEW') ? 'view' : 'table', schema: current }))
      }
      return {
        engine: 'mysql',
        version: String(versionRow?.[0] ?? 'unknown'),
        databases: databases.map((row) => String(row[0])),
        schemas: [],
        currentDatabase: current,
        currentSchema: null,
        tables,
      }
    })
  },
  /** @param profile - connection profile. */
  async table(profile, selection) {
    const database = selection.database ?? profile.database
    if (database === undefined || database === null) throw new RpcError(400, 'select a database first')
    const table = selection.table
    return mysql.connect(profile, database, async (connection) => {
      const qualified = quotePath('mysql', [database, table])
      const [columns] = await connection.query(`SHOW COLUMNS FROM ${qualified}`)
      if (columns.length === 0) throw new RpcError(400, `unknown table "${table}"`)
      const [indexRows] = await connection.query(`SHOW INDEX FROM ${qualified}`)
      const indexes = []
      for (const row of indexRows) {
        const name = String(row[2])
        let entry = indexes.find((candidate) => candidate.name === name)
        if (entry === undefined) {
          entry = { name, unique: Number(row[1]) === 0, columns: [] }
          indexes.push(entry)
        }
        entry.columns.push(String(row[4]))
      }
      const [rows] = await connection.query(`SELECT * FROM ${qualified} LIMIT ? OFFSET ?`, [selection.pageSize + 1, selection.offset])
      const hasMore = rows.length > selection.pageSize
      return {
        engine: 'mysql',
        columns: columns.map((row) => ({
          name: String(row[0]),
          type: String(row[1] ?? ''),
          nullable: String(row[2]).toUpperCase() === 'YES',
          defaultValue: row[4] === undefined ? null : toJsonValue(row[4]),
          primaryKey: String(row[3]).toUpperCase() === 'PRI',
        })),
        indexes,
        primaryKey: columns.filter((row) => String(row[3]).toUpperCase() === 'PRI').map((row) => String(row[0])),
        rows: serializeRows(hasMore ? rows.slice(0, selection.pageSize) : rows, [], true),
        hasMore,
      }
    })
  },
}

/** PostgreSQL adapter. */
const postgres = {
  /** @param profile - connection profile. @param database - database to open. */
  async connect(profile, database, onConnected) {
    const driver = await loadDriver('pg')
    const client = new driver.Client({
      host: profile.host,
      port: profile.port,
      user: profile.user,
      password: resolvePassword(profile),
      database: database ?? profile.database ?? 'postgres',
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      statement_timeout: SERVER_TIMEOUT_MS,
      query_timeout: SERVER_TIMEOUT_MS,
      application_name: 'dsh-database-preview',
      // The server refuses writes for this session even if a statement slipped through.
      options: '-c default_transaction_read_only=on',
      ssl: profile.encrypt === true ? { rejectUnauthorized: false } : undefined,
    })
    client.on('error', () => {})
    try {
      await client.connect()
    } catch (error) {
      throw connectionFailure(error)
    }
    try {
      return await onConnected(client)
    } finally {
      await client.end().catch(() => {})
    }
  },
  /** @param profile - connection profile. */
  async catalog(profile, selection) {
    const database = selection.database ?? profile.database ?? 'postgres'
    return postgres.connect(profile, database, async (client) => {
      const version = await client.query('SHOW server_version')
      const databases = await client.query('SELECT datname FROM pg_database WHERE NOT datistemplate ORDER BY datname')
      const schemas = await client.query(
        "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema' ORDER BY nspname",
      )
      const currentSchema = selection.schema ?? profile.schema ?? schemas.rows[0]?.nspname ?? 'public'
      const tables = await client.query(
        'SELECT table_schema, table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
        [currentSchema],
      )
      return {
        engine: 'postgres',
        version: String(version.rows[0]?.server_version ?? 'unknown'),
        databases: databases.rows.map((row) => String(row.datname)),
        schemas: schemas.rows.map((row) => String(row.nspname)),
        currentDatabase: database,
        currentSchema,
        tables: tables.rows.map((row) => ({
          name: String(row.table_name),
          type: String(row.table_type).includes('VIEW') ? 'view' : 'table',
          schema: String(row.table_schema),
        })),
      }
    })
  },
  /** @param profile - connection profile. */
  async table(profile, selection) {
    const database = selection.database ?? profile.database ?? 'postgres'
    const schema = selection.schema ?? profile.schema ?? 'public'
    return postgres.connect(profile, database, async (client) => {
      const columns = await client.query(
        'SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position',
        [schema, selection.table],
      )
      if (columns.rows.length === 0) throw new RpcError(400, `unknown table "${selection.table}"`)
      const indexes = await client.query('SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename = $2 ORDER BY indexname', [
        schema,
        selection.table,
      ])
      const qualified = quotePath('postgres', [schema, selection.table])
      const page = await client.query({
        text: `SELECT * FROM ${qualified} LIMIT $1 OFFSET $2`,
        values: [selection.pageSize + 1, selection.offset],
        rowMode: 'array',
      })
      const hasMore = page.rows.length > selection.pageSize
      const primaryKey = await client.query(
        `SELECT a.attname FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) WHERE i.indrelid = $1::regclass AND i.indisprimary`,
        [qualified],
      )
      return {
        engine: 'postgres',
        columns: columns.rows.map((row) => ({
          name: String(row.column_name),
          type: String(row.data_type),
          nullable: String(row.is_nullable).toUpperCase() === 'YES',
          defaultValue: row.column_default === null ? null : String(row.column_default),
          primaryKey: primaryKey.rows.some((key) => String(key.attname) === String(row.column_name)),
        })),
        indexes: indexes.rows.map((row) => ({ name: String(row.indexname), unique: /UNIQUE/i.test(String(row.indexdef)), columns: [] })),
        primaryKey: primaryKey.rows.map((row) => String(row.attname)),
        rows: serializeRows(hasMore ? page.rows.slice(0, selection.pageSize) : page.rows, [], true),
        hasMore,
      }
    })
  },
}

/** Microsoft SQL Server adapter. */
const mssql = {
  /** @param profile - connection profile. @param database - database to open. */
  async connect(profile, database, onConnected) {
    const driver = await loadDriver('mssql')
    const pool = new driver.ConnectionPool({
      server: profile.host,
      port: profile.port,
      user: profile.user,
      password: resolvePassword(profile),
      database: database ?? profile.database ?? 'master',
      connectionTimeout: CONNECT_TIMEOUT_MS,
      requestTimeout: SERVER_TIMEOUT_MS,
      pool: { max: 1, min: 0, idleTimeoutMillis: 5000 },
      options: { encrypt: profile.encrypt === true, trustServerCertificate: true, enableArithAbort: true },
    })
    pool.on('error', () => {})
    try {
      await pool.connect()
    } catch (error) {
      throw connectionFailure(error)
    }
    try {
      return await onConnected(pool)
    } finally {
      await pool.close().catch(() => {})
    }
  },
  /** @param profile - connection profile. */
  async catalog(profile, selection) {
    const database = selection.database ?? profile.database ?? 'master'
    return mssql.connect(profile, database, async (pool) => {
      const version = await pool.request().query('SELECT SERVERPROPERTY(\'productversion\') AS v')
      const databases = await pool.request().query('SELECT name FROM sys.databases WHERE database_id > 4 ORDER BY name')
      const schemas = await pool.request().query("SELECT name FROM sys.schemas WHERE name NOT IN ('guest','INFORMATION_SCHEMA','sys') ORDER BY name")
      const currentSchema = selection.schema ?? profile.schema ?? schemas.recordset[0]?.name ?? 'dbo'
      const tables = await pool.request().input('schema', currentSchema).query(
        'SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = @schema ORDER BY TABLE_NAME',
      )
      return {
        engine: 'mssql',
        version: String(version.recordset[0]?.v ?? 'unknown'),
        databases: databases.recordset.map((row) => String(row.name)),
        schemas: schemas.recordset.map((row) => String(row.name)),
        currentDatabase: database,
        currentSchema,
        tables: tables.recordset.map((row) => ({
          name: String(row.TABLE_NAME),
          type: String(row.TABLE_TYPE).includes('VIEW') ? 'view' : 'table',
          schema: String(row.TABLE_SCHEMA),
        })),
      }
    })
  },
  /** @param profile - connection profile. */
  async table(profile, selection) {
    const database = selection.database ?? profile.database ?? 'master'
    const schema = selection.schema ?? profile.schema ?? 'dbo'
    return mssql.connect(profile, database, async (pool) => {
      const columns = await pool.request().input('schema', schema).input('table', selection.table).query(
        'SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = @schema AND TABLE_NAME = @table ORDER BY ORDINAL_POSITION',
      )
      if (columns.recordset.length === 0) throw new RpcError(400, `unknown table "${selection.table}"`)
      const columnNames = columns.recordset.map((row) => String(row.COLUMN_NAME))
      const indexes = await pool.request().input('schema', schema).input('table', selection.table).query(
        `SELECT i.name AS index_name, i.is_unique, c.name AS column_name
         FROM sys.indexes i
         JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         JOIN sys.tables t ON t.object_id = i.object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
         WHERE s.name = @schema AND t.name = @table AND ic.is_included_column = 0
         ORDER BY i.name, ic.key_ordinal`,
      )
      const indexList = []
      for (const row of indexes.recordset) {
        const name = String(row.index_name)
        let entry = indexList.find((candidate) => candidate.name === name)
        if (entry === undefined) {
          entry = { name, unique: Boolean(row.is_unique), columns: [] }
          indexList.push(entry)
        }
        entry.columns.push(String(row.column_name))
      }
      const qualified = quotePath('mssql', [schema, selection.table])
      const page = await pool.request()
        .input('offset', selection.offset)
        .input('limit', selection.pageSize + 1)
        .query(`SELECT * FROM ${qualified} ORDER BY (SELECT NULL) OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`)
      const rows = page.recordset
      const hasMore = rows.length > selection.pageSize
      const primaryKey = await pool.request().input('schema', schema).input('table', selection.table).query(
        `SELECT c.name AS column_name
         FROM sys.indexes i
         JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         JOIN sys.tables t ON t.object_id = i.object_id
         JOIN sys.schemas s ON s.schema_id = t.schema_id
         WHERE s.name = @schema AND t.name = @table AND i.is_primary_key = 1
         ORDER BY ic.key_ordinal`,
      )
      const keys = primaryKey.recordset.map((row) => String(row.column_name))
      return {
        engine: 'mssql',
        columns: columns.recordset.map((row) => ({
          name: String(row.COLUMN_NAME),
          type: String(row.DATA_TYPE),
          nullable: String(row.IS_NULLABLE).toUpperCase() === 'YES',
          defaultValue: row.COLUMN_DEFAULT === null ? null : String(row.COLUMN_DEFAULT),
          primaryKey: keys.includes(String(row.COLUMN_NAME)),
        })),
        indexes: indexList,
        primaryKey: keys,
        rows: serializeRows(hasMore ? rows.slice(0, selection.pageSize) : rows, columnNames, false),
        hasMore,
      }
    })
  },
}

/** SQLite adapter, delegating every task to a worker thread. */
const sqlite = {
  /** @param dbPath - absolute path to the database file. */
  async catalog(dbPath) {
    return runSqliteWorker(dbPath, { op: 'catalog' })
  },
  /** @param dbPath - absolute path to the database file. */
  async table(dbPath, selection) {
    const result = await runSqliteWorker(dbPath, {
      op: 'table',
      table: selection.table,
      pageSize: selection.pageSize,
      offset: selection.offset,
    })
    return result
  },
  /** @param dbPath - absolute path to the database file. */
  async probe(dbPath) {
    return runSqliteWorker(dbPath, { op: 'probe' })
  },
}

/** Engine name to adapter. */
const ADAPTERS = { sqlite, mysql, postgres, mssql }

/**
 * Look up an adapter.
 * @param engine - engine name from a request.
 * @returns the adapter.
 * @throws RpcError for an unknown engine.
 */
export function adapterFor(engine) {
  const adapter = ADAPTERS[engine]
  if (adapter === undefined) throw new RpcError(400, `unknown engine "${engine}"`)
  return adapter
}
