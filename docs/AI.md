# V1.7.2 配置交互修复

设置→AI服务直接配置。加载/保存的Provider及模型使用同一规范化基线，缺省模型不被误判为用户编辑；真实未提交密钥或Provider/模型修改仍保护关闭。分类、备份、草稿操作不触发AI密钥提示。限额展示来自原服务端status，价格、Provider、DPAPI、同源/session/费用确认与连接测试协议未改。没有自动调用；本轮云端全部模拟。

---
历史记录（当前交付以上述说明为准）：

# V1.7.1 上下文与体验

知识问答/结构优化/整合/关联使用原Provider、DPAPI、Schema、限额、费用确认、取消和人工审核。本轮不更换模型/Endpoint/价格，不增加自动API调用。

阅读页“就此内容询问AI”在当前页打开原助手，初始只选真实当前entries ID；可查看/调整证据与参考费用后手动生成。回答不自动正式保存。综合文档在辅助面板中进入。回收站资料从候选/catalog排除，resolve/apply重新校验并拒绝已回收对象；恢复后可重新使用。正式Key未读取至工具输出或传入模拟测试，实际云未验证。

---
历史说明（以本轮入口为准）：

# V1.7 关联发现

relations模式复用OpenAI/DeepSeek、模型/Endpoint白名单、DPAPI、统一Schema/用量/限频/单并发/超时/取消及错误处理。UI先本地候选预览和领域/专题筛选，中心+用户选中2～10条完整资料，12000字符；不全库扫描上传、不截断。字符/Token/参考输入费粗估，输出另计，明确费用确认才请求。

结构化建议包括两个真实端点、方向type、具体note、evidence逐字摘录及uncertainty。ID限定用户本轮选择，URL标题不等于已读正文，至少两份足量文字，端点之外引用拒绝。来源日期和性质沿用已有resolve，不改原记录。冲突两方都保留，不输出胜者字段；引用/组成不能因语义相似变system。

生成仅内存8份/15分钟；用户修改/部分选择/拒绝共用AiReviewItem，采用再重验正文/版本/实际归属/分类/来源hash，事务写AI候选，仍需确认关系。手工编辑保留原AI origin并明确确认；未采用/取消不写库。全部模型测试虚构Key+模拟transport，未调用真实付费API。

---
历史说明（本轮入口优先）：

# V1.6.1 分类统一与来源

Provider/模型/Endpoint/DPAPI/额度/超时/取消/用量/收费确认保持。schema7结构建议只绕领域树、专题、标签及内容归属，不生成独立知识目录方案；问答保持真实来源与推断标识，新增普通内容导入的来源日期/性质纳入证据。新综合页可指定主要领域，内部AI块继承该页领域，原知识ID/正文/日期/来源保留。

动态专题的AI仍仅发送用户主动选中资料，生成与采用均校验实际规则或人工成员及正文快照；规则改变使已选来源离开专题时拒绝采用。领域合并维护引用/主要领域/规则/常用视图，人工双确认和历史保护不变。旧schema6历史保留但升级使原状态hash不同，拒绝覆盖恢复。所有本轮云验证均注入虚构Key和模拟Provider，未测试真实云或调用付费接口。

---
历史说明（入口以本轮说明为准）：

# V1.6 知识管理助手

新增assistant_qa与assistant_structure，Provider/模型/Endpoint/DPAPI不改，不新增前端Key输入或向量库。知识助手先本地SQLite检索与元数据检查；只在用户调整范围、看到规模与参考费并确认后请求。QA问题≤1000字、10份证据；结构30对象；完整JSON≤12000字符，不截断，超长需人工分批。小时限额/单并发/输出Token/超时/取消共用原服务和用量日志，新增模式正常记账；Token粗估不是实际计费Tokenizer，费用以usage和各Provider独立配置为准。

QA严格Schema：answer(text,basis=evidence|inference,sourceIds)+missing，ID限定所选真来源；标题URL无正文不能用作正文证据。evidence表示有用户资料文字，不代表事实已证实；源status/epistemic/知识date与sourceDates区分，未知日期不能填今天，模型推断不变用户确认。回答只在当前页、不自动保存，点击真实引用站内跳转。

结构Schema：suggestions(object,target,kind,action,name,reason,evidenceIds)。action限定rename/merge/move/associate/create/keep，目标必须是选中真对象或根级/新类空值，影响数由服务端计算而非信任模型。歧义keep；用户可修改/选部分/拒绝→差异预览→确认→事务。模型无DB写权限，服务端在apply再查版本、归属、数据库/workspace与差异hash。潜在破坏性合并第二确认；专题正文/历史/引用保留，草稿冲突等拒绝。拆分用创建新类与后续关联，不自动清旧关系。

