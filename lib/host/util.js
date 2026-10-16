/**
 * Shared host-side helpers: JSON-safe value conversion, per-engine identifier
 * quoting, and bounded integer parsing.
 *
 * Everything a database driver returns must survive `JSON.stringify` into the
 * RPC response: bigints, dates, buffers and nested rows are converted here
 * rather than at each call site.
 * @module dsh-database-preview/host/util
 */

/** An error carrying the HTTP status the RPC surface should answer with. */
export class RpcError extends Error {
  /**
   * @param {number} status - HTTP status; 400 marks a caller mistake, 500 an unexpected failure.
   * @param {string} message - human-readable reason, safe to show in the Sidebar.
   */
  constructor(status, message) {
    super(message)
    this.name = 'RpcError'
    this.status = status
  }
}

/** Cap on the hex preview of a binary cell, so one BLOB cannot bloat the response. */
const BLOB_PREVIEW_BYTES = 256

/**
 * Convert one driver value into something `JSON.stringify` represents faithfully.
 * @param value - any value a driver may return.
 * @param depth - nesting depth, bounding self-referential structures.
 * @returns a JSON-shaped value.
 */
export function toJsonValue(value, depth = 0) {
  if (value === null || value === undefined) return null
  const type = typeof value
  if (type === 'string' || type === 'boolean') return value
  if (type === 'number') return Number.isFinite(value) ? value : String(value)
  if (type === 'bigint') return value.toString()
  if (type === 'symbol' || type === 'function') return String(value)
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
    const head = bytes.subarray(0, BLOB_PREVIEW_BYTES)
    let hex = ''
    for (const byte of head) hex += byte.toString(16).padStart(2, '0')
    return { $type: 'bytes', length: bytes.length, hex, truncated: bytes.length > BLOB_PREVIEW_BYTES }
  }
  if (Array.isArray(value)) {
    if (depth >= 3) return `[${value.length} items]`
    return value.map((item) => toJsonValue(item, depth + 1))
  }
  if (type === 'object') {
    if (depth >= 3) return '[object]'
    // Drivers return rows as plain objects; JSONB columns can nest further.
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = toJsonValue(item, depth + 1)
    return out
  }
  return String(value)
}

/** One row of driver output, converted cell by cell. */
export function toJsonRow(row) {
  return row.map((cell) => toJsonValue(cell))
}

/** Identifier quoting rules, one entry per engine. */
const QUOTING = {
  sqlite: { open: '"', close: '"', escape: /"/g, replacement: '""' },
  postgres: { open: '"', close: '"', escape: /"/g, replacement: '""' },
  mysql: { open: '`', close: '`', escape: /`/g, replacement: '``' },
  mssql: { open: '[', close: ']', escape: /]/g, replacement: ']]' },
}

/**
 * Quote one SQL identifier for an engine.
 * @param engine - `sqlite`, `mysql`, `postgres` or `mssql`.
 * @param name - the raw identifier.
 * @returns the quoted identifier.
 */
export function quoteIdent(engine, name) {
  const rule = QUOTING[engine]
  if (rule === undefined) throw new RpcError(500, `unknown engine "${engine}"`)
  const text = String(name)
  if (text.length === 0) throw new RpcError(400, 'empty identifier')
  if (text.includes('\u0000')) throw new RpcError(400, 'identifier contains a NUL byte')
  return rule.open + text.replace(rule.escape, rule.replacement) + rule.close
}

/** Quote a dotted path of identifiers, for example `schema.table`. */
export function quotePath(engine, parts) {
  return parts.filter((part) => part !== undefined && part !== null && part !== '').map((part) => quoteIdent(engine, part)).join('.')
}

/**
 * Parse an integer and clamp it into range.
 * @param value - candidate from a request body.
 * @param min - smallest accepted value.
 * @param max - largest accepted value.
 * @param fallback - value used when the candidate is absent or not a number.
 * @returns the clamped integer.
 */
export function clampInt(value, min, max, fallback) {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(number)))
}

/**
 * Require a non-empty string property.
 * @param value - candidate value.
 * @param label - field name used in the error message.
 * @returns the trimmed string.
 */
export function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new RpcError(400, `${label} is required`)
  return value.trim()
}
