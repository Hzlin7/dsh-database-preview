/**
 * The connection manager: the page that owns saved MySQL, PostgreSQL and
 * SQL Server profiles, and the way into their data.
 *
 * SQLite needs none of this — a `.db` file opens straight into the browser from
 * the Files tab — so this page exists for the engines that live on a server.
 *
 * Controls come from `controls.jsx`. Deletion confirms inline rather than
 * through `window.confirm`, which would be the one control on the page that does
 * not belong to the application.
 * @module dsh-database-preview/client/connections
 */
import React from 'react'
import { rpc } from './rpc.js'
import { PREFIX } from './styles.js'
import { AppButton, AppCheckbox, AppInput, AppTag, Dropdown, Field, Spinner, icon } from './controls.jsx'
import { DatabaseBrowser } from './browse.jsx'

/** Engine display names. */
const ENGINE_LABELS = { sqlite: 'SQLite', mysql: 'MySQL / MariaDB', postgres: 'PostgreSQL', mssql: 'SQL Server' }

/** The blank draft a new connection starts from. */
function blankDraft(engines) {
  const engine = engines.includes('mysql') ? 'mysql' : engines[0]
  return { label: '', engine, host: '127.0.0.1', port: '', user: '', password: '', passwordEnv: '', database: '', schema: '', encrypt: false, clearPassword: false }
}

/** Short one-line summary of where a profile points. */
function describe(profile) {
  if (profile.engine === 'sqlite') return profile.path
  const port = profile.port === undefined ? '' : `:${profile.port}`
  return `${profile.host}${port}${profile.database === undefined ? '' : ` / ${profile.database}`}`
}

/**
 * The connection page body.
 * @param root0 - component props.
 * @param root0.t - translator.
 */
