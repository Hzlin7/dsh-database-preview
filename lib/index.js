/**
 * Database preview — host half.
 *
 * Serves one authenticated JSON RPC surface over the harness web server:
 * `POST /_dsh/dsh-database-preview/<method>`. Every method is read-only with
 * respect to the databases it inspects; the only writes this plugin performs are
 * to its own connection-profile document.
 *
 * File targets arrive as `{ sessionId, path }` and are resolved through the
 * host's own workspace-files service, so the sandbox backend keeps its authority
 * over which files are readable, and the client never supplies a raw filesystem
 * path of its own choosing.
 * @module dsh-database-preview
 */
import { openSync, readSync, closeSync, statSync } from 'node:fs'
import { basename, isAbsolute, resolve as resolvePath } from 'node:path'
import { RpcError, clampInt, requireText } from './host/util.js'
import {
  DEFAULT_PORT,
  ENGINES,
  findProfile,
  normalizeProfile,
  readStore,
  redact,
  sweepTemporaryFiles,
  writeStore,
} from './host/store.js'
import { adapterFor } from './host/engines.js'

/** Route prefix claimed on the web server. */
const ROUTE_PREFIX = '/_dsh/dsh-database-preview'
/** Largest accepted request body. */
const MAX_BODY_BYTES = 128 * 1024
/** Rows per page by default and at most. */
const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 500
/** Largest accepted page number, bounding the work one OFFSET can request. */
const MAX_PAGE = 5000
/** Largest serialized response before rows are dropped. */
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
/** Deadline for host-side file resolution. */
const RESOLVE_TIMEOUT_MS = 20000
/** The 16-byte header every SQLite database file starts with. */
const SQLITE_MAGIC = 'SQLite format 3\u0000'

/**
 * `AbortSignal.timeout` is missing from some embedded runtimes; a missing signal
 * means "no deadline" rather than a thrown error.
 * @param ms - deadline in milliseconds.
 * @returns the signal, or undefined when unsupported.
 */
function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined
}

/**
 * Refuse a file that is not a SQLite database, before a worker is spawned.
 * @param absolutePath - resolved file path.
 * @throws RpcError when the file is missing, not a regular file, or not SQLite.
 */
function assertSqliteFile(absolutePath) {
  let stat
  try {
    stat = statSync(absolutePath)
  } catch (error) {
    throw new RpcError(400, `cannot open ${absolutePath}: ${String(error?.message ?? error)}`)
  }
  if (!stat.isFile()) throw new RpcError(400, `${absolutePath} is not a regular file`)
  const handle = openSync(absolutePath, 'r')
  try {
    const head = Buffer.alloc(16)
    readSync(handle, head, 0, 16, 0)
    if (head.toString('latin1') !== SQLITE_MAGIC) throw new RpcError(400, `${basename(absolutePath)} is not a SQLite database`)
  } finally {
    closeSync(handle)
  }
}

/**
 * Turn a `{ sessionId, path }` pair into the absolute path the host may read.
 *
 * The workspace-files service owns resolution and the access checks, so its
 * answer is preferred; the local fallback exists for a deployment that composes
 * the preview without that service.
 * @param ctx - host context.
 * @param sessionId - Session whose workspace root resolves a relative path.
 * @param path - workspace-relative or absolute path.
 * @returns the absolute path.
 */
async function resolveAbsolutePath(ctx, sessionId, path) {
  const sessions = ctx.get('sessions')
  const sandboxPolicy = ctx.get('sandboxPolicy')
  let workspaceRoot
  try {
    workspaceRoot = sessions?.get?.(sessionId)?.header?.cwd
  } catch {
    workspaceRoot = undefined
  }
  if (typeof workspaceRoot !== 'string' || workspaceRoot === '') workspaceRoot = sandboxPolicy?.workspaceRoot
  const workspaceFiles = ctx.get('workspaceFiles')
  if (workspaceFiles !== undefined && typeof workspaceFiles.stat === 'function' && typeof workspaceRoot === 'string' && workspaceRoot !== '') {
    try {
      const meta = await workspaceFiles.stat({ sessionId, workspaceRoot }, path, timeoutSignal(RESOLVE_TIMEOUT_MS))
      if (typeof meta?.absolutePath === 'string' && meta.absolutePath !== '') return meta.absolutePath
    } catch (error) {
      throw new RpcError(error?.status ?? 400, String(error?.message ?? error))
    }
    throw new RpcError(400, `the host reported no readable file at "${path}"`)
  }
  if (isAbsolute(path)) return path
  if (typeof workspaceRoot !== 'string' || workspaceRoot === '') throw new RpcError(400, `cannot resolve the relative path "${path}" without a workspace root`)
  return resolvePath(workspaceRoot, path)
}

/**
 * Resolve the request's target into something a driver can open.
 * @param ctx - host context.
 * @param raw - the request's `target` field.
 * @returns a resolved target.
 */
