/**
 * Durable connection profile store for the database preview plugin.
 *
 * Non-secret fields and the optional password live in one JSON document under
 * the DSH home directory, written atomically with owner-only permissions. A
 * profile may instead name an environment variable through `passwordEnv`, which
 * keeps the secret out of the file entirely and is the recommended form.
 * @module dsh-database-preview/host/store
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { RpcError, requireText } from './util.js'

/** Engines this plugin can open. */
export const ENGINES = ['sqlite', 'mysql', 'postgres', 'mssql']

/** Default TCP port per engine, used when a profile omits one. */
export const DEFAULT_PORT = { mysql: 3306, postgres: 5432, mssql: 1433 }

/** Format version of the stored document. */
const FORMAT_VERSION = 1

/**
 * Directory holding this plugin's data. `DSH_DB_PREVIEW_DIR` overrides it,
 * which keeps tests and throwaway profiles out of the real home directory.
 * @returns the absolute directory path.
 */
export function dataDir() {
  const override = process.env.DSH_DB_PREVIEW_DIR
  if (typeof override === 'string' && override.trim() !== '') return override
  const home = process.env.DSH_HOME
  const base = typeof home === 'string' && home.trim() !== '' ? home : join(homedir(), '.dsh')
  return join(base, 'dsh-database-preview')
}

/** Path of the connection document. */
function storePath() {
  return join(dataDir(), 'connections.json')
}

/** Identifier grammar shared with the credential service's key segments. */
const ID_PATTERN = /^[a-z][a-z0-9-]*$/

/** Turn a label into a stable, addressable id. */
function slugify(label, taken) {
  const base = String(label)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const root = ID_PATTERN.test(base) ? base : `db-${randomUUID().slice(0, 8)}`
  if (!taken.has(root)) return root
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${root}-${index}`
    if (!taken.has(candidate)) return candidate
  }
  return `db-${randomUUID().slice(0, 8)}`
}

/**
 * Read the whole document, tolerating absence and corruption.
 *
 * A corrupt file is reported to the caller instead of being silently replaced,
 * so a user never loses a hand-written profile to a truncated write.
 * @returns the parsed document.
 */
export function readStore() {
  const file = storePath()
  if (!existsSync(file)) return { version: FORMAT_VERSION, connections: [] }
  let raw
  try {
    raw = readFileSync(file, 'utf8')
  } catch (error) {
    throw new RpcError(500, `cannot read ${file}: ${error.message}`)
  }
  if (raw.trim() === '') return { version: FORMAT_VERSION, connections: [] }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new RpcError(500, `${file} is not valid JSON: ${error.message}`)
  }
  const connections = Array.isArray(parsed?.connections) ? parsed.connections : []
  return { version: FORMAT_VERSION, connections }
}

/**
 * Replace the document atomically, owner-readable only.
 * @param document - the document to persist.
 * @returns the path written.
 */
export function writeStore(document) {
  const dir = dataDir()
  mkdirSync(dir, { recursive: true })
  const file = storePath()
  const temporary = `${file}.${process.pid}.tmp`
  const body = `${JSON.stringify({ version: FORMAT_VERSION, connections: document.connections }, null, 2)}\n`
  writeFileSync(temporary, body, { mode: 0o600 })
  chmodSync(temporary, 0o600)
  renameSync(temporary, file)
  return file
}

/**
 * Validate and normalize one profile from a request body.
 * @param input - caller-supplied profile.
 * @param existingId - id to keep, or undefined when creating.
 * @param taken - ids already in use, so a new one cannot collide.
 * @returns the normalized profile.
 */
export function normalizeProfile(input, existingId, taken) {
  if (input === null || typeof input !== 'object') throw new RpcError(400, 'profile must be an object')
  const label = requireText(input.label, 'label')
  const engine = requireText(input.engine, 'engine')
  if (!ENGINES.includes(engine)) throw new RpcError(400, `engine must be one of ${ENGINES.join(', ')}`)
  const profile = {
    id: existingId ?? slugify(label, taken),
    label,
    engine,
  }
  if (engine === 'sqlite') {
    profile.path = requireText(input.path, 'path')
    return profile
  }
  profile.host = requireText(input.host, 'host')
  const port = Number(input.port ?? DEFAULT_PORT[engine])
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RpcError(400, 'port must be an integer between 1 and 65535')
  profile.port = port
  profile.user = requireText(input.user, 'user')
  if (typeof input.database === 'string' && input.database.trim() !== '') profile.database = input.database.trim()
  if (typeof input.schema === 'string' && input.schema.trim() !== '') profile.schema = input.schema.trim()
  if (input.passwordEnv !== undefined && input.passwordEnv !== null && String(input.passwordEnv).trim() !== '') {
    const name = String(input.passwordEnv).trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new RpcError(400, 'passwordEnv must be an environment variable name')
    profile.passwordEnv = name
  }
  if (typeof input.password === 'string' && input.password !== '') profile.password = input.password
  if (input.encrypt === true) profile.encrypt = true
  return profile
}

/**
 * Resolve the password for a profile without exposing it to the caller.
 * @param profile - stored profile.
 * @returns the password, or undefined for passwordless authentication.
 */
export function resolvePassword(profile) {
  if (typeof profile.passwordEnv === 'string') {
    const value = process.env[profile.passwordEnv]
    if (typeof value === 'string' && value !== '') return value
  }
  if (typeof profile.password === 'string' && profile.password !== '') return profile.password
  return undefined
}

/**
 * The caller-facing view of a profile: never the password itself.
 * @param profile - stored profile.
 * @returns the redacted profile.
 */
export function redact(profile) {
  const { password, ...rest } = profile
  return { ...rest, hasPassword: typeof password === 'string' && password !== '', passwordResolved: resolvePassword(profile) !== undefined }
}

/**
 * Find one profile by id.
 * @param id - profile id.
 * @returns the stored profile.
 * @throws RpcError when no such profile exists.
 */
export function findProfile(id) {
  const wanted = requireText(id, 'connectionId')
  const document = readStore()
  const found = document.connections.find((entry) => entry?.id === wanted)
  if (found === undefined) throw new RpcError(404, `no connection named "${wanted}"`)
  return found
}

/**
 * Remove the temporary files a crashed write may have left behind.
 * @returns the number of files removed.
 */
export function sweepTemporaryFiles() {
  const dir = dataDir()
  if (!existsSync(dir)) return 0
  let removed = 0
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('connections.json.') || !name.endsWith('.tmp')) continue
      try {
        unlinkSync(join(dir, name))
        removed += 1
      } catch {
        // A file another process is still writing is not ours to remove.
      }
    }
  } catch {
    // A directory we cannot list is not a failure worth reporting.
  }
  return removed
}
