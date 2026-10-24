# V1.8 轻量粘贴路径（JSON v1/v2继续保留）

＋新建→粘贴文字/Markdown→选择普通笔记/综合文档→本地预览→修改标题/选择条目及已有分类→核对重复→确认收纳。Markdown只按明确标题拆章节，纯文本不猜多条知识。根文档与章节parent明确，缺父级整批拒绝，不能因同领域猜从属。

解析为安全Tiptap子集，不调用AI、不读取ChatGPT私人历史。原始粘贴全文在source excerpt与内部JSON v2快照保留；用户可通过原来源/导入原包查看。ChatGPT来源是用户说明，AI推断/待验证不自动确认，原日期作者未知不推断。复杂表格/嵌套列表等降为文字，不声称Markdown全语法渲染。

标题/正文片段重复仅候选，可新标签页查看已有、返回修改或明确另存。修改标题后保存前重检，服务端提交再验；同包重复仍需明确另存，不覆盖原记录。原始100000字/256KiB、内部包512KiB、100项/8层、预览8份/15分钟，超限拒绝不截断。详见DESIGN_V1_8。下面旧JSON协议与技能继续有效。

---

历史记录（当前交付以上述版本为准）：

# V1.7 关系扩展（继续JSON v2）

v1机器Schema不变。v2 relations.kind保留duplicate/complement/conflict/revision/parent，并兼容新增reference/dependency/composition/related；from/to限定包内local ID。全部导入语义关联仍candidate/origin=import，需逐项核对，不能在包中声明confirmed或伪装system。保留原包、来源、日期、条目/章节UUID、旧协议hash与人工创建选择。

composition关系声明不自动收纳章节；真正章节仍需要items.parent并经层级审核，确定性组成来自实际父级。相同关系或循环会拒绝整批并回滚，引用/依赖目标必须实际存在。未选端点不写入该关系，但原包完整保留；不会根据相似性推断引用或判断冲突正确性。

---
历史说明（本轮入口优先）：

# V1.6.1 统一导入（v2与明确v1兼容路径）

当前主入口为知识库→统一导入；新格式及操作见[CHATGPT_IMPORT_V2.md](CHATGPT_IMPORT_V2.md)、[Schema](knowledge-exchange-v2.schema.json)、[成功样例](examples/content-v2-success.json)、[失败样例](examples/content-v2-invalid.json)及[导入技能](skills/knowledge-import-v2/SKILL.md)。旧v1机器Schema与下方历史说明保留；历史文中的“version2不支持”仅指旧入口，不是当前统一入口。

v2 content_type显式note/bookmark/tool/document/block/unspecified；items平面ID配parent确定章节树，预览按树展示而不是按同领域猜归属。可编辑类型/正文/网址/类别/主领域/章节父级，保留原包与来源。新标签/领域/专题逐项人工批准；未选关联两端不写入，原始关系仍留原包。

兼容转换需勾选：v1 page为综合文档，有完整page父级链的point为内部块，其余point/capture为独立笔记；目录成为可拒绝的领域建议。Markdown/纯文本保留整个原始记录。旧文件及其hash/raw仍可追溯，不自动重新导入真实库。

重复文件检测要求明确另存，重复网址另存另需勾选；不覆盖旧内容、删除重复或自动确认判断。部分审核事务提交失败无孤立关系。URL仅用户来源，未抓取验证。容量512KiB/100内容/100来源/100领域/200关系，正文/摘录100000字、8层；父级缺失/循环、危险HTML/外部图片、日期/引文/未知字段拒绝。

---
历史说明（入口以本轮说明为准）：

# V1.6 补充（交换协议仍v1）

知识交换JSON/机器Schema/来源日期与ChatGPT导出提示词不改，导入仍本地解析/人工审核/事务新增。知识助手回答不会自动导入为已确认知识；复杂ChatGPT整理由用户按下方v1格式导入。已有AI推断/待验证素材在QA中明确性质，不把来源日期或整理日期当知识首次形成日期。跨目录整合复用原稳定ID、来源和阶段日期，并保留原文；结构优化不重新导入或清空真实库。

---

# ChatGPT 知识交换与双 AI 工作流（V1.5-B，兼容 v1）

网站内 DeepSeek/OpenAI API 用于手动分类、摘要和小规模专题整合，安全配置和限制继续见 AI.md。复杂对话由用户在 ChatGPT 中分析，再按本格式导入；ChatGPT 订阅与 API 计费分开，网站不读取私人聊天历史。B 追加人工审核章节结构与选中资料整合，不自动拆分长文本或扫描全库。

