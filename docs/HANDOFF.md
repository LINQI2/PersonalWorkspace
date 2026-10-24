# V1.0 个人工作空间交接 / 2026-10-24

整合交付点。工作目录 `D:\Projects\PersonalWorkspace`，地址 `http://127.0.0.1:5180/`，启动/停止使用根目录 `启动个人工作空间.bat` / `停止个人工作空间.bat`。整合主提交 `e118b3022b515b46e918e25f647fa13386924840`（知识库基线 `c9cdc7adc2ed75c2c2b872d91b85d020567c1d0a`，新仓库基线 `c75fcb9`）；最终 HEAD 以 `git log -1` 为准。

- 底座：知识收藏馆 V1.9（Git `c9cdc7adc2ed75c2c2b872d91b85d020567c1d0a`，schema 11）整体导入后成立新仓库；任务台以模块方式并入，React 18 组件保留原交互。
- 数据：知识 `data/library.sqlite`（21 条内容/2 附件/2 导图/26 版本/1 专题）与任务 `data/tasks.db`（25 条/3 根/最大层级 4/已完成 1），来源与指纹见 `data/migration-report.json` 和 `docs/INTEGRATION_V1_0.md`。原两个项目未修改，可独立回滚使用。
- 界面：统一顶栏/侧栏导航（首页、任务台、收集箱、知识库、AI 助手）；任务模块常驻挂载，切换不丢任务搜索/选中，也不卸载知识列表；`#tasks` 可刷新保持。
- 安全：任务 API 复用 127.0.0.1/Host/Origin/X-PK-Request/session/维护门；服务端校验 ID、状态、父子、循环、大小；无文件访问暴露。
- 备份：设置→数据与备份→完整工作空间备份（manifest + knowledge.zip + tasks.db + tasks.json + SHA-256）；恢复前校验、快照、暂存、双库切换、复核、失败回滚；旧知识 ZIP 只恢复知识，旧任务 JSON 只替换任务。
- 修复：知识库恢复跨盘 `renameSync EXDEV`（C: 临时目录 → D: data）缺陷，改为 fallback 复制；任务整表替换父子写入顺序与外键；任务库 `user_version` 迁移。
- AI：DPAPI 凭据与旧数据目录绑定，未迁移、未读取；新站点需重新录入。旧 `:3000` 的 localStorage（主题/折叠/上次阅读/快速记录恢复副本）不会共享，服务器端草稿已随数据迁移。
- 验证：`npm test` 95/95；Edge 1920/1366/390 实测任务树/右键/拖拽/撤销/备注/恢复/启动停止；统一备份恢复与损坏回滚、旧格式兼容均在真实数据副本上演练。
- 常用命令：`npm run build`、`npm run typecheck`、`npm test`、`node scripts/migrate-legacy.mjs`（一次性，目标已有库会拒绝）。正式 data 目录不要提交；迁移/恢复前先停止或使用统一备份。

下一次继续开发前：`git status`、`git log -1`、确认 `data/migration-report.json` 与备份可用；不要把正式库用于破坏性测试。

---

# V1.9 交接 / 2026-10-15

开工HEAD ff880adb88b70752a11e323429fbbf9b594e7e9f，工作树干净，正式schema10/34表/17内容。用户附件已保存为PRODUCT_REQUIREMENTS_V1_9.md。本轮新增mind-elixir稳定5.15.1（MIT），无新Provider、付费插件、网页抓取或全库AI任务。

- 思维导图是既有entries上的正式独立类型；复用分类/主要领域/专题/标签、pin、搜索、软删除/恢复。新建自动聚焦中心；知识库直接打开，正文编辑器不能覆盖结构。默认只画布，大纲与节点面板按需打开。
- 树编辑、Tab/Enter/F2/Delete、拖动重排/换父级、复制分支、折叠、80步统一撤销/重做、明暗主题/分支颜色/粗体。大纲和画布共享节点ID。采用自动树布局，非自由XY白板；方向/顺序/折叠和连线控制点保存。
- 独立跨分支连线有方向/说明/修改/删除，分支删除清除悬空连线、撤销整份恢复，不写全站关系。节点链接现有稳定内容/章节ID并有返回导图入口；未知ID拒绝，回收目标提示，改名不失联。
- 650ms串行自动保存、修订+分类指纹冲突保护、真实保存状态、浏览器隔离恢复副本和正式版本历史。失败无自动重试；恢复稿基线改变时禁止覆盖，可导出比较。原workspace、快速记录/知识/专题/AI草稿互不替代。
- 实际PNG/SVG/JSON/Markdown导出；兼容导图JSON校验/层级预览后仅新建。JSON保留结构/连线/知识ID；Markdown有损。原知识交换v1/v2保留，导图单独格式，分类在新图内设置。

schema10→11仅追加mindmaps/mindmap_versions及历史索引。升级前保护包pre-v19-12d4ebbd-c5c3-446c-9ef2-67f20100944e.zip已完整校验并实际POST restore到隔离schema11，34旧表/workspace/附件一致。正式原启动器正常停止后升级再后台启动；36表/17内容，两个新表为空。34旧表及workspace/用量/两附件共4文件SHA-256与开工一致，无正式测试CRUD。自动预迁移包pre-schema-11-d44ed1a0-f073-4954-983f-4f7a8342c822.zip；交付包delivery-v19-67dcf2b1-28dd-4f6d-8c6f-3a2091d186d5.zip完整有效且实际恢复隔离库通过。私有包不提交。

构建/类型检查、92自动测试、真实Edge V19三尺寸、V18/V173/V161/V17、设置与OpenAI/DeepSeek模拟审核、Windows启动链回归通过；证据和实际限制见TESTING、DESIGN_V1_9。新增测试所有写入/故障/恢复均在独立临时目录；真实正式Edge只读核验。最终完整SHA见本次Git提交与最终报告，复工先git status/log。

正常使用仍双击启动知识库.bat，已有验证实例复用；停止用停止知识库.bat/设置→本地运行。刷新网页加载新版。正式数据已schema11，不用旧程序降级打开。不要提交data、workspace、备份、凭据或恢复副本。DeepSeek旧超时仍疑似上游异常；未改超时/模型/Provider，未调用真实付费API。

限制：500节点/12层/500连线/750000字节结构、导入文件1MB；JSON导图不含全站分类映射，跨库未知链接需人工处理。复制分支不自动复制对外连线。会话撤销80步，历史列表50条但旧历史仍在库/ZIP。没有任意XY/协作/AI生成/第三方专有导图格式。未做用户人工验收、Windows整机重启、断电/磁盘满/大库压力或真实云质量验证。停V1.9，不自动进入下一版本。

---

历史记录（当前版本以上述说明为准）：

# V1.8 交接 / 2026-10-15

开工HEAD 7e0a30fd98e49113bbdfb85ceffa2b2dd7d3a47f，工作树干净，原正式schema9/33表/17内容。用户本轮明确授权V1.8，旧“停V173”规则不阻止本轮。无新依赖/Provider/向量库/抓取系统。

- ReaderPanels大纲/正文/辅助三兄弟滚动区域，面板自身收起、边缘展开；1366可同时并排，390覆盖但不互相关闭。章节树/UUID/锚点保持。正文位置与面板会话恢复，跨引用有返回上一内容。Dialog键盘监听改为layout effect，防快速Escape绘制竞态。
- reading.js + shared/reading-anchor.js：持久化reading_marks，指纹/原文/64字符前后文定位，失效不猜；手工批注编辑修订校验、软删除、旧摘录保留。新旧笔记/知识引用追加与历史同事务，选区和目标版本重验，有草稿保守拒绝；data-entry-id复用关系，data-reading-mark及#quote稳定定位，Tiptap/安全HTML显式保留。
- ReadingTools复用RelatedPanel/ContextAssistant；只真实正文选区、范围/费用确认/取消/人工审核，不自动调用或保存。原来源、历史、七种方向/防环/删除保护、DPAPI/限额不变。AI初始问题可带选区，失败/取消保持。
- paste.js将确定Markdown标题树/文本转换为内部JSON v2，复用原Schema/人工分类/事务/来源；原始全文在source excerpt与原包中可恢复。PasteImport在全局新建下，先预览、逐项选择、标题/分类、重复查验；保存前和提交重新检查修改后的标题，明确另存才创建新ID，不合并旧资料。旧JSON v1/v2继续兼容。
- schema9→10仅追加reading_marks及两个索引。启动/ZIP严格校验，迁移前真实ZIP完整验证，失败回滚9。旧1～9 ZIP隔离向前恢复10。原33表、来源/附件/workspace/用量/凭据不清理、不重建。启动器显式新增1.8身份版本，锁/PID/端口保护不变。

