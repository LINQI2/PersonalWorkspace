# PersonalWorkspace V1.0 整合记录

日期：2026-10-24
状态：整合交付点。停在此处，不自动进入后续知识库优化。

## 1. 目标与范围

把两个 Windows 本地项目整合为一个站点：

- 知识收藏馆：`D:\Projects\PersonalKnowledge`（基线 Git `c9cdc7adc2ed75c2c2b872d91b85d020567c1d0a`，V1.9，schema 11）
- 个人任务台：`D:\Projects\PersonalTaskHub`（无 Git，React 18 + Express 4 + `node:sqlite`，正式库 `data/taskhub.db`）
- 新工程：`D:\Projects\PersonalWorkspace`，统一地址 `http://127.0.0.1:5180/`

本轮只做整合与必要的缺陷修复：不重做首页/分类/知识图谱，不做任务-知识双向关联、AI 规划任务、日历/甘特、多人协作、云同步，不扩大功能范围。

## 2. 现场审计（迁移时实测）

| 项目 | 结果 |
| --- | --- |
| Node / 平台 | Node 24.21.0（知识库要求 24.x），Windows |
| 知识库代码 | 工作树干净，HEAD 与审计一致；React 19 / Express 5 / Vite 7 / Tiptap 3 / mind-elixir 5.15.1 |
| 知识库数据 | `library.sqlite` schema 11；21 entries、2 assets、5 domains、3 tags、1 collection、2 mindmaps、26 mindmap_versions、1 专题文档；WAL 1.39 MB（必须用 SQLite 快照，不能复制主文件） |
| 任务台代码 | 无 Git；React 18 / Express 4；任务树、右键、拖拽、状态、备注、搜索、撤销、JSON 备份 |
| 任务台数据 | 迁移时通过运行中 API 读取：25 条任务、3 个根、最大层级 4、未开始 24 / 已完成 1、备注 0、折叠 0；主库 4 KB + WAL 531 KB |
| 端口 | 知识库默认 3000（当时未运行），任务台 5175（运行时读取最新数据），新站点 5180 |

## 3. 架构决策

- **单 Node 进程 + 单 React 应用**。以知识库 V1.9 工程为底座（Express 5、静态托管 `dist/`、派生静态资源 `/static/`、附件 `/assets/`）。
- **双数据库、双模块**：
  - 知识库：`data/library.sqlite`（schema 11 原样，不因整合改表）。
  - 任务台：`data/tasks.db`（独立文件，WAL、外键、`user_version=1`）。
  - 服务端代码 `app/server/tasks/{store,router}.js`，前端 `app/client/tasks/`。
- **API 命名空间**：`/api/tasks`（GET/POST/PATCH/DELETE/PUT），任务导入 `POST /api/workspace/tasks/import`。
- **统一外壳**：知识库原有的固定顶栏 + 侧栏；新增「任务台」一级导航。品牌统一为「个人工作空间」。任务模块不再保留自己的品牌栏，只保留模块工具条（搜索/撤销/新建任务）。
- **端口/数据目录**：默认 `5180`，数据目录默认 `<root>/data`；支持 `PORT`、`PW_DATA_DIR`（兼容 `PK_DATA_DIR`）。
- **启动链**：沿用知识库经过验证的启动器（数据锁、实例令牌、端口归属检查、按需构建、后台启动），仅替换应用标识与端口；新增 `启动个人工作空间.bat` / `停止个人工作空间.bat`，移除旧名称脚本。

## 4. 前端整合与状态保护

- `TasksModule` 常驻挂载，切到知识库时仅隐藏（`.tasks-host`），任务搜索、选中、展开、详情与未完成备注定时器不会因切换丢失。
- 任务台用独立状态 `tasksOpen`，不修改知识视图 `view`：
  - 知识列表、筛选、搜索、选中、阅读位置保持挂载；
  - 进入任务台前记录 `window.scrollY`，离开时在 `requestAnimationFrame` 中恢复；
  - 切换仍走原 `nav()` 守卫：编辑中拒绝切换、快速记录未保存确认、思维导图/专题离开检查。
- 地址：`#tasks` 直接打开任务台（刷新保持）；离开任务台清除该 hash。知识锚点 `#content-*`、`#chapter-*`、`#quote-*`、`#preview-*` 行为未改。
- 备注保存：详情面板 500ms 防抖 + 失焦立即保存 + `pagehide` 兜底；切换模块不卸载组件，异步保存不会被卸载中断。

