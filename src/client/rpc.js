/**
 * The browser half of the plugin's RPC.
 *
 * Every call targets the host route this plugin claims. Failures carry the
 * host's own message, which is written to be shown to a user.
 * @module dsh-database-preview/client/rpc
 */

/** Route prefix the host half claims. */
const ROUTE_PREFIX = '/_dsh/dsh-database-preview'

/** Deadline for one RPC call; a database that never answers must not pin the panel. */
const RPC_TIMEOUT_MS = 30000

/**
 * Call one host method.
 * @param method - method name, for example `db.catalog`.
 * @param args - JSON body.
 * @param signal - caller cancellation, combined with the plugin's own deadline.
 * @returns the parsed result.
 * @throws Error whose message is safe to display.
 */
export async function rpc(method, args, signal) {
  const timeout = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(RPC_TIMEOUT_MS) : undefined
  const combined = signal !== undefined && timeout !== undefined && typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : (signal ?? timeout)
  let response
  try {
    response = await fetch(`${ROUTE_PREFIX}/${encodeURIComponent(method)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args ?? {}),
      signal: combined,
    })
  } catch (error) {
    if (signal?.aborted === true) throw error
    throw new Error(`无法连接宿主路由：${String(error?.message ?? error)}`)
  }
  const text = await response.text().catch(() => '')
  let payload
  try {
    payload = text === '' ? {} : JSON.parse(text)
  } catch {
    throw new Error(`宿主返回了无法解析的响应（HTTP ${response.status}）`)
  }
  if (!response.ok) throw new Error(String(payload?.error ?? `请求失败（HTTP ${response.status}）`))
  return payload
}
