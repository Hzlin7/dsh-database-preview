/**
 * Copy for the database preview.
 *
 * The translator prefers the harness locale service so the panel follows the
 * application language, and falls back to the browser language and then English.
 * Every dictionary lookup is guarded: a missing or unauthorized locale service
 * must never make the panel fail to render.
 * @module dsh-database-preview/client/i18n
 */

/** This plugin's copy namespace. */
export const NS = 'databasePreview'

/** Simplified Chinese dictionary. */
export const zh = {
  'title': '数据库',
  'connections.title': '数据库连接',
  'connections.guide': '管理并浏览 MySQL、PostgreSQL、SQL Server 连接',
  'connections.intro': '连接信息保存在本机 DSH 目录中，密码仅用于建立只读连接，从不回传到界面。',
  'connections.empty': '还没有保存的连接。',
  'connections.new': '新建连接',
  'connections.edit': '编辑',
  'connections.remove': '删除',
  'connections.test': '测试连接',
  'connections.testing': '正在测试…',
  'connections.testOk': '连接成功 · 版本 {version}',
  'connections.open': '浏览数据',
  'connections.back': '返回连接列表',
  'connections.save': '保存',
  'connections.saving': '正在保存…',
  'connections.cancel': '取消',
  'connections.saved': '已保存连接「{label}」',
  'connections.removed': '已删除连接「{label}」',
  'connections.confirmRemove': '确定删除连接「{label}」吗？该操作不可撤销，但不会影响数据库本身。',
  'connections.removeConfirm': '确认删除',
  'connections.clearPassword': '清除已保存的密码',
  'connections.envHint': '环境变量名（优先于下方密码）',
  'connections.passwordHint': '留空则不修改已保存的密码',
  'field.label': '名称',
  'field.engine': '类型',
  'field.host': '主机',
  'field.port': '端口',
  'field.user': '用户名',
  'field.password': '密码',
  'field.passwordEnv': '密码环境变量',
  'field.database': '数据库',
  'field.schema': '模式',
  'field.path': '文件路径',
  'field.encrypt': '使用加密连接（TLS）',
  'field.optional': '可选',
  'browse.database': '数据库',
  'browse.schema': '模式',
  'browse.view': '视图',
  'browse.table': '表',
  'browse.refresh': '刷新',
  'browse.loading': '正在读取…',
  'browse.selectTable': '选择一张表以预览数据',
  'browse.noTables': '该数据库中没有可预览的表或视图。',
  'browse.rows': '数据',
  'browse.structure': '结构',
  'browse.indexes': '索引',
  'browse.columns': '列',
  'browse.column': '列名',
  'browse.type': '类型',
  'browse.nullable': '可空',
  'browse.default': '默认值',
  'browse.key': '主键',
  'browse.indexName': '索引',
  'browse.unique': '唯一',
  'browse.page': '第 {page} 页',
  'browse.prev': '上一页',
  'browse.next': '下一页',
  'browse.pageSize': '每页行数',
  'browse.rowCount': '显示第 {from}–{to} 行',
  'browse.more': '还有更多行',
  'browse.nullValue': 'NULL',
  'browse.bytes': '{length} 字节',
  'browse.readOnly': '只读预览',
  'browse.emptyTable': '这张表没有数据。',
  'browse.retry': '重试',
  'browse.truncated': '结果过大，已省略数据行。',
  'browse.yes': '是',
  'browse.no': '否',
  'browse.details': '详细信息',
  'error.title': '读取失败',
  'error.load': '无法读取数据库：{message}',
  'update.title': '数据库预览',
  'update.checking': '正在检查…',
  'update.available': '有新版本 v{version}',
  'update.upToDate': '已是最新版本',
  'update.registryUnknownShort': 'npm 上查不到',
  'update.unknown': '未知',
  'update.failed': '更新失败：{message}',
  'update.installed': '已更新到 v{version}，重启 DSH 后生效。',
  'update.running': '运行中版本',
  'update.kindLink': 'link: 安装',
  'update.kindCopy': '已安装副本',
  'update.pendingRestartTag': '待重启',
  'update.check': '检查更新',
  'update.applying': '正在更新…',
  'update.apply': '更新到 v{version}',
  'update.latest': '最新版本',
  'update.notPublished': 'npm 上还没有这个包。发布之后才能在这里检查更新。',
  'update.registryUnknown': '读不到 npm registry：{reason}',
  'update.state.queued': '排队中…',
  'update.state.running': '正在更新…',
  'update.state.succeeded': '更新完成',
  'update.state.failed': '更新失败',
  'update.state.cancelled': '已取消',
  'update.state.rolled-back': '已回滚',
  'update.pendingRestartBody': '磁盘上已是 v{version}，但当前进程运行的仍是旧代码，重启 DSH 后才生效。',
  'update.marketMissing': '未安装 dshmarket，无法一键更新。可直接执行：{command}',
  'update.marketMissingLink': '在插件页卸载后重新安装',
  'update.linkInstall': '这是 link: 安装，指向你的源码目录。更新请在自己的仓库里 git pull 并重新构建。',
  'update.viaMarket': '更新由 dshmarket 的公开更新 API 执行（该 API 目前标记为 beta）。',
}