## 5. 样式隔离

原任务台 CSS 含 `:root`、`*`、`body`、`button`、`::-webkit-scrollbar` 等全局规则，直接引入会污染知识库弹窗与表单。

- `scripts/scope-tasks-css.mjs` 一次性把 `app/client/tasks/styles.css` 转换为 `tasks-scoped.css`：所有选择器限定在 `.tw-app` 下，`:root` 变量改为 `.tw-app` 变量，`body.is-dragging` 改为 `body.tw-dragging .tw-app`，`@media` 递归处理，`@keyframes` 原样保留。
- 任务模块根节点改为 `.tw-app`；`<main>` 改为 `<div>`（避免知识库 `main` 的 margin/padding 命中），使用 `body.tw-dragging` 而非通用类名。
- `workspace.css` 增加作用域内的标签重置（`p/h1-h4/button/input/textarea`），抵消知识库全局标签规则。
- 结果：知识库列表、阅读器、思维导图、设置弹窗均无任务台样式泄漏；任务台右键菜单、拖拽提示、详情面板层级正常。

## 6. 安全设计

任务接口不新增一套鉴权，而是完全复用知识库现有边界：

- 仅允许 `Host: 127.0.0.1|localhost`、端口一致、`remoteAddress` 环回、`Sec-Fetch-Site != cross-site`；有 `Origin` 时必须同源。
- 所有非 GET 请求必须带 `X-PK-Request: 1`；AI/敏感配置另有 `X-PK-Session`。
- 统一 `express.json({ limit: '2mb' })`、备份/恢复上传 512 MB 上限；维护门（`busy`）在备份/恢复期间拒绝 `/api`、`/assets` 写入与读取。
- 任务参数校验：ID 白名单正则（≤64）、标题非空 ≤500、备注 ≤20000、状态枚举、父任务存在、拖拽循环与自引用服务端二次拒绝、`index` 必须为有限数字、整表替换严格校验孤儿/重复/循环/未知状态，拒绝时整批不写入。
- 不暴露任意文件路径；`/api/tasks/info` 只返回本机数据库路径与统计（与 `/api/meta` 同级信息）。
- CSP、`no-store`、错误脱敏沿用；不开放 CORS。

修复的既有缺陷：知识库恢复时从系统临时盘（C:）向 data 盘（D:）`renameSync` 会 `EXDEV` 失败，导致旧知识库 ZIP 无法恢复；现改为 `rename → EXDEV 时 cpSync + rmSync`（`app/server/index.js`）。

## 7. 任务数据模型

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'todo',   -- todo/doing/done/paused
  collapsed INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_parent ON tasks(parent_id, sort_order);
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version = 1;
```

- 与任务台原模型一致（无 schema 破坏）；`created_at/updated_at` 原样保留。
- 撤销：客户端 30 步内存快照 → `PUT /api/tasks` 整表替换（同事务，父子先写）；服务端严格校验后再写，失败不改变数据。后续如增加任务关联数据，需同步扩展快照与替换逻辑。

## 8. 正式数据迁移

脚本：`scripts/migrate-legacy.mjs`（只读源，目标已有数据库时拒绝覆盖）。

- 知识库：只读连接上 `VACUUM INTO` 目标库（自动包含 WAL 最新状态），随后核对 schema 11、`integrity_check`、entries 数量；复制 `attachments/`、`workspace.json`、`ai-usage.json`；旧备份复制到 `data/backups/knowledge-legacy/`。
- 任务台：优先请求运行中的 `http://127.0.0.1:5175/api/tasks`（含最新提交）；服务未运行时只读 SQLite（自动读 WAL）。
- 写入 `data/tasks.db` 前后比较结构指纹（id/父级/顺序/状态/标题/备注/折叠/时间），不一致即停止。
- 输出 `data/migration-report.json`，并把源任务 JSON 存为 `data/backups/tasks-migrated-*.json`。

正式迁移结果（2026-10-24）：

| 指标 | 结果 |
| --- | --- |
| 知识库 | 21 entries、2 assets、2 mindmaps、26 版本、1 专题；schema 11、integrity ok、外键 0；库 SHA-256 `5728ba55…e7c503` 与迁移前一致快照相同 |
| 任务 | 25 条、根 3、最大层级 4、未开始 24 / 已完成 1；迁移前后指纹均 `30235bac…5c17b` |
| 附件 | 2 个，正式目录下 `/assets/*.webp` 返回 200 |

