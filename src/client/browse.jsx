/**
 * The data browser: pick a database, schema and table, then page through rows
 * and read the table's structure. Used both for a SQLite file and for a saved
 * server connection, so it knows only about a target descriptor.
 *
 * Every control comes from `controls.jsx`, which resolves the app's own
 * primitives — nothing here styles a button or a field by hand.
 * @module dsh-database-preview/client/browse
 */
import React from 'react'
import { rpc } from './rpc.js'
import { PREFIX } from './styles.js'
import { AppButton, AppTag, Dropdown, Field, Spinner, icon } from './controls.jsx'

/** Page sizes offered for a table preview. */
const PAGE_SIZES = [50, 100, 200, 500]

/** The views a table can be shown in; also the values of the view dropdown. */
const VIEWS = ['rows', 'structure']

/** Render one cell's value, marking nulls and binary values. */
function Cell({ value, t }) {
  if (value === null || value === undefined) return <span className={`${PREFIX}-null`}>{t('browse.nullValue')}</span>
  if (typeof value === 'object' && value.$type === 'bytes') {
    const hex = String(value.hex ?? '')
    return (
      <span className={`${PREFIX}-blob`} title={`0x${hex}`}>
        {`0x${hex.slice(0, 32)}${hex.length > 32 ? '…' : ''}`} · {t('browse.bytes', { length: value.length })}
      </span>
    )
  }
  if (typeof value === 'object') {
    const text = JSON.stringify(value)
    return <span title={text}>{text}</span>
  }
  const text = String(value)
  return <span title={text}>{text}</span>
}

/**
 * A pager action: one glyph on the dropdown-surface chip, no visible text.
 *
 * The accessible name and the tooltip carry the label instead. When the kernel's
 * icon set is unavailable the label is rendered as the button's content, and the
 * square shape is dropped with it — a square button holding neither a glyph nor
 * text would be unusable.
 * @param root0 - component props.
 * @param root0.icon - the glyph component, or undefined in a shell without the primitives.
 * @param root0.label - the visible fallback text, also the accessible name.
 */
function PagerButton({ icon: Glyph, label, ...rest }) {
  const square = Glyph !== undefined
  return (
    <AppButton
      className={square ? `${PREFIX}-chip ${PREFIX}-iconButton` : `${PREFIX}-chip`}
      icon={square ? <Glyph /> : undefined}
      aria-label={label}
      title={label}
      {...rest}
    >
      {square ? null : label}
    </AppButton>
  )
}

/**
 * The browser body.
 * @param root0 - component props.
 * @param root0.target - `{ kind: 'file', sessionId, path }` or `{ kind: 'connection', connectionId, database?, schema? }`.
 * @param root0.t - translator.
 * @param root0.onBack - optional callback rendered as a back button.
 */
