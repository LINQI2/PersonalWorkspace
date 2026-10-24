# V1.0 个人工作空间 / 双库单进程

PersonalWorkspace 以知识收藏馆 V1.9 工程为底座，在同一 Node 24 / Express 5 进程中同时提供知识库与任务台，浏览器只有一个来源 `http://127.0.0.1:5180/`。

- 数据：`data/library.sqlite`（schema11，未改表）+ `data/tasks.db`（任务独立库，user_version=1，WAL/外键）。不把任务塞进知识 schema，也不引入第二服务。
- 服务端：`app/server/tasks/store.js` 负责任务事务/校验/导入，`router.js` 挂载 `/api/tasks`；`workspace-backup.js` 组装统一 ZIP，`workspace-restore.js` 执行带日志、暂存、快照与回滚的双库切换；`index.js` 只增加接线与 `/api/workspace/*` 入口。任务 API 完全复用 Host/Origin/X-PK-Request/session/维护门/JSON 限额。
- 前端：`app/client/tasks/*` 为原任务台模块，`styles.css` 经 `scripts/scope-tasks-css.mjs` 生成 `.tw-app` 作用域样式；`main.tsx` 新增 `tasksOpen` 状态与「任务台」导航，知识视图保持挂载以保留筛选/滚动；`workspace.css` 负责外壳高度与标签重置。
- 备份：统一 ZIP = manifest + 知识标准 ZIP + tasks.db + tasks.json + README；恢复先完整校验、再快照、再关闭/搬移/切换/复核，失败回滚并保留 previous 目录与日志。
- 兼容：旧知识库 ZIP 只恢复知识库；旧任务 JSON 只替换任务。AI 凭据 DPAPI 未迁移，需重新授权；旧源浏览器 localStorage 不共享。
- 详细决策、迁移核对、验证矩阵见 [INTEGRATION_V1_0](INTEGRATION_V1_0.md)。启动仍沿用原 launcher 身份锁/实例令牌，仅把端口改为 5180、应用标识改为 PersonalWorkspace。

---

# V1.9 思维导图 / schema11

保持Node24、Express、SQLite、React19、TypeScript、Vite和Tiptap；仅新增MIT mind-elixir@5.15.1，锁文件固定版本。MindmapEditor在挂载/卸载时管理本地实例，提供画布/文字大纲/属性与连线面板，禁用任意HTML/图片/外链插件入口。导图引擎独立Vite chunk约93KB原始/30KB gzip，没有新增后台服务或云请求。

mindmaps.entry_id引用现有entries，结构JSON含稳定节点ID/children顺序/direction/expanded/安全style/metadata.contentId及arrows；mindmap_versions保留正式旧结构/标题/修订。仅追加两表及一索引，原34表不重建。entries仍遵循既有note/knowledge约束；hydrate.mindmap/contentType显式识别独立类型，普通saveEntry拒绝覆写导图，搜索plain_text为节点文字投影。分类、主要领域、多对多专题/标签、pin和lifecycle复用。

shared/mindmap.js同时负责服务端、前端及导入的安全白名单/树/ID/限额；不把任意供应商JSON直接交给渲染器。mindmaps.js在同一事务中校验CAS修订与分类指纹、写上一版、保存结构并更新搜索投影。引用目标需真实存在；回收状态动态解析，跨分支连线不进入knowledge_relations。启动和ZIP验证结构、索引一致性、历史、目标与外键；旧1～10ZIP严格验证后隔离升级11。

API：GET /mindmaps/:id、/mindmaps/:id/versions；POST /mindmaps、PUT /mindmaps/:id、POST /mindmap-import/preview。写入复用Origin/session/JSON/X-PK-Request及Host/localhost边界。导入只新建、不按节点ID跨图合并；全站JSON v1/v2内容协议不改。

客户端650ms串行快照保存；以响应更新已保存基线，不覆盖期间新输入。浏览器恢复副本按数据目录/entry/window隔离并绑定修订与分类指纹；冲突只能导出比较/重新加载，失败无后台重试。全局导航/站内跳转/关闭保护独立于原workspace/quick/knowledge/topic草稿。图片几何由本机引擎导出，mindmapExport重建文字/标签并过滤可执行SVG，Markdown明确有损；服务器ZIP覆盖正式结构与历史，不包含Key/用量日志。实现细节与边界见DESIGN_V1_9。

---

历史记录（当前版本以上述说明为准）：

# V1.8：阅读记录与统一粘贴 / schema10

不改React/Express/SQLite/Tiptap架构，无新依赖。ReaderPanels把真实章节大纲、reading-main正文和辅助信息分为三个独立滚动兄弟；面板开合/功能标签/正文位置保存会话元数据，窄屏覆盖不互斥。ReadingTools基于真实正文DOM选区，复用RelatedPanel/ContextAssistant，不把业务搬进第二AI工作台。

新reading_marks表及source/target索引追加于schema10，保留旧33表。source_id/target_id/source_page_id外键RESTRICT；quote/anchor_json/comment/revision/时间/软删除。reading.js服务端绑定原文指纹、精确摘录与64字符前后文，精确/唯一重定位/失效/歧义动态计算。引用追加用原saveEntry/saveRecord与历史逻辑同事务，不绕过修订和草稿；原文引用通过原data-entry-id确定性关系展示，data-reading-mark和#quote仅补充定位。Tiptap保留新安全属性，未知来源不伪造引用。