升级前保护包 data/backups/pre-v18-21755589-a1c0-4322-80a5-63ec485147f6.zip 已完整验证，并实际通过生产恢复API恢复到隔离schema10：33旧表/workspace/附件与开工哈希一致，新表0。正式实例已通过原启动器升级至1.8.0/schema10，共34表，新reading_marks为0；33旧表与workspace/用量/两附件共4文件SHA均未变，17内容保留，没有正式测试写入。自动迁移前ZIP pre-schema-10-f06ebf85-96a2-487c-afd4-acc3ec442160.zip验证为schema9。交付ZIP delivery-v18-0a348d3a-9383-47aa-b856-dfb7d7745bf2.zip完整有效并实际恢复隔离库通过；个人ZIP/日志/数据不提交。

构建/类型检查、87项自动测试通过。真实Edge1920/1366/390的V18主流程、旧V173草稿/多窗口/后退、V172设置/树/弹层、V171短笔记编辑/回收、V161导入、V17关联/地图及两Provider/专题/DPAPI模拟回归通过。Windows隔离后台.bat启停/复用/异常恢复/正常停止通过。具体命令/截图/未验证项见TESTING与DESIGN_V1_8；不把headless Edge自动化称为用户人工验收。

限额与降级：选区2～2000字，AI问题素材≤800字；上下文变化的锚点需人工重新选区，不自动语义重绑。Markdown是安全子集，复杂表格/嵌套列表按文字保留，原文快照不丢；文本≤100000字/256KiB、内部包≤512KiB、100项、8层、8预览/15分钟。草稿和AI输出隔离原机制不变。

DeepSeek超时仍“疑似上游服务异常，待恢复后复测”，未改Provider/模型/超时。真实付费云、用户本人验收、整机重启/断电/大库压力未验证；测试仅虚构Key与模拟transport。停V1.8，不自动进入V1.9。

---

历史记录（当前交付以上述版本为准）：

# V1.7.3 交接 / 2026-10-15

开工 HEAD 57eef955d97adbb6b9fbb7bc4aed6d9c6de3e6b4，工作树干净。当前产品1.7.3/schema9，无数据库迁移/新依赖。用户本轮明确授权阅读工作台，不执行 V1.8。

- ReaderWorkbench 共用固定 ReaderToolbar 与 ReaderPanels；ContentActions 提取复用原接口。普通内容/独立知识/综合文档均保留置顶、软删除、恢复及编辑。大纲真实父子树、开合、滚动高亮和稳定锚点；章节定位使用实际固定栏底部，避免偏移叠加。宽屏可双栏，中桌面/窄屏正文优先。
- ContentPreview 统一笔记/网站/工具默认本地预览，综合文档直接阅读；外链独立。保留原富文本、图片、历史、来源、RelatedPanel 与 ContextAssistant 的审核/费用/取消机制，无新 AI 引擎。
- readingNavigation 区分显式返回原根页面与新导航；浏览器后退遵循预览/阅读层级，编辑后退检查真实 dirty/busy。知识库会话保存筛选、类型、来源/状态、排序、页码/滚动，新的领域/专题意图重置旧页码，避免旧筛选复活。
- 综合文档整理默认紧凑，仅选中章节展示管理表单；原移动/顺序/编辑/移出/收纳/整合和循环引用保护不变。低频知识库入口在“管理与导入”，高频搜索/筛选/新建/置顶直接可见。
- quickDraft 单例共享输入，400ms 防抖服务器 workspace.drafts.quick，专用 GET/PUT/DELETE /api/quick-draft 版本校验；通用草稿接口拒绝绕过。刷新前未同步文字在本浏览器按目录/窗口恢复副本保护；多窗口差异显式审核，成功正式保存后只清理相同草稿。原 new/newtool、知识、专题及 AI 草稿隔离。新 quick workspace 不直接用旧 V172 运行时降级打开，旧 ZIP 继续兼容。

测试写入全部使用独立临时数据目录。82/82 自动测试与生产构建/类型检查通过，真实 Edge 1920×1080、1366×768、390×844 阅读/草稿专项及现行历史业务矩阵通过。真实 Windows 隔离后台启动/复用/异常恢复/正常停止及 ZIP 恢复通过。截图与限制见 DESIGN_V1_7_3 和 TESTING。

正式保护：升级前有效 ZIP pre-v173-06d3789c-73c5-49dd-b0bb-44bcfb1d2598.zip 保存在忽略的 data/backups；交付再次校验33表、17内容和4私有文件，实际恢复 ZIP 到隔离库，结果见 TESTING。本轮不对正式内容/草稿/附件做测试写入，不读取或调用真实 Key；不删除有效锁。最终服务通过项目正常 Stop/Start 加载新版。Git 完整 SHA 见最终报告及 git log -1。

交付复核：正常重启后最新保护包 delivery-v173-7965afec-addf-46e9-97b1-4ee8daa817f7.zip 完整有效，33表与4文件校验值全部未变；该包实际恢复到独立临时库通过。快速后退的迟到异步响应另加导航状态校验，避免旧阅读页重新出现；编辑中后退拒绝/明确放弃均在真实Edge专项验证。

DeepSeek 超时归类“疑似上游服务异常，待恢复后复测”，没有调整超时、Provider、模型或接口架构。AI 测试全部模拟；真实云调用/质量、用户最终使用验收、Windows 整机重启未验证。不要将自动 Edge 验证称作人工验收。

---

历史记录（当前行为以上述版本为准）：

# V1.7.2 交接 / 2026-10-15

基线 f0e7556c8e9bd45b65cb8a6a7ee7f329367b65f2，开工工作树干净。项目结构/Provider/模型/Endpoint/凭据/内容语义保留，版本1.7.2/schema9，无迁移。

- ContentActions 常态 Pin 状态；预览/综合文档/独立知识详情操作后重读，排序仍独立。
- AiSettings 统一加载/保存基准（空 model 使用同一默认模型），SettingsPanel 分离 AI、分类、恢复准备状态。正式配置本机零改未复现误报；冻结 V171 空模型场景实测复现并修复。六个设置分区直接进入，保留隐藏 AI 输入，未提交 Key 仍受关闭保护。
- FilterMenu 直接按钮选值、单面板、外点/Escape、组合条件和清除；主外壳同步真实筛选，避免回首页后旧领域参数复活。
- DomainTree 共用侧栏和两处领域管理，独立箭头/导航/添加、层级/数量/选中/长名；桌面收起为图标栏。非空删除禁用，说明先调整归属，后代父选项排除，服务端循环/引用校验不变。
- Dialog portal 顶层、固定标题、视口限制与内部滚动；共用滚动锁计数与最上层 Escape，背后阅读器不被一起关闭。截图复核后修正侧栏长名称撑宽及设置多余空白。

正式库17条内容/33表，升级前及交付 ZIP 均完整校验，真实 ZIP 实际恢复到临时库。33表原始行内容、workspace、用量与两附件共4文件 SHA-256 均与本轮基线一致；正式记录零测试写入。备份在忽略的 data/backups，真实 Key 未用于测试、未进输出或提交。

正式实例已正常停止/启动加载1.7.2，GET/HEAD-only Edge再次核验版本与设置关闭；重启后数据哈希及隔离ZIP恢复再次通过。当前后台正常运行，刷新网页使用新界面；无强制结束或锁删除。

构建/类型检查、80自动测试、V172与V171/V161/V17/settings/V13/双Provider Edge、隔离 Windows 后台启停/重复启动/异常恢复/锁、ZIP恢复通过；完整证据和命令见 TESTING。Edge为真实msedge通道自动化，并非用户人工验收。付费云、整机重启未验证。