/** English dictionary. */
export const en = {
  'title': 'Database',
  'connections.title': 'Database connections',
  'connections.guide': 'Manage and browse MySQL, PostgreSQL and SQL Server connections',
  'connections.intro': 'Connection details are stored in your local DSH directory. A password is used only to open a read-only connection and is never sent back to this panel.',
  'connections.empty': 'No saved connections yet.',
  'connections.new': 'New connection',
  'connections.edit': 'Edit',
  'connections.remove': 'Delete',
  'connections.test': 'Test connection',
  'connections.testing': 'Testing…',
  'connections.testOk': 'Connected · version {version}',
  'connections.open': 'Browse data',
  'connections.back': 'Back to connections',
  'connections.save': 'Save',
  'connections.saving': 'Saving…',
  'connections.cancel': 'Cancel',
  'connections.saved': 'Saved connection "{label}"',
  'connections.removed': 'Deleted connection "{label}"',
  'connections.confirmRemove': 'Delete connection "{label}"? This cannot be undone and does not touch the database itself.',
  'connections.removeConfirm': 'Delete',
  'connections.clearPassword': 'Clear the saved password',
  'connections.envHint': 'Environment variable name (takes precedence over the password below)',
  'connections.passwordHint': 'Leave blank to keep the saved password',
  'field.label': 'Name',
  'field.engine': 'Engine',
  'field.host': 'Host',
  'field.port': 'Port',
  'field.user': 'User',
  'field.password': 'Password',
  'field.passwordEnv': 'Password environment variable',
  'field.database': 'Database',
  'field.schema': 'Schema',
  'field.path': 'File path',
  'field.encrypt': 'Encrypted connection (TLS)',
  'field.optional': 'optional',
  'browse.database': 'Database',
  'browse.schema': 'Schema',
  'browse.view': 'View',
  'browse.table': 'Table',
  'browse.refresh': 'Refresh',
  'browse.loading': 'Loading…',
  'browse.selectTable': 'Select a table to preview its data',
  'browse.noTables': 'This database has no previewable tables or views.',
  'browse.rows': 'Data',
  'browse.structure': 'Structure',
  'browse.indexes': 'Indexes',
  'browse.columns': 'Columns',
  'browse.column': 'Column',
  'browse.type': 'Type',
  'browse.nullable': 'Nullable',
  'browse.default': 'Default',
  'browse.key': 'Key',
  'browse.indexName': 'Index',
  'browse.unique': 'Unique',
  'browse.page': 'Page {page}',
  'browse.prev': 'Previous',
  'browse.next': 'Next',
  'browse.pageSize': 'Rows per page',
  'browse.rowCount': 'Rows {from}–{to}',
  'browse.more': 'more rows available',
  'browse.nullValue': 'NULL',
  'browse.bytes': '{length} bytes',
  'browse.readOnly': 'Read-only preview',
  'browse.emptyTable': 'This table has no rows.',
  'browse.retry': 'Retry',
  'browse.truncated': 'The result was too large, so its rows were omitted.',
  'browse.yes': 'Yes',
  'browse.no': 'No',
  'browse.details': 'Details',
  'error.title': 'Could not read',
  'error.load': 'Could not read the database: {message}',
  'update.title': 'Database preview',
  'update.checking': 'Checking…',
  'update.available': 'Version {version} is available',
  'update.upToDate': 'Up to date',
  'update.registryUnknownShort': 'not on npm',
  'update.unknown': 'unknown',
  'update.failed': 'Update failed: {message}',
  'update.installed': 'Updated to v{version}. Restart DSH to apply it.',
  'update.running': 'Running version',
  'update.kindLink': 'link: install',
  'update.kindCopy': 'installed copy',
  'update.pendingRestartTag': 'restart to apply',
  'update.check': 'Check for updates',
  'update.applying': 'Updating…',
  'update.apply': 'Update to v{version}',
  'update.latest': 'Latest version',
  'update.notPublished': 'This package is not on npm yet. Publishing it is what makes an update checkable here.',
  'update.registryUnknown': 'Could not reach the npm registry: {reason}',
  'update.state.queued': 'Queued…',
  'update.state.running': 'Updating…',
  'update.state.succeeded': 'Update finished',
  'update.state.failed': 'Update failed',
  'update.state.cancelled': 'Cancelled',
  'update.state.rolled-back': 'Rolled back',
  'update.pendingRestartBody': 'The files on disk are already v{version}, but this process still runs the old code. Restart DSH to apply it.',
  'update.marketMissing': 'dshmarket is not installed, so the one-click update is unavailable. Run: {command}',
  'update.marketMissingLink': 'uninstall and reinstall it from the plugin page',
  'update.linkInstall': 'This is a link: install pointing at your own checkout. Update it with git pull and a rebuild in your repository.',
  'update.viaMarket': "The update runs through dshmarket's public update API, which is currently marked beta.",
}