同源/session保护的新API：GET /reading/marks/:content、/reading/mark/:mark、/reading/targets；POST /reading/marks、/reading/marks/:mark（评论修订/软删）。写入仍需Origin/本地session/JSON/请求标记，localhost和DNS rebinding防护沿用。数据库/附件/密钥不暴露给外部客户端。

paste.js为独立可复用服务，POST /knowledge/paste/preview/check/commit/cancel。安全Markdown子集→明确JSON v2对象→原prepareImport/commitV2，原始粘贴全文在来源excerpt/原包快照内。短期令牌8份/15分钟，标题改动和提交前本地重检重复，人工另存/分类/选择，事务失败不留孤立记录。旧JSON接口/Schema不变。

迁移9→10先生成并完整校验旧ZIP，再BEGIN追加，故障回滚9；启动/备份/恢复严格验证新结构与外键。旧1～9ZIP校验后隔离升级10。个人DPAPI、workspace快速草稿、用量文件及单实例身份锁不改。启动器只显式增加对1.8身份协议版本的支持。

---

历史记录（当前交付以上述版本为准）：

# V1.7.3 阅读工作台 / schema9不变

ReaderWorkbench 提供测量高度的固定工具栏、按内容ID管理的来源/关联/AI辅助容器；复用 ContentActions、ContentProvenance/原历史、RelatedPanel、ContextAssistant。ContentPreview 管理本地预览与历史层级；readingNavigation 保存显式返回根页面，useHistoryGuard 给普通/知识编辑器增加真实dirty/busy后退保护。知识库会话元数据与新scope nonce分离，不写正文到导航状态。

快速记录由 quickDraft.ts 的共享外部store串行防抖/CAS持久化；/quick-draft受现有localhost/Origin/session/写入标记/JSON保护。workspace版本仍1，新增专用drafts.quick（字面文本转义HTML、UUID修订、领域/标签严格校验），启动和ZIP校验识别并限制该键，通用draft写入不得绕过CAS。原普通/工具/知识/专题/AI草稿不复用此键，数据库及33张表不变。

浏览器仅对快速输入保留按dataPath/窗口隔离的localStorage恢复副本，sessionStorage保存前窗口恢复标识；API Key永不进入该机制。服务器已保护draft进入ZIP，尚未同步的浏览器副本不进入ZIP。冲突必须人工选择，正式保存成功按版本清除，不自动创建正式知识。旧ZIP可继续恢复；含quick键的新workspace不直接降级到旧版程序。

AI Provider/超时/模型/Endpoint、DPAPI、数据目录身份锁及备份恢复的安全边界不改，无SQL迁移或新增依赖。交互规则见DESIGN_V1_7_3.md。

---

历史记录（当前行为以上述版本为准）：

# V1.7.2 交互修复 / schema9不变

无迁移、第二数据库或新Provider。DomainTree复用真实domain_structure，侧栏/SettingsPanel/UnifiedLibrary管理统一节点视觉；FilterMenu只管理一个展开状态，筛选条件仍是原查询。pk-library-scope事件同步浏览元数据，避免外壳导航参数覆盖已清除条件。ContentActions仍调用原pin/软删除接口，阅读对象在操作后重读。

Dialog使用React portal到body，固定标题与dialog-body内部滚动，统一视口约束；useScrollLock对阅读器和嵌套弹层引用计数，只有最后一个关闭恢复原body样式。最上层Escape与焦点约束保护背后阅读器。样式experience.css最后加载，避免旧dialog/sidebar规则覆盖修复。

SettingsPanel六分区保持同一表单实例，AI隐藏时不丢未提交Key；AiSettings用规范化provider/model加载及保存基线比较真实修改。分类与恢复准备有独立关闭判断，公开status只展示原限额/用量，不新增密钥读取或限额写入接口。安全边界、DPAPI、Origin/session/CSRF、锁、版本历史和ZIP沿用。

---
历史记录（当前交付以上述说明为准）：

# V1.7.1 统一体验 / schema9

架构仍为 Node24/Express/React/TypeScript/SQLite/Tiptap，无新增依赖、模型、第二内容库或关系库。Experience.tsx 复用 api/Assistant/UnifiedImport 与原编辑器，提供统一操作、快速记录、工作台、队列、回收站、全页阅读外壳和设置入口。main.tsx 统一顶侧导航/真实领域专题树；UnifiedLibrary 保留搜索、导入、动态规则、章节与探索。

顺序迁移仅追加 content_lifecycle（entry_id、state=inbox/later/done/trash、previous_state、changed_at/deleted_at）和 content_versions（原 title/description/content/时间）。31旧表不重建、不回填或改原记录。处理状态与知识 epistemic/status 分离，完成处理不自动确认判断。迁移前始终生成 ZIP 并由生产 openStore 钩子完整校验；错误回滚8。旧1～8ZIP先严格验证原 schema/语义/附件，再隔离升级9。

