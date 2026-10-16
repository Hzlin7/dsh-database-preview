/**
 * This bundle's own page in the plugin manager: version facts, and the update
 * action.
 *
 * The plugin does not rewrite its own files. It has runtime dependencies, so a
 * release that changes the dependency tree needs a real package-manager install,
 * and the profile's manifest and lockfile belong to the plugin manager rather
 * than to a plugin. The update is therefore delegated to the Market's public
 * update API v1 when `dshmarket` is installed, and handed to the user as one
 * exact command when it is not. A `link:` install is never touched: it points at
 * the user's own checkout, and their `git pull` owns it.
 * @module dsh-database-preview/client/update
 */
import React from 'react'
import { rpc } from './rpc.js'
import { copyFor } from './i18n.js'
import { PREFIX } from './styles.js'
import { AppButton, AppTag, Field, Spinner } from './controls.jsx'

/** The Market's public update API, same origin as this page. */
const MARKET = '/dsh-market/api/v1'
/** The schema every v1 answer carries; discovery is refused without it. */
const MARKET_SCHEMA = 'dsh-market/update-api/v1'
/** Poll cadence while an update runs. */
const POLL_MS = 1200
/** States an operation never leaves. */
const TERMINAL = ['succeeded', 'failed', 'cancelled', 'rolled-back']

/**
 * Call one Market endpoint, turning a transport failure into a value.
 * @param path - path below the API prefix.
 * @param init - fetch options.
 * @returns the status and parsed body.
 */
async function market(path, init) {
  try {
    const response = await fetch(`${MARKET}${path}`, init)
    const text = await response.text().catch(() => '')
    let body = {}
    try {
      body = text === '' ? {} : JSON.parse(text)
    } catch {
      body = {}
    }
    return { ok: response.ok, status: response.status, body }
  } catch (error) {
    return { ok: false, status: 0, body: {}, transport: String(error?.message ?? error) }
  }
}

/**
 * Discover the API before offering any mutation control, as its contract requires.
 * @returns `{ available: false }`, or the advertised capabilities.
 */
async function discoverMarket() {
  const result = await market('/capabilities')
  if (!result.ok || result.body?.schema !== MARKET_SCHEMA) return { available: false }
  return {
    available: true,
    stability: typeof result.body.stability === 'string' ? result.body.stability : undefined,
    endpoints: result.body.endpoints ?? {},
  }
}

/** The command that performs this update by hand, or undefined for a linked checkout. */
function manualCommand(status) {
  if (status?.installKind !== 'copy') return undefined
  const profile = status.profileName ?? '<profile>'
  return `dsh plugin --profile ${profile} add ${status.packageName}`
}

/** Render one line of version comparison. */
function Row({ t, label, children }) {
  return (
    <div className={`${PREFIX}-row`}>
      <span className={`${PREFIX}-fieldLabel`}>{label}</span>
      <span className={`${PREFIX}-muted`}>{children}</span>
    </div>
  )
}

/**
 * The plugin-manager page body.
 *
 * `view === 'summary'` is the one line the plugin list shows under the title;
 * every other view is the full panel.
 * @param props - slot props, including the framework's `t` and `view`.
 */