/** The dictionaries this plugin registers. */
export const DICTIONARIES = { zh, en }

/** Replace `{name}` placeholders. */
function format(template, params) {
  return String(template).replace(/\{(\w+)\}/g, (match, name) => (params !== undefined && Object.hasOwn(params, name) ? String(params[name]) : match))
}

/** Pick a dictionary from the browser's languages. */
function browserDictionary() {
  const nav = typeof navigator !== 'undefined' ? navigator : typeof window !== 'undefined' && window !== null ? window.navigator : undefined
  const tags = nav !== undefined && nav !== null && Array.isArray(nav.languages) && nav.languages.length > 0 ? nav.languages : [nav?.language]
  for (const tag of tags) {
    if (typeof tag !== 'string' || tag === '') continue
    const base = tag.toLowerCase().split('-')[0]
    if (Object.hasOwn(DICTIONARIES, base)) return DICTIONARIES[base]
  }
  return en
}

/**
 * Build the translator this plugin's components use.
 *
 * A locale service that is absent, unauthorized, or whose binding throws must
 * not break rendering, so every lookup is guarded and falls back to the
 * browser dictionary and then to English.
 * @param service - `ctx.locale`, when available.
 * @returns the translate function.
 */
export function createTranslator(service) {
  let bound = null
  if (service !== undefined && service !== null && typeof service.bind === 'function') {
    try {
      bound = service.bind(NS)
    } catch {
      bound = null
    }
  }
  return function translate(key, params) {
    if (bound !== null) {
      try {
        const resolved = bound(key, params)
        if (typeof resolved === 'string' && resolved !== '' && resolved !== key) return resolved
      } catch {
        // A stale binding falls through to the local dictionaries.
      }
    }
    const dictionary = browserDictionary()
    const template = dictionary?.[key] ?? en[key] ?? key
    return params === undefined ? template : format(template, params)
  }
}

/**
 * The translator the whole client half shares.
 *
 * It lives here rather than in the entry module so every component reads copy
 * through one path: the entry installs it once during `apply`, and a component
 * that never ran still gets the browser-language fallback.
 */
let shared = createTranslator(undefined)

/**
 * Install the translator built from the client's locale service.
 * @param service - `ctx.locale`, when available.
 * @returns the translator, for callers that need it immediately.
 */
export function setTranslator(service) {
  shared = createTranslator(service)
  return shared
}

/**
 * The translator a component should use.
 *
 * The slot framework may pass its own `t`, which follows a language change; it
 * is preferred when it actually resolves, and the shared one answers otherwise.
 * @param props - the component's props.
 * @returns the translate function.
 */
export function copyFor(props) {
  const injected = props?.t
  if (typeof injected !== 'function') return shared
  return (key, params) => {
    const resolved = injected(key, params)
    return typeof resolved === 'string' && resolved !== '' && resolved !== key ? resolved : shared(key, params)
  }
}
