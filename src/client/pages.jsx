/**
 * Page components behind the two registered tab types.
 * @module dsh-database-preview/client/pages
 */
import React from 'react'
import { DatabaseBrowser } from './browse.jsx'
import { Connections } from './connections.jsx'
import { PREFIX } from './styles.js'

/**
 * A database file tab.
 * @param root0 - component props.
 * @param root0.t - translator.
 * @param root0.address - the tab's resource address.
 * @param root0.file - the parsed address, or undefined when it is not a Session file address.
 */
export function FilePage({ t, address, file }) {
  if (file === undefined || file.scope !== 'session') {
    return (
      <div className={`${PREFIX}-root`}>
        <div className={`${PREFIX}-notice ${PREFIX}-notice-error`}>{t('error.load', { message: `unsupported address: ${address}` })}</div>
      </div>
    )
  }
  return <DatabaseBrowser t={t} target={{ kind: 'file', sessionId: file.sessionId, path: file.path }} />
}

/**
 * The connection-manager page.
 * @param root0 - component props.
 * @param root0.t - translator.
 */
export function ConnectionPage({ t }) {
  return <Connections t={t} />
}