lifecycle.js 提供 quickCapture、setLifecycle、visibleSql、validateLifecycle。POST /capture 与 /content/:id/action 受同源/session/JSON/请求标记保护；快速保存及状态写入同一事务，重复/坏元数据整批回滚。旧 DELETE /entries/:id 与 batch delete 也委托软删除，不保留另一套不可恢复删除语义。正文/ID/来源/标签/专题/附件仍在原表，恢复旧未显式状态会移除覆盖状态并沿用旧处理语义；引用目标、仍有子章节的文档及未移出的内部章节依然保守拒绝回收。

正常列表/检索、动态专题/成员数量及 AI catalog 排除回收站，详情稳定 ID 仍可查看并恢复；原人工专题关联不删。普通正文更新前事务记录版本，历史HTML/大小/日期/图片引用严格验证；只允许放入编辑器人工保存，旧知识和专题版本逻辑不变。回收站不永久清空，分页显示每页24条，支持所有页恢复。

阅读器使用实际章节树、稳定 #content/#chapter 入口，不据设计图造统计/进度/来源。阅读位置和导航偏好仅保存 ID/筛选等浏览器元数据；正文从 SQLite 读取。快速记录文本不存浏览器持久化。原 workspace、知识/专题草稿及 AI 短期审核隔离策略不变；DPAPI/Origin/锁/Endpoint 安全边界保留。

---
历史说明（以本轮入口为准）：

# V1.7 关系与探索 / schema8

保持既有SQLite knowledge_relations（5个历史kind）不重建；追加relation_details存七类型、origin、证据JSON、不确定性与revision，relation_history存事务前快照/提交后hash/时间，两索引加速正反向。新type=reference/dependency/composition/related以旧kind parent为兼容存储载体，读取必须用details.relation_type；旧parent/duplicate不猜组成，显示历史待复核的related。旧kind、ID和方向未改。

relations.js统一真实node/owner/anchor、持久关系与只读确定性记录、正反向列表、循环/重复/自引用/版本检查、删除保护、局部BFS、事务/历史及恢复校验。确定性关系从knowledge_structure、knowledge_references、正文data-entry-id实际UUID推导，不建图数据库或自动写全库。复用delete/batch安全guard，引用必须先解除；章节父级调整也校验组成循环。

历史恢复只改两个关系表，不覆盖原文；hash绑定全部关系、原内容标题/正文/更新时刻及实际章节结构，变更后保守拒绝，FK与来源端点/元数据重验。2MB快照、10000关系上限超限拒绝保存，不要求删除知识。旧1～7ZIP先原schema校验再提取副本迁移到8；启动和ZIP校验typed关系/历史JSON/循环/字段/限额。

ai/relations.js为现有Provider/service的relations模式适配器，共用DPAPI、限额、费用、超时、取消和secret-free ledger。prepare限定所选2～10份完整正文及必要元数据，12000字符，真实ID Schema、逐字引文、足量文字；生成、采用绑定resolve快照。不赋予模型写权，采用同事务写origin=ai/state=candidate，人工可再确认/拒绝。pending8/15分钟、无后台重试；导入origin=import保持candidate。

RelatedPanel复用AiReviewItem，与原审核风格统一，折叠展示、人工编辑/方向/证据范围、本地候选与AI审核同一处，无新AI工作台。本地召回按标题/简介/正文及共同领域/标签/专题排序，最多查200/显40，领域含子领域，动态专题复用规则；只有主动选择资料发送云端。

KnowledgeExplorer原生SVG圆形局部布局，无依赖；最多40真节点/80真边，层数1/2、类型过滤、候选显隐、颜色/箭头/标题说明和HTML列表；g节点键盘操作，点击用现有owner导航。省略为遍历上限计数，不虚构节点。App处理#content-UUID/#chapter-UUID及正文站内链接，仅同站GET真实对象。

API：GET /relations/:id、/relation-candidates、/relation-history；POST /relations/save/review/graph/estimate/generate/apply/cancel/restore均受同源/session/JSON/X-PK-Request保护。旧knowledge/relations/review路由委托同模型，历史调用兼容。localhost/Origin/锁/身份验证/ZIP与密钥边界不变，不能抵抗同Windows账号恶意进程。

---
历史说明（本轮入口优先）：

# V1.6.1 统一内容与领域树 / schema7

保留Node24/Express/React/TypeScript/SQLite/Tiptap架构及全部历史SQL。顺序迁移新增domain_structure（领域parent/position）、content_primary_domains（主要领域）、content_provenance（普通内容导入映射/日期/性质）、content_source_links（任意entries到原来源）、collection_rules（已审核动态筛选）、library_views（持久常用视图）六表。不改23旧表，不把普通工具/收藏强塞knowledge_records。

unified.js集中领域树循环/8层/引用检查、主要领域、类型映射、规则、来源和只读清理候选。旧domains继续全局唯一名称；parent关系独立表，未记录为根领域。主要领域必须来自entry_domains；其余仍跨领域多对多。删除被内容/子领域/规则/视图引用的领域拒绝。领域父级变更不改entry_collections。