跨来源整合复用B协议/审核。多目录/page/点先本地展开，用户再选2～10条；发送原始日期/来源日期与所选正文，六种关系保留不同阶段，原记录不覆盖/删/归档。综合page/point独立review/ai_inference与来源快照，同事务失败全回滚，已有目标页/真实章节快照也重验。相同来源的B缓存仍可复用。

预览最多8/15分钟，未采用/QA不持久化；离开有未保存提示，取消不改正式数据。已保存结构历史在SQL/ZIP，5MB上限，且只允许数据库仍与提交后完全相同时恢复；不覆盖后续用户成果。秘密与用量仍不进ZIP/Git/前端持久化/错误，DPAPI在LOCALAPPDATA按数据目录/provider绑定。本轮所有模型验证均虚构Key模拟，未使用真实Key或付费接口。

---
历史B与Provider配置如下：

# V1.5-B 知识整合补充

新增 mode=integration，Provider统一generate接口/模型/Endpoint/Windows DPAPI不改，价格沿用各自独立现有配置。未做真实付费验证。用户选2～10条知识，先estimate再费用确认；仅送所选标题/简介/正文/来源性质与状态，不上传原始整包、全库或网址内容。

Schema返回 keepIds/order、sections(title/text/sourceIds)、relations(kind/from/to/reason/fromQuote/toQuote)、verification及ready/insufficient。kind区分duplicate/complement/parent/conflict/revision/related。来源限定选中ID，有具体正文才可引用；关系引文逐字验证，不以标题猜事实。生成/采用时复核SHA快照，过期或变化拒绝；manual edit不允许虚构来源。

输入JSON最多12000字符，至少两条正文具备24字证据，否则本地insufficient零调用。超长明确要求用户人工缩小选择/分批，不自动截断或全库两两请求。Token按字符粗估（并非计费Tokenizer），参考输入费按当前Provider价格，输出另计，以实际usage为准。原20次/小时默认、单并发、timeout/abort、output限额不变，integration加入同一secret-free ledger。

本地标准化文字/同名仅召回候选、不直接合并。相同源快照+Provider/模型/配置版本成功方案缓存15分钟最多8份，缓存命中usage=null且界面标识本次无API调用；内存重启丢失，不后台刷新。审核也是独立短期令牌，非正式笔记草稿。

人工采用新章节另建review/ai_inference、原来源文本快照+原ID候选关系；原文/图片/判断不被AI覆盖，related不写强关系。可修改章节、关系类型/理由、阅读顺序或部分拒绝；关系仍为候选，顺序采用仅作用当前page直属章节。API写入要求Origin/session/JSON和明确确认，取消/错误不写正式知识。已采用内容随知识ZIP保留，API Key仍不进浏览器持久化/SQL/ZIP/Git/日志。

---
原Provider与安全配置文档如下：

# AI 使用与实现（历史 V1.5-A 基线）

V1.5-A 双工作流保留原网站内 Provider/DPAPI/限制和小规模人工审核。新增 ChatGPT 人工分析后 JSON 本地导入，详见 IMPORT.md；导入/标题候选不调用 API，不读取聊天历史，不把订阅当 API 额度。来源报告/AI 推断/资料中用户判断与用户明确确认分开；正文修改撤销旧确认。B 的长对话自动拆分、模型关系判断、缓存复用/Token费用估算/可审查分批只记录方案，未实现、未自动运行。本轮真实云端仍未验证，无真实密钥使用或付费调用。

V1.4 仅调整设置入口与增加工具资源，不修改 Provider、DPAPI、Endpoint、请求/用量或人工审核规则。设置 →「AI 配置」，首页状态仍直达该分区；切换分区暂存未提交输入，关闭确认后清空，不持久化浏览器密钥。工具正文沿用安全内容与稳定条目 ID，schema3 工具字段不改变专题 AI 的资料边界或来源校验。本轮所有云端回归均模拟，未读取/使用真实密钥或发付费请求。

## 当前推荐：可视化安全配置

设置 → AI 配置 → DeepSeek / deepseek-flash → 输入Key →「安全保存或替换密钥」→ 确认。可切OpenAI/白名单模型，分别保存；替换/清除确认，输入随后清空，不回显旧Key。网页配置即时生效，无需重启，普通收藏不依赖AI。