[DESIGN_V1_7_2_AUDIT](DESIGN_V1_7_2_AUDIT.md)覆盖10页面及全局，明确逐段批注、多链接字段、五项AI任务侧栏等尚未实现/等效差异，不冒称概念图全部落实。前后合成截图已存 docs/design/v1.7.2。后续只在用户授权后继续；不进入V1.8，不清理正式知识。

---
历史记录（当前交付以上述说明为准）：

# V1.7.1 交接 / 2026-10-14

开工为V1.7真实HEAD 9a0a810d3d4251f829c41a07eda43c94b7cdc288，用户只新增PRODUCT_REQUIREMENTS_V1_7_1.md和docs/design下9图。V1.7后正式资料已有人为更新，新的可恢复保护包 data/backups/pre-v171-174944b8-0399-46a4-a98c-fca2fc0cdbc9.zip/schema8，建立本轮31表与4文件哈希；没有用旧轮基线覆盖用户更新。

本轮产品版本1.7.1/schema9，两表/索引追加。Experience.tsx + experience.css是共享全局新建/操作/工作台/收集箱/回收站/阅读/设置，不是第二业务系统。main统一固定顶栏和可收起侧栏、真实领域/专题；UnifiedLibrary默认列表及多维筛选、预览与完整阅读；KnowledgeReader大纲并排正文、来源/关联/AI辅助切换、稳定UUID定位；EntryEditor仅对从阅读页编辑的短普通笔记采用ReadingSurface，复用原草稿/关闭保护/Tiptap。所有AI服务、导入、来源、专题动态规则和探索保留。

lifecycle.js统一快速保存与处理状态/软删除/恢复。所有删除（含旧API/批量）软删除；有引用/子章节保守拒绝。content_versions保留普通正文上一版，正文历史恢复先放编辑器；原知识/专题历史不变。启动/ZIP验证新增状态和安全历史/图片引用，旧1～8ZIP向前恢复，不降级强开。没有永久清空、自动资料清理、真实Key或付费调用。

80项自动测试、构建/类型检查、实际Edge新流程与旧导入/关联/两家AI/DPAPI/专题回归、Windows隔离启停和ZIP通过，详情TESTING。源码依赖未变，package-lock保留。视觉落实与等效选择见DESIGN_V1_7_1.md，截图仅合成测试数据且不提交Git。

快速记录是内存输入，有失败保留、离开/关闭和beforeunload保护，但没有自动服务器草稿；长时间未完成内容请打开原完整编辑器。回收站每页24条，支持翻页恢复，暂无永久清空。完整来源/历史与关联保留折叠或选项卡，不依视觉稿删功能。历史已保存筛选只保留兼容使用，不新增常用视图分组。

正式最终迁移已完成：正常Stop/Start至schema9，31旧表和4私有文件SHA全部一致，16资源保留，新两表均0，pre-schema-9-ff802bfc-85c6-4541-91c3-218c363f8e89.zip有效schema8；正式Edge仅GET/HEAD核验1.7.1/schema9通过，没有正式测试写入。部署前最后保护包pre-v171-26bd4da6-8f96-468d-bb04-0637f9a23886.zip也有效。Git SHA见最终报告/git log -1。用户人工验收尚未做，真实云/整机重启/ACL/大库未验证。停V1.7.1，不进入V1.8。

---
历史说明（以本轮入口为准）：

# V1.7 交接 / 2026-10-14

正式交付核验：schema7正常Stop/Start顺序升级8，pre-schema-8-211f74b2-2440-4cf2-b782-897c64ff435e.zip完整校验为7，升级前后29旧表、两附件/workspace草稿与偏好/ai-usage共4文件SHA全部一致，16资源保留；relation_details/history正式均0，没有正式关系测试写入、清理或付费调用。当前1.7.0服务经启动器认证运行；稳定UUID站内章节URL的Edge重载验证通过。


开工HEAD bf7acfdd355e5a957975c6fc08752a1608164160，工作树干净，正式schema7，用户明确授权连续开发覆盖停V161限制。新package1.7.0/schema8，仅追加两表/两索引，原29表内容不改；无新依赖、图数据库或爬虫。完整规格PRODUCT_REQUIREMENTS_V1_7.md。

知识关联复用knowledge_relations并新增details七类型/origin/引文/不确定性/修订，与历史kind载体分开；历史行ID和方向原样保留，未知parent/duplicate不猜组成。人工确认、AI/import候选、真正父级/资源/正文链接的system关系区分。正反标签、依赖/组成/修正防循环、引用可相互、重复/自引用/无对象拒绝。

相关面板覆盖普通内容、综合文档与章节详情，搜索及领域/专题范围、本地共同类别召回；AI中心+主动选中资料2～10/12000字符、费用预览确认，共用service/Provider/DPAPI/限额/取消/ledger/AiReviewItem。生成只读，采用候选事务写入，来源快照再验，人工可确认/编辑/拒绝；不改原文/日期或断言冲突孰真。

知识库→知识探索原生SVG一/二层真实40节点80边、有向类型过滤/候选显隐/键盘与HTML列表，来源跳原owner章节；#content-UUID/#chapter-UUID及data-entry-id正文可重载定位，改名排序不改ID。引用目标删除前拒绝，先解除关系与正文引用，页面子章节FK保护继续。未自动清理真实研究。

relation_history事务快照2MB/10000关系，原文/实际章节或关系后续变化拒绝覆盖恢复，启动/ZIP严格验证；旧1～7ZIP验证后隔离向前升级。所有正式操作必须先持有效身份锁；启动器支持1.7并验证项目实例。截图只合成test-results/v1.7-*，复工按TESTING复现。74测试及真Edge/Windows隔离启停回归通过；实际云、整机重启、断电、ACL/大库未测。不自动进入V1.8。

最终Git SHA见报告/git log -1；本地提交不推送。正式迁移及旧表/附件/草稿/用量的最后哈希核验已完成，结果见本页开头；未以测试库替代真实升级。

---
历史说明（本轮入口优先）：

# V1.6.1 交接 / 2026-10-14

开工b76d8e5d824ec70a07b0eb095d2d817d5ac17701，用户明确授权本轮，保留中断的全部未提交成果；package1.6.1/schema7。旧23表不变，新增6表，保留原栈/Provider/DPAPI/锁/恢复与工具/专题/笔记。正式用户重启自动迁移7，预迁移ZIP完整验证，旧表与4私有文件哈希全同（含workspace草稿），16内容/10知识保留。无真实Key读取或付费调用。

主导航四项，UnifiedLibrary统一类型/领域树/专题/标签/检索/排序/固定视图，阅读复用KnowledgeReader与Tiptap。document/page、block/point+knowledge_structure，明确父级不复制记录，默认不平铺内部块，搜索定位章节。旧目录字段与草稿验证仍兼容，但不参与新分类或AI建议。旧真实研究未收纳、清理或重导。

unified.js+schema7六表、exchange.js独立v2校验、import-v2.js事务写入，UnifiedImport人工类型/章节/分类审核，旧v1显式转换保留raw/hash。普通内容来源/provenance独立于knowledge_records；相同文件/网址需明确另存。专题动态规则不改人工成员，AI采用实时成员及正文复核；领域AI合并维护主领域/子域/规则/视图，恢复快照兼容旧格式并防覆盖后续成果。源、引用、互补、冲突、修正候选可查看/人工确认或拒绝。

ChatGPT说明与旧技能升级见CHATGPT_IMPORT_V2.md和docs/skills/knowledge-import-v2/SKILL.md，Schema/examples独立合成。技能未自动安装到用户全局或改旧技能。设置→备份与草稿→清理候选只读下载；私有实际10候选清单.test-data-v161-cleanup-candidates.json被Git忽略。清理须用户明确稳定ID清单，本轮不执行。

build/typecheck、65自动化、真实Edge V161及核心/两家原AI/两家专题/settings、Windows隔离startup、实际ZIP恢复通过；详情TESTING。重要合成截图test-results/v1.6.1-*已实读，无私有截图。后续最后git log -1查交付SHA，本地提交不推送。