综合文档=既有page；内部block=point+knowledge_structure。旧目录、directory_id、来源/历史/草稿完全保留，兼容字段不再成为新界面分类。既有点不按同目录推定父级。首页与library列表无搜索时隐藏已拥有的内部块，独立点仍可维护；全文搜索与owner定位复用原B。

v2机器Schema独立，exchange.js确定性校验并继续解析v1；import-v2.js独立于React表单，预览token/15分钟/8个沿用importer.js。原包hash/日期/来源摘录不变，v1显式转换仍保存原v1 raw与hash；所有新entries/领域/来源/章节/关系同一事务。外部客户端没有新公开鉴权，所有library写入需同源/session/JSON/X-PK-Request，旧安全边界不变。

动态专题类型/领域/标签同类OR、跨类AND，领域含子树；规则只读计算成员，不写人工关系。按用户选择生成专题AI，采用时重验正文和实时成员。规则预览返回匹配IDs/数量，明确确认后保存。常用视图最多20，未归属筛选暂不能固定。

schema7 AI结构只召回领域/专题/标签/内容，不生成旧目录建议；领域移动/合并维护子领域/主要领域/规则及视图，事务快照新增4个结构表。旧schema6历史before_json仍验证保留，升级改变状态hash，旧操作恢复保守拒绝，不能覆盖新schema；需要手工调整或完整ZIP。当前历史恢复仍要求DB/workspace未发生后续变化，5MB上限。

backup/openStore完整校验schema、树、日期、导入hash、来源、HTML/资产与历史。旧1～6ZIP原始验证后仅迁移提取的隔离副本，正式锁机制保持。凭据/用量不进ZIP，任何新表也不保存Key。

---
历史说明（入口以本轮说明为准）：

# V1.6 当前架构

版本1.6.0/schema6，仅assistant_changes一表，历史schema1～5 SQL保留。迁移前完整ZIP校验、事务新增，旧22表不改。backup/openStore验证新历史列/JSON/大小/树/HTML/本地资产/来源，旧1～5ZIP先验证再仅迁移隔离副本，未知损坏拒绝。

assistant/catalog.js复用SQLite LIKE与Intl.Segmenter本地检索/rank，规范key=固定kind:真实id。来源resolve获取完整选中正文/描述及分类/实际父级/目录/性质/日期，SHA绑定内容、归属、版本/关联/来源；不抓URL。metadata目录/分类有标识不表示已读正文，预览240字符不用于模型截断。inspect在本机检查名称标准化、深度和缺归属/标签，不默认把全库传API。retrieve每类最多80候选，rank显示40；scope最多20范围/200知识，明确拒绝超限。

ai/assistant.js为assistant_qa/assistant_structure生成真实Schema，与provider相同协议。sourceIds/evidenceIds/object/target enum限定所选；字段/hasEvidence重验。service统一状态/usage/单并发/小时20/超时/取消/输出限额，不保存回答。问题1000/QA10/结构30，完整输入12000字符；status不足本地零调用。Provider与DPAPI不改，独立价格与secret-free日志追加模式。

assistant/review.js独立estimate/generate/preview/apply/cancel/history/restore。受保护Origin/session/JSON，8份/15分钟预览，源快照重验；preview绑定plan+selected hash，apply重验差异hash与数据库与workspace确定状态再确认，同一事务执行操作并存before_json/after_hash/changes_json。源/目标直接关联量从数据库计算。rename保留ID；merge转关系去重，directory防环，topic追加正文/保留source版本，未保存草稿或不同源快照保守拒绝。restore原主键upsert与只清本批新增行，绝不删除knowledge_records导致来源/导入映射级联；全DB状态不符拒绝，5MB历史快照上限。未来schema新增列须兼容schema6 before_json。

knowledge/integration扩展newPage，在同事务保存page/point/出处，原数据日期/内容不变；已有目标page与章节在生成前后/采用绑定hash。prepareKnowledgeInput附原日期/源日期，fingerprint纳入分类/真实目录parent/来源及性质，避免审核期间归属变化。原B缓存/Schema/逐字引文/正文历史不变。

Assistant前端问答/结构/范围入口，AiReviewItem复用B状态/差异/影响/来源展示；输入阶段候选、生成后只显示选中对象，减小长页面负担。来源回调打开既有主界面，知识点定位到page/章节；目录快捷按钮直达结构。未保存管理离开与beforeunload保护，卸载取消生成/预览，不占任何正式草稿。名字筛选可发现非默认候选。

新/API：GET /assistant/catalog/history；POST search/scope/estimate/generate/preview/apply/cancel/restore。无跨域、公网、外部进程授权/长期前端管理Key。旧本地同账号恶意进程威胁边界不变。

---
历史B架构：

# V1.5-B 当前架构

版本1.5.1/schema5；沿用原栈和所有依赖。migrations保留历史schema1～4原SQL，顺序增加readingSchema：knowledge_structure(entry_id PK, parent_id FK RESTRICT, position)及knowledge_versions(id,entry_id FK CASCADE,title,content,revision,created_at)。旧20表不改。先完整验证pre-schema-5 ZIP，再事务迁移；exact sqlite_master/integrity/FK与结构/历史HTML/资产语义验证，未知或损坏拒绝。旧1～4ZIP先验证原包，再仅升级隔离副本。