## B 的页面层级审核

交换Schema仍为v1，不增加必填字段。page是阅读页，point是章节；items.parent显式指向page或另一章节，必须最终到达page、最多8层且无环。预览显示保存后的层级，逐条“页面/上级章节”可修改或拒绝归属。所选父级必须也选中，缺失/循环/错误类型时整批拒绝，不留下半份知识。旧文件无page根的parent仅保留关系建议，默认独立，不按同目录自动推定归属。

已导入资料不重导：打开混合页→整理模式→收纳已有知识点→核对选择→收纳。原包有显式parent时可核对后采用收纳建议；既有候选parent不自动生效。原IDs/正文/来源/日期保留，原普通资源引用不等于章节。

建议交给ChatGPT时明确“生成一个kind=page概览，其余kind=point使用parent指向该page或真实上级章节；不要仅用相同directory表达归属；不同观点和修正保留独立，不虚构时间”。其他Schema/原文/来源/人工确认规则不变。

## 使用

网站 →「知识目录」或「快速收集箱」→「导入知识」。可下载示例模板和 Schema，粘贴 JSON 或选择 .json 文件，点击本地解析，逐条编辑/勾选，再确认新增。可以拒绝任意条目；已知领域/标签/专题可取消选择，未知分类和目录默认不创建，创建父/子目录需分别确认。目录归属可选择已有目录或拒绝归属。关系默认不保留，选中后仍只是候选，不合并、不删旧记录。

同名不是同一知识。相近标题仅产生本地候选，用户勾选后才记录疑似重复关系；相同规范化包哈希提示重复，需勾选明确另存所选知识，适用于补导上次未选部分，仍可能重复。成功后可在知识列表、目录中阅读，查看来源原文、原始日期、用户提供记录时间与本机导入时间。无来源引用的条目也保留到原始包的独立映射，可打开完整导入原文。

Markdown/.md 与纯文本/.txt 不猜测多条结构化知识、标题层级或日期：整个原文保存为一条收集记录，正文按文本转义，原文件文字保留。单条人工资料最多 100000 字；过长明确拒绝，不截断。用户可改标题/状态/目录再保存。

记录分原始收集、独立知识点、混合页面；混合页富文本可引用已有网址/工具/笔记/知识，复用条目 ID。可手动上下移动目录及知识、调整优先级和状态。只有用户明确选择并确认才标为人工确认；正文或标题修改撤销旧确认，重新核对后再确认。原始来源快照独立留存，导入不覆盖旧知识，人工编辑正文不等于自动改写源资料。

## 标准文件与语义

- 机器 Schema：[knowledge-exchange.schema.json](knowledge-exchange.schema.json)，JSON Schema draft 2020-12，服务器实施同等结构检查并增加引用/日期/树/HTML语义校验。
- 成功样例：[knowledge-success.json](examples/knowledge-success.json)，完全合成资料，替换后使用。
- 失败样例：[knowledge-invalid.json](examples/knowledge-invalid.json)，version=2，不受支持；自动测试必须拒绝。
- `format=personal-knowledge-exchange`、整数 `version=1`；必填 sources/items，directories/relations 可省略。未知字段拒绝，local id 仅字母/数字/下划线/横线，1～80字且各数组内唯一。
- sources：id、kind(chatgpt/report/inspiration/website/other)、title、excerpt；可选 url、original_date、recorded_at、date_note。网址仅 HTTP/HTTPS、不含凭据；表示用户提供，不表示已访问验证。引用 quote 非空时必须逐字存在于对应 excerpt。
- items：id、title、body；可选 body_format（默认 plain）、kind（默认 point）、epistemic（默认 ai_inference）、status（默认 review）、priority（0～3）、original_date、recorded_at、date_note、questions、domains/tags/collections（建议名称）、directory（本包目录 ID）、parent（本包知识 ID）、references（source_id/quote）。
- reported_fact 是来源报告的事实，不是系统验证；ai_inference 是 AI 推断；user_judgment 是资料中声称的用户判断，导入后仍未确认。JSON 不允许 status=confirmed，审核界面可由用户明确选择确认状态。
- original_date 仅实际可证实的 YYYY-MM-DD；未知 null/省略。recorded_at 是资料提供的记录时间，须带时区 ISO 时间；未知 null/省略，数据库另存本地 created_at/recorded_at。不能把本次整理/导入日期当成首次形成日期。
- directories：id/name/parent，最多8层，缺父/循环拒绝。relations：from/to/kind(duplicate/complement/conflict/revision/parent)/note，两端限定本包知识。跨阶段修正保留为不同条目及候选关系，不强制合并。跨专题归属复用原多对多关系；混合页还可由用户关联已有站内资源。
- HTML 只作受控基本文本格式；脚本、事件属性、iframe/对象、危险协议及图片拒绝导入。建议 ChatGPT 输出 plain；正文图片之后使用本地 Tiptap 上传，不导入远程图片链接。原始包在来源预览中只按文本显示。

