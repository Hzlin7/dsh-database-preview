/**
 * The `dsh-resource://file/…` address grammar, parsed in the browser.
 *
 * This is a faithful copy of `@deepseek-ai/dsh-util-workspace-path`'s
 * `parseFileAddress`. The utility package is not part of the client module
 * baseline a third-party bundle may request, and a builtin bundle inlines it
 * for the same reason, so the grammar is reproduced here rather than depended on.
 * @module dsh-database-preview/client/address
 */

/** The scheme and type every file address opens with. */
const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/** Whether a decoded first path segment is a Windows drive (`C:`). */
function isDriveSegment(segment) {
  return segment !== undefined && /^[A-Za-z]:$/.test(segment)
}

/**
 * Read a file address back into its parts without resolving `.` or `..`.
 * @param address - a candidate address.
 * @returns the parts, or undefined when the string is not a file address in a known scope.
 */
export function parseFileAddress(address) {
  try {
    if (typeof address !== 'string' || !address.startsWith(FILE_ADDRESS_PREFIX)) return undefined
    const end = address.search(/[?#]/)
    const [scope, ...rest] = address.slice(20, end === -1 ? undefined : end).split('/')
    if (scope === 'session') {
      const [id, ...segments] = rest
      if (id === undefined || id === '' || segments.length === 0) return undefined
      return { scope, sessionId: decodeURIComponent(id), path: segments.map(decodeURIComponent).join('/') }
    }
    if (scope === 'absolute') {
      const unc = rest[0] === '' && rest.length > 1
      const segments = (unc ? rest.slice(1) : rest).map(decodeURIComponent)
      if (segments.length === 0 || segments[0] === '') return undefined
      if (unc) return { scope, path: `//${segments.join('/')}` }
      return { scope, path: isDriveSegment(segments[0]) ? segments.join('/') : `/${segments.join('/')}` }
    }
    return undefined
  } catch {
    return undefined
  }
}