knowledge/structure.js定义归属：只有point能有结构父级，沿明确parent最多8层最终必须page。目录/knowledge_references/候选parent均不代表所有权。attach由外层事务封装，验证全树再提交，不写entries正文或来源；后代随祖先跨页移动。FK拒绝直接删父节点。chapterRows只返回大纲元数据，正文展开时getRecord，避免目录全量携带正文。

listRecords默认页面优先（有page时只显示page，否则显示独立记录），all=1或搜索显式返回所有，附所属页ID/标题；owner验证真实结构，知识/全局搜索客户端导航到所属页并展开目标。KnowledgeReader分阅读/整理，继续复用KnowledgeEditor/Tiptap；历史恢复放入编辑器再保存，不直接覆盖。

importer独立逻辑兼容v1；审核新增parent与organize确认，所选parent以本包local-id→UUID映射在整批事务末写结构；缺父/循环/类型失败回滚。旧原始parent仅用于structuralSuggestions待确认，不自动更改旧数据。非page根的旧parent仍可作关系候选。导入源原包/来源不修改。

ai/knowledge.js构造integration Schema和2～10条所选资料≤12000字符输入，来源ID与逐字引文验证；service复用Provider/credentials/ledger/取消/限频。knowledge/integration.js独立estimate/generate/apply/cancel，审核Origin/session/确认令牌，15分钟/8份；根据所选源标题/简介/正文/版本/时间SHA复核，不采用变化来源。相同快照+Provider/模型/凭据配置版本短期缓存最多8份，明确标识无新调用。内存预览不是正式草稿，不入workspace或ZIP。

apply事务新建review/ai_inference章节、明确父级、原资料文字快照及候选来源/观点关系，原entries不覆盖或删除；sourceIds仅有正文依据的所选ID。相关关系不落强关系。阅读顺序仅显式调整page直属选中章节，其余章节顺序保留。正文编辑在saveRecord和旧transaction saveEntry保留旧HTML/title；元数据排序不创建正文历史。ZIP增加树/历史检查，秘密/锁/运行用量仍排除，DPAPI不改。

新增API /api/knowledge/pages/:id/chapters、POST structure、GET versions/:id、POST integration/{estimate,generate,apply,cancel}。结构/AI/导入变更与现有强同源/session/JSON守卫一致，无CORS/公网/外部长期凭据授权。HTTP会话不能抵御同Windows账号恶意程序，沿用既有边界。

---
历史架构如下：

# 实际架构

## 历史 V1.5-A

Node/Express/SQLite/React/TypeScript/Tiptap 与依赖不变，package 1.5.0（A 阶段），schema4。仅追加九张表：knowledge_directories、knowledge_records（一对一 entries 元数据）、knowledge_imports、knowledge_sources、knowledge_entry_sources、knowledge_relations、knowledge_references、knowledge_drafts、knowledge_import_entries。旧 11 表及字段不改写，知识复用原 UUID/HTML/附件/分类/专题，工具不自动变为知识点。

knowledge_records 持有类型 capture/page/point、目录、priority 0～3、inbox/draft/review/confirmed/archived、来源性质、问题、position/revision、人工确认时间、原始日期和资料提供时间。目录父子最多8层且无环，非空拒绝删除；知识及目录上下移动事务写 position。混合页面只关联既有 entries，删除引用资源不复制记录、不执行软件。列表/引用仅返回元数据和数量，正文按需读取；搜索复用 plain_text 和问题文字。

saveEntry 新增可由外层管理事务的可选参数，默认行为保持原状。saveRecord/importer 外层事务调用，任何字段/分类/资源/日期失败全部回滚；正文/标题改写使旧确认转待验证且 revision 增加，元数据不能被旧编辑器转成工具/网址。确认须显式参数与 UI 确认。手工 capture 原文另存来源，导入的原文来自不可变包/来源，知识编辑不改来源摘录。

exchange.js 使用 docs/knowledge-exchange.schema.json 的真实 Schema 约束与有界校验器（可选字段、类型、enum、长度、pattern），再校验有效日期/时区时间、源 ID/逐字 quote、目录树、HTML。Markdown/文本只转义成单条 capture。importer.js 与 React 独立：原包哈希、标题关键词候选、用户选择和显式创建，来源 ID 映射到新 UUID，包内关系候选及 import_entries 映射保留；没有自动合并、模型调用或全库两两比较。

预览仅服务内存，最多8份/15分钟，commit 重验候选/选择、重复哈希、分类与引用 ID，同一事务写新条目/目录/分类/来源/关系。成功消耗令牌、失败可保留审核重试；恢复时使用当前 DB 重新校验，不复用旧数据库连接。来源日期/资料记录时间与本机记录时间分别存储，AI user_judgment 标注不是 confirmed。

knowledge_drafts 独立 SQLite 槽 new/UUID，最多50份、单份1.5 MB、富文本1 MB，650ms 串行保存、关闭确认刷入；恢复过期草稿另行确认。导入外层事务不清理手工 new 草稿。导入源原文、来源、候选和新草稿全部进 ZIP；密钥/用量/锁仍不进 ZIP。schema3→4 前保存完整校验 ZIP，旧1/2/3包先验证后只迁移隔离副本；新九表语义、树、日期、原包哈希、来源引用、草稿/图片与FK一并验证。