限制：原始包 ≤512 KiB，知识≤100、来源≤100、目录≤100、关系≤200，每正文/摘录≤100000字、JSON嵌套≤8层；超限明确拒绝。所有新增记录、明确创建的分类/目录、来源映射与关系同一事务；失败不留半批或孤立关联。预览15分钟，重启后失效，需重新解析；成功令牌不可重放。未采用的预览不落正式库，取消不创建来源。

原始导入包包含本次用户提交的全部原文，作为本地快照随 ZIP 保存；仅部分条目落正式列表。不要把密钥、密码或不希望保留的资料粘贴到包中。导入不发送模型或访问来源网站。

## 可直接交给 ChatGPT 的导出提示词

先把本项目 Schema 和需要整理的资料提供给 ChatGPT，再粘贴下面提示词。不要让模型声称看过未提供的网页/视频或私人历史。

```text
请仅根据当前对话中我主动提供的资料，生成符合附带 personal-knowledge-exchange v1 JSON Schema 的知识包。只输出一个完整 JSON 对象，不要代码围栏或额外文字。

提取独立知识点，减少机械重复，但不同阶段的修正、互补观点和真正冲突必须保留成不同条目。不要仅凭同名判定重复，不要把没有证据的不同表述判成冲突。关系只作候选，分别使用 duplicate/complement/conflict/revision/parent，说明依据及待验证事项。

sources 保存可追溯的原始摘录，id 在包内稳定唯一，类型仅 chatgpt/report/inspiration/website/other。items 的 references.source_id 必须来自 sources；quote 有文字时必须逐字包含在对应 excerpt。缺少可核对来源时 sources/references 可为空，不能虚构网址、出处、作者或视频内容。

区分来源报告 reported_fact、AI 推断 ai_inference、资料中的用户判断 user_judgment；这些标注都不代表网站已经验证。status 使用 review/inbox/draft/archived，不能使用 confirmed 或伪造人工确认。body_format 使用 plain，不输出 HTML 或图片。

每条 title/body 独立可读，保留重要事实、判断、数字及局限，questions 列待验证问题。建议 domains/tags/collections 名称、priority 0～3，必要时给 directories 及其 parent 与 items.directory，目录不超过8层；不要强制创建所有目录或字段。

original_date 只填资料能证实的观点/原文实际日期；recorded_at 仅填可证实的资料记录时间且带时区。两者未知则 null 或省略，date_note 说明未知。若我要求保存某日认知变化，不要把今天的整理日期当成认知首次形成日期。保持不同阶段的原文与修正轨迹。

包大小不超过512 KiB，最多100条、100来源、100目录、200关系，每正文/摘录最多100000字。若资料超限，请先说明需要由我审查的分批方案，不静默截断或省略重要证据。分批时引用限定各自包内来源，避免无法验证的跨包 ID。

输出前逐项核对 Schema、唯一 ID、所有引用、日期、关系类型与长度。不要抓取网址，不要调用未授权接口，不要读取我未提供的完整聊天记录。
```

## 本地 API 与未来客户端

exchange.js 纯解析/校验、importer.js 审核事务独立于 React，未来可复用；当前没有 MCP/插件/公开接口。GET knowledge/schema/template，POST knowledge/import/preview/commit/cancel/source。写入与原文读取使用当前本机同源 Origin、X-PK-Request、短期 X-PK-Session；commit 必须携带当前预览令牌、所选审核项、创建选择与明确确认。恢复重新校验 token 对应 ID/重复包，数据库不暴露、前端无长期管理密钥。

这些措施防浏览器跨站/重绑定和无会话调用，不是 Windows 进程身份认证；同一账号下恶意本地进程可能伪造 HTTP 头或窃取会话。未来外部客户端需另行授权与审批方案，不能据此开放任意进程、公网或绕过审核。当前只支持本地单用户可信系统，保留既有安全边界。

独立验证：`node --test tests/knowledge.test.js`、`npm.cmd run test:browser:v15`，使用合成资料/临时库。未来 B 可先本地标准化/关键词召回，再由用户选择候选做单次模型判定，并缓存内容快照；费用/Token预估、可审查分批需独立验收，本轮不声称已实现。