原项目保持不变；迁移前独立备份（知识库一致副本 + 任务台代码/JSON 快照）在 `D:\Projects\PersonalWorkspace-backups\`。

## 9. 统一备份与恢复

ZIP 结构：

```
workspace-manifest.json   format=personal-workspace, version=1, 时间、版本、SHA-256、数量、任务指纹
knowledge.zip             知识库标准备份（library.sqlite + attachments + workspace.json + manifest）
tasks/tasks.db            任务库 SQLite 快照（VACUUM INTO）
tasks/tasks.json          任务可读 JSON（兼容旧任务台格式）
README.txt                说明
```

恢复状态机（`app/server/workspace-restore.js`）：

1. 维护门打开；生成当前完整快照 `backups/before-restore-workspace-*.zip`。
2. 完整校验 BEFORE 修改：ZIP 路径白名单/重复/大小、manifest 版本、各部分 SHA-256、知识库 `validateBackup`（含 schema/树/引用/附件），任务库 `integrity_check`/`foreign_key_check`/schema/行结构、`tasks.json` 与 `tasks.db` 数量与指纹一致。
3. 准备 stage（知识库库/附件/workspace + tasks.db）。
4. 写 `workspace-restore-journal.json`，关闭知识库与任务库，当前文件整体移入 `previous-workspace-*`。
5. 移入新文件，重新打开两个数据库，复核任务数量/指纹与知识库 `integrity_check`。
6. 成功：保留 previous 目录与安全快照；失败：新文件移入 `failed-restore-*`，旧文件搬回并重新打开，保留日志供下次启动继续回滚。
7. 启动时 `recoverWorkspaceRestore()` 在打开数据库前处理遗留日志，避免“知识新库 + 任务旧库”的混合状态。

兼容：

- 统一入口选择旧知识库 ZIP → `inspect` 返回 `type: knowledge`，前端提示并走原有 `/api/restore`，只替换知识库，任务数据不变。
- 旧任务台 JSON → `/api/workspace/tasks/import`，只替换任务，导入前保存快照，导入后核对指纹。
- 损坏/未知格式拒绝，当前数据不改变（自动化与实测均覆盖）。

## 10. 浏览器数据与 AI 凭据

- 旧源 `:3000` 与新源 `:5180` 的 localStorage/sessionStorage 不共享：主题、侧栏/领域折叠、上次阅读、阅读面板偏好、快速记录尚未同步的浏览器恢复副本不会自动迁移。服务器端草稿（workspace.json / 草稿表）已迁移。
- API Key 由 CurrentUser DPAPI 加密且绑定 Provider/数据目录，未复制、未读取、未打印。新站点默认“未配置 AI”；需要时在设置→AI 服务重新录入并主动确认费用。旧 `ai-usage.json` 仅保留用量统计。

## 11. 验证摘要

- `npm run build`（tsc + Vite）、`npm run typecheck` 通过。
- `npm test`：95/95（知识库原 92 + 任务/整合 3）。
- Edge 实测（Playwright channel=msedge）：
  - 任务台：右键菜单增同级/子任务、改状态、双击改名、备注保存、搜索、拖拽排序/改父级、撤销、刷新后保持 `#tasks`、切换模块保持任务搜索。
  - 知识库：列表/筛选、阅读器、思维导图打开、快速记录离开保护、旧锚点。
  - 设置：工作空间备份下载、ZIP 校验摘要（知识 21 / 任务 25）、界面恢复后自动重载为 25 条。
  - 响应式：1920×1080、1366×768、390×844 无横向溢出；390px 侧栏可展开切换模块，任务详情可关闭。
- 备份/恢复：真实数据副本上导出→新增任务→恢复→回到 25 条；损坏 ZIP 400 且数据不变；旧知识库 ZIP 恢复到 17 条内容时任务仍为 25；旧任务 JSON 导入后知识领域仍存在。
- 启动链：launcher 构建/后台启动/重复启动复用/正常停止；停止后端口释放、锁删除。

## 12. 已知限制与后续候选

- 任务台固定浅色，知识库支持深浅主题；统一主题留待后续。
- 恢复旧任务台 JSON 是全量替换，无逐条合并/差异预览。
- 撤销不持久化；整表快照替换模型在任务关联数据增多后需要迁移到操作日志。
- 未实现任务与知识互链、全文统一搜索、日历/提醒——按整合范围明确不做。
- 未验证 Windows 整机重启/断电；迁移与恢复已在副本上实际演练，正式库仅迁移/只读核对。