客户端分 KnowledgeWorkspace/KnowledgeEditor/KnowledgeImport/knowledgeTypes；旧页面继续用原组件。GET knowledge/schema/template/directories/records/drafts，变更、导入预览/提交/取消/原文读取使用与安全配置相同的 Origin+session guard。HTTP 的本机会话不是 Windows 进程身份鉴权，同账号恶意进程仍在既有威胁边界外；未来外部客户端需独立授权，不公开服务、数据库或长期管理密钥。详细协议与提示词见 IMPORT。

## 当前 V1.4 工具与设置

沿用 Node/Express/React/TypeScript/SQLite/Tiptap，无新依赖。schema3 顺序增加 `entries.resource_kind`（knowledge/tool，默认 knowledge）、`tool_kind`（空或 website/online/ai/desktop/custom/other）和组合索引；不重建 entries，也不改变旧字段。工具仍采用现有 note 编辑语义，resource_kind 是独立资源身份，工具 URL 可以为空或合法 HTTP/HTTPS；普通知识 URL/类型规则不变。

POST/PUT/GET/DELETE entries 共用原事务/HTML/资产/分类校验；工具元数据在服务端校验，旧客户端编辑省略元数据时保留已有值。查询 `view=tools` / `tool_kind` 与原分类过滤组合，全部资源搜索包含工具正文 plain_text，notes 排除工具。重复 URL 检查覆盖所有有 URL 的资源。meta.stats 增加 tools，原 total 包含工具。

图标沿用 cover_asset_id 与资产转换，个人备注沿用 content/plain_text，专题沿用 entry_collections。稳定 ID 不复制，旧专题来源/审核结构不改变，后续问答可按 ID 引用文本，但本轮不实现问答。workspace 版本仍为 1，工具新稿用 new-tool，旧 new/UUID 草稿兼容；分类/图片和 ZIP 校验同步支持新字段。

migrations 按 schema1→2→3 事务执行，每个已有库迁移步骤前写 WX ZIP（源版本清单/SQLite 一致性快照/图片/workspace）并在生产入口完整校验；失败回滚当前步骤。旧 schema1/2 ZIP 先验证原包，再只升级隔离解压副本，schema3 精确 SQL/列/内容验证。旧软件不能打开 schema3，回退须保留现库，另行使用升级前 ZIP 与匹配版本，不能降版本号强开。

main/EntryEditor/Cover 复用原组件，工具卡片覆盖旧封面大面积布局，备注用 details，类型/领域/标签/专题筛选共用查询。SettingsPanel 以 initialSection/initialKind 定向四分区，隐藏组件保持未提交 AI 状态，关闭仍确认清空；Dialog 只循环可见焦点节点。启动器识别并认证 1.4 实例，DPAPI/Provider/锁/备份安全边界不变。

## V1.3.1 安全配置与本地运行

schema2/依赖不变。credentials.js管理LOCALAPPDATA中的DPAPI密文/公开元数据；密钥负载绑定Provider/目录，revision与原子rename保护，验证旧密文后才替换/清除，解密失败保留。dpapi.ps1使用CurrentUser及stdin/stdout管道，不把Key放argv/日志/文件；状态不解密，Provider调用前临时解密。已保存网页配置优先且无环境回退。

connection模式复用generate/Schema/用量/限制，只发固定极短JSON。AI配置、测试及停止API额外强制同源JSON/session/明确确认，loopback Host/实际端口/remoteAddress/Origin/Sec-Fetch-Site校验，API no-store与敏感/JSON错误脱敏，不信代理头/不开放CORS。Vite只绑定127.0.0.1:5173，代理仅改写可信本地同源Origin，生产不使用它。

launcher.js只读核对锁/创建身份/实际端口owner/API目录，新版实例额外锁token握手验证项目root。正常实例复用，旧服务需原窗口Ctrl+C一次升级；死进程/PID复用交给原lock.js归档，未知损坏保守拒绝。独立.launcher锁串行构建与启动，源指纹按需构建。隐藏后台Node脱离启动窗口，无服务/自启/自动重启，启动日志在data。停止脚本或网页先核对实例，经受保护API关闭HTTP/SQLite释放锁；维护/上传中拒绝，AI取消。前台npm start仍可Ctrl+C。

凭据/锁/用量/启动日志不进知识ZIP，恢复不改变本机安全配置。配置文件名*.dpapi.json*亦忽略，测试使用独立凭据目录/虚构Key/模拟transport，mock-cloud-preload仅用于Windows隔离测试。

## V1.3 当前结构（下方旧版本说明为历史基线）

架构和依赖不变，package 1.3.0，SQLite user_version=2。`migrations.js` 保留精确 schema1 定义，只新增 `collection_documents`（介绍、安全 HTML、来源快照、revision、时间）、`collection_versions`（完整上一版）和 `collection_drafts`（manual/ai 独立槽位）。原 collections、entry_collections 及其他旧表不修改、不复制资源，专题无正文时按默认空值读取。