最后通过现有启动器正常Stop/Start加载最终1.6.1，probe认证成功；正式Edge仅GET/HEAD查看首页/知识库/类型/AI结构，阻止所有写入及外网，没有私有截图。补充工具的手工CRUD、无网址、上传图标、备注搜索、主领域、子类型筛选、置顶/取消和持久网格列表Edge通过。

技能的quick_validate.py已尝试，但本机Python缺PyYAML，官方校验器未成功；name/description、引用路径人工复核，新Schema及样例通过服务器测试。不安装全局依赖或更改旧技能。

已知限制：8层/全局领域同名唯一；导入512KiB/100内容，无远程图片；旧研究不自动归属；旧目录不自动迁移领域；快捷视图不含专题/未归属；AI问答与未采用方案不跨重启，旧schema6历史保留但原hash变化不能直接恢复，当前历史5MB且后续DB/workspace变更保守拒绝。实际云、整机重启、物理双击、断电/大库/跨用户未测。V1.6后台退出根因未确认，不引入自启/自动重启。本轮停V1.6.1。

双击启动知识库.bat复用现有实例；停止用停止知识库.bat或设置→网站启停。先读本段、ARCHITECTURE/IMPORT/TESTING和V1.6.1需求，禁止旧版本降schema强开，不对正式库做破坏性测试。

---
历史说明（入口以本轮说明为准）：

# V1.6 交接 / 2026-10-13

交付末次探测曾发现后台实例退出、服务锁已释放、错误日志为空，退出来源/原因未确认；随后使用现有启动器正常重开一次，不盲删有效锁、不强杀进程，也没有加入自启或自动重启。运行期间新增的1份workspace草稿继续保留。启动/启停测试通过不等于已解释这一外部运行现象，长期后台运行稳定性仍需后续观察。

开工HEAD f1a44a46b473a39e396ad89c978381928cf0be67，工作树干净。用户明确连续开发V1.6覆盖停B限制。交付package1.6.0/schema6；停V1.6，不进入1.7。原栈/Provider/DPAPI/模型/Endpoint不换、无新依赖。需求见PRODUCT_REQUIREMENTS_V1_6.md。

Assistant入口问答/结构/跨范围三分区，KnowledgeWorkspace直达结构。assistant/catalog.js：SQLite关键词召回+中文分词，返回真实namespaced key（entries/domains/tags/collections/directories:真实ID），预览节选/类型/文字证据状态，完整正文只对用户选中资料送API。resolve绑定正文/版本/实际父级/目录/类别/来源性质与日期SHA；仅标题网址不能作正文。目录/分类元数据明确不是资源正文。QA有Schema受限citation ID、已有文字与推断标签、资料不足，点击跳原详情/工具/知识页章节/专题/目录/分类，不自动写正式知识。

本地检查名称标准化/含糊或过长/深层目录/缺标签与页面归属，只发送选中的必要对象与对应候选。assistant_structure输出rename/merge/move/associate/create/keep，目标与依据限定所选真ID，Schema重验、用户编辑选择、服务端计算直接影响、差异hash绑定、保存确认+合并第二确认。assistant/review.js事务迁移分类关系去重、目录防环、保留entries UUID；专题合并追加正文/迁移历史/来源，未保存草稿引用源对象、专题草稿、冲突引用版本或正文超限保守拒绝。不同或含糊概念保持独立；拆分通过先创建新类、再另行审核关联，不自动删除旧归属。

管理历史assistant_changes保存结构/关系/知识元数据/专题正文与历史的本地恢复快照（5MB上限），无密钥；不上传模型。提交后的数据库内容/关系及workspace草稿/偏好hash必须仍一致才恢复，后续任何正式修改拒绝覆盖，建议先备份。restore原PK upsert、仅清本批新增行，禁止删knowledge_records触发来源/导入映射级联；重验树/FK/安全HTML/资产/源和列白名单。历史损坏拒绝启动/ZIP恢复。新表随ZIP，旧22表迁移不写，历史快照格式当前schema6，未来改列需兼容此恢复协议。

跨范围本地展开多目录/page/点，最多20范围对象/200候选（超限拒绝），再选2～10条。复用KnowledgeIntegration、AiReviewItem、六类关系/逐字依据；新增综合页或采用到旧页均同事务，模型不触及原文/归档。sources传原始日期、来源日期/性质，未知不填今天；采用留原ID/正文/来源日期快照，review/ai_inference。源与已有目标页/实际章节在生成前后及采用时重验，失败回滚全批含新页/来源。B缓存/取消/原知识正文历史保持。

AI service新增assistant_qa/assistant_structure模式，同一Provider.generate、secret-free用量、单并发/小时限制/超时/取消/输出上限。QA≤1000字/10份，结构≤30对象，完整输入12000字符；Token/参考输入费粗估，输出另计。费用确认后才调用；无Key所有手工功能可用。人工审核有效15分钟/最多8，离开未保存结构审核有确认/取消，卸载清理token；答案和未采用方案不持久化，不占workspace/知识/专题草稿。无全库上传/模型自动扫描/爬虫/向量库/复杂智能体。

API /api/assistant/catalog/history GET与 search/scope/estimate/generate/preview/apply/cancel/restore POST，沿用localhost实际端口/Origin/session/JSON保护。key命名空间映射真ID而非URL抓取；未提供外部自动客户端鉴权，不公开SQLite或公网。HTTP防护不能抵御同Windows账号恶意进程，仍是原本地威胁边界。

正式安全：开工schema5、16资源/10知识（1页9点）/1工具，有效旧服务正常Stop后Start升级6。初始与最终完整保护ZIP已校验；自动pre-schema-6-4ab6193f-7ce5-4180-9373-1dc0f458db06.zip完整验证。迁移紧随核验22旧表与2附件/workspace/ai-usage共4文件SHA全同；最终重开后数据库22旧表、2附件和用量仍同。运行期间workspace另新增1份草稿（来源未独立核实），偏好与原草稿保留，没有恢复覆盖当前文件；assistant_changes为空，真实知识归属未修改。服务1.6.0/schema6运行，AI非敏感configured=true/deepseek保留。真实Edge正式仅GET/HEAD入口/本地检查/目录快捷页核验，所有POST与外网阻止，无私有截图、测试写入或真实付费请求。

验证：build/typecheck、55/55自动测试（原47+assistant8）；真Edge V16证据/无匹配/推断/引用跳转/修改建议/双确认合并/差异/历史恢复/离开拒绝/多目录新页/原文日期/刷新/390px/深色/目录快捷入口，0pageerror。旧V1/V1.1/V1.4/V1.5-A/B/安全配置/两家原AI及专题均通过；Windows隔离.bat后台/复用/异常重开/正常Stop/DPAPI、锁PID复用/损坏/他程序端口、真ZIP/旧1～5隔离升级回归。全部云为注入虚构Key模拟，不读取正式Key。

截图仅合成test-results/v1.6-{answer,structure-review,mobile,dark}.png，实际读取复核、不入Git。复现npm run test:browser:v16 / node --test tests/assistant.test.js。私有审计文件/数据/附件/ZIP/日志/Key被忽略。本地提交不推送，SHA见最终报告或git log -1。

限制：关键词召回不是完整语义检索，每类本地候选80/显示40；结构列表需用名称筛选查更多。过长资料人工减小范围/分批，无自动批次编排。5MB结构恢复快照超限拒绝AI变更，原手工功能和ZIP仍可用；历史恢复在后续变化后保守拒绝，需手工或完整备份。答案/未采用预览不跨重启保留。未验证真实云质量/账户/账单、Windows整机重启/物理Explorer双击、干净机器/跨用户ACL/断电/磁盘满/大库压力。不会自动发展1.7。

双击启动知识库.bat继续；停止用停止知识库.bat或设置→网站启停，无常驻系统服务/自动重启。先读本段、AI/IMPORT/架构/TESTING及V1.6需求再复工。schema6禁止旧软件降版本强开。

---
历史V1.5-B交接：

# V1.5-B 交接 / 2026-10-13

实际开工HEAD 14da655ba3f4831a0520365b07928efff771fa7e，干净工作区；用户本轮B授权覆盖停A限制。交付package1.5.1/schema5，停B。需求见 PRODUCT_REQUIREMENTS_V1_5_B.md；无依赖/架构替换。

