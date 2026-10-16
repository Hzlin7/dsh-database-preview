# dsh-database-preview

DeepSeek Harness 的数据库**只读预览**插件：在右侧边栏的文件预览面板里浏览 SQLite / MySQL / PostgreSQL / SQL Server 的表、数据与结构，**从不写库**。

## 功能

| 能力 | 说明 |
|---|---|
| 引擎 | SQLite（`node:sqlite`，零依赖）、MySQL / MariaDB、PostgreSQL、SQL Server |
| 表与视图 | 列出当前库 / 模式下的表与视图 |
| 数据 | 分页预览，每页 50 / 100 / 200 / 500 行 |
| 结构 | 列名、类型、可空、默认值、主键标记 |
| 索引 | 索引名、是否唯一、包含列 |
| 值呈现 | `NULL` 灰斜体；BLOB 显示十六进制前缀与字节数；超出 `Number.MAX_SAFE_INTEGER` 的整数保持字符串精度 |
| 语言 | 跟随宿主界面语言（中文 / English） |

不支持：写入、DDL、手写 SQL 输入框、结果导出。

## 两个入口

**SQLite 文件** —— 右侧边栏的**文件**标签页里点任意 `.db`、`.sqlite`、`.sqlite3`、`.db3`、`.s3db`、`.sl3` 文件，就在同一个预览面板里打开。

实现上这是在 DSH 的**扩展档位**注册一个更窄的地址模式（`*.db` 等），按标签类型排序（扩展档 > 内建档 > 回退档）接管这些地址——即官方文档描述的内建预览插件被接管的方式，没有修改任何内建包。

**服务器数据库** —— 右侧边栏标签栏的 **＋** 打开引导页，选**数据库连接**，可新建 / 测试 / 编辑 / 删除连接并进入数据浏览。

## 安装

```powershell
# 换成本仓库的实际路径
dsh plugin --profile <profile> add <path-to>/dsh-database-preview
```

DSH 的插件管理器会把它加为 `link:` 依赖，并把 `dsh-database-preview` 追加进 profile 的 `dsh.profile.bundles`。**HMR 会在该列表变化时实时重组**，所以插件当场生效，不需要重启 DSH（改代码后另见下文）。

也可以在 Web 界面的**插件**页里按路径安装。

卸载：

```powershell
dsh plugin --profile <profile> remove dsh-database-preview
```

## 连接信息与密码

连接档案保存在 `<DSH_HOME>/dsh-database-preview/connections.json`（可用环境变量 `DSH_DB_PREVIEW_DIR` 改写目录），以 `0600` 权限原子写入。

密码两种给法：

- **`passwordEnv`（推荐）**：填环境变量名，密码完全不落盘，且优先于文件里的字面密码。
- **字面密码**：存在上述 JSON 里。本机单用户场景可接受，但**如果你会同步或分享 profile 目录，请用 `passwordEnv`**。

规则：编辑连接时**留空密码字段 = 保留原密码**；要清除必须显式勾选。任何接口都不会把密码回传给界面，列表只报告「是否已设置」。

## 只读是怎么保证的

| 层 | 措施 |
|---|---|
| 语句来源 | 全部由插件生成，接口不接受 SQL 文本 |
| 标识符 | 先在内省目录中校验存在，再按引擎转义（`"` / `` ` `` / `[]`） |
| 值 | 只有 `LIMIT` / `OFFSET` 等走占位符绑定 |
| SQLite | `DatabaseSync(path, { readOnly: true })` + `PRAGMA query_only = ON` |
| MySQL | `SET SESSION TRANSACTION READ ONLY`，`multipleStatements: false` |
| PostgreSQL | 会话级 `default_transaction_read_only=on`，并设 `statement_timeout` |
| SQL Server | 只发只读 SELECT，`requestTimeout` 兜底 |
| 文件路径 | 由宿主的 workspace-files 服务解析，沿用沙箱后端的读取权限；插件再自验 SQLite 魔数头 |

宿主侧只 claim 一条路由 `POST /_dsh/dsh-database-preview/<method>`，请求先过 `ctx.connection.requestRejection(req)`——与官方插件同一道 Host/Origin 栅栏与浏览器认证边界。改状态的方法只接受 POST。

## 限制

- **只读**：没有编辑、DDL、导出，也没有手写 SQL 输入框。
- **SQLite 跑在 worker 线程里**：`node:sqlite` 是同步 API，大库查询会卡住整个宿主；worker 有 20 秒硬超时，超时终止线程并报错，而不是让界面冻住。
- **WAL 模式的 SQLite 库可能只读打开失败**：SQLite 需要可写的 `-shm` / `-wal` 目录。会给出提示，把库切到 `journal_mode=DELETE` 或让目录可写即可。
- 页大小上限 500 行、页码上限 5000；响应超过 8 MiB 时丢弃数据行并提示。
- BLOB 只显示前 256 字节的十六进制预览，不下载内容。
- 服务器引擎每次调用新建一条短连接、用完即关：不持有连接池，代价是每次多一次握手。
- 需要 `node:sqlite`（Node 22.5+ / Electron 35+）。当前 DSH 桌面端是 Electron 44 / Node 24.18。

## 开发

```powershell
pnpm install
pnpm run build      # src/ -> lib/（客户端半打成模块加载器工厂包）
pnpm test           # 32 项：宿主逻辑 / 两个入口的接线 / 真实 DOM 渲染
pnpm run sample     # 生成 examples/shop.db 用于手动验证
```

```
src/host.js                宿主入口：路由、目标解析、只读守卫
src/host/engines.js        四个引擎的适配层
src/host/sqlite-worker.js  SQLite 读取（worker 线程，可超时终止）
src/host/store.js          连接档案持久化
src/host/util.js           JSON 安全取值、标识符转义
src/client/index.jsx       客户端入口：注册两个标签类型
src/client/controls.jsx    控件层：解析内核原语 + 无原语时的兜底
src/client/browse.jsx      数据浏览器
src/client/connections.jsx 连接管理页
src/client/styles.js       样式（模板字符串）
scripts/build.mjs          构建（暂存目录 + 原子替换）
tests/                     三层测试
```

## 许可

MIT