async function resolveTarget(ctx, raw) {
  if (raw === null || typeof raw !== 'object') throw new RpcError(400, 'target is required')
  if (raw.kind === 'file') {
    const sessionId = requireText(raw.sessionId, 'target.sessionId')
    const path = requireText(raw.path, 'target.path')
    const absolutePath = await resolveAbsolutePath(ctx, sessionId, path)
    assertSqliteFile(absolutePath)
    return { kind: 'file', engine: 'sqlite', label: basename(absolutePath), absolutePath, sessionId, path }
  }
  if (raw.kind === 'connection') {
    const profile = findProfile(raw.connectionId)
    return {
      kind: 'connection',
      engine: profile.engine,
      label: profile.label,
      profile,
      database: typeof raw.database === 'string' && raw.database !== '' ? raw.database : undefined,
      schema: typeof raw.schema === 'string' && raw.schema !== '' ? raw.schema : undefined,
    }
  }
  throw new RpcError(400, 'target.kind must be "file" or "connection"')
}

/** The caller-facing description of a resolved target, carrying no filesystem path for connections. */
function publicTarget(target) {
  if (target.kind === 'file') return { kind: 'file', engine: 'sqlite', label: target.label }
  return { kind: 'connection', engine: target.engine, label: target.label, connectionId: target.profile.id }
}

/**
 * Open a profile just far enough to prove it works.
 * @param profile - normalized profile.
 * @returns the probe report.
 */
async function probeProfile(profile) {
  if (profile.engine === 'sqlite') {
    assertSqliteFile(profile.path)
    const report = await adapterFor('sqlite').probe(profile.path)
    return { engine: 'sqlite', version: report.version, tableCount: report.tables }
  }
  const catalog = await adapterFor(profile.engine).catalog(profile, {})
  return { engine: profile.engine, version: catalog.version, databaseCount: catalog.databases.length, tableCount: catalog.tables.length }
}

/**
 * Merge a test request over the stored profile it names, so a saved password is
 * reused without being echoed back to the browser.
 * @param args - the request body.
 * @returns the normalized profile under test.
 */
function profileForTest(args) {
  const raw = args?.profile
  if (raw === null || typeof raw !== 'object') throw new RpcError(400, 'profile is required')
  let stored
  if (typeof raw.id === 'string' && raw.id !== '') {
    try {
      stored = findProfile(raw.id)
    } catch {
      stored = undefined
    }
  }
  const merged = { ...stored, ...raw }
  return normalizeProfile(merged, stored?.id, new Set(stored === undefined ? [] : [stored.id]))
}