知识目录页面优先，独立点仍可全量查看/搜索。新增 knowledge_structure 的真实父级/顺序，与目录、资源引用、关系候选严格分开；最深8层/无环/最终page。KnowledgeReader提供阅读/整理、大纲定位、逐章按需正文、来源折叠、人工收纳/父级/排序/归档、现有Tiptap编辑。知识与全站搜索可打开所属页并定位章节；独立详情保留关系与来源。混合资源仍复用原关联卡片。

导入仍v1：显示并修改实际parent，明确确认后同事务建结构；部分选择缺父/循环回滚。旧导入不重写：仅从原包显式parent或parent候选产生可审核收纳建议，绝不按同目录猜归属。用户这套真实研究仍保留原10条，仅页面优先显示；需要在整理模式选择原9点收纳，未代用户自动修改归属。

AI integration模式复用两家Provider、DPAPI、单并发/频率/超时/取消和用量；选2～10条/12000字符，仅所选标题/简介/正文/性质/状态。输出独立保留、章节、duplicate/complement/parent/conflict/revision/related、来源逐字依据、验证项及顺序，真实Schema/来源ID/引文/快照两次验证。人工修改/选择/拒绝后，章节另存review/ai_inference，保留原ID/正文及当时原文来源快照；关系为候选，related不建强关系；排序只改直属章节。整批事务失败不留半稿。成功方案相同快照+配置内存缓存15分钟/最多8，命中标识不计新调用；独立审核令牌15分钟/8份/一次消费，不占正式草稿。无自动长文本拆分或全库扫描。

knowledge_versions保留编辑前标题/HTML，包括旧全局EntryEditor；历史可放入原编辑器，再保存才替换，保存失败回滚历史/正文。结构元数据不复制知识/来源，FK限制有子节点的直接删除/脱离page。普通引用/专题/标签不改语义。

正式安全：开工PID28620、schema4、16资源/10知识（1页9点）/1工具，已导出完整验证保护ZIP。最终又导出最新保护包，通过启动器身份核实正常Stop/Start，schema4→5只增加2表/索引，自动完整验证pre-schema-5-b011570f-bdb4-4173-a03e-75720e86ad25.zip。升级后20张旧表全部原字段及2附件/workspace/ai-usage共4文件SHA全同，16条保留，新结构/历史表空；AI仍configured=true/deepseek。真实Edge正式页仅GET/HEAD（写入及外网阻止）核对1主页面、收纳列表9点，无私有截图或测试CRUD。服务1.5.1/schema5健康，锁有效；旧代码不可强开schema5。个人保护文件/哈希/截图均Git忽略。

验证：build/typecheck、47/47自动测试；真实Edge B与A、V1/V1.1/工具/安全配置、两家原AI/专题；Windows隔离启动/复用/崩溃重开/正常停止/DPAPI；真ZIP与历史1～4向前恢复。B覆盖1页9点、层级/正文ID不变、排序重开、知识/全站搜索定位、AI拒绝/修改/采用/缓存、来源/异常/取消/超限、导入层级修改后真正提交、390px/深色/0pageerror。全部云调用为虚构Key模拟，未使用正式Key。

合成截图test-results/v1.5-b-{before-flat,directory,reader,integration-review,import-hierarchy,mobile,dark}.png，已读取复核，不入Git。复现 npm run test:browser:v15b / node --test tests/knowledge-reading.test.js。

未验证：真实云端质量/账号/账单，整机Windows重启/Explorer物理双击、干净机器/跨用户ACL/断电/磁盘满/大库压力。长资料采用用户缩小选中集的人工分批，没有自动批次编排；AI审核重启丢失须重新生成，已采用章节/历史/来源随ZIP。无拖拽、自动合并/删除或复杂知识图谱。历史章节正文按需缓存，编辑后刷新读取。交付SHA见最终报告或git log -1；本地提交不推送。

启动/停止方式不变：双击启动知识库.bat；正常停止用停止知识库.bat或设置→网站启停。当前真实研究无需重新导入。下一会话先读本段、B需求、IMPORT/AI/TESTING；不自动进入下一阶段。

---
以下为历史A交接：

# V1.5-A 交接

## 当前交付：知识组织与人工审核导入（2026-10-13）

开工 HEAD `48461d055b8ddc02933de355a41ae84f23bc07b9`，V1.4 已交付，Git 干净；仓库只有泛化 ROADMAP，无更具体 V1.5 方案。本轮按用户增量需求实现 A；package 1.5.0/schema4，停在 A，不进入 B。复工先读 AGENTS、README、PRODUCT_REQUIREMENTS_V1_5_A、IMPORT、Schema、ARCHITECTURE、TESTING、AI。

已完成收集箱、8层目录树/父级移动/空目录删除保护、capture/page/point、手动顺序、0～3优先级、状态/问题/来源性质、富文本混合页引用原资源、原分类与跨专题。知识沿用 entries UUID/图片/搜索/专题，九张扩展表不复制资源。新知识草稿独立，650ms串行保存、关闭确认、过期恢复确认；导入不清理用户手工 new 草稿。修改正文/标题撤销旧人工确认；导入资料称为用户判断也不能自动 confirmed。

knowledge-exchange v1 有真实 JSON Schema、成功/失败合成样例、下载模板、ChatGPT导出提示词。JSON解析/语义校验与事务导入独立模块；本地预览/编辑/选择/拒绝，未知目录/领域/标签/专题确认才创建，候选关系不合并/删除，同名不唯一，重复包哈希须明确另存。Markdown/纯文本保留单条原文。来源ID/逐字摘录验证，原包/来源/条目映射随ZIP保存；无来源引用的条目仍可追溯原包。original_date、资料提供 recorded_at 与本地时间分开，未知不填今天。

限制512KiB/100条、100来源/目录、200关系、8层、单正文/摘录10万字；图片由现有Tiptap本地上传，JSON不导入图片。15分钟/最多8份服务内存预览，成功令牌不可重放，API强制本机同源Origin/session/明确确认，未提供MCP/外部长期鉴权。HTTP头/session不能隔离同一Windows账号的恶意进程，未来客户端需单独授权方案。A没有自动长对话提炼、模型冲突判断、全库扫描、费用估算或AI任务；既有Provider/DPAPI完全保留，未读取用户密钥或调用付费API。

### 正式数据安全基线

开工服务PID27408/schema3，实际用户已新增一项工具：6条/2笔记/1工具/1专题。初始保护ZIP已导出。最终升级前旧服务已退出、锁正常释放、无错误日志，原因未确定；没有盲删锁/强杀。先取得数据目录身份锁，只读导出最新库，校验并在隔离副本实际迁移比较旧11表；保护ZIP `data/backups/pre-v1.5-a-protected-0bb8dff1-ed11-4f49-a846-b888c9fa2c00.zip`。

正常启动CLI取锁后schema3→4事务追加九表，自动完整校验备份 `data/backups/pre-schema-4-a9a8e8c8-932a-498a-9f1a-7534ea1fa551.zip`。升级后旧11表全部原字段、2份附件/workspace/ai-usage共4文件哈希相同，正式6条/2笔记/1工具/1专题、0新增知识，AI configured=true；只读Edge验证知识空页/导入模板入口，无测试CRUD。最终正常重开核对PID28620，schema4未重复迁移，服务1.5.0运行；不删除有效锁或旧ZIP，禁止旧版本强开4。

### 验证、使用与限制

build/typecheck/noUnusedLocals、41/41自动测试通过；新增六项覆盖Schema/样例/恶意格式、日期/原文/部分审核、整批故障回滚、新分类目录/关系、重复文件、排序/优先级/跨专题/确认撤销、schema3迁移故障/真ZIP、同源/session/一次令牌/恢复重启。真实Edge跑新JSON/file/Markdown、下载模板、partial编辑/确认/重复、来源日期、混合网址工具、深色/390px，旧V1/V1.1/V1.4/安全配置/两家原AI与专题全部回归。Windows隔离.bat后台启动/并发复用/异常重开/DPAPI/正常Stop与旧锁测试通过。全部云端模拟，无真实密钥/付费调用。