export function UpdatePanel(props) {
  const t = copyFor(props)
  const [status, setStatus] = React.useState({ state: 'loading' })
  const [marketState, setMarketState] = React.useState({ state: 'unknown' })
  const [operation, setOperation] = React.useState(undefined)
  const [busy, setBusy] = React.useState(false)
  const [notice, setNotice] = React.useState(undefined)
  const timer = React.useRef(undefined)
  const page = props.view !== 'summary'

  const load = React.useCallback(async () => {
    setStatus({ state: 'loading' })
    try {
      setStatus({ state: 'ready', value: await rpc('update.status') })
    } catch (error) {
      setStatus({ state: 'error', error: String(error?.message ?? error) })
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  React.useEffect(() => {
    if (!page) return undefined
    let alive = true
    void discoverMarket().then((found) => {
      if (alive) setMarketState({ state: 'ready', ...found })
    })
    return () => {
      alive = false
    }
  }, [page])

  React.useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current)
    },
    [],
  )

  if (!page) {
    if (status.state === 'loading') return <span className={`${PREFIX}-muted`}>{t('update.checking')}</span>
    if (status.state === 'error') return <span className={`${PREFIX}-muted`}>{status.error}</span>
    const value = status.value
    if (value.ok !== true) return <span className={`${PREFIX}-muted`}>{value.error}</span>
    const latest = value.latest
    if (value.updateAvailable === true && latest.known) return <span className={`${PREFIX}-muted`}>{t('update.available', { version: latest.version })}</span>
    if (value.updateAvailable === false) return <span className={`${PREFIX}-muted`}>{t('update.upToDate')}</span>
    return (
      <span className={`${PREFIX}-muted`}>
        v{value.runningVersion} · {latest.known === false ? t('update.registryUnknownShort') : t('update.unknown')}
      </span>
    )
  }

  const value = status.state === 'ready' ? status.value : undefined
  const latest = value?.latest
  const command = manualCommand(value)
  const canDelegate = marketState.available === true && value?.canDelegate === true && value?.updateAvailable === true

  const start = async () => {
    setBusy(true)
    setNotice(undefined)
    const started = await market('/updates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ packageName: value.packageName }),
    })
    const id = started.body?.operation?.operationId
    if (!started.ok || typeof id !== 'string') {
      setBusy(false)
      setNotice({ ok: false, text: t('update.failed', { message: started.body?.error ?? started.body?.failure?.message ?? `HTTP ${started.status}` }) })
      return
    }
    const step = async () => {
      const result = await market(`/operations?operationId=${encodeURIComponent(id)}`)
      const next = result.body?.operation
      setOperation(next ?? { operationId: id, state: 'unknown' })
      if (next === undefined || !TERMINAL.includes(next.state)) {
        timer.current = setTimeout(() => {
          void step()
        }, POLL_MS)
        return
      }
      setBusy(false)
      await load()
      if (next.state === 'succeeded') setNotice({ ok: true, text: t('update.installed', { version: next.installedVersion ?? '' }) })
      else setNotice({ ok: false, text: t('update.failed', { message: next.failure?.message ?? next.state }) })
    }
    void step()
  }

  return (
    <div className={`${PREFIX}-root`}>
      {status.state === 'loading' ? (
        <div className={`${PREFIX}-notice`}>
          <Spinner /> {t('update.checking')}
        </div>
      ) : null}

      {status.state === 'error' ? <div className={`${PREFIX}-notice ${PREFIX}-noticeError`}>{status.error}</div> : null}

      {value !== undefined && value.ok !== true ? <div className={`${PREFIX}-notice ${PREFIX}-noticeError`}>{value.error}</div> : null}

      {value !== undefined && value.ok === true ? (
        <>
          <div className={`${PREFIX}-bar`}>
            <Field label={t('update.running')}>
              <div className={`${PREFIX}-row`}>
                <span className={`${PREFIX}-cardName`}>v{value.runningVersion}</span>
                <AppTag>{value.installKind === 'link' ? t('update.kindLink') : t('update.kindCopy')}</AppTag>
                {value.pendingRestart === true ? <AppTag>{t('update.pendingRestartTag')}</AppTag> : null}
              </div>
            </Field>
            <span className={`${PREFIX}-spacer`} />
            <AppButton variant="outline" disabled={busy || status.state === 'loading'} onClick={load}>
              {t('update.check')}
            </AppButton>
            {canDelegate ? (
              <AppButton variant="primary" disabled={busy} onClick={start}>
                {busy ? t('update.applying') : t('update.apply', { version: latest.version })}
              </AppButton>
            ) : null}
          </div>

          <div className={`${PREFIX}-form`}>
            <Row t={t} label={t('update.latest')}>
              {latest.known === true ? `v${latest.version}` : t('update.unknown')}
            </Row>
            {latest.known === false && latest.reason === 'not-published' ? <div className={`${PREFIX}-muted`}>{t('update.notPublished')}</div> : null}
            {latest.known === false && latest.reason !== 'not-published' ? (
              <div className={`${PREFIX}-muted`}>{t('update.registryUnknown', { reason: latest.reason })}</div>
            ) : null}
            {latest.known === true && value.updateAvailable === false ? <div className={`${PREFIX}-muted`}>{t('update.upToDate')}</div> : null}

            {busy || operation !== undefined ? (
              <div className={`${PREFIX}-muted`}>
                {t(`update.state.${operation?.state ?? 'queued'}`)}
                {operation?.progress?.percent !== null && operation?.progress?.percent !== undefined
                  ? ` · ${operation.progress.percent}%`
                  : operation?.progress?.total
                    ? ` · ${operation.progress.done}/${operation.progress.total}`
                    : ''}
              </div>
            ) : null}

            {notice !== undefined ? (
              <div className={notice.ok ? `${PREFIX}-muted` : `${PREFIX}-noticeError`}>{notice.text}</div>
            ) : null}

            {value.pendingRestart === true ? <div className={`${PREFIX}-muted`}>{t('update.pendingRestartBody', { version: value.diskVersion })}</div> : null}

            {/* The fallbacks, in the order of how much they can do for the user. */}
            {marketState.available === false && value.updateAvailable === true ? (
              <div className={`${PREFIX}-notice`}>
                {t('update.marketMissing', { command: command ?? t('update.marketMissingLink') })}
              </div>
            ) : null}
            {value.canDelegate === false && value.updateAvailable === true ? <div className={`${PREFIX}-notice`}>{t('update.linkInstall')}</div> : null}
            {marketState.available === true ? <div className={`${PREFIX}-muted`}>{t('update.viaMarket')}</div> : null}
          </div>
        </>
      ) : null}
    </div>
  )
}