CLI 先取得既有身份锁，再恢复中断文件、读取 workspace、打开库。schema1 完整性/外键/精确对象校验 → VACUUM INTO 一致性库快照 + workspace/附件/校验清单 ZIP → 完整恢复格式校验 → BEGIN IMMEDIATE 新增表、版本检查 → COMMIT。失败回滚，保留保护 ZIP；schema2 重开不重复迁移，未知版本/触发器/无版本非空库拒绝。createApp 不取锁，仅用于独立测试库。备份 manifest 与库版本匹配，支持 1/2；恢复先验证旧 ZIP，在隔离临时库迁移到2，再走既有安全 ZIP/恢复日志/previous 回滚流程。

`topics.js` 提供读取、关联、摘要保存、历史与独立草稿。保存要求 revision 匹配，事务插入原版并更新正文/标题，成功后才清除专题草稿；失败不破坏旧版。资源管理只改原关系表；删除专题级联清理新增三表，收藏及附件保留。内部来源链接的安全 `data-entry-id` 必须来自已审核来源快照，Tiptap 扩展保留此属性；HTML/本地图仍使用原清理与资产校验。

新增 API：GET/PUT `/api/collections/:id`；POST `/:id/resources`（add/remove、ids≤100）；GET `/:id/versions`（最近50条）及 `/:id/versions/:versionId`；POST `/:id/versions/:versionId/restore`（revision+明确确认）；GET/PUT/DELETE `/:id/drafts/manual|ai`。AI 草稿 PUT 仅改 reviewTitle/review，已验证 sources/suggestion 不由前端覆盖。草稿每行≤2MB，随数据库备份，绝不写 workspace。历史保留全部，暂无自动清理。

`ai/collection.js` 增加 collection 模式，共用服务端 Provider、次数/Token/超时/取消。逐一查询选中的3～10个关联 ID，仅发送标题/简介/纯文本正文/type/来源主机，输入JSON≤12000字符，超限拒绝。正文/简介去除URL和空白≥24字符表示有文字依据，至少2条；不代表视频已读取或事实已验证。生成及采用时验证来源仍关联、内容/URL/时间 SHA256 和总结 revision；维护期间拒绝写草稿。生成结构和全部引用二次校验。

`CollectionPage.tsx` 复用卡片/Dialog/RichEditor，独立可编辑预览、来源编号、追加/确认替换表单、历史和离开保护；模型文本先转义再构造固定HTML。来源快照保存实际URL，可追溯站内详情与外链。`shareText.ts` 纯本地解析、`ShareAssist.tsx` 展示可编辑候选及原文本，不联网，不持久化原分享文本；旧 AiAssist 和条目草稿流程保持。

V1.2 DeepSeek 增量：provider.js 的配置白名单保留 OpenAI，增加 DeepSeek 官方固定 Endpoint/独立环境变量密钥；新增 deepseek.js 实现相同 generate 契约，service 按 Provider 选择。DeepSeek Chat Completions JSON 模式 + 本地完整 Schema/ID 校验，OpenAI Structured Outputs 保留。用量 JSON version=1 兼容旧 OpenAI/新混合记录，DeepSeek 缓存/Token/参考价单独计算，小时限额共用。无收藏/笔记/SQLite结构变化；后文 Responses/store=false 为 OpenAI 路径，DeepSeek 使用非思考单轮 Chat Completions，详细安全与配置见 AI.md。

Node.js 24 + Express 5 提供环回地址单进程服务器。React 19 / TypeScript / Vite 构建前端；Tiptap 3 基于 ProseMirror 富文本；Lucide 图标；原生 CSS。生产网页与 API 同端口，构建资源 `/static/`、个人图片 `/assets/` 分离。

`app/server/store.js`：Node 内置 SQLite DatabaseSync、外键、WAL、参数化查询、多对多事务；`PRAGMA user_version=1` 作为迁移版本。高于当前版本拒绝打开；未来迁移追加版本步骤，先备份。表：entries、assets、domains/tags/collections、entry_domains/entry_tags/entry_collections。待整理由领域关联为空推导，不维护易漂移的冗余状态。created/updated/url 和关系检索索引。

`app/server/index.js`：API、图片、来源检查、恢复编排；`backup.js`：一致性快照、清单/校验与备份结构验证；`library.js`：URL 重复比较、最近分类、批量事务；`workspace.js`：浏览偏好与草稿文件校验/原子替换；`lock.js`：CLI 单数据目录实例锁。

前端 `main.tsx`：首页、导航、详情和状态编排；`EntryEditor.tsx`：添加/编辑、重复检查、分类创建、草稿恢复；`RichEditor.tsx`：格式状态、选区链接、本地图片；`SettingsPanel.tsx`：分类、备份、草稿清理及批量分类弹窗；`components.tsx`：封面与模态焦点/滚动；`shared.ts`：类型、API、表单默认值；`style.css`：设计系统与响应式样式。

HTML 为定义的富文本格式：后端 sanitize-html 白名单，清除脚本、事件属性、不安全链接；正文图只允许本地资产引用且验证存在；搜索另存纯文本。详情渲染的 HTML 来自安全清理后的服务器数据，恢复也检查安全与 schema。外链统一 noopener noreferrer。只允许环回 Host、同源 Origin；变更请求必须携带自定义请求头，不开放 CORS；CSP 限制脚本/图片/连接来源。

