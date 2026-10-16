/**
 * Version and install-shape facts for this plugin's own update surface.
 *
 * The plugin does not update itself: it has runtime dependencies (`mysql2`,
 * `pg`), so replacing its own files would be wrong the moment a release changes
 * the dependency tree, and the profile's manifest and lockfile belong to the
 * plugin manager, not to a plugin. The update itself is therefore delegated —
 * to the Market's public update API when it is installed, and otherwise to the
 * user with an exact command.
 *
 * What lives here is only what the host can answer honestly: which version is
 * running, which version is on disk, how this copy was installed, and what the
 * registry currently offers.
 * @module dsh-database-preview/host/update
 */
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** This package's own root, derived from this module's location (`lib/host/update.js`). */
export const PACKAGE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** How long a registry answer is reused, so reopening the panel does not re-ask. */
const REGISTRY_TTL_MS = 60_000

/** Deadline for one registry lookup. */
const REGISTRY_TIMEOUT_MS = 8000

/**
 * Parse a semver-ish version.
 * @param value - candidate version.
 * @returns the parts, or undefined when the shape is not understood.
 */
export function parseVersion(value) {
  if (typeof value !== 'string') return undefined
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim())
  if (match === null) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null }
}

/** Compare two prerelease strings per semver: numeric identifiers rank below alphanumeric ones. */
function comparePrerelease(left, right) {
  if (left === right) return 0
  if (left === null) return 1
  if (right === null) return -1
  const a = left.split('.')
  const b = right.split('.')
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const one = a[index]
    const two = b[index]
    if (one === undefined) return -1
    if (two === undefined) return 1
    const oneNumeric = /^\d+$/.test(one)
    const twoNumeric = /^\d+$/.test(two)
    if (oneNumeric && twoNumeric) {
      if (Number(one) !== Number(two)) return Number(one) < Number(two) ? -1 : 1
      continue
    }
    if (oneNumeric !== twoNumeric) return oneNumeric ? -1 : 1
    if (one !== two) return one < two ? -1 : 1
  }
  return 0
}

/**
 * Compare two versions.
 * @param left - version string.
 * @param right - version string.
 * @returns -1, 0 or 1; undefined when either side cannot be parsed.
 */
export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === undefined || b === undefined) return undefined
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1
  }
  return comparePrerelease(a.prerelease, b.prerelease)
}

/**
 * Read this package's manifest.
 * @param packageDir - package root directory.
 * @returns the name and version, or undefined when the manifest is unreadable.
 */
export function readManifest(packageDir = PACKAGE_DIR) {
  try {
    const manifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'))
    if (typeof manifest?.name !== 'string' || typeof manifest?.version !== 'string') return undefined
    return { name: manifest.name, version: manifest.version }
  } catch {
    return undefined
  }
}

/**
 * How this copy was installed.
 *
 * A `link:` install resolves to a directory outside every `node_modules` — the
 * user's own checkout — and rewriting that would edit their working copy, so the
 * two shapes are reported separately and the update surface keeps its hands off
 * the link case.
 * @param packageDir - resolved package root.
 * @returns the shape, with the profile directory when one can be derived.
 */
export function installShape(packageDir = PACKAGE_DIR) {
  const resolved = resolve(packageDir)
  if (!resolved.includes(`${sep}node_modules${sep}`) && !resolved.includes(`${sep}.pnpm${sep}`)) {
    return { kind: 'link' }
  }
  const profile = /^(.*[\\/]profiles[\\/][^\\/]+)[\\/]node_modules[\\/]/.exec(resolved)
  if (profile === null) return { kind: 'copy' }
  return { kind: 'copy', profileDir: profile[1], profileName: basename(profile[1]) }
}

/** Registry answers, keyed by package name, inside the TTL. */
const registryCache = new Map()

/** The signal a lookup aborts on, or undefined where `AbortSignal.timeout` is missing. */
function timeoutSignal(ms) {
  return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : undefined
}

/**
 * Ask the public registry what the latest published version is.
 *
 * A failure is reported rather than folded into "up to date": for a plugin that
 * has not been published yet the honest answer is that the registry has nothing,
 * and the panel says so instead of claiming the user is current.
 * @param name - package name.
 * @param fetchImpl - fetch implementation, injectable for tests.
 * @returns the version, or a reason it is unknown.
 */
export async function fetchLatestVersion(name, fetchImpl = fetch) {
  const cached = registryCache.get(name)
  if (cached !== undefined && Date.now() - cached.at < REGISTRY_TTL_MS) return cached.value
  let value
  try {
    const response = await fetchImpl(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
      headers: { accept: 'application/json' },
      signal: timeoutSignal(REGISTRY_TIMEOUT_MS),
    })
    if (response.status === 404) value = { known: false, reason: 'not-published' }
    else if (!response.ok) value = { known: false, reason: `registry responded ${response.status}` }
    else {
      const body = await response.json()
      value = typeof body?.version === 'string' ? { known: true, version: body.version } : { known: false, reason: 'no version in the registry answer' }
    }
  } catch (error) {
    value = { known: false, reason: String(error?.message ?? error) }
  }
  registryCache.set(name, { at: Date.now(), value })
  return value
}

/**
 * The facts the update surface renders.
 * @param root0 - dependencies, injectable for tests.
 * @param root0.runningVersion - version whose code is loaded right now.
 * @param root0.packageDir - package root to read from disk.
 * @param root0.fetchImpl - fetch implementation.
 * @returns the status payload.
 */
export async function updateStatus({ runningVersion, packageDir = PACKAGE_DIR, fetchImpl = fetch } = {}) {
  const manifest = readManifest(packageDir)
  if (manifest === undefined) {
    return { ok: false, error: `cannot read ${resolve(packageDir, 'package.json')}` }
  }
  const shape = installShape(packageDir)
  const diskVersion = manifest.version
  const running = runningVersion ?? diskVersion
  const latest = await fetchLatestVersion(manifest.name, fetchImpl)
  // The target is what sits on disk, not what is loaded: after an update the two
  // differ until a restart, and comparing against the loaded version would keep
  // offering an update that already happened.
  const outdated = latest.known ? compareVersions(latest.version, diskVersion) === 1 : undefined
  return {
    ok: true,
    packageName: manifest.name,
    runningVersion: running,
    diskVersion,
    // Set once the files on disk are newer than the code this process loaded.
    pendingRestart: compareVersions(diskVersion, running) === 1,
    installKind: shape.kind,
    profileName: shape.profileName,
    latest,
    updateAvailable: outdated,
    // A linked checkout belongs to the user's repository; updating it is their
    // `git pull`, and no automated path may write there.
    canDelegate: shape.kind === 'copy',
  }
}