export function DatabaseBrowser({ target, t, onBack }) {
  const [catalog, setCatalog] = React.useState({ status: 'loading' })
  const [database, setDatabase] = React.useState(target.database)
  const [schema, setSchema] = React.useState(target.schema)
  const [table, setTable] = React.useState(undefined)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(100)
  const [detail, setDetail] = React.useState({ status: 'idle' })
  const [view, setView] = React.useState('rows')
  const [token, setToken] = React.useState(0)

  // The descriptor is a stable identity for the target, so a re-render does not refetch.
  const descriptor = React.useMemo(
    () =>
      target.kind === 'file'
        ? { kind: 'file', sessionId: target.sessionId, path: target.path }
        : { kind: 'connection', connectionId: target.connectionId },
    [target.kind, target.sessionId, target.path, target.connectionId],
  )

  React.useEffect(() => {
    const controller = new AbortController()
    setCatalog({ status: 'loading' })
    rpc('db.catalog', { target: descriptor, database, schema }, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setCatalog({ status: 'ready', data })
      })
      .catch((error) => {
        if (!controller.signal.aborted) setCatalog({ status: 'error', error: String(error?.message ?? error) })
      })
    return () => controller.abort()
  }, [descriptor, database, schema, token])

  // Adopt the database/schema the host actually opened, but only while the caller
  // has expressed no preference, so this cannot ping-pong with the fetch above.
  React.useEffect(() => {
    if (catalog.status !== 'ready') return
    if (database === undefined && catalog.data.currentDatabase !== undefined && catalog.data.currentDatabase !== null) {
      setDatabase(catalog.data.currentDatabase)
    }
    if (schema === undefined && catalog.data.currentSchema !== undefined && catalog.data.currentSchema !== null) {
      setSchema(catalog.data.currentSchema)
    }
  }, [catalog, database, schema])

  const tables = catalog.status === 'ready' ? (catalog.data.tables ?? []) : []

  // Keep a valid selection: default to the first table, and drop one that vanished.
  React.useEffect(() => {
    if (catalog.status !== 'ready') return
    if (table !== undefined && tables.some((entry) => entry.name === table)) return
    setTable(tables[0]?.name)
    setPage(1)
  }, [catalog.status, tables, table])

  React.useEffect(() => {
    if (table === undefined) {
      setDetail({ status: 'idle' })
      return undefined
    }
    const controller = new AbortController()
    setDetail({ status: 'loading' })
    rpc('db.table', { target: descriptor, table, page, pageSize, database, schema }, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setDetail({ status: 'ready', data })
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDetail({ status: 'error', error: String(error?.message ?? error) })
      })
    return () => controller.abort()
  }, [descriptor, table, page, pageSize, database, schema, token])

  const refresh = () => setToken((value) => value + 1)
  const PrevIcon = icon('IconChevronLeftOutlineRegular')
  const NextIcon = icon('IconChevronRightOutlineRegular')

  const databases = catalog.status === 'ready' ? (catalog.data.databases ?? []) : []
  const schemas = catalog.status === 'ready' ? (catalog.data.schemas ?? []) : []

  return (
    <div className={`${PREFIX}-root`}>
      {catalog.status === 'loading' ? (
        <div className={`${PREFIX}-notice`}>
          <Spinner /> {t('browse.loading')}
        </div>
      ) : null}

      {catalog.status === 'error' ? (
        <div className={`${PREFIX}-notice ${PREFIX}-noticeError`}>
          <div>{t('error.load', { message: catalog.error })}</div>
          <div className={`${PREFIX}-row`} style={{ marginTop: 8 }}>
            <AppButton size="sm" onClick={refresh}>
              {t('browse.retry')}
            </AppButton>
          </div>
        </div>
      ) : null}

      {catalog.status === 'ready' ? (
        <>
          {/* One chrome row: every picker and action, packed left, with the slack
              left over at the right edge. Nothing here grows, so no control is
              pushed away from the group. */}
          <div className={`${PREFIX}-bar`}>
            {onBack !== undefined ? (
              <AppButton onClick={onBack}>
                {t('connections.back')}
              </AppButton>
            ) : null}
            {databases.length > 0 ? (
              <Field label={t('browse.database')}>
                <Dropdown
                  label={t('browse.database')}
                  value={database ?? ''}
                  onChange={(value) => {
                    setDatabase(value)
                    setSchema(undefined)
                    setTable(undefined)
                    setPage(1)
                  }}
                  options={databases.map((name) => ({ value: name, label: name }))}
                />
              </Field>
            ) : null}
            {schemas.length > 0 ? (
              <Field label={t('browse.schema')}>
                <Dropdown
                  label={t('browse.schema')}
                  value={schema ?? ''}
                  onChange={(value) => {
                    setSchema(value)
                    setTable(undefined)
                    setPage(1)
                  }}
                  options={schemas.map((name) => ({ value: name, label: name }))}
                />
              </Field>
            ) : null}
            <Field label={t('browse.table')} className={`${PREFIX}-fieldTable`}>
              <Dropdown
                label={t('browse.table')}
                value={table ?? ''}
                onChange={(value) => {
                  setTable(value === '' ? undefined : value)
                  setPage(1)
                }}
                options={
                  tables.length === 0
                    ? [{ value: '', label: t('browse.noTables') }]
                    : tables.map((entry) => ({ value: entry.name, label: entry.type === 'view' ? `${entry.name} · view` : entry.name }))
                }
              />
            </Field>
            {detail.status === 'ready' ? (
              <Field label={t('browse.view')} className={`${PREFIX}-fieldNarrow`}>
                <Dropdown
                  label={t('browse.view')}
                  value={view}
                  onChange={setView}
                  options={VIEWS.map((name) => ({ value: name, label: t(name === 'rows' ? 'browse.rows' : 'browse.structure') }))}
                />
              </Field>
            ) : null}
            {/* Same surface as the dropdown triggers beside it — filled, no
                border, default 36px — and no leading glyph, so the row reads as
                one group. */}
            <AppButton className={`${PREFIX}-chip`} onClick={refresh}>
              {t('browse.refresh')}
            </AppButton>
            <span className={`${PREFIX}-spacer`} />
            <span className={`${PREFIX}-muted`} title={`${catalog.data.engine} ${catalog.data.version}`}>
              {catalog.data.engine} {catalog.data.version}
            </span>
            <AppTag>{t('browse.readOnly')}</AppTag>
          </div>

          {detail.status === 'loading' || detail.status === 'idle' ? (
            <div className={`${PREFIX}-notice`}>
              <Spinner /> {detail.status === 'idle' ? t('browse.selectTable') : t('browse.loading')}
            </div>
          ) : null}

          {detail.status === 'error' ? (
            <div className={`${PREFIX}-notice ${PREFIX}-noticeError`}>
              <div>{t('error.load', { message: detail.error })}</div>
              <div className={`${PREFIX}-row`} style={{ marginTop: 8 }}>
                <AppButton size="sm" onClick={refresh}>
                  {t('browse.retry')}
                </AppButton>
              </div>
            </div>
          ) : null}

          {detail.status === 'ready' ? (
            <>
              {/* The view picker rides the table row above; the pager is the only
                  control left here, and it belongs to the data view alone. */}
              {view === 'rows' ? (
                <div className={`${PREFIX}-bar`}>
                  <span className={`${PREFIX}-spacer`} />
                  <div className={`${PREFIX}-row`}>
                    <PagerButton
                      icon={PrevIcon}
                      label={t('browse.prev')}
                      disabled={page <= 1}
                      onClick={() => setPage((value) => Math.max(1, value - 1))}
                    />
                    <span className={`${PREFIX}-muted`}>{t('browse.page', { page })}</span>
                    <PagerButton
                      icon={NextIcon}
                      label={t('browse.next')}
                      disabled={detail.data.hasMore !== true}
                      onClick={() => setPage((value) => value + 1)}
                    />
                    <Dropdown
                      label={t('browse.pageSize')}
                      value={String(pageSize)}
                      align="end"
                      wrapClassName={`${PREFIX}-dropdownWrapNarrow`}
                      onChange={(value) => {
                        setPageSize(Number(value))
                        setPage(1)
                      }}
                      options={PAGE_SIZES.map((size) => ({ value: String(size), label: String(size) }))}
                    />
                  </div>
                </div>
              ) : null}

              {detail.data.truncated === true ? <div className={`${PREFIX}-notice`}>{t('browse.truncated')}</div> : null}

              <div className={`${PREFIX}-scroll`}>
                {view === 'rows' ? (
                  <table className={`${PREFIX}-grid`}>
                    <thead>
                      <tr>
                        {(detail.data.columns ?? []).map((column) => (
                          <th key={column.name} title={`${column.name} · ${column.type}`}>
                            {column.name}
                            {column.primaryKey ? <span className={`${PREFIX}-pk`}>PK</span> : null}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(detail.data.rows ?? []).length === 0 ? (
                        <tr>
                          <td colSpan={Math.max(1, (detail.data.columns ?? []).length)} className={`${PREFIX}-muted`}>
                            {t('browse.emptyTable')}
                          </td>
                        </tr>
                      ) : (
                        detail.data.rows.map((row, rowIndex) => (
                          <tr key={rowIndex}>
                            {row.map((value, columnIndex) => (
                              <td key={columnIndex} className={typeof value === 'number' ? `${PREFIX}-num` : undefined}>
                                <Cell value={value} t={t} />
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                ) : (
                  <div className={`${PREFIX}-structure`}>
                    <div className={`${PREFIX}-sectionTitle`}>{t('browse.columns')}</div>
                    <table className={`${PREFIX}-grid`}>
                      <thead>
                        <tr>
                          <th>{t('browse.column')}</th>
                          <th>{t('browse.type')}</th>
                          <th>{t('browse.nullable')}</th>
                          <th>{t('browse.default')}</th>
                          <th>{t('browse.key')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.data.columns ?? []).map((column) => (
                          <tr key={column.name}>
                            <td>{column.name}</td>
                            <td>{column.type}</td>
                            <td>{column.nullable ? t('browse.yes') : t('browse.no')}</td>
                            <td>{column.defaultValue === null || column.defaultValue === undefined ? '—' : String(column.defaultValue)}</td>
                            <td>{column.primaryKey ? 'PK' : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className={`${PREFIX}-sectionTitle`}>{t('browse.indexes')}</div>
                    <table className={`${PREFIX}-grid`}>
                      <thead>
                        <tr>
                          <th>{t('browse.indexName')}</th>
                          <th>{t('browse.unique')}</th>
                          <th>{t('browse.column')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.data.indexes ?? []).length === 0 ? (
                          <tr>
                            <td colSpan={3} className={`${PREFIX}-muted`}>
                              —
                            </td>
                          </tr>
                        ) : (
                          detail.data.indexes.map((index) => (
                            <tr key={index.name}>
                              <td>{index.name}</td>
                              <td>{index.unique ? t('browse.yes') : t('browse.no')}</td>
                              <td>{(index.columns ?? []).join(', ')}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