合成截图位于忽略的test-results：v1.5-a-import-review.png、knowledge-detail.png、mixed-page.png、mobile.png、dark.png，实际读取复核。正式个人库/附件/ZIP/密钥/用量/日志/截图不入Git；无新依赖。交付SHA以最终报告或 `git log -1 --format=%H` 为准，本地提交不推送。

双击启动知识库.bat；进入收集箱/知识目录即可使用，新导入在IMPORT文档指导下操作。停止用停止脚本或设置网站启停。AI仍在设置→AI配置，DPAPI安全保存，网页配置优先，不自动付费。知识ZIP包含新来源/草稿/关系，兼容旧1/2/3包向前恢复，密钥与用量不包含。

已知限制：未验证真实云端/账单/质量、整机重启/物理双击/干净机器/跨用户ACL/断电/磁盘满/大库压力；后台退出原因未确认。目录/知识上下排序，没有拖拽；正文编辑不是自动版本系统，导入/收集原文独立留存，阶段观点请用不同知识点和revision候选关系。预览未采用修改取消后不保存，重启须重解析；来源URL不证明真实性。B的智能拆分/冲突判定/跨来源整合需下一次授权及独立验收。

## 历史 V1.4（以下统计和进程不代表当前）

## 工具导航库与设置分区交付记录（2026-10-13）

开工 HEAD `394a36c5ce87db8e099810a904ff0dcf330445e5`，工作区干净。当前完成 V1.4，不自动进入 V1.5；旧 ROADMAP 网页抓取候选不适用本轮。复工先读 AGENTS、README、PRODUCT_REQUIREMENTS_V1_4、ARCHITECTURE、TESTING 与 AI。

工具库独立入口，紧凑图标卡片，六种类型/可选网址/用途/领域/标签/专题/富文本个人备注，添加编辑确认删除/搜索筛选/排序/列表/置顶/批量。备注默认折叠；全站搜索含备注。共用 entries UUID、附件和多对多关系，不创建重复库或启动本地软件。

设置拆分类管理、AI 配置、备份与草稿、网站启停。领域/专题加号及管理标签直接选中相应表单、回顶聚焦；隐藏区不进入焦点循环，切区保留未提交配置，关闭仍确认清空密钥。原 DPAPI、Provider、AI 人工审核、备份和锁保留，无真实模型请求。

schema3 在 entries 增 resource_kind/tool_kind 与索引，旧行默认 knowledge/空类型，原字段不改写。新工具仍复用 note 富文本编辑语义，靠 resource_kind 区别，允许合法网址或空值；notes 列表排除工具，all 搜索包含工具。工具新稿 new-tool 与原 new 隔离，旧草稿兼容。

正式开工服务 PID29596/schema2/5条/2笔记/1专题，有效锁保留。升级前受保护 ZIP `data/backups/pre-v1.4-protected.zip` 校验成功；正常停止旧服务、用启动脚本取得锁后事务迁移，自动完整校验备份 `data/backups/pre-schema-3-04da7c31-ecdd-4093-a8bf-8ac6628a008e.zip`。升级后只读快照比较旧 11 表原列全部相同，附件/workspace/ai-usage 原文件哈希相同，正式记录没有测试写入。5条/2笔记/1专题/0工具、AI configured=true，未读取密钥或测试真实连接。正式实例 V1.4.0/schema3 后台运行（核对 PID24244），有效锁不删除，不强制结束。

生产 build/typecheck 与 35/35 自动化通过。Edge：原 V1/V1.1、原 AI OpenAI/DeepSeek、专题两家 Provider、安全设置和新增工具全部回归通过，云端均模拟；工具/设置桌面、深色、390px 截图实读复核。Windows .bat 隔离演练验证重复启动同 PID、异常退出重开、旧笔记/虚构 DPAPI 配置保留、正常停止释放锁；schema1/2/3 真 ZIP 校验和恢复，迁移失败回滚。详细命令及限制见 TESTING。

最终复核曾发现正式进程已退出、锁正常释放、启动错误日志无异常，原因未能确定；没有删除锁或强杀，正常启动脚本恢复后只读数据哈希仍相同。最终核对 PID26760，schema3 未重复迁移，Edge 正式页面只读验证工具空状态、专题快捷管理、AI 空密码输入和无 pageerror。不能把这一退出现象归因于已确认的代码缺陷。

截图仅合成资料，在忽略的 test-results：v1.4-tools-desktop.png、v1.4-tools-dark.png、v1.4-tools-mobile.png、v1.4-settings-mobile.png。个人库/ZIP/用量/密钥/日志均不入 Git；本轮无新依赖。交付提交用 `git log -1 --format=%H` 确认，SHA 在最终报告；本地提交，不推送。

未验证：真实付费 Provider 权限/账单/效果、整机重启/Explorer 物理双击、跨 Windows 用户/ACL、干净机器安装、断电/磁盘满/大库压力。工具类型扁平，暂不转换现有知识为工具；没有文件执行、抓取、问答或自动图标下载。默认图标/手动上传、稳定 ID 和纯文本索引满足本轮，不代表已实现未来问答。

使用：双击启动知识库.bat → 工具库 → 添加工具；设置四分区选择所需操作。AI 密钥仍在 AI 配置内用 CurrentUser DPAPI 安全保存，未保存网页配置时兼容环境变量；双击停止知识库.bat 或设置 → 网站启停 → 正常停止网站。关闭网页不停止后台。

## 历史 V1.3.1（以下服务状态不代表当前）

## AI安全配置与一键启停交付记录（2026-10-13）

交付补记：正式1.3.1已用正常启动脚本启动（当时PID33404），只读API确认为schema2/4条/0专题/canStop=true；重复启动复用同PID，再用停止脚本正常停止，有效锁释放，全部11表/附件/workspace/用量哈希一致。**交付时服务已停止**，用户可直接双击启动，不需清理锁。未在正式配置中输入测试Key或触发连接测试。

基线 `4478a8d90bbc42b3d6202fa4dcf54e555b60b9d3`，开工Git干净，schema2保持，无迁移/依赖更换/抓取。完成设置内双Provider/模型/安全输入保存替换清除、CurrentUser DPAPI与Provider/目录绑定、原子/乐观配置版本、解密失败保留；网页配置优先于环境且清除不回退。首页AI状态、主动费用确认连接测试、最近结果/时间/参考用量。新Key不由读取API返回，不进data/SQLite/ZIP/Git/日志/浏览器存储，固定Endpoint仍限制。

一键后台启动先核对锁/进程创建身份/端口owner/API目录/新版项目握手，健康复用同一PID。独立启动锁串行、按需构建，终端关闭不结束后台；无系统服务/自启/自动重启。停止脚本/设置通过同源token确认API关闭HTTP/SQLite释放锁，维护上传中拒绝、AI取消；前台npm start仍Ctrl+C。旧服务无法握手关闭时须原启动窗口Ctrl+C一次，不能盲删锁或强杀。

正式实例开工时PID20324/3000/schema2；开发途中观察到原服务已停止且原锁已释放，没有对它发送终止命令。取得锁只读审计时为**4条记录/0专题**，包含用户在V1.3后增加的记录；全部11表/附件/workspace/用量建立哈希并复核一致。本轮测试均在独立系统临时库/凭据目录，不清空或恢复正式数据。最终运行状态见本节交付补记，下方旧版本3条/PID20324等只属于当时状态。

构建/严格类型/33项自动测试通过（原28+DPAPI配置4+启动器1）。真Windows .bat启动后台、退出启动器/重复双击同PID、直接重复Node拒绝、异常杀测试进程后重开、旧笔记/手工收藏/加密Key保留、模拟连接成功、正常停止释放锁、缺Node报错通过。真DPAPI往返/密文损坏、模拟权限失败、Provider错绑、清除/替换失败不覆写；CSRF/Origin/Host/端口/session/JSON错误脱敏、密钥不入API/DB/ZIP/浏览器测试通过。V1～V1.3真Edge全部回归，新增设置完整流程与窄屏截图。模型transport或测试专用预加载器模拟，未读取用户真实Key、未做付费调用。

首次使用：双击启动 → 首页AI入口或设置 → DeepSeek/deepseek-flash → Key → 安全保存确认。以后直接双击；停止用停止知识库.bat或设置。安全配置在 `%LOCALAPPDATA%\PersonalKnowledge\AI\*.dpapi.json`，知识备份不带Key，换用户/机器/目录需重设。AI.md说明优先级、费用和安全边界。