/** Read a request body as text, refusing anything above the cap. */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new RpcError(413, 'request body is too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Methods that change this plugin's own state and must arrive over POST. */
const MUTATING = new Set(['connections.save', 'connections.delete'])

/** Every RPC method, keyed by the name in the route path. Exported so tests can drive it directly. */
export const ROUTES = {
  /** List stored connection profiles, always redacted. */
  'connections.list': async () => {
    const document = readStore()
    return { connections: document.connections.map((profile) => redact(profile)), engines: ENGINES, defaultPort: DEFAULT_PORT }
  },
  /** Create or replace one connection profile. */
  'connections.save': async (ctx, args) => {
    const document = readStore()
    const requested = args?.profile
    const existingId = typeof requested?.id === 'string' && requested.id !== '' ? requested.id : undefined
    const stored = existingId === undefined ? undefined : document.connections.find((entry) => entry?.id === existingId)
    // A blank password field means "keep the stored one"; clearing it takes the
    // explicit flag, so editing an unrelated field can never silently drop a secret.
    const merged = { ...stored, ...requested }
    if (requested?.clearPassword === true) delete merged.password
    else if (typeof requested?.password !== 'string' || requested.password === '') {
      if (stored !== undefined && typeof stored.password === 'string') merged.password = stored.password
      else delete merged.password
    }
    delete merged.clearPassword
    const taken = new Set(document.connections.filter((entry) => entry?.id !== existingId).map((entry) => entry.id))
    const profile = normalizeProfile(merged, existingId, taken)
    const index = document.connections.findIndex((entry) => entry?.id === profile.id)
    if (index === -1) document.connections.push(profile)
    else document.connections[index] = profile
    const file = writeStore(document)
    ctx.logger?.info?.(`dsh-database-preview: saved connection "${profile.id}" to ${file}`)
    return { connection: redact(profile) }
  },
  /** Remove one connection profile. */
  'connections.delete': async (ctx, args) => {
    const id = requireText(args?.connectionId, 'connectionId')
    const document = readStore()
    const remaining = document.connections.filter((entry) => entry?.id !== id)
    if (remaining.length === document.connections.length) throw new RpcError(404, `no connection named "${id}"`)
    writeStore({ ...document, connections: remaining })
    ctx.logger?.info?.(`dsh-database-preview: removed connection "${id}"`)
    return { removed: id }
  },
  /** Open a profile (saved or unsaved) and report what it is. */
  'connections.test': async (ctx, args) => {
    const profile = profileForTest(args)
    const report = await probeProfile(profile)
    return { ok: true, ...report }
  },
  /** Databases, schemas and tables for one target. */
  'db.catalog': async (ctx, args) => {
    const target = await resolveTarget(ctx, args?.target)
    if (target.engine === 'sqlite') {
      const catalog = await adapterFor('sqlite').catalog(target.absolutePath)
      return { target: publicTarget(target), ...catalog }
    }
    const catalog = await adapterFor(target.engine).catalog(target.profile, { database: target.database, schema: target.schema })
    return { target: publicTarget(target), ...catalog }
  },
  /** One page of rows plus the table's structure and indexes. */
  'db.table': async (ctx, args) => {
    const target = await resolveTarget(ctx, args?.target)
    const table = requireText(args?.table, 'table')
    const pageSize = clampInt(args?.pageSize, 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)
    const page = clampInt(args?.page, 1, MAX_PAGE, 1)
    const offset = (page - 1) * pageSize
    const selection = {
      table,
      pageSize,
      offset,
      database: typeof args?.database === 'string' && args.database !== '' ? args.database : target.database,
      schema: typeof args?.schema === 'string' && args.schema !== '' ? args.schema : target.schema,
    }
    const result =
      target.engine === 'sqlite'
        ? await adapterFor('sqlite').table(target.absolutePath, selection)
        : await adapterFor(target.engine).table(target.profile, selection)
    return { target: publicTarget(target), page, pageSize, offset, table, ...result }
  },
}

/**
 * Serialize a result, dropping rows rather than refusing to answer when the
 * payload is oversized.
 * @param payload - the RPC result.
 * @returns the JSON text to send.
 */
function serialize(payload) {
  let text = JSON.stringify(payload, (_key, value) => (typeof value === 'bigint' ? value.toString() : value))
  if (Buffer.byteLength(text) <= MAX_RESPONSE_BYTES) return text
  if (payload !== null && typeof payload === 'object' && Array.isArray(payload.rows)) {
    text = JSON.stringify({ ...payload, rows: [], truncated: true, truncationReason: `the response exceeded ${MAX_RESPONSE_BYTES} bytes; narrow the page size` })
    return text
  }
  throw new RpcError(500, `the response exceeded ${MAX_RESPONSE_BYTES} bytes`)
}

/** Write a JSON response with an accurate length. */
function respond(res, status, payload) {
  const body = serialize(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/**
 * Host plugin body: claim the RPC route for as long as the web server exists.
 * @param ctx - host context.
 */
function apply(ctx) {
  sweepTemporaryFiles()
  ctx.inject(['connection', 'webServer'], (webCtx) => {
    webCtx.effect(() => {
      const dispose = webCtx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req, res) => {
          let method = ''
          try {
            // The connection service owns the request policy for both transports: the
            // desktop shell forwards dsh-app://app requests after stripping renderer
            // Origin/Host headers, so a hand-rolled header check would reject them.
            const rejection = webCtx.connection.requestRejection(req)
            if (rejection !== undefined) {
              respond(res, rejection, { error: rejection === 401 ? 'authentication required' : 'request rejected' })
              return
            }
            const url = new URL(req.url || '/', 'http://localhost')
            const path = url.pathname
            if (!path.startsWith(`${ROUTE_PREFIX}/`)) {
              respond(res, 404, { error: 'not found' })
              return
            }
            method = decodeURIComponent(path.slice(ROUTE_PREFIX.length + 1))
            const handler = Object.hasOwn(ROUTES, method) ? ROUTES[method] : null
            if (typeof handler !== 'function') {
              respond(res, 404, { error: `unknown method: ${method}` })
              return
            }
            if (MUTATING.has(method) && req.method !== 'POST') {
              respond(res, 405, { error: 'this method requires POST' })
              return
            }
            let args = {}
            if (req.method === 'POST' || req.method === 'PUT') {
              const raw = await readBody(req)
              if (raw.trim() !== '') {
                try {
                  args = JSON.parse(raw)
                } catch {
                  respond(res, 400, { error: 'invalid JSON body' })
                  return
                }
              }
            }
            const result = await handler(ctx, args)
            respond(res, 200, result)
          } catch (error) {
            const status = error instanceof RpcError ? error.status : 500
            if (status >= 500) {
              // Unexpected failures must leave a trace; request bodies are never logged
              // because they may carry connection passwords.
              console.warn(`[dsh-database-preview] RPC ${method || 'unknown'} failed: ${String(error?.stack ?? error)}`)
            }
            respond(res, status, { error: status >= 500 ? `internal error: ${String(error?.message ?? error)}` : String(error?.message ?? error) })
          }
        },
      })
      return () => dispose()
    }, 'dsh-database-preview: Web routes')
  })
}

export default { apply }