credentials.js调用隐藏Windows PowerShell/.NET ProtectedData/CurrentUser DPAPI，经stdin/stdout管道传递，不放argv、子进程环境、日志或临时明文文件。加密负载绑定Provider/数据目录，密文与非敏感配置存 `%LOCALAPPDATA%\PersonalKnowledge\AI\<目录hash>.dpapi.json`，不在项目/data/SQLite/ZIP，原子替换及revision冲突保护。操作前验证旧密文，解密失败不覆盖/删除，测试失败只在内存提示，不能自动重置。[Microsoft DPAPI](https://learn.microsoft.com/en-us/dotnet/standard/security/how-to-use-data-protection)、[用户作用域边界](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/nf-dpapi-cryptprotectdata)。

优先级：已有网页配置时Provider/模型/Endpoint/两家Key由它决定，旧环境Key不使用；首次保存不导入环境密钥，清除保持空值不回退。没有网页配置才使用原环境变量。超时、Token、小时限额与独立价格仍使用已有环境参数。换数据路径需重新配置；其他Windows用户/机器、强制密码重置/用户配置丢失可能无法解密，保留文件核对账号/权限，不能盲删。恢复知识ZIP不覆盖本机凭据/用量。

GET ai/status只返回是否配置、公开模型/限制、最近测试/时间、历史整理成功时间和参考用量，无Key或密文。状态不解密，调用Provider前临时解密；保存/切换/清除前也校验旧密文以保护。JS字符串无法保证立即擦除，Key在提交与调用内存中短暂存在。

PUT ai/config需provider/model/action=keep|replace|clear/revision，替换附key及「保存或替换密钥」，清除附「清除密钥」。POST ai/test需「测试连接可能产生费用」，只请求极短固定JSON、不发收藏，复用generate/Schema/超时/取消/并发/限额/费用。「已配置」不是连接成功，连接成功不是整理质量保证；connection记录计入小时限额。网页配置下测试结果持久化，环境模式结果仅服务会话保留；解密失败结果只内存保留。配置/启动不自动调用。

401认证被拒；DeepSeek402按官方含义余额不足；429仅提示上游限流/核对配额；模型不可用只在明确model_not_found/model_not_available代码时说明；其余上游错误泛化，网络/超时/取消独立，不输出上游正文或Key，不重试/充值。[官方错误码](https://api-docs.deepseek.com/quick_start/error_codes/)。

安全边界：只监听127.0.0.1，loopback Host/实际端口/远端地址与同源Origin校验，拒绝cross-site，不信转发头、不开放CORS。变更需X-PK-Request，凭据/测试/停止额外同源JSON和会话X-PK-Session；GET local/session也需自定义标记，无浏览器持久化。OPTIONS无标记拒绝，防普通CSRF/DNS rebinding；API no-store，敏感及JSON解析错误固定脱敏、不记录请求/Authorization/正文。固定Endpoint/redirect:error保持。

单用户本机应用无法对抗同一Windows账号下恶意程序、管理员或已失陷系统/浏览器，DPAPI与本地token不是这一威胁的权限隔离。应用不写localStorage/sessionStorage/cookie，off/ignore标记不能保证第三方密码扩展不保存，请拒绝浏览器保存输入。非Windows不降级明文，仅兼容环境变量。真实DPAPI已测试；跨账号/整机重启和真实云端权限/质量/账单未验证。

## 已保留 V1.3 能力

成功时间只取新版明确生成ready候选的记录，信息不足不计成功。用量JSON仍version1，旧记录保持不改写；旧日志没记录候选状态，不能据此声称已完成整理，历史费用和次数仍保留。

AI 为可选服务端能力，不配置也能完整使用收藏网站。V1.3 保留 V1.2 OpenAI/DeepSeek Provider 和价格配置，新增专题多资料整理；架构和依赖不变。schema2 仅新增专题正文、历史和草稿，旧收藏/笔记不改写。

## V1.3 专题综合整理

选择3～10条关联资源，手动综合整理。generate 契约不变，mode=collection 专用严格 JSON Schema 返回 status/title/reason/sections/core/related/differences/uncertainties/verification，观点含sourceIds。OpenAI Structured Outputs、DeepSeek JSON模式+动态Schema示例均服务端再验证，禁止额外字段/伪造引用；空/截断/无效内容拒绝，无修补或重试。

只发送所选ID、标题、简介、纯文本笔记、类型和来源主机，不发送全库、图片、专题现有正文、未选记录或URL字段。笔记已有文字链接仍属文字资料。至少两条正文/简介去除URL和空白≥24字符，否则本地信息不足零请求。hasEvidence仅表示用户文字存在，不验证事实；标题之外未知的视频内容不能作为证据，引用枚举限定本轮有文字依据的选中ID。

总输入JSON≤12000字符，超限提示减少资料，不截断；单批3～10条、一次模型请求，沿用并发1/小时20次/超时/输出Token预算，mode=collection与旧模式共用限额和各Provider独立单价。默认2048输出Token，不完整结果明确拒绝，可减少资料或在既有范围内调预算，不新增付费服务。

AI草稿在 collection_drafts/ai 独立持久化，可编辑标题/文字、拒绝或追加/确认替换；最终保存前不改正式总结，事务保留上一版。来源快照含真实URL/标题/时间/SHA256，生成完成和采用时验证仍关联、内容和总结版本一致，变化则拒绝并保留原总结/草稿。来源标记经转义成受控 data-entry-id 链接，后端验证；原图/HTML由现有清理和Tiptap保护。删除原收藏后站内提示不存在，历史原网址仍可追溯。

专题手工/AI草稿与workspace隔离，进入ZIP；密钥/用量/锁不进ZIP。模型HTML只作文字，人工须核对事实与来源是否支持观点，ID有效不代表内容正确。本轮请求全部模拟，真实云端账号/中文质量/账单/网络未验证。

## 使用与人工审核

添加/编辑条目使用「AI 帮我整理」，正文工具栏使用「AI 整理笔记」。本次标题、简介、纯文本正文，以及每种最多 40 个现有分类的名称/ID 发送到云端。已选分类优先，其余按名称排序；不会发送其他收藏正文、数据库、附件或收藏网址字段。正文中的文字链接仍是文字资料。网站不访问、抓取链接，不能仅按网址猜测视频或文章。

正文/具体简介去掉网址和空白后不足 24 个字符时，本地返回信息不足，零 API 调用。标题不单独作为足够的正文依据。AI 仍可返回 insufficient；该状态清空候选并显示原因。

推荐标题、摘要和新标签名称可修改，各字段和现有分类可单独选择。拒绝不改变表单和正式条目；接受只更新编辑表单，点击「保存条目」才写正式记录。新标签默认不选，创建时再次确认；已经确认创建的标签是持久化分类，即使之后取消条目也保留。网络中途失败可能留下部分已确认创建的标签，重试复用同名分类。候选只推荐已有领域/专题，新建仍使用原有人工入口。

笔记整理稿先以可编辑纯文本预览。采用时将原 HTML 完整保留在前，追加「AI 整理稿（原文保留）」和经过转义的段落/标题；原图片、链接、格式均保留。模型 HTML 只显示为文字，不作为 HTML 执行。原文不是另一个数据库版本，而是同一笔记内保留的完整原段。用户保存前应核对事实、数值与不确定性。保存前的已采用表单使用原有本地草稿恢复；尚未采用的候选不持久化。生成后若编辑内容变化，禁止采用旧建议，须重新生成。

## 兼容环境配置（仅无网页保存配置时使用）

默认仍是 OpenAI Responses，固定 Endpoint `https://api.openai.com/v1/responses`，快照 `gpt-4.1-mini-2025-04-14`（可选 `gpt-4.1-mini`）。现有 Structured Outputs 和参考输入/缓存/输出单价 $0.40/$0.10/$1.60 每百万 Token 保留。[官方模型与价格](https://developers.openai.com/api/docs/models/gpt-4.1-mini)、[结构化输出](https://developers.openai.com/api/docs/guides/structured-outputs)。

`PK_AI_PROVIDER=deepseek` 选择 DeepSeek Chat Completions；固定 Endpoint `https://api.deepseek.com/chat/completions`，默认/本轮唯一允许模型 `deepseek-flash`，可通过 `PK_AI_MODEL` 显式指定。2026-10-13 核对官方文档，该名称指向 DeepSeek-V4.1-Flash；采用 `response_format:{type:json_object}`、`thinking:{type:disabled}`、`stream:false`、`max_tokens`。禁用思考以适配轻量整理和现有预算，不调用工具或其他 API。[官方接口](https://api-docs.deepseek.com/api/create-chat-completion/)、[JSON 模式](https://api-docs.deepseek.com/guides/json_mode/)、[模型和价格](https://api-docs.deepseek.com/quick_start/pricing/)。

DeepSeek JSON 模式不等同 OpenAI Structured Outputs。系统消息含 json 字样、完整示例及动态 JSON Schema，用户资料单独放在 user 消息。提示 Schema 不意味着上游强制 Schema，最终仍执行原有服务端结构/ID/长度校验。只接受一条 assistant choice、finish_reason=stop、非空完整 JSON；空内容、length 截断（即使 JSON 可解析）、工具响应、代码围栏/不完整 JSON/多余字段拒绝采用，不自动修补或重试。空白 keep-alive 行由 JSON 解析器正常处理。错误固定提示，不暴露上游消息/密钥。

本轮不读取用户独立密钥，不调用实际付费 API；真实账户权限、整理效果和收费未验证。

服务端启动环境变量：

| 变量 | 默认与范围 |
|---|---|
| OPENAI_API_KEY | 无网页配置且选择openai时使用，缺失仅禁用AI |
| DEEPSEEK_API_KEY | 选择 deepseek 时仅使用此密钥，不借用 OpenAI 密钥 |
| PK_AI_PROVIDER | 默认 openai，允许 openai / deepseek |
| PK_AI_MODEL | 按 Provider 默认；OpenAI 允许上述两个值，DeepSeek 允许 deepseek-flash |
| PK_AI_ENDPOINT | 按 Provider 默认；仅允许其完整固定 HTTPS 地址，拒绝交叉 Endpoint、任意地址、参数、用户信息或片段 |
| PK_AI_TIMEOUT_MS | 30000，1000–60000 |
| PK_AI_MAX_OUTPUT_TOKENS | 2048，512–4096 |
| PK_AI_MAX_CALLS_PER_HOUR | 20，1–100 |

先在原启动窗口 Ctrl+C 正常停止，再在项目 PowerShell 终端输入密钥（不回显、不把实际密钥写进命令历史或项目文件）：

```powershell
$env:PK_AI_PROVIDER = 'openai'
Remove-Item Env:PK_AI_MODEL -ErrorAction SilentlyContinue
Remove-Item Env:PK_AI_ENDPOINT -ErrorAction SilentlyContinue
$aiSecret = Read-Host 'OpenAI API Key' -AsSecureString
try {
  $env:OPENAI_API_KEY = [System.Net.NetworkCredential]::new('', $aiSecret).Password
  npm.cmd start
} finally {
  Remove-Item Env:OPENAI_API_KEY -ErrorAction SilentlyContinue
  Remove-Variable aiSecret -ErrorAction SilentlyContinue
}
```

DeepSeek 配置示例（按提示在本机安全输入，不把真实密钥写进脚本文件）：

```powershell
$env:PK_AI_PROVIDER = 'deepseek'
$env:PK_AI_MODEL = 'deepseek-flash'
Remove-Item Env:PK_AI_ENDPOINT -ErrorAction SilentlyContinue # 使用所选 Provider 默认地址
$aiSecret = Read-Host 'DeepSeek API Key' -AsSecureString
try {
  $env:DEEPSEEK_API_KEY = [System.Net.NetworkCredential]::new('', $aiSecret).Password
  npm.cmd start
} finally {
  Remove-Item Env:DEEPSEEK_API_KEY -ErrorAction SilentlyContinue
  Remove-Variable aiSecret -ErrorAction SilentlyContinue
}
```

切回 OpenAI：正常停止服务，设置 `PK_AI_PROVIDER=openai`，清除 `PK_AI_MODEL` / `PK_AI_ENDPOINT` 使用 OpenAI 默认值，再按前例安全输入 OpenAI 密钥启动。选择一种 Provider 不会发送另一种密钥；切 Provider 却保留另一种模型/Endpoint 会明确报配置错误，不静默回退。会话环境变量不会自动传给从别处双击的启动窗口。

构建已完成时可直接 start；首次安装按 README。密钥存在服务进程内存与环境，不写 data、日志、前端构建、备份或 Git。不要使用 VITE_* 配置密钥。改变环境变量需要重启后端。配置密钥不会自动调用；仅用户按生成按钮才请求，此时可能产生 API 费用。不要把实际密钥贴到聊天、截图或测试文件。

## 接口、结构与错误

`provider.js` 提供 Provider 白名单、AiError、共享指令、OpenAI Token/费用和 OpenAIProvider；`deepseek.js` 提供 DeepSeekProvider 和独立 Token/费用。两者均为 `generate({ input, schema, signal }) -> { value, usage }`，service 按配置选择。资料边界、并发/频率/超时、Schema/ID 复核、用量记录及正式记录隔离不变。`schema.js` 不变。

GET `/api/ai/status` 返回配置可用性、公开模型/限制和汇总用量，永不返回密钥。POST `/api/ai/suggest` 输入 `{ mode: bookmark|note, form }`，输出 `{ suggestion, usage, usageWarning? }`。继承原有同源与变更请求头保护。suggestion 包含 status/title/summary/reason/domains/tags/collections/newTags/points/sections。字段类型、长度、数组数量、required、additionalProperties=false 全部检查；分类 enum 来源于本次真实数据库 ID，再复核 membership。没有分类时 schema 使用不可采用的占位枚举，服务端仍只允许空推荐集合。取消/超时会 Abort，UI 丢弃已过期请求，服务端客户端断开也取消。

API 不启用 tools、网页访问、文件操作或重试；资料与分类名称置于 user 数据区，系统指令明确其不可信。防注入不依赖模型听话：没有工具权限，返回值经过验证，候选不自动写记录，生成正文只经文字转义和原有 HTML 白名单保存。OpenAI 使用 Responses `store:false`，DeepSeek 使用单轮 Chat Completions，不等于供应商没有服务日志；按所选供应商的数据政策使用。

AI 错误使用固定消息/code，不输出上游正文或请求/密钥。busy 409、rate 429、缺配置/错误配置 503、timeout 504，其他 AI 错误 400；不会影响普通 CRUD。失效用量文件只禁用 AI，不重置文件或手动数据。

## 成本与持久化

同时最多 1 次生成，单批次上限 1（V1.2 未实现可选批量 AI）。总输入上限 12000 字符；超过明确拒绝，不静默截断事实。HTML 输入本地上限 1MB，标题 200、简介 2000；每种分类最多 40。输出预算默认 2048 Token，响应体最多 128KB；没有后台无限调用或重试。

调用前在 `data/ai-usage.json` 原子记录 pending，结束记录状态和供应商返回的 Token/估算 USD，最多最近 2000 次。记录不含正文、网址、分类或密钥；每小时上限跨后端重启仍有效。费用以参考单价估算，不是账单；错误、取消或没有有效 usage 时标记未知，不能当成零费用。已发出的请求取消并不保证供应商零收费。ZIP 使用白名单，不包含用量文件、密钥或锁；恢复只恢复知识内容和草稿/偏好，不重置现有用量记录。

DeepSeek 用量由 `prompt_tokens`、`completion_tokens`、`prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 映射到统一字段，兼容 `prompt_tokens_details.cached_tokens`。缺缓存细节按全 miss 保守估算；无效/矛盾 Token 数标记未知。不保存 reasoning_content。旧 OpenAI version=1 用量日志原样保留，可追加两种 Provider 记录；小时次数跨 Provider 共用，汇总包括两家历史记录，已保存估算不随之后改价重算。

独立 DeepSeek 参考价（美元 / 百万 Token）默认采用官方高峰价，不依据本机时间猜测节假日或自动切低峰价：

| 变量 | 默认 | 说明 |
|---|---|---|
| PK_AI_DEEPSEEK_INPUT_USD_PER_MILLION | 0.30 | 缓存未命中输入 |
| PK_AI_DEEPSEEK_CACHED_USD_PER_MILLION | 0.006 | 缓存命中输入 |
| PK_AI_DEEPSEEK_OUTPUT_USD_PER_MILLION | 1.20 | 输出 |

接受有限数字 0–1000，无效配置只禁用 AI。官方低峰参考价分别为 0.15/0.003/0.60；若明确适用，可覆盖上述环境变量并重启。默认估算可能高于实际低峰账单，价格可能调整，以供应商账单为准。OpenAI 不受这些变量影响，DeepSeek 不复用 OpenAI 单价。[官方单价与时段规则](https://api-docs.deepseek.com/quick_start/pricing/)

## 测试与扩展边界

`tests/ai.test.js`、`tests/deepseek.test.js`、`tests/browser-ai.js` 使用临时库和模拟 transport，走真实服务端/Schema/UI/持久化，不在公开 API 提供 mock 开关，不调用外网付费 API。`test:browser:ai` 测 OpenAI，`test:browser:deepseek` 用同一场景测 DeepSeek。测试结果见 TESTING。真实 API、账户权限、中文效果/收费和 Ollama 兼容性未验证。

未来本地模型需独立Endpoint/密钥规则，不能放开任意地址；新模型、批量等须另行授权并验证费用。本轮停在V1.3.1，不执行V1.4。