新代码：AiSettings.tsx、ai/credentials.js、scripts/dpapi.ps1/launcher.js/stop.ps1、停止知识库.bat，settings/launcher自动测试与browser-settings、mock-cloud-preload（仅tests）。测试命令见TESTING；不要把预加载模拟引入生产，不执行V1.4。当前提交为含本文档的HEAD，最终回复给准确SHA，工作树以git status核对，无推送。

截图为合成资料，test-results/v1.3.1-ai-settings.png与-mobile.png实际读取复核，不提交。限制：仅Windows支持安全持久化；同用户恶意程序/管理员/失陷系统仍能读本机凭据；跨Windows账号/真实ACL变更、整机物理重启、Explorer物理双击、真实云端/账单未测试。权限失败由注入模拟，真实损坏密文解密失败实测。JS内存不能保证即时擦除，密码管理扩展off不能保证遵守。旧进程无新停止接口需一次Ctrl+C。锁无法确认保守拒绝，后台不自动保活。

## 历史V1.3交接（以下状态不是当前事实）

## 当前交付（2026-10-13）

从干净 HEAD `feeca8d8d555e40f0942b1e0f97c237e2b6c8f83` 继续，保留全部 V1～V1.2/DeepSeek 成果。停在V1.3，无新架构/依赖/爬虫/账号/云部署，不执行V1.4。交付 SHA 为包含本文档的本地 HEAD，用 `git rev-parse HEAD` 获取，最终答复报告实际值；未推送。

实际完成：专题整页的介绍/富文本知识总结/资源卡片，添加移除已有资源、当前专题新增、原网址/站内详情、分页和空状态；独立手工草稿/离开保护、乐观版本、保存旧版与历史恢复；选中3～10条双Provider综合整理、严格Schema/引用ID/源内容快照校验，可编辑独立AI草稿、拒绝、追加/确认替换后手工保存；本地分享文本多URL/标题/话题候选、编辑拒绝、新标签确认、不覆盖已有标题/笔记。

AI资料仅主动所选标题/简介/纯文本笔记/type/来源主机，不抓取视频/网站、不上传全库。至少两条≥24个具体文字字符，否则本地不足；总JSON≤12000字符超限拒绝、不截断。引用仅来自选中有文字依据的ID，来源/总结版本变化时拒绝迟到生成及采用，保留旧稿；ID有效不是事实验证。OpenAI/DeepSeek配置/独立单价/共享限额不变，真实密钥未读取或输出、未调用付费API。AI.md详述边界。

### 正式数据与启动状态

开工时实际服务已停止、无有效服务锁，schema1、**3条记录、0专题**；下方旧PID5800/两条记录是历史记录，不能当作当前事实。取得实例锁后只读审计原八表/附件/workspace/用量哈希，创建并校验 `data/backups/pre-v1.3-4da18d41-f571-465d-a4fa-7942591a22cf.zip`，该ZIP副本在独立临时库成功校验并升到schema2，原八表/附件/workspace完全一致。

最终使用正常CLI取得身份锁启动正式库：迁移前自动保存并完整校验 `data/backups/pre-schema-2-c0f122fc-c958-4a8a-9f31-f1ba59a152c0.zip`，事务增加三张专题表，未改旧八表。只读 `/api/meta` 与 `/api/entries` 为200、version1.3.0/schema2/3条/0专题；Ctrl+C停止后有效锁正常释放。再次正常重开仍为schema2/3条，未产生第二份迁移备份，最终正常停止。迁移后原八表、附件、workspace与ai-usage哈希和开工一致，未向正式库写测试资料，未删除数据库/WAL/SHM/附件/历史备份，也未强制结束用户服务。

正式库已是schema2，不能用V1.2代码强开；需要回退时保留当前完整目录，用对应版本和旧保护ZIP在独立目录恢复，不能直接覆盖。交付结束服务停止，可双击根目录 `启动知识库.bat`（或 `npm.cmd start`）打开 http://127.0.0.1:3000，停止按Ctrl+C。AI环境变量需在启动后端的终端设置，详见AI.md，勿把密钥发给Codex或写文件。

### 验证与复工

构建、typecheck/noUnusedLocals、**28/28自动测试**通过。真实Windows Edge跑V1、V1.1、原AI双Provider、V1.3双Provider全部流程，0页面错误；Windows .bat真启动/异常退出重开/重复实例拒绝/缺Node、真实ZIP和schema1→2恢复通过。专题测试包括原HTML/图片、草稿刷新、来源点击、编辑保留引用、追加/拒绝替换/确认替换/历史恢复、错误/取消/超时、深色/窄屏；分享解析模拟paste事件、修改拒绝/采用、新标签、原标题笔记不覆盖、重复链接。无真实云端调用。详情/命令见TESTING。

截图只含合成资料，忽略的 `test-results/v1.3-deepseek-topic.png`、`v1.3-deepseek-ai-review.png`、`v1.3-deepseek-dark.png`、`v1.3-deepseek-mobile.png`、`v1.3-share-candidates.png`、`v1.3-share-text.png`，OpenAI同前缀图也生成；实际读取截图复核，不入Git。

复工先读README/AGENTS/本文件/TESTING/V1～V1.3/ARCHITECTURE/DESIGN/AI，检查真实Git/服务/锁/数据。新增代码：migrations.js/topics.js/ai/collection.js；CollectionPage/ShareAssist/shareText；tests/topics/migration/share/v13-fixture/browser-v13。所有测试用独立临时库、注入transport；禁止用createApp测试工厂打开正式目录（它不获取实例锁）。保存任何新迁移前必须备份并真实恢复。

### 已知限制 / 未验证

实际云端权限、中文生成质量、账单/网络，以及Ollama未验证；未做整机物理重启、Explorer物理双击、系统剪贴板端到端、干净电脑初装/真实断电/磁盘满/大规模库压力。Windows真实进程重开和可控PID复用测试通过，不能表述为整机重启通过。

原分享文本只在本次编辑可查看，关闭即丢弃；需长期留存请人工复制到笔记。历史全部持久化但UI只列最近50版，暂不自动清理；专题删除会删除其正文/历史/草稿，资源和附件不删。已确认创建的新标签会保留，即使取消收藏。旧AI草稿遇到正式版本变化不可直接采用，需复制要保留的文字后明确放弃并重新生成。删除来源后历史URL快照仍可查看，站内详情会提示不存在。最后650ms未落盘内容仍可能在突然断电丢失，操作前等待草稿已保存。

## 历史 V1.2 交接（下方运行状态/版本仅供追溯）

## 本次增量：DeepSeek Provider（2026-10-13）

用户授权在已验收 V1.2 上增加 DeepSeek，基线提交 `6d6cb1a5486f22a228841013edaa95054600fbe4`，开工 Git 干净。保留版本 1.2.0 和原架构，无依赖/数据库/收藏或笔记结构变更，未读取真实密钥、未做付费 API 调用，不开发其他功能。当前交付仍为包含本文件的 HEAD，执行 `git rev-parse HEAD` 获取准确 SHA。

- 默认 OpenAI 保留；`PK_AI_PROVIDER=deepseek` 选择新增 DeepSeekProvider，`DEEPSEEK_API_KEY` 独立环境变量、`PK_AI_MODEL=deepseek-flash`。完整安全输入和切回 OpenAI 示例见 AI.md，改变配置必须正常重启后端。
- 官方文档核对：DeepSeek Chat Completions 固定 `https://api.deepseek.com/chat/completions`，json_object、非思考、非流式、max_tokens。不接受任意或交叉 Endpoint；仅发送所选 Provider 密钥。
- generate 契约不变，共享既有审核、原文追加、图片保护与服务端 Schema/ID 校验。空/截断/无效 JSON/字段/工具输出拒绝，无自动修补/重试；已返回的失败用量仍记录，无 usage 明确未知。
- DeepSeek 费用独立，默认高峰美元参考价 0.30 / 0.006 / 1.20 每百万未缓存输入/缓存输入/输出，三个价格环境变量可覆盖；不自动猜测低峰或节假日。OpenAI 单价不变。
- 旧 OpenAI 用量日志 version=1 原样读取、追加混合记录，小时上限跨 Provider 共用；价格变更不重算历史估算。密钥/输入不进日志、数据库、备份或 Git。