export function Connections({ t }) {
  const [list, setList] = React.useState({ status: 'loading' })
  const [editing, setEditing] = React.useState(undefined)
  const [active, setActive] = React.useState(undefined)
  const [busy, setBusy] = React.useState(false)
  const [result, setResult] = React.useState(undefined)
  const [notice, setNotice] = React.useState(undefined)
  const [confirming, setConfirming] = React.useState(undefined)

  const load = React.useCallback(async () => {
    try {
      const data = await rpc('connections.list')
      setList({ status: 'ready', ...data })
    } catch (error) {
      setList({ status: 'error', error: String(error?.message ?? error) })
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  const engines = list.engines ?? ['sqlite', 'mysql', 'postgres', 'mssql']
  const defaultPort = list.defaultPort ?? {}
  const PlusIcon = icon('IconPlusOutlineRegular')

  if (active !== undefined) {
    return (
      <DatabaseBrowser
        t={t}
        target={{ kind: 'connection', connectionId: active.id, database: active.database, schema: active.schema }}
        onBack={() => setActive(undefined)}
      />
    )
  }

  if (editing !== undefined) {
    const draft = editing
    const patch = (changes) => setEditing({ ...draft, ...changes })
    const isSqlite = draft.engine === 'sqlite'

    /** The profile a save or a test would send; a blank password stays out of it. */
    const draftProfile = () => ({
      id: draft.id,
      label: draft.label,
      engine: draft.engine,
      ...(isSqlite
        ? { path: draft.path }
        : {
            host: draft.host,
            port: draft.port === '' ? undefined : Number(draft.port),
            user: draft.user,
            database: draft.database,
            schema: draft.schema,
            passwordEnv: draft.passwordEnv,
            encrypt: draft.encrypt === true,
            ...(draft.password === '' || draft.password === undefined ? {} : { password: draft.password }),
          }),
    })

    const submit = async (event) => {
      event.preventDefault()
      setBusy(true)
      setResult(undefined)
      try {
        const saved = await rpc('connections.save', {
          profile: { ...draftProfile(), ...(draft.clearPassword === true ? { clearPassword: true } : {}) },
        })
        setNotice(t('connections.saved', { label: saved.connection.label }))
        setEditing(undefined)
        await load()
      } catch (error) {
        setResult({ ok: false, message: String(error?.message ?? error) })
      } finally {
        setBusy(false)
      }
    }

    const test = async () => {
      setBusy(true)
      setResult(undefined)
      try {
        const profile = { ...draftProfile(), label: draft.label === '' ? 'test' : draft.label }
        const tested = await rpc('connections.test', { profile })
        setResult({ ok: true, message: t('connections.testOk', { version: tested.version }) })
      } catch (error) {
        setResult({ ok: false, message: String(error?.message ?? error) })
      } finally {
        setBusy(false)
      }
    }

    return (
      <form className={`${PREFIX}-root`} onSubmit={submit}>
        <div className={`${PREFIX}-bar`}>
          <AppButton onClick={() => setEditing(undefined)}>{t('connections.cancel')}</AppButton>
          <span className={`${PREFIX}-spacer`} />
          <AppButton disabled={busy} onClick={test}>
            {busy ? t('connections.testing') : t('connections.test')}
          </AppButton>
          <AppButton variant="primary" type="submit" disabled={busy}>
            {busy ? t('connections.saving') : t('connections.save')}
          </AppButton>
        </div>

        {result !== undefined ? <div className={`${PREFIX}-notice${result.ok ? '' : ` ${PREFIX}-noticeError`}`}>{result.message}</div> : null}

        <div className={`${PREFIX}-scroll`}>
          <div className={`${PREFIX}-form`}>
            <Field label={t('field.label')}>
              <AppInput value={draft.label} onChange={(event) => patch({ label: event.target.value })} />
            </Field>
            <Field label={t('field.engine')}>
              <Dropdown
                label={t('field.engine')}
                value={draft.engine}
                onChange={(engine) => {
                  const port = defaultPort[engine]
                  patch({ engine, port: draft.port === '' && port !== undefined ? String(port) : draft.port })
                }}
                options={engines.map((engine) => ({ value: engine, label: ENGINE_LABELS[engine] ?? engine }))}
              />
            </Field>

            {isSqlite ? (
              <Field label={t('field.path')} wide>
                <AppInput value={draft.path ?? ''} placeholder="D:\\data\\shop.db" onChange={(event) => patch({ path: event.target.value })} />
              </Field>
            ) : (
              <>
                <Field label={t('field.host')}>
                  <AppInput value={draft.host} onChange={(event) => patch({ host: event.target.value })} />
                </Field>
                <Field label={t('field.port')}>
                  <AppInput type="number" value={draft.port} onChange={(event) => patch({ port: event.target.value })} />
                </Field>
                <Field label={t('field.user')}>
                  <AppInput value={draft.user} onChange={(event) => patch({ user: event.target.value })} />
                </Field>
                <Field label={t('field.password')}>
                  <AppInput
                    type="password"
                    value={draft.password}
                    title={t('connections.passwordHint')}
                    placeholder={draft.id === undefined ? '' : t('connections.passwordHint')}
                    onChange={(event) => patch({ password: event.target.value })}
                  />
                </Field>
                <Field label={`${t('field.passwordEnv')} · ${t('field.optional')}`}>
                  <AppInput
                    value={draft.passwordEnv}
                    title={t('connections.envHint')}
                    onChange={(event) => patch({ passwordEnv: event.target.value })}
                  />
                </Field>
                <Field label={`${t('field.database')} · ${t('field.optional')}`}>
                  <AppInput value={draft.database} onChange={(event) => patch({ database: event.target.value })} />
                </Field>
                <Field label={`${t('field.schema')} · ${t('field.optional')}`}>
                  <AppInput value={draft.schema} onChange={(event) => patch({ schema: event.target.value })} />
                </Field>
                <div className={`${PREFIX}-field ${PREFIX}-fieldWide`}>
                  <AppCheckbox checked={draft.encrypt === true} label={t('field.encrypt')} onChange={(checked) => patch({ encrypt: checked })} />
                  {draft.id !== undefined && draft.hasPassword === true ? (
                    <AppCheckbox
                      checked={draft.clearPassword === true}
                      label={t('connections.clearPassword')}
                      onChange={(checked) => patch({ clearPassword: checked })}
                    />
                  ) : null}
                </div>
              </>
            )}
          </div>
        </div>
      </form>
    )
  }

  return (
    <div className={`${PREFIX}-root`}>
      <div className={`${PREFIX}-bar`}>
        <span className={`${PREFIX}-muted`}>{t('connections.intro')}</span>
        <span className={`${PREFIX}-spacer`} />
        <AppButton
          variant="primary"
          icon={PlusIcon === undefined ? undefined : <PlusIcon />}
          onClick={() => {
            setNotice(undefined)
            setEditing(blankDraft(engines))
          }}
        >
          {t('connections.new')}
        </AppButton>
      </div>

      {notice !== undefined ? <div className={`${PREFIX}-notice`}>{notice}</div> : null}

      {list.status === 'loading' ? (
        <div className={`${PREFIX}-notice`}>
          <Spinner /> {t('browse.loading')}
        </div>
      ) : null}

      {list.status === 'error' ? <div className={`${PREFIX}-notice ${PREFIX}-noticeError`}>{t('error.load', { message: list.error })}</div> : null}

      {list.status === 'ready' ? (
        <div className={`${PREFIX}-scroll`}>
          <div className={`${PREFIX}-list`}>
            {(list.connections ?? []).length === 0 ? <div className={`${PREFIX}-muted`}>{t('connections.empty')}</div> : null}
            {(list.connections ?? []).map((profile) => (
              <div key={profile.id} className={`${PREFIX}-card`}>
                <div className={`${PREFIX}-cardHead`}>
                  <span className={`${PREFIX}-cardName`}>{profile.label}</span>
                  <AppTag>{ENGINE_LABELS[profile.engine] ?? profile.engine}</AppTag>
                  <span className={`${PREFIX}-cardActions`}>
                    <AppButton
                      size="sm"
                      variant="primary"
                      onClick={() => {
                        setNotice(undefined)
                        setActive(profile)
                      }}
                    >
                      {t('connections.open')}
                    </AppButton>
                    <AppButton
                      size="sm"
                      onClick={() => setEditing({ ...blankDraft(engines), ...profile, password: '', passwordEnv: profile.passwordEnv ?? '', clearPassword: false })}
                    >
                      {t('connections.edit')}
                    </AppButton>
                    {confirming === profile.id ? null : (
                      <AppButton size="sm" danger onClick={() => setConfirming(profile.id)}>
                        {t('connections.remove')}
                      </AppButton>
                    )}
                  </span>
                </div>
                <div className={`${PREFIX}-muted`} title={describe(profile)}>
                  {describe(profile)}
                </div>
                {confirming === profile.id ? (
                  <div className={`${PREFIX}-row`}>
                    <span className={`${PREFIX}-muted`}>{t('connections.confirmRemove', { label: profile.label })}</span>
                    <AppButton
                      size="sm"
                      danger
                      onClick={async () => {
                        setConfirming(undefined)
                        try {
                          await rpc('connections.delete', { connectionId: profile.id })
                          setNotice(t('connections.removed', { label: profile.label }))
                          await load()
                        } catch (error) {
                          setNotice(String(error?.message ?? error))
                        }
                      }}
                    >
                      {t('connections.removeConfirm')}
                    </AppButton>
                    <AppButton size="sm" onClick={() => setConfirming(undefined)}>
                      {t('connections.cancel')}
                    </AppButton>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