图片 Multer 内存限额、Sharp 解码校验实际格式/像素，转 WebP，UUID 内部名；附件从 asset 记录查验后提供。拒绝 SVG 和远程正文图。移除引用不自动删文件，备份保留附件全部历史。

备份使用 SQLite 官方 backup API；备份与恢复期间阻止 API/图片读写，JSON 解析及上传解析后再次检查维护门；活动上传未完成时拒绝开始备份。ZIP 含 manifest.json、library.sqlite、attachments/*.webp，V1.1 可选加入 workspace.json；版本、精确路径白名单、无重复路径、数量/体积上限、SHA-256、数据库完整性/FK/精确 schema 与内容验证。草稿也检查 HTML 与资产引用。恢复先完整验证/解码图片、自动生成安全 ZIP，再将数据库/附件/workspace 一起移动到 previous 目录并替换，重新打开。错误时回滚旧文件，旧库与安全 ZIP 保留。兼容没有 workspace 的 V1 ZIP，恢复为默认偏好及空草稿；不能使用旧 V1 应用导入新增了 workspace 的备份。

V1.1 没有数据库结构修改：user_version 仍为 1，既有 entry HTML/字段不被升级任务改写。`data/workspace.json` 自有 version=1，保存 preferences 和最多 50 份草稿、总量 10 MB。格式先完整校验，再写 tmp、同目录 rename 替换；损坏文件拒绝读取而非重置。前端串行草稿请求避免旧写覆盖新写，650ms 防抖，关闭确认后刷入，正式保存成功后清理对应草稿。每个条目 ID / new 一个槽位。删除条目保留草稿，设置可明确清理；草稿不进入 SQLite 搜索。最近分类通过关系表和条目 updated_at 推导。

API：GET /api/meta；GET /api/entries（q/view/domains/tags/collections/sort/page）；GET/PUT/DELETE /api/entries/:id；POST /api/entries；POST/PUT/DELETE /api/taxonomy/:kind[/id]；POST /api/assets（image）；POST /api/backup；POST /api/restore/inspect、/api/restore（backup、confirm）。重复 URL 返回 409 和原条目，allowDuplicate=true 才保留重复。

V1.1 新增 GET /api/duplicate（url/exclude）；GET/PUT /api/preferences；GET /api/drafts（名称/时间/原条目是否存在）；GET/PUT/DELETE /api/drafts/:key；PATCH /api/entries/:id/pin；POST /api/batch（ids、action、kind/taxonomyIds 或 delete confirm）。批量先校验全部 ID，再 BEGIN IMMEDIATE，分类只 INSERT OR IGNORE 追加。UI 只操作当前页，服务端每次最多 100 条；排序使用固定白名单。

运行目录 data 独立于代码。单用户、单服务进程；CLI 在恢复和开库前获取 `.server-lock.json`，V1.2 记录 version=2、PID/token、进程创建时间和可执行路径。Windows 通过隐藏 PowerShell CIM 查询身份，不能只以 PID 存活判断。Linux /proc 身份分支尚未实机验证。已结束或身份确定不符的旧锁改名归档；旧版锁对应明确非 Node 可识别 PID 复用，旧版 Node 锁仍保守拒绝。查询失败、锁损坏/未知版本拒绝。所有新版启动通过 wx `.server-lock-acquire.json` 串行检查/归档/建立锁，finally 释放短期检查锁；若恰好在此阶段崩溃遗留检查锁，保留并提示人工核实，禁止自动强删。正常退出按 token 释放服务锁。createApp 测试工厂不获取锁，仅用于独立库。

V1.2 仍为 schema 1，无数据库迁移。`app/server/ai/{provider,schema,service}.js` 提供固定云端 Provider、JSON Schema/二次校验、资料/分类边界、并发/超时/频率/用量。`AiAssist.tsx` 复用添加/编辑与富文本工具栏，生成候选→人工审核→编辑表单→原有正式保存。整理稿追加保留原 HTML，模型文本转义后构造固定格式。AI 不直接写 entries；仅经过人工确认的候选新标签调用既有分类接口创建。未采用的候选是短期界面状态，已采用表单继承 workspace 草稿持久化。

GET /api/ai/status、POST /api/ai/suggest 同源保护；实际云请求固定 Responses Endpoint、store=false、无工具或自动重试。私有 `ai-usage.json` 保存最近 2000 次状态/Token/估算费用，无密钥/输入，写入前计频率，未知用量明确标注。ZIP 不包含该运行日志/密钥/锁，恢复保留本机日志，数据库 getter 跟随恢复后的连接。详细 Provider 契约、安全边界与后续本地适配规则见 [AI.md](AI.md)。

`recovery.js`：恢复文件移动前写入本地恢复日志；发生异常或下次启动检测到日志时，优先移回原库及 workspace，替换途中产生的数据保存在 interrupted 目录。原库、安全 ZIP 与新库都不会因中断回滚被删除。schema v1 没有改写原有数据的就地重建。