实际验证：build、typecheck/noUnusedLocals、18/18 自动测试通过（保留原13，增加5项 DeepSeek）。Edge 分别跑 OpenAI/DeepSeek 同一完整审核流程：修改/选择/全接受/拒绝、分类 ID、新标签确认、原文/图片、恶意文本转义、超时/取消/无密钥手动保存；V1/V1.1 浏览器回归通过。全部模型请求使用注入的模拟 transport，不是实际云服务。

正式服务仍为 PID5800/3000，未结束或移除有效锁。两条条目、schema1；条目/附件/workspace草稿/用量文件/有效锁与开工哈希一致。临时库测试完成后关闭并清理。正式数据未迁移/恢复/覆盖。最新后端不会热加载，请在原窗口 Ctrl+C，再按 AI.md 在配置环境的终端启动；不需要向 Codex 提供密钥。

截图为合成资料：test-results/v1.2-deepseek-bookmark-review.png、note-preview/note-reading/mobile，同样前缀的 openai 图用于回归；不提交。详细结果见 TESTING。本轮没有实际 DeepSeek/OpenAI 调用，账户权限、实际中文质量/账单/网络可用性未验证。官方文档已核对但不是实际 API 验收。只支持 deepseek-flash，新增其他模型需独立费用/白名单验证。停止在本次 Provider 接入验收点，不自动进入 V1.3。

## 历史 V1.2 主交付

以下为本次增量前的交付记录；其13项测试/仅OpenAI描述属于历史版本，以本节上方与 AI.md 最新实现为准。

最后更新：2026-10-13（Asia/Shanghai）。已连续完成中断恢复、V1.2 可选 AI 整理和 Windows PID 复用锁修复；停在 V1.2 验收点，不进入 V1.3。

## Git 与恢复基线

V1 基线 `12bced8`，V1.1 交付基线 `51ebcd9`。本轮从昨天的未提交 AiAssist、ai/、编辑器、后端和版本修改继续，保留并补完，没有初始化/重建。当前交付提交是包含本文件的本地 HEAD，用 `git rev-parse HEAD` 获取准确 SHA；最终回复报告实际 SHA。没有推送或公开发布。

data（数据库、WAL/SHM、附件、workspace 草稿/偏好、锁、用量）、备份、密钥、dist、node_modules、测试结果全部忽略。正式实例审计时 PID 5800、端口 3000、API version=1.2.0、schema=1，原有两条原创笔记、零附件。已通过现有服务导出并完整校验 `data/backups/pre-v1.2-resume-2026-10-13.zip`，没有对正式库执行恢复、清空、迁移或测试写入。正式条目、附件和有效锁开工/完工哈希一致。原服务及锁保留，未强制结束、移除或替换。

**当前运行的旧后端进程不会热加载锁修复**。请在原启动窗口 Ctrl+C 正常停止，再双击 `启动知识库.bat`，即可使用最终代码。保留 data，勿直接删除有效锁。前端已构建完成，最终后端已在独立 Windows 临时库启动和验收。

## 实际功能

- V1/V1.1 的收藏和原创笔记、三组分类、多对多、待整理、搜索、分页、卡片/列表/排序、置顶/人工批量、重复检测、最近分类、内联创建、富文本、本地图片、草稿恢复、ZIP 和恢复回滚继续使用且回归。
- 「AI 帮我整理」：推荐标题/摘要、现有分类 ID、现有标签/有依据的专题、候选新标签、分类理由；只处理主动提供的当前文字和必要分类元数据，不抓取 URL。
- 「AI 整理笔记」：标题、摘要、结构、要点和表达整理的可编辑预览；采用时原文完整保留，追加安全转义整理稿，原图片和链接不改变。
- 统一人工审核：接受全部、选部分、修改和拒绝；新标签默认不选、创建前确认，分类只追加；采用只进表单，原有「保存条目」才保存正式记录。编辑内容变更后阻止旧建议覆盖。
- OpenAI Responses Provider；默认固定 GPT-4.1 mini 快照，真实 JSON Schema/二次验证，固定 HTTPS Endpoint；环境变量密钥仅服务端使用。
- 输入/输出/响应体/超时/并发/每小时次数限制，主动取消、固定错误反馈、零自动重试；本地私有用量日志无正文或密钥，未知费用如实显示；无密钥/异常不影响手动功能。
- 新锁比较创建时间/可执行路径，明确死进程或 PID 复用时归档旧锁，旧 LockApp.exe 锁可恢复。旧版 Node 锁、权限不足、损坏或未知锁保守拒绝；检查阶段 wx 互斥防并发回收，正常退出按 token 释放。
- SQLite schema 仍为 1，没有数据库结构修改，不需要顺序迁移。ZIP 结构保持，兼容旧 V1/V1.1，秘密/锁/AI 用量不进备份。

## 验证结果

详见 TESTING。build、typecheck/noUnusedLocals、13/13 自动测试（含 V1/V1.1、AI 和锁）通过。真实 Edge 的 V1 原流程、V1.1 体验和 V1.2 审核/取消/超时/无密钥流程均通过；Windows .bat 启动、异常退出重启、真实重复启动被拒、缺 Node 明确报错通过。真实恢复比较字段、分类和图片字节；原文/图片/恶意模型文字验证通过。截图使用合成资料，位于忽略的 test-results，实际读取桌面、列表、编辑、详情、深色、窄屏及 AI 审核图。

无有效 API Key，未调用实际付费 API。模拟 transport 走真正服务端/Schema/UI，不是绕过后端的假审核。真实 API/账户权限/实际模型输出质量与收费、Ollama/其他 Provider 未验证。未做整机物理重启；PID 复用通过可控进程身份测试，异常退出重开用真实 Windows 进程。未做 Explorer 物理双击、另一台干净电脑初装、真实断电/磁盘满/大量数据及全浏览器测试。

## 使用、配置与复工

Node.js 24 LTS，根目录启动脚本，访问 http://127.0.0.1:3000，Ctrl+C 停止。可选 AI 环境变量/安全输入方法、参数、Provider 契约与价格依据见 AI.md；不要在网页、源代码、日志或聊天输入 API Key。未配置时继续正常使用。

复工阅读 README → AGENTS → HANDOFF → TESTING → V1/V1.1/V1.2 需求 → ARCHITECTURE/DESIGN/AI；检查 Git 和真实服务身份。所有破坏性测试使用独立系统临时库，createApp 工厂不带锁，绝不用于正式目录。运行 build/typecheck/test/test:browser/test:browser:v11/test:browser:ai/test:startup/test:visual。不自动执行 ROADMAP、安装本地模型或调用付费 API。

## 限制与维护

AI 整理需人工核对，原文是在同一笔记前段保留，不是独立版本管理。未经采用的候选刷新即丢弃；采用后的表单使用既有草稿保护。已确认新标签即为真实分类，取消条目或部分创建失败不会删除它，可在设置人工管理。现有分类仅建议和追加，手工删除/修改使用原有入口。可选批量 AI 本轮不实现，上限为 1；V1.1 人工批量不变。

用量文件保留最近 2000 次，仅参考费用而非账单；取消已发请求可能仍计费，失败无 usage 为未知。ZIP 不含用量，恢复不重置次数上限。用量文件损坏保留并只禁用 AI，手工功能可用。

新锁的启动检查阶段如恰好崩溃，短期 acquire 锁可能遗留，此时明确拒绝并要求核实后保留归档；不能一键盲删。旧锁若 PID 对应 Node 又缺创建时间，无法安全辨认，保守拒绝符合数据保护。正式现有 legacy 锁由原服务正常退出释放；下一次启动建立版本 2 身份锁。

原有草稿 50 份/10MB、防抖最后未落盘风险、上传 10MB/4000万像素、WebP 长边2400px/GIF首帧、ZIP 256MB压缩/512MB解压/10000文件限制保留。附件解除引用不删文件，安全 ZIP/previous 目录不自动清理。定期异盘备份；workspace 损坏不重置，恢复要先校验并明确确认。
