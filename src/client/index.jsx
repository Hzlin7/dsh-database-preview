/**
 * Database preview — client half.
 *
 * Registers two right-Sidebar tab types:
 *
 * - a resource type at the default `extension` band claiming the database file
 *   suffixes, so opening a `.db`/`.sqlite` file from the Files tab renders in the
 *   same preview pane the document viewers use, instead of the binary fallback;
 * - a page type contributed to the Sidebar guide, which owns saved server
 *   connections for MySQL, PostgreSQL and SQL Server.
 *
 * A build step bundles this entry into `lib/client.js` in the client module
 * loader's factory form; see `scripts/build.mjs`.
 * @module dsh-database-preview/client
 */
import React from 'react'
import { parseFileAddress } from './address.js'
import { ConnectionPage, FilePage } from './pages.jsx'
import { copyFor, DICTIONARIES, NS, setTranslator } from './i18n.js'
import { UpdatePanel } from './update.jsx'
import { installStyles } from './styles.js'

/** Identity of the resource type, and the key its body registers under. */
export const FILE_TYPE_ID = 'dsh-database-preview'
/** Tab kind of the resource type. */
export const FILE_KIND = 'database'
/** Identity of the connection-manager page type. */
export const CONNECTIONS_TYPE_ID = 'dsh-database-preview/connections'
/** Tab kind of the connection-manager page type. */
export const CONNECTIONS_KIND = 'database-connections'

/** File suffixes this plugin claims. A narrower pattern at the extension band outranks the preview's fallback type. */
export const DATABASE_EXTENSIONS = ['db', 'sqlite', 'sqlite3', 'db3', 's3db', 'sl3']

/** Body of a database file tab. */
function DatabaseFileBody(props) {
  const { tab } = props.useTabInfo()
  return <FilePage t={copyFor(props)} address={tab.contentId} file={parseFileAddress(tab.contentId)} />
}

/** Body of the connection-manager tab. */
function ConnectionsBody(props) {
  return <ConnectionPage t={copyFor(props)} />
}

/** The resource type's static registration. */
function fileTypeDefinition(t) {
  return {
    id: FILE_TYPE_ID,
    kind: FILE_KIND,
    patterns: DATABASE_EXTENSIONS.map((extension) => `*.${extension}`),
    // The chip text is the decoded file name, captured when the tab opens.
    title: (address) => {
      const name = String(address ?? '').slice(String(address ?? '').lastIndexOf('/') + 1)
      if (name === '') return t('title')
      try {
        return decodeURIComponent(name)
      } catch {
        return name
      }
    },
  }
}

/** The page type's static registration, including its guide entry. */
function connectionsTypeDefinition(t) {
  return {
    id: CONNECTIONS_TYPE_ID,
    kind: CONNECTIONS_KIND,
    title: () => t('connections.title'),
    guide: [{ id: 'database-connections', order: 20, title: t('connections.title'), description: t('connections.guide') }],
  }
}

/** Browser services this plugin's body needs before it can register anything. */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/**
 * Client plugin body.
 * @param ctx - client root context.
 */
export function apply(ctx) {
  let locale = null
  try {
    locale = ctx.locale
  } catch {
    locale = null
  }
  if (locale === null && typeof ctx.get === 'function') {
    try {
      locale = ctx.get('locale')
    } catch {
      locale = null
    }
  }
  if (locale !== null && typeof locale.register === 'function') {
    try {
      const dispose = locale.register(NS, DICTIONARIES)
      if (typeof ctx.effect === 'function') ctx.effect(() => dispose, 'dsh-database-preview: dictionaries')
    } catch {
      // Copy registration is optional; the local dictionaries already answer.
    }
  }
  const translate = setTranslator(locale)

  ctx.effect(() => installStyles(), 'dsh-database-preview: styles')

  ctx.effect(() => ctx.sidebarRightTabs.register(fileTypeDefinition(translate)), 'dsh-database-preview: file type')
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: FILE_TYPE_ID, locale: NS }, DatabaseFileBody),
      ),
    'dsh-database-preview: file body',
  )

  ctx.effect(() => ctx.sidebarRightTabs.register(connectionsTypeDefinition(translate)), 'dsh-database-preview: connections type')
  ctx.effect(
    () =>
      ctx.slots.inject('sidebar.right.pane.tab', () =>
        ctx.slots.register({ name: 'sidebar.right.pane.tab', key: CONNECTIONS_TYPE_ID, locale: NS }, ConnectionsBody),
      ),
    'dsh-database-preview: connections body',
  )

  // This bundle's own page in the plugin manager. The slot is keyed by the
  // bundle's package name; registering under any other key fails the whole web
  // entry at load rather than showing up in the wrong place.
  ctx.effect(
    () =>
      ctx.slots.inject('plugins.bundle.config', () =>
        ctx.slots.register(
          { name: 'plugins.bundle.config', key: FILE_TYPE_ID, locale: NS, label: () => translate('update.title') },
          UpdatePanel,
        ),
      ),
    'dsh-database-preview: plugin page',
  )
}

export default { apply, inject }
