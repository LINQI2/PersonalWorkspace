# V1.0 个人工作空间验证 / 2026-10-24

本机 Windows、Node 24.21.0、真实 Microsoft Edge（Playwright channel=msedge）。除正式数据迁移与只读核对以外，破坏性操作均在独立临时目录 / 数据副本上完成。

| 检查 | 实际结果 |
| --- | --- |
| `npm run build` / `npm run typecheck` | 通过（tsc noEmit + Vite；任务模块 24 KB CSS 已作用域化，主 chunk 522 KB 属既有体积告警） |
| `npm test` | 95/95：知识库原 92 项全部通过；新增 3 项覆盖任务安全边界/CRUD/层级/循环/撤销/重启持久化、旧任务 JSON 严格校验（未知状态/孤儿/超长备注拒绝）、统一备份恢复/损坏回滚/旧格式导入 |
| 任务台 Edge 实测 | 右键菜单（新增同级/子任务、改状态、重命名、折叠、删除）、状态子菜单、双击改名、备注 500ms 保存与"已保存"、搜索过滤、拖拽排序/改父级（含自动展开、拒绝后代循环）、30 步撤销、刷新后 `#tasks` 保持 25 条 |
| 模块切换 | 任务搜索/选中保留；知识库搜索词、筛选与滚动位置（163px）切回后恢复；快速记录未保存时切任务台弹出确认并停留在原页；知识编辑器关闭有草稿确认 |
| 知识回归 | 列表/领域/专题/筛选、内容预览、完整阅读、思维导图编辑器、旧锚点 `#content-*`、附件 `/assets/*.webp` 200 |
| 统一备份/恢复 | 界面导出 ZIP；界面校验显示"知识 21 条 · 任务 25 条"；加入第 26 条任务后经界面恢复，自动重载回到 25 条；损坏 ZIP 400 且任务数不变；旧知识库 ZIP 恢复 17 条内容时任务仍 25；旧任务 JSON 导入后知识领域保留 |
| 恢复内部 | `before-restore-workspace-*.zip` 与 `previous-workspace-*` 生成；任务/知识数量与指纹复核；失败路径回滚 |
| 启动链 | `scripts/launcher.js` 按需构建→后台启动→元数据 25 条；重复启动复用；`--stop` 正常停止、端口释放、锁删除 |
| 正式迁移 | 只读 `VACUUM INTO` 知识库（SHA 与迁移前备份一致）+ 运行中任务 API 25 条；知识 21/2/2/26/1，任务 25/3/24+1/层级 4，指纹一致；原项目未改 |
| 响应式 | 1920×1080、1366×768、390×844：`scrollWidth-innerWidth=0`；390px 可展开侧栏切换模块，任务详情可关闭、工具条可用 |
| 安全 | 无 `X-PK-Request` 的 POST 403、跨站 Origin 403、非法状态/循环/孤儿/超长输入 400、未知 API 404；维护门期间拒绝写入 |
| 浏览器数据/凭据 | 旧 `:3000` localStorage 与 DPAPI 凭据未迁移、未读取；未调用真实付费 AI；无 Key 时手工功能正常 |

未验证：Windows 整机重启/断电、磁盘满、超大任务量压力、真实云端 AI 质量与费用。以上不视为通过。

---

# V1.9 验证 / 2026-10-15

本机Windows、Node24、真实Microsoft Edge（Playwright channel=msedge无头）；测试写入仅系统临时目录。所有AI为虚构Key+注入transport，网络拦截外站；未读取或调用真实Key。

| 检查 | 实际结果 |
| --- | --- |
| npm run build / typecheck | TypeScript/Vite生产构建通过；mind-elixir独立chunk，无>500KB块警告 |
| npm test | 92/92，旧87加导图5：安全字段/深度/数量/连线/自引/未知目标、CRUD/分类与主要领域/CAS和外部分类冲突、标题/节点检索、稳定知识链接/目标改名回收、历史/重开、故障事务回滚、损坏启动/ZIP拒绝、schema10→11失败回滚与旧ZIP向前恢复、同源/session、实际ZIP恢复API；原AI/批注/引用/导入/DPAPI/锁全部回归 |
| test:browser:v19 | 1920×1080、1366×768、390×844：新建入口及中心输入、Tab/Enter/F2、复制分支撤销、空节点文字失焦还原、画布/大纲折叠、主题、层级循环拒绝/移动/撤销重做、真实拖动换父级与重开、跨分支线/说明/分支删除及撤销、知识链接/跳转/返回、快速自动保存、模拟500恢复、双窗口冲突保留稿、实际PNG/SVG/JSON/MD下载、SVG文字转义和无脚本执行及JSON新图预览导入、节点全站检索、三尺寸截图；0pageerror |
| test:browser:v18 / v173 | 旧四类型预览/阅读、三滚动区域、划词/批注/引用/精确定位/知识关联、模拟AI取消错误保留、Markdown/纯文本/重复审核；快速草稿刷新恢复/多窗口/后退与筛选上下文 |
| test:browser:v161 / v17 | JSON v2四内容及9章节、分类/动态专题/来源日期/搜索，七类关系正反/AI候选人工审核/保护与一二层局部地图；旧v1由自动测试覆盖 |
| test:browser:settings / ai / deepseek | 虚构Key真实CurrentUser DPAPI保存重载/替换清除/模拟401/确认费用、无Key普通功能；两模拟Provider笔记/收藏审核、原富文本图片、安全HTML、错误超时取消/无Key |
| test:startup | 真Windows隔离后台.bat启停、重复启动同PID复用、直接第二服务拒绝、异常测试进程恢复、旧内容及虚构DPAPI保留、正常清锁、缺Node；不等于Windows整机重启 |
| 正式保护/迁移 | schema10开工备份完整校验并实际恢复到独立schema11；正式仅正常迁移/备份/只读检查，34旧表/17内容和4文件SHA不变，新增mindmaps/mindmap_versions为空；36表 |
| 交付ZIP | delivery-v19-67dcf2b1-28dd-4f6d-8c6f-3a2091d186d5.zip完整校验与生产恢复API在隔离目录恢复、旧34表/workspace/附件逐项比对通过；用量不进ZIP但正式文件未改 |

新增脚本tests/browser-v19.js、tests/mindmap.test.js。截图见docs/design/v1.9/screens及DESIGN_V1_9中的逐图索引，均为合成数据且实际打开查看。窄屏可收起覆盖面板恢复整幅画布，主要编辑面向桌面。PNG为实际下载并解码核验图像尺寸，SVG包含真实节点文字，JSON保留arrows，Markdown明确有损。

调查中修复：原库SVG文本转换line-height/innerHTML问题用安全文字适配修复并实际打开PNG复核；恢复原已保存内容时同步保存状态；宿主与库内部canvas同名导致背景/高度冲突，已隔离class并恢复受限宿主定位；全局nav按钮100%宽度导致导图工具栏竖排；显式新节点参数需主动进入编辑；库删除分支未清理arrows需包装处理；折叠节点的findEle会抛错，装饰时只查实际DOM；恢复副本绑定分类指纹，不能以相同修订覆盖外部分类修改。旧迁移最终版本更新至11但故障原版本断言保留；V18滚动测试等待原有80ms定位+平滑滚动结束后再测试面板不影响正文，未修改阅读器或放松滚动断言。

未验证：真实付费AI/云质量、用户本人验收、Windows整机重启/断电/磁盘满、干净机器首次安装、数万节点或所有辅助技术。部分更早的历史浏览器脚本未逐一运行，其业务由现行矩阵及92自动测试覆盖，不宣称全历史脚本都跑过。DeepSeek旧超时仍疑似上游异常待复测。

---

历史记录（当前版本以上述说明为准）：

# V1.8 验证 / 2026-10-15

全部写入/删除/故障/恢复测试为独立临时目录；真实本机Windows Edge通过Playwright msedge无头执行，实际打开检查截图。AI只有虚构Key+注入模拟transport，未调用真实付费接口。正式库只做备份、顺序升级与非破坏性核验。

| 检查 | 实际结果 |
| --- | --- |
| npm run build / typecheck | TypeScript、Vite生产构建通过；无新依赖 |
| npm test | 87/87（旧82+reading5）：前插/原文修改删除/历史还原/重复位置拒绝、章节稳定ID、批注CAS/软删、引用新旧内容/历史/过期与故障事务回滚、重复标题修改重检、HTML安全/来源日期/纯文本层级、同源/session、schema9→10故障回滚/旧ZIP向前恢复/损坏拒绝；旧全部业务回归 |
| test:browser:v18 | 1920×1080、1366×768、390×844：独立左右开合/同时显示、三滚动区域、固定栏/章节；划词/Escape、个人批注新增编辑删除定位；引用到已有/新笔记、反向引用/摘录依据、原文精确高亮、复制稳定#quote链接新页面定位/上一内容返回；手工关系、选区AI零自动调用/模拟503保留/取消保留/模拟回答和引用；Markdown结构/来源快照、重复禁存/明确另存实际增加3条、纯文本保存1条普通笔记；四类型预览路径 |
| test:browser:v173 | 旧快速草稿立即刷新/共享输入/成功清除/多窗口冲突与保存500保留；编辑后退拒绝/放弃、延迟请求不复活、原筛选/第2页/新领域意图；独立面板与紧凑整理 |
| test:browser:v172 / v171 | Pin/排序/同步、直接组合筛选、独立设置dirty/真实未存Key保护、领域树操作、嵌套弹层坐标/Escape/窄屏；原位编辑/历史/回收恢复、稳定章节刷新 |
| test:browser:v161 / v17 | JSON v2四类型/9章节、分类/专题手工成员/动态规则/工具/来源/日期/搜索；旧JSON v1由自动测试覆盖；正反关系/候选审核/防删除、一二层地图/键盘/列表/章节跳转 |
| test:browser:ai / deepseek / v13 | 两模拟Provider收藏与笔记审核/图片保护/错误超时取消/无Key普通功能；专题草稿/追加替换/历史/分享文本本地解析 |
| test:browser:settings | CurrentUser DPAPI虚构Key保存重载/替换清除/Provider/401/费用确认、无明文入DB/ZIP/浏览器、安全停止UI |
| test:startup | 本机Windows隔离.bat后台启停/同PID复用/重复拒绝/异常退出恢复/旧数据与虚构DPAPI保留/正常停止清锁/缺Node；启动器显式新增1.8身份版本，PID复用等继续由自动测试覆盖 |
| 升级前可恢复证明 | 正式schema9保护ZIP完整校验，实际POST restore到独立schema10，旧33表、workspace和附件哈希一致，新reading_marks为空 |
| 正式交付核验 | 原启动器正常升级1.8.0/schema10，34表/17内容，33旧表及workspace/用量/两附件共4文件SHA不变；新reading_marks=0。pre-schema-10-f06ebf85-96a2-487c-afd4-acc3ec442160.zip完整验证为9；delivery-v18-0a348d3a-9383-47aa-b856-dfb7d7745bf2.zip完整验证并POST恢复隔离库通过。正式Edge仅GET/HEAD核验导航/设置与版本，不写正式资料 |

初期失败已修复：历史测试最终schema断言与迁移ZIP数量需跟随10（旧版本失败回滚断言不变）；启动器未包含1.8；面板入口移动后的旧脚本等待/最上层选择；快速Escape监听安装时间及跨引用返回状态。没有通过删测试/放宽校验掩盖失败。

最终截图见 docs/design/v1.8 和 [设计说明](DESIGN_V1_8.md)。双侧栏、关闭后正文、划词、批注/引用、来源/关联、Markdown与重复候选、笔记/网站/工具均为合成库真实渲染。重复区和确认按钮实际滚动并操作，不能仅以截图文件存在证明通过。

未验证：真实付费云质量、用户本人最终使用验收、Windows整机重启/断电/磁盘满及大规模压力。DeepSeek旧超时仍疑似上游异常待复测，未改超时/模型/接口。早期旧导航脚本未全部运行，其业务通过上述现行矩阵与87测试覆盖，不宣称每一历史脚本重跑。

---

历史记录（当前交付以上述版本为准）：

# V1.7.3 验证 / 2026-10-15

真实本机 Windows Edge（Playwright channel=msedge，headless），全部写入/删除/冲突/恢复测试为独立临时数据。AI 注入模拟 transport，不用真实 Key 或付费调用。沙箱内直接执行 npm test/build 曾因进程身份查询/SQLite替换/Vite realpath 权限拒绝失败；在正常 Windows 权限下执行以下命令通过，没有放宽生产校验。

| 命令/检查 | 实际结果 |
| --- | --- |
| npm run build / npm run typecheck | tsc / Vite 通过，无新依赖，package-lock 仅根版本更新 |
| npm test | 82/82：原80项加2项快速草稿。CAS 过期写入/删除、字面 HTML/换行、原草稿隔离、真实 ZIP、限额/分类、同源/session、通用接口绕过拒绝；原迁移/恢复、关系、事务、历史、DPAPI/CSRF/rebinding、AI mock 超时/取消/Schema/限额均通过 |
| npm run test:browser:v173 | 四类默认预览/阅读与独立外链，长文固定操作栏；章节定位与高亮、大纲开合、1920双栏/1366/390辅助三标签与边界、嵌套Escape、紧凑整理；首页返回、浏览器后退、查询/第2页/新领域意图区分；快速输入立即刷新恢复、重复打开共享、关闭防丢失、正式保存清草稿、双窗口差异拒绝静默覆盖、模拟保存500保留输入并重载恢复 |
| test:browser:v172 / v171 | 直接互斥组合筛选、树/设置独立dirty、Pin与排序/首页同步、弹层坐标、回收恢复、短笔记原位编辑与未保存保护/历史、稳定章节刷新与上下文AI确认入口 |
| test:browser:v161 / v17 | JSON v2四类型/9章节、旧v1由自动测试覆盖、领域/动态专题/手工成员/来源/日期/工具图标/批量排序；关系方向、候选编辑拒绝采用/确认、引用保护、一二层局部地图/键盘/列表/章节跳转 |
| test:browser:settings | 真实 CurrentUser DPAPI（虚构Key）、配置保存/重载/替换/清除/两Provider、mock连接与401、费用确认、无浏览器明文/DB/ZIP、无Key手工功能、停止UI |
| test:browser:v13 / test:browser:ai / test:browser:deepseek | 原专题/Tiptap/图片/草稿/历史/追加替换、分享本地解析、两模拟Provider人工审核/错误/超时/取消/信息不足/原文保护 |
| test:startup | 隔离 Windows .bat 后台启动、正常实例同PID复用、重复服务拒绝、异常结束重开、虚构DPAPI和旧数据保留、正常停止释放锁、缺Node提示；PID复用与不明锁/占端口由自动测试覆盖 |
| 正式库与 ZIP | schema9/33表/17内容；交付导出完整校验ZIP，再POST restore到独立库，比较全部表、workspace和附件；正式33表与4文件SHA-256与开工相同，用量文件不改且不进入ZIP |

正式服务通过原启动器正常停止/启动，正式 Edge 限定 GET/HEAD 再检查版本1.7.3/schema9、四项导航、互斥筛选及设置零改关闭，无正式测试写入。截图用合成库，实际打开复核固定栏、大纲定位、宽窄布局及关闭操作，见 [设计证据](DESIGN_V1_7_3.md)。

追加专项：模拟详情响应延迟后立即浏览器后退，确认迟到响应不复活旧阅读器；脏编辑后退拒绝保持表单，明确放弃关闭且正式标题不变。最后重启后的交付ZIP为 delivery-v173-7965afec-addf-46e9-97b1-4ee8daa817f7.zip，完整校验、33表/4文件一致与隔离实际恢复均通过。

未验证：真实付费云端、用户本人最终使用、Windows 整机重启/断电、磁盘满/大库压力。DeepSeek 整合超时为“疑似上游服务异常，待恢复后复测”；没有为其改变限额/超时/模型。Windows测试是服务进程启停/异常恢复，不能代称整机重启。早期 browser/browser-v11/browser-v14 等旧导航脚本未全量改造运行；业务通过上述现行矩阵覆盖，不宣称每个历史脚本运行通过。

---

历史记录（当前行为以上述版本为准）：

# V1.7.2 验证 / 2026-10-15

使用本机真实 Edge（Playwright msedge，headless）及独立临时 SQLite/附件/凭据目录。正式网站审计只允许GET/HEAD；正式备份导出后完整校验，并在独立库实际POST restore，不恢复正式资料。无真实Key/付费调用。

| 检查 | 实际结果 |
| --- | --- |
| npm run build / npm run typecheck | tsc 与 Vite 生产构建通过，无新增依赖；package-lock只根版本修改 |
| npm test | 80/80，旧1～8 ZIP向前迁移/恢复、生命周期、引用、Schema/事务/历史、两Provider错误/超时/取消、DPAPI/CSRF/rebinding及旧核心业务 |
| npm run test:browser:v172 | 新专项通过：四维直接选项/互斥/外点/Escape/组合条件/空结果；列表网格置顶、三排序、首页和阅读器同步；空模型零改不提示/真实虚构Key与Provider修改提示/分类独立警告；树箭头仅折叠、名称导航、长名边界、改名/移动/ID/后代选项；关联/AI/收纳弹窗坐标、关闭命中、内部底部可达、Escape保留阅读器、滚动锁释放；1366×768、1920×844、390×844；schema9真ZIP校验 |
| test:browser:v171 | 快速记录十秒内、同ID队列完成、置顶排序、回收恢复、四类阅读、稳定章节刷新、导航与窄屏 |
| test:browser:v161 | JSON v2四类型/9章节、v1兼容自动测试、树/排序、专题动态规则与手工成员、来源/日期、模拟问答引用、深色/窄屏 |
| test:browser:v17 | 正反向关系、章节跳转、模拟AI拒绝/修改/采用/确认、引用删除拒绝、一/二层地图/类型/键盘/列表替代 |
| test:browser:settings | 真实Windows CurrentUser DPAPI（虚构Key）保存重载/替换/清除/Provider切换/模拟连接/401/费用确认、无浏览器明文/DB/ZIP、无Key手工笔记、停止UI |
| test:browser:v13 / test:browser:ai / test:browser:deepseek | 富文本/图片/专题草稿/历史/追加替换、来源与本地分享解析、两模拟Provider人工审核、错误/取消/超时/信息不足，无原文自动覆盖 |
| test:startup | 独立Windows后台启动、复用同PID、第二服务拒绝、异常结束/重启、虚构DPAPI和旧内容保留、正常停止释放锁、缺Node提示；PID复用/旧锁/不明锁/占端口另由80项自动测试覆盖 |
| 正式资料保护与恢复 | schema9/33表/17内容，33表行数据和4私有文件校验值未变；交付ZIP实际恢复到独立库，所有表/草稿/附件一致；用量不进入ZIP且正式用量文件未改 |

修复前冻结V171复现：两个筛选同时open、关联/AI弹窗嵌套阅读器且顶栏实际拦截关闭、扁平树表单、空模型零改AI误报。修复后坐标和按钮实际点击均检查；查看了前后截图及桌面/窄屏。截图为合成资料，[设计审计](DESIGN_V1_7_2_AUDIT.md)逐页面解释落实/差异；不是私人库截图。

正式实例另外使用项目正常停止/启动机制加载1.7.2；只读Edge再次核验四项导航、互斥筛选、设置各分区浏览后零修改关闭无警告、版本1.7.2/schema9。重启后再次比较33表/4私有文件并完成隔离ZIP恢复，全通过；没有强杀或移除有效锁。

未验证：用户本人最终使用验收、真实付费云端质量/网络、Windows整机重启。早期browser/browser-v11/browser-v14等旧导航脚本未全部改造或全量重跑，其业务以80自动测试及上述现行Edge矩阵回归，不将历史脚本未运行声称通过。

---
历史记录（当前交付以上述说明为准）：

# V1.7.1 工程验证 / 2026-10-14

正式基线 HEAD 9a0a810d3d4251f829c41a07eda43c94b7cdc288/schema8。工作树只有用户新增的规格和9张设计图，保留并纳入文档。用户在V1.7交付后更新过正式资料，已建立新的本轮31表/4私有文件哈希基线与可恢复 ZIP，未按上一轮数据反向覆盖。

build/typecheck通过；npm test 80/80（历史74+experience6）。全部写入/破坏测试为临时数据目录。新增测试覆盖原文安全转义、可选元数据、重复/失败事务、处理/稍后/软删/恢复同ID、AI不召回回收站、引用删除拒绝、普通正文历史与恶意历史拒绝、schema8→9有效ZIP/故障回滚、旧恢复、同源/session及置顶与标题排序共存。

真实 Windows Edge（无头）结果：test:browser:v171 十秒内保存、四页全局新建、收集箱完成后同ID仍在库、置顶/排序/回收站恢复、四类完整阅读、短笔记原位编辑/拒绝丢弃/历史、上下文问答默认当前证据且不调用、章节刷新/阅读位置、设置入口和390px通过；test:browser:v161 四类型JSON/9章节/领域树/旧保存筛选兼容/动态专题人工成员/来源/重复/工具图标备注/批量置顶/模拟问答及移动排序通过；test:browser:v17 关联/双向章节引用/模拟AI部分编辑拒绝采用确认/地图1-2层过滤键盘列表/窄屏通过。

原 OpenAI/DeepSeek 收藏与笔记模拟AI审核、图片原文保护、错误/超时/取消/信息不足及无Key保存通过；原专题（DeepSeek模拟）富文本/图片/草稿/追加替换/历史/来源/错误取消超时/本地分享解析通过。settings真实CurrentUser DPAPI虚构Key的首次保存/刷新/切换/替换/清除/费用确认/401/无Key与停止UI通过。test:startup真实隔离Windows后台.bat启动、同PID复用、重复服务拒绝、临时崩溃重开、虚构DPAPI/原资料保留、正常Stop释放锁、缺Node通过。真实ZIP导出、损坏拒绝、旧1～8恢复与回收站/历史保留通过。

截图全部为合成资料，test-results/v1.7.1-{home,inbox,library,note,bookmark,tool,document,settings,mobile}.png；图库实际读取复核。正式库仅做备份/正常升级/哈希及GET/HEAD只读验证，正式最终核验：正常Stop/Start至schema9，31旧表和4私有文件SHA全部一致，16资源保留，新处理/正文历史两表均0；pre-schema-9-ff802bfc-85c6-4541-91c3-218c363f8e89.zip完整校验为8，生产1.7.1与只读Edge核验通过。

未验证用户本人关键任务验收、真实云权限/费用/质量、整机重启/物理双击、跨账号ACL/干净机器/断电/磁盘满/大库压力。模拟 Provider 不是云验证。未获得独立首页/收集箱图，以文字规格实现，9张现有图均实读；不造来源、数量或阅读进度。

---
历史说明（以本轮入口为准）：

# V1.7 验证 / 2026-10-14

正式交付核验：schema7正常Stop/Start顺序升级8，pre-schema-8-211f74b2-2440-4cf2-b782-897c64ff435e.zip完整校验为7，升级前后29旧表、两附件/workspace草稿与偏好/ai-usage共4文件SHA全部一致，16资源保留；relation_details/history正式均0，没有正式关系测试写入、清理或付费调用。当前1.7.0服务经启动器认证运行；稳定UUID站内章节URL的Edge重载验证通过。


build/typecheck通过，npm test 74/74（历史65+relations9）。独立临时库，云全部虚构Key模拟。

- 七类型正反向、真实端点/章节anchor、人工/AI/import来源和candidate确认、重复/对称反向重复/自引/失效目标拒绝。
- 依赖/组成/修正循环拒绝，相互引用允许；改名/排序后章节UUID和owner/anchor不变，明确正文站内引用与实际父级只读，引用目标删除被保护。
- 原内容/来源/日期不改；版本hash拒绝过期编辑，故障注入整批回滚，历史恢复及后续正文变化拒绝；ZIP保持关系来源/历史，损坏历史拒绝。schema7→8有效pre-schema-8ZIP与失败回滚7，旧1～7隔离恢复到8。
- 本地领域/专题候选检索、地图一/两层/过滤/candidate显隐、40真节点/80边限额及省略计数，无虚构节点。
- 两家模拟AI选中范围/Schema/逐字引用、编辑/部分采用/candidate人工确认拒绝、源变化/错引用拒绝；无Key/不足/超预算/超时/取消/共享用量不修改原文。
- 真Edge V17：人工引用、反向章节跳转、AI拒绝/编辑/采用/再确认、删除保护、地图1/2层/筛选/键盘Enter/列表/390px及稳定#chapter重载定位，无pageerror。
- 真Edge旧V161（含无网址工具图标/备注/分类/主领域/CRUD/网格列表/置顶/统一导入）、核心收藏/笔记/图片/草稿/ZIP恢复、两家原收藏笔记AI、专题及DPAPI虚构凭据settings通过。Windows隔离.bat后台启停/同PID复用/重复拒绝/临时崩溃重开/旧笔记工具与虚构凭据保留通过，PID复用/模糊锁/他程序端口原自动测试保留。

合成截图test-results/v1.7-related.png、v1.7-map.png、v1.7-map-mobile.png，真实读取复核，不进Git。复现npm run test:browser:v17与node --test tests/relations.test.js。

未验证真实云质量/账单、Windows整机重启/物理双击、跨账号ACL、断电/磁盘满/大库压力。地图圆形布局不代表语义距离，不支持无限扩展或全库图谱；本地召回有限关键词/共同类别，不声称语义检索。关系快照2MB/10000条上限，后续原文/实际章节/关系变化阻止恢复。历史方向不自动修正，真实知识不自动收纳、删除或合并。

---
历史说明（本轮入口优先）：

# V1.6.1 验证 / 2026-10-14

Windows/Node24.21/真实Edge无头，测试全部合成独立库；无真实Key、付费API、私人聊天或正式测试CRUD。

- build/typecheck通过；npm test 65/65（历史55+统一10）。四类型/无网址工具/内部章节、严格v2字段/HTML/日期/引文/父级/限额、部分修改/重复包网址、整批回滚、v1显式转换、来源原包保留、重开及真实ZIP通过。
- 领域创建/排序/移动/循环/有引用删除拒绝，主要领域及跨领域/专题人工成员保持；动态规则/AI实时成员重验、领域AI合并维护主领域/子域/规则/历史恢复；schema6→7顺序预迁移ZIP和故障回滚6通过。旧1～6ZIP向前验证。
- Edge V161（含最终工具补充回归）：无网址工具手工添加/图标上传/备注全文搜索/主领域/编辑删除、子类型筛选、置顶取消及网格/列表持久化通过。四类主内容+9内部章节默认不平铺；类型审核/领域建议/搜索跳章节/手动顺序/备注/来源原包/重复拒绝、领域折叠/固定视图重载、动态规则人工成员保持、AI证据引用/原文保持、390px/深色，无pageerror。
- 原核心Edge：收藏/富文本/封面正文图片/搜索/编辑/重复/草稿/删除取消/ZIP恢复/重载/窄屏；两家模拟收藏与笔记AI人工审核、原文及图片保护；两家专题AI富文本/图片/草稿/追加替换/历史/来源/取消超时、分享文本均通过。settings真实CurrentUser DPAPI虚构凭据/切换替换清除/连接测试收费确认/安全边界通过。
- Windows test:startup真实隔离后台.bat启动/复用同PID/重复拒绝/临时服务异常结束重开/旧笔记收藏与虚构DPAPI保留/正常停止释放锁通过。锁PID复用/无法确认/其他端口仍有自动化回归。
- 正式用户启动触发schema7，pre-schema-7-2f181781-3672-4294-a362-046d1ebe5594.zip完整校验为schema6。23旧表、2附件、workspace草稿/偏好及ai-usage哈希与开工一致；16资源/10知识保留。只读清理10候选，未清理或重导。

截图仅合成test-results/v1.6.1-{library,document,import-review,mobile,dark}.png，实读复核、不进Git。复现npm run test:browser:v161、node --test tests/unified.test.js。

未验证真实云质量/计费/账户、Windows完整OS重启/物理Explorer双击、跨用户ACL、断电/磁盘满/大库压力。旧研究的9独立点没有自动收纳；需要手动归属或确认清理后重导。旧目录未自动变成领域；名称仍全局唯一。快捷视图只保存领域/标签/类型，暂不保存专题、工具子类型、搜索/排序及未归属条件。历史跨schema/后续DB或workspace变化保守拒绝；本轮无自动清理接口。

---
历史说明（入口以本轮说明为准）：

# V1.6 验收 / 2026-10-13

交付末次后台曾退出（锁释放、无错误日志），原因未独立确认，随后正常重开；没有宣称定位或修复根因。实际启停/异常重开通过不代表长期后台稳定性已验证。

Windows/Node24.21/实际Edge无头；破坏性与写入全部隔离合成库，AI注入虚构Key/模拟transport，禁止真实付费请求。正式仅一致性备份、顺序迁移、哈希及GET/HEAD入口读检。

- build/typecheck通过，npm test **55/55**（47历史+V1.6八项），0失败。
- SQLite检索：收藏/笔记/工具/page/point/目录/专题真实ID、中文关键词、候选预览与证据选择、无匹配/仅标题零调用、两家模拟QA已有资料/推断/不足、错来源拒绝，原记录不被回答写入。
- 结构：目录重命名/移动/合并、领域/标签/专题合并去重引用、创建/关联，UUID/正文/日期/原始来源不变；专题旧正文与目标正文/历史保留。真ZIP中历史恢复原分类/层级/引用，无knowledge_records删除级联。循环/草稿/旧证据拒绝；故障注入整批回滚。
- 审核：修改建议和部分选择、差异hash及数据库/workspace/选中对象版本防并发，过期/cancel拒绝，后续更改不能覆盖恢复。恶意历史HTML在启动/真实ZIP中拒绝；列白名单/树/本地资产校验。
- 跨范围：多个目录本地展开、按用户选择模型分析，两阶段认知原始日期与不同观点保留，原文不覆盖，另存review/ai_inference综合页及章节。目标页变更拒绝，失败后新页/章节/来源全回滚。
- 新API：跨站Origin/session/模式/长度拒绝、取消/超时/upstream/错Schema与引用、無Key手工记录、用量入同一日志/虚构Key不泄露。原Provider的空/截断JSON、Token/配额、DPAPI与恢复安全回归。
- npm run test:browser:v16：真实Edge问答无匹配/证据调整/引用跳站内，结构理由编辑/差异/两次确认/引用保留/历史恢复/拒绝离开保护，跨目录新综合页/日期/源记录不变，知识目录快捷入口、reload/390px/dark、0pageerror。
- 历史浏览器V1、v11、v14、v15、v15b、settings、ai/OpenAI、deepseek、v13/DeepSeek及--openai全通过；Windows test:startup实际隔离.bat/同PID复用/直接重复拒绝/自身临时进程崩溃重开/虚构DPAPI/正常停止，原锁回归。
- schema5→6真pre-schema-6 ZIP、故障回滚5、旧1～5 ZIP隔离向前恢复、schema6新管理历史与内容/来源恢复通过。正式迁移后22旧表/4文件哈希同；最终运行期间workspace新增1草稿，已保留，旧22表/附件/用量仍同、16条/10知识保留、AI configured状态保留，新history表0；未改正式归属或做测试CRUD。

截图test-results/v1.6-answer.png、structure-review.png、mobile.png、dark.png（均v1.6-前缀），合成资料，实读复核且Git忽略。命令见README。

未验证真实云权限/账单/事实质量、Windows完整重启/物理双击/干净安装/跨用户ACL、断电/磁盘满/大型库。关键词召回有界，不声称语义检索；Token为粗估，超长需人工分批。结构历史快照5MB，后续任何DB修改都使覆盖恢复拒绝，可继续手工管理/ZIP。未采用预览/回答不持久化；不将这些限制列为已通过。

---
历史V1.5-B：

# V1.5-B 验收 / 2026-10-13

Windows / Node24.21 / 真Edge（无头）；所有写入、破坏性及模拟API测试独立合成库。未读取真实Key、付费云请求或私有聊天历史。

- build/typecheck通过；npm test **47/47**（原41 + B六项），0失败。
- B自动化：明确结构1页9点/无环/8层/父级缺失事务回滚，收纳稳定ID/正文/日期/来源，搜索owner/排序重开，历史HTML保留/旧编辑器保护，v1兼容及旧显式parent审核，schema4→5故障回滚4、真预迁移ZIP/新结构与历史恢复。
- 两家Provider均注入模拟：只选中资料、字段/来源/逐字引文验证、人工修改/部分采用、AI推断保持review、原文不覆盖、源变化拒绝、信息不足零调用、超预算拒绝；新受保护API Origin/session拒绝、取消/超时/upstream、日志无虚构Key、同快照缓存不重复调用、无Key手动记录。既有空JSON/截断/错误响应与限频测试回归。
- npm run test:browser:v15b：实际Edge默认1页、9章节显式收纳、父级和顺序持久化、已有独立点收纳、章节展开/大纲定位、知识及全站搜索定位、AI方案拒绝/编辑/采用/缓存、层级审核修改并真实确认导入、重复包明确另存、390px/深色、0pageerror。
- test:browser:v15、V1、v11、v14、settings、ai/openai、deepseek、v13/deepseek及 --openai全部通过，富文本/图片/草稿/工具/专题/ZIP保留。
- test:startup实际Windows.bat隔离启动/并发复用同PID/重复Node拒绝/自身临时进程异常重开/虚构DPAPI/正常停止释放锁通过；PID复用/模糊锁/其他端口保护自动化回归。
- 正式服务只做备份/顺序升级、哈希和GET/HEAD Edge：16资源/10知识/1工具保留，20旧表与4私有文件哈希全同，schema5，AI非敏感配置状态保留；未创建真实章节关系或测试资料。升级ZIP与导出ZIP实际完整验证，旧schema1～4隔离恢复到5。

合成截图在test-results/v1.5-b-before-flat.png、directory.png、reader.png、integration-review.png、import-hierarchy.png、mobile.png、dark.png（均有v1.5-b-前缀），已实读复核。截图/临时哈希/个人库/ZIP/日志/密钥不提交。

未验证真实云API/账单/质量、整机重启/物理双击、干净机器/跨账户ACL、断电/磁盘满/大型库。模拟不是云端验证，进程重开不是整机重启。超长输入明确拒绝并由用户分批选择，没有自动长对话拆分；待审核AI仅15分钟内存，不保证重启保留。

---
历史A验收如下：

# V1.5-A 实际验收与历史回归记录

## 2026-10-13 V1.5-A 验收

Windows/Node24.21、真实Edge无头，所有破坏性/写入测试为临时合成库，所有模型注入模拟；正式库仅保护备份、正常迁移、哈希及只读页面验证。未读取真实Key/聊天历史或请求付费API。

| 检查 | 实际结果 |
|---|---|
| build/typecheck/noUnusedLocals | 通过，React/Express/SQLite/Tiptap/依赖不变 |
| npm test | 41/41，原35 + knowledge六项，0失败 |
| Schema/安全 | 真Schema/成功失败文件样例、缺字段/未知版本与状态/字段/无效日期时间/伪来源摘录/重复ID/循环目录/危险URL/HTML/超条数及体积拒绝，纯Markdown不拆分不执行HTML |
| 审核/事务 | 预览不写库、选择部分/修改/拒绝、未知元数据显式创建、关系候选未确认、同名独立UUID；同包哈希提示/明确另存；故障注入回滚全部记录/来源/新分类/目录/关系，手工new草稿保留 |
| 知识对象 | 目录层级循环拒绝、混合页工具/网址/知识引用、跨专题、手动排序/优先级、日期与资料记录时间保存、人工确认显式、正文改写撤销确认、旧编辑器不能改成工具/网址 |
| 备份/迁移 | schema3→4旧列不变、故障回滚3、预迁移真实ZIP恢复；旧schema1/2回归，新schema4正文/来源/关系/目录/草稿/引用真ZIP恢复及服务重开，快照/引用语义和图片校验 |
| 本地API | Origin/session/标记缺失及跨站拒绝，预览令牌成功后不可重放，原包读取受保护；不开放CORS/SQLite/长期前端Key，同账号恶意进程不在HTTP鉴权保证范围 |
| test:browser:v15 | Edge JSON粘贴/文件/Markdown、本地错误、下载模板、partial修改/拒绝、确认创建、来源原包/日期、同名/重复文件明确选择、知识排序、确认判断、收集原文、混合网址工具/专题、刷新/安全文本/深色/390px，0pageerror |
| 原浏览器 | V1、V1.1、V1.4、安全配置、原AI OpenAI/DeepSeek、专题两家Provider全部通过，原图片/草稿/工具/分享/版本/ZIP保持 |
| Windows | test:startup实际.bat背景/并发复用同PID、隔离异常重开、合成DPAPI与旧笔记保留、正常Stop释放锁/缺Node；锁PID复用/模糊锁/其他端口回归 |
| 正式数据 | 最新6条/2笔记/1工具/1专题保留；schema4新增知识表空。旧11表/2附件/workspace/用量共4文件哈希全同，保护包隔离迁移验证，AI仍已配置；只读Edge新入口通过 |

新增复现命令 `node --test tests/knowledge.test.js` 和 `npm.cmd run test:browser:v15`。截图仅合成资料，在test-results/v1.5-a-import-review.png、knowledge-detail.png、mixed-page.png、mobile.png、dark.png；已实读复核，不入Git。浏览器mock transport明确禁止云调用；Windows测试只终止自身临时数据进程。旧测试的“当前版本”断言更新为4，保留旧原列比较及对应步骤失败回滚断言。

未验证：真实云端账号/质量/账单，完整Windows重启/Explorer物理双击、干净机器、跨用户ACL、断电/磁盘满/大库压力。进程重开≠整机重启，模拟云端≠真实付费API。旧正式进程退出原因未确认，已在取得锁保护后正常恢复；不声称修复一个未证实的根因。B未实现不列为通过。

## 历史 V1.4（以下统计为历史）

## 2026-10-13 V1.4 验收

真实 Windows / Node 24.21 / Microsoft Edge 无头浏览器。破坏性测试全部独立临时库；模型为虚构密钥与注入模拟 transport，没有真实付费请求。

| 检查 | 实际结果 |
|---|---|
| build / typecheck | TypeScript 与生产 Vite 构建通过，无新依赖 |
| npm test | 35/35，原 33 项回归 + 工具/迁移 2 项，0 失败 |
| schema2→3 | 旧 11 表原列/关系/总结全同，workspace 不改；真升级前 ZIP 可恢复，失败注入回滚至 schema2，旧 schema1 向前升级与未知/损坏库拒绝回归 |
| 工具 API | 无网址、六类之一、非法类型/URL拒绝、图标与 HTML 清理、分类/专题、多对多稳定 ID、全站正文搜索、工具筛选、notes 排除工具、重复 URL 共用、旧客户端省略字段保留、独立草稿、重开持久化、schema3 真 ZIP 恢复 |
| test:browser:v14 | 实际 Edge：紧凑卡片、添加/编辑/删除、无网址、上传图标、备注展开、类型筛选、专题、全站搜索、刷新、网格/列表、深色/390px；三分类快捷入口选区/回顶/焦点、四设置分区、窄屏创建/无横溢、隐藏焦点/未保存密钥关闭确认 |
| 原浏览器回归 | test:browser、:v11、:ai、:deepseek、:v13 及 --openai、:settings 全部通过，原图片/草稿/批量/分享解析/人工审核/专题原文/历史/真ZIP/DPAPI不受影响，0pageerror |
| test:startup / 原 lock | 真 Windows 后台 .bat：并发重复复用同 PID、直接二次 Node 拒绝、仅终止隔离测试进程模拟异常，重开保留旧笔记/虚构 DPAPI Key，模拟连接/正常 Stop 释放锁/缺 Node；PID 复用/其他端口占用/模糊锁保守拒绝回归 |
| test:visual | 合成首页/编辑/详情/列表/深色/窄屏；新增工具/设置截图实际读取复核 |
| 正式保护 | 有效旧服务正常停止后 schema2→3，自动 ZIP 完整校验，旧 11 表原列/附件/workspace/用量哈希相同；5条/2笔记/1专题，AI 已配置状态保留。未做正式测试 CRUD/恢复覆盖 |

新增命令 `npm.cmd run test:browser:v14`，其余命令见 README。截图仅合成资料：test-results/v1.4-tools-desktop.png、-dark.png、-mobile.png、v1.4-settings-mobile.png，忽略不入 Git。旧夹具使用历史 SQL 写旧 schema，避免用新版写入器伪造旧库；迁移测试保留原列逐字段比较，不只验证计数。

未验证：真实云端账号/账单/整理质量、整机重启/Explorer物理双击、跨账号或真实ACL变化、干净机器安装、断电/磁盘满/大库压力。模拟 Provider 不等于云端成功；进程重开不等于 Windows 整机重启。正式实例状态与保护 ZIP 文件名见 HANDOFF。

## 历史 V1.3.1（以下计数与进程为历史）

## 2026-10-13 AI配置与启动验收

Windows/Node24.21、真实CurrentUser DPAPI、真实Edge无头，虚构Key/独立系统临时库及凭据目录，全部云端模拟；未读取真实Key或发付费请求。

| 检查 | 结果 |
|---|---|
| build / typecheck / noUnusedLocals | 通过 |
| npm test | 33/33，原28+安全配置4+启动器1 |
| DPAPI | 真加密/解密及损坏拒绝，绑定Provider/目录；模拟权限异常保留原密文，替换/清除/测试失败不覆写 |
| 安全API | Origin/null/cross-site/缺标记/错误session/非法Host实际端口拒绝；原始HTTP Host验证（fetch会规范化），确认/revision/白名单、JSON错误/上游密钥脱敏；API no-store |
| 配置与费用 | 网页优先、切换/替换/清除、无环境回退、服务重开和结果持久化；连接才调用，确认/错误401/402/429/明确模型code/泛化500/网络/超时/取消/并发保护，共享记录/限额 |
| 密钥隔离/ZIP | GET只状态、无Key/cipher；DB/ZIP/日志/浏览器持久化不含Key，真ZIP恢复不改变本机DPAPI配置 |
| test:startup | 真后台启动、启动器退出后台仍在、重复双击复用同PID、直接重复Node拒绝、异常测试进程重开保留旧schema1笔记/收藏/加密Key、模拟连接成功、正常Stop释放锁、缺Node提示 |
| launcher/lock | 其他程序占端口不终止、不打开库；损坏/模糊旧Node锁保留、死进程/复用PID识别、原LockApp/异常/正常锁回归 |
| test:browser:settings | Edge首次安全保存/清空、刷新/切Provider/替换/拒绝/清除、费用确认/401/成功、无密钥手工笔记、存储检查、390px/停止UI，0pageerror |
| 其余浏览器 | V1、V1.1、原AI OpenAI/DeepSeek、专题双Provider和真实ZIP回归通过 |
| test:visual | 合成桌面/列表/编辑/阅读/深色/窄屏，设置截图已实际读取 |
| 正式数据 | schema2、4条/0专题，11表/附件/workspace/用量哈希一致，本轮无迁移或测试CRUD |

命令新增npm run test:browser:settings；tests/startup使用测试专用NODE_OPTIONS预加载器，外部网络禁止，虚构密钥才响应，不是生产mock开关。所有临时服务正常停止并清理自己的目录；故障演练只终止自身隔离进程。重要截图test-results/v1.3.1-ai-settings.png、-mobile.png，合成资料，不入Git。

未验证：真实付费Provider端到端/账号权限/账单/质量、整机重启、Explorer物理双击、跨Windows用户或真实ACL变更、干净机器初装/断电/磁盘满/大库压力。真实Windows进程重开不等于整机重启；模拟权限失败不等于跨账户验证。保护措施无法保证第三方密码扩展行为或抵御已失陷本机。最终正式状态见HANDOFF。

## 历史V1.3验收

## 2026-10-13 V1.3 验收

真实Windows环境、Node24.21/npm11、Microsoft Edge无头模式；全部合成测试资料写独立系统临时目录，所有云端请求为注入模拟transport，不读取真实密钥或请求付费API。正式库只做保护备份、正常向前迁移和只读API检查，不写测试数据。

| 检查 | 实际结果 |
|---|---|
| npm run build / typecheck / tsc --noUnusedLocals | 通过，生产构建完成 |
| npm test | 28/28、0失败：原18 + 分享3 + 迁移3 + 专题4 |
| schema迁移/备份 | 真schema1旧表/多对多/草稿保留、完整预迁移ZIP、异常回滚、未知/损坏schema拒绝、重开无重复升级 |
| ZIP恢复 | V1/V1.1/V1.2旧ZIP隔离迁移；schema2总结/图片/引用/历史/草稿真ZIP恢复，原条目/关系/图片字节校验 |
| 专题API | CRUD、关系多对多不复制/不误删、富文本/图片持久化、revision冲突、保存失败旧版不变、确认恢复历史、独立草稿不改workspace |
| 专题AI | 双Provider仅选中资料、Schema/伪造/标题-only引用拒绝、生成不改正式稿、人工编辑审核后保存、来源变更拒绝迟到生成/采用、预算/不足/超时/取消/错误保护 |
| 分享解析 | 用户抖音样例、通用英文/其他平台、纯URL、多URL/去重/查询参数/标点/括号、无URL/话题、危险URL/长度拒绝，零网络 |
| test:browser / :v11 / :ai / :deepseek | 原收藏/笔记/图片/搜索/分类/排序/批量/草稿/审核/无密钥/真实恢复全部通过 |
| test:browser:v13 + --openai | 两种Provider专题总结/本地图/草稿刷新、添加移除、来源详情、人工预览编辑持久化、追加/替换/历史、XSS文字转义、取消/错误/超时、390px与深色、分享paste事件/拒绝/采用/不覆盖/重复；0pageerror |
| test:startup | 真Windows.bat启动两次、旧schema1笔记升级保留、异常退出/锁回收、真实重复Node拒绝、缺Node错误；测试禁用自动打开浏览器 |
| test:visual | 合成首页/列表/编辑/详情/深色/窄屏截图完成 |
| 正式库 | 原3条/0专题，正常CLI迁移schema1→2；HTTP200，旧8表/附件/workspace/用量SHA256一致，停止后有效锁正常释放 |

复现命令见README；专题浏览器默认模拟DeepSeek，`node tests/browser-v13.js --openai`回归OpenAI。所有测试结束关闭自己的服务/浏览器并清理临时库；截图保留在忽略的test-results。重要图：v1.3-deepseek-topic/ai-review/dark/mobile.png、v1.3-share-text.png（亦有OpenAI同名图），实际读取复核，全部合成资料。

正式保护ZIP先在独立目录恢复/升级并比较原八表、附件、workspace哈希；正式升级自动校验新预迁移ZIP，备份文件名见HANDOFF。未对正式库执行恢复覆盖或测试CRUD。锁实现/PID复用保护保留并通过原有测试。

未验证：真实付费OpenAI/DeepSeek端到端、账号权限/质量/账单/网络、本地模型，Windows整机重启/物理双击/系统剪贴板、干净机器初装、断电/磁盘满/大量资料压力。真实Edge使用自动化paste事件，不声称测试了系统剪贴板。真实进程重启不是整机重启。上述项目不能标为通过。

## 历史 V1.2（下方状态不代表当前服务）

## 2026-10-13 DeepSeek 增量验收

模型请求全部使用注入的服务端模拟 transport；运行真实本地 API 和 Microsoft Edge 无头浏览器。未读取用户密钥，未请求实际付费 API。项目版本/SQLite schema/原数据结构不变，无依赖新增。

| 检查 | 结果 |
|---|---|
| build / typecheck / noUnusedLocals | 通过 |
| npm test | 18/18，0失败；保留原13项并新增5项 DeepSeek |
| npm run test:browser:ai | 默认 OpenAI 全部审核/原文/图片/异常场景通过，0 pageerror |
| npm run test:browser:deepseek | 同一场景经 DeepSeek 请求/响应与本地 Schema 通过，0 pageerror |
| npm run test:browser / test:browser:v11 | 收藏、笔记、分类、搜索、富文本、图片、草稿、重复、批量、ZIP 真恢复回归通过 |
| npm run test:startup | 真 Windows .bat 启动/异常退出重开/重复实例拒绝/缺Node提示通过 |
| 正式数据 | PID5800服务和有效锁保留；2条记录/schema1；条目/附件/草稿/用量/锁文件开工与完工哈希一致 |

5项 DeepSeek 测试覆盖：Provider/模型/Endpoint 白名单与密钥互不借用；独立峰值/自定义价格、缓存 Token/异常统计；真实本地接口的 JSON 参数/资料边界/Schema/ID/不写原记录/备份不含密钥；空/空白/null/截断/fenced/无效字段/未知ID/过长/工具输出/超大响应/拒绝；超时/取消/无密钥/网络/401/429/500、无重试；切换 OpenAI→DeepSeek→OpenAI 保留日志版本/历史和共有小时限额。失败中已知 usage 留存，不把未知费用当零。

浏览器脚本增加 `--deepseek`，使用真实建站后端并注入模拟云 transport，不伪造审核 API。覆盖选部分/改标题摘要和候选标签/创建取消确认/全部接受/拒绝/陈旧建议禁用/正式保存前记录完全不变、完整原 HTML 前缀/本地图 naturalWidth/恶意脚本不执行、390px/错误/超时/取消/信息不足不调用/无密钥手动保存。两 Provider 截图为 test-results/v1.2-{openai,deepseek}-{bookmark-review,note-preview,note-reading,mobile}.png，合成资料，不入 Git。

未验证：实际 DeepSeek/OpenAI 服务、真实密钥权限/网络/中文生成质量与实际账单；低峰时段自动判断未实现（固定高峰参考估算，可手工配置），其他 DeepSeek 模型和 Ollama不支持/未测。正式后端保持原进程，配置后正常重开生效。此前 Windows 启动和锁测试在自动测试中保留，本轮没有整机物理重启。

以下 V1.2 主交付及 V1.1 表格是历史记录，原13项测试数量和仅OpenAI边界不代表本次增量。

## 2026-10-13 V1.2 验收

Windows 主机，Node 24.21.0，Microsoft Edge 无头真实浏览器；测试使用独立系统临时目录，未对正式 data 做破坏性测试。无 API Key，测试注入服务端 transport，不连接付费 API。没有新增第三方依赖，package-lock 仅更新项目版本，本轮不重装正在使用的 node_modules。

| 命令/核查 | 本轮结果 |
|---|---|
| npm run build / npm run typecheck | 类型检查和生产构建通过 |
| npx tsc --noEmit --noUnusedLocals | 通过 |
| npm test | 13/13，通过：3 V1 + 3 V1.1 + 5 AI + 2 锁测试 |
| npm run test:browser | V1 创建/编辑/图片/搜索/重复/删除/备份恢复/reload/窄屏通过 |
| npm run test:browser:v11 | 列表/排序/筛选/置顶/批量/最近分类/草稿恢复/链接通过 |
| npm run test:browser:ai | 真 Edge + 真服务端 Schema/审核/持久化，0 pageerror，通过 |
| npm run test:startup | Windows 真实 .bat、重复 Node 实例拒绝、异常退出重开持久化、缺 Node 报错通过 |
| npm run test:visual | V1.2 合成首页/列表/详情/编辑/深色/390px 图通过；一次临时 captureScreenshot 错误重试成功 |
| 正式数据保护 | 原服务 PID 5800/端口3000持续保留；2条笔记、schema1；升级前 ZIP 完整校验，开工/完工记录/附件/有效锁哈希一致 |
| Git/密钥/构建 | diff 格式检查；数据/附件/ZIP/.env 忽略；模拟密钥不进入日志、状态接口、备份和前端产物 |
| npm ls --depth=0 / npm audit --audit-level=low | 依赖匹配，0 个已知漏洞 |

### V1.2 需求证据

| 要求 | 证据 |
|---|---|
| 分类标签写入审核且绑定真实 ID | AI 集成动态 schema enum + membership；Edge 审核显示前端开发/实践/界面设计并保存真实关系 |
| 建议不直接改原始记录 | 生成、拒绝、部分采用、全部采用前后请求原条目深比较；采用只改表单，正式 Save 才改变数据库 |
| 接受、修改、拒绝、新标签确认 | Edge 修改标题/摘要/新标签名称，取消创建不写分类，再确认；选部分和全接受；拒绝原表单不变 |
| 没有正文返回信息不足 | 仅标题/URL、简介只有长 URL 均 local insufficient；服务端及 Edge 断言 transport 零次调用 |
| 原笔记/富文本/图片保护 | 整理稿采用前原记录不变；保存后原 HTML 为完整前缀、strong/原链接/本地图保留，图片 naturalWidth>0；恶意模型 HTML 显示文字，无脚本执行 |
| 无密钥手动功能正常 | AI 缺配置只报固定消息；真实无密钥后端的 Edge 添加保存成功；损坏 AI 日志只影响 AI |
| 超时/取消/错误隔离 | 注入超时/中止/401/500/网络/拒绝/不完整/过大/无效 JSON；既有数据库不变，无自动重试；忙/小时限制和跨服务重建频率保留 |
| 旧数据和真实恢复 | 全部原 V1/V1.1 恢复回归；AI 临时库导出/删除/真实 ZIP 恢复原字段，恢复后 AI 使用新的数据库连接 |
| 密钥和隐私边界 | 请求不含 URL 字段、其他收藏或 HTML 图片；正文/密钥不进 ledger/status；ZIP 白名单没有 key/log/lock；前端构建无模拟密钥 |
| PID 复用与可靠单实例 | 真本机进程身份查询；正常 acquire/release/restart、活实例拒绝、token 防错释放、死进程/新启动时间/旧 LockApp 归档、旧 Node/查询失败/损坏/acquire 锁保守拒绝；临时库 sentinel 不改变；真 Windows 第二 Node 启动失败 |

截图在 `test-results/v1.2-after-*.png` 和 `v1.2-ai-bookmark-review/ai-note-preview/ai-note-reading/ai-mobile.png`，合成测试资料，无个人信息，不提交 Git。旧 V1/V1.1 before/after 截图保留原版本身份，未用新版生成假的 before。

未验证：真实付费 API、账户权限/可用地区、模型整理质量和实际账单、Ollama/其他 Provider、Linux 实机锁分支、整机物理重启、Explorer 物理双击自动打开、另一台干净 Windows 初装、断电/磁盘满和大规模性能。PID 复用是可控身份模拟，正常与异常进程重开是在真实 Windows 上完成，不宣称已做物理重启。正式服务保留未热加载后端修复，正常关闭重开后生效。

## 历史：2026-10-12 V1.1 验收

以下为 V1.1 历史记录，其空生产库、无 AI、重装依赖及截图版本属于当时状态，不代表当前 V1.2。

日期：2026-10-12（Asia/Shanghai）。Windows 主机；Node 24.21.0；真实 Microsoft Edge Chromium，无头自动化。测试使用系统临时目录独立库，退出清理；不向生产 data 写入演示收藏。

## 命令与结果

| 命令 | 结果 |
|---|---|
| npm ci | 锁文件全新安装成功 |
| npm run build | TypeScript + Vite 生产构建通过，无大块体积警告 |
| npm run typecheck | 通过 |
| npm test | 6/6 通过，0 失败；保留 3 项 V1 集成测试并新增 3 项 V1.1 测试 |
| npm run test:browser | Edge 真实页面流程通过，0 pageerror |
| npm run test:browser:v11 | Edge 的新增体验、草稿恢复/清理与编辑器两种链接操作通过，0 pageerror |
| npm run test:visual | 六类页面截图生成并实际读取复核 |
| npm run test:startup | Windows .bat 两次启动、重开持久化、缺 Node 报错通过 |
| scripts/start.ps1 -CheckOnly | 环境检查与生产构建通过 |
| npm audit --audit-level=low | 0 个已知漏洞 |
| git diff --check / git check-ignore | 格式检查通过；data、图片、ZIP、.env 均忽略 |

本轮重新执行 npm ci、生产构建、类型检查（额外开启 noUnusedLocals）、数据测试、V1/V1.1 浏览器测试及 Windows 启动测试。原有 Node/SQLite/Tiptap/React 依赖方案保留，没有新增第三方依赖。

## V1.1 验收对应

| 优化 | 实际证据 |
|---|---|
| 默认封面、排版、浅/深色及响应式 | 同一组合成收藏的前后截图；桌面首页、列表、编辑、长文详情、深色、390px 截图实际查看；网格/列表均无横向溢出 |
| 网格/列表、五种排序 | API 白名单与浏览偏好校验；UI 切换列表/标题排序后 reload 保留；旧 V1 置顶排序测试保留 |
| 组合筛选、当前分类、最近使用 | V1 三组关系筛选回归；V1.1 专题筛选/清除；保存后表单最近标记；API 重启后最近分类仍一致 |
| 重复检测与查看已有 | 标准化 host/默认端口/根 slash/fragment，query 不合并；UI 实时提示并查看详情，同时保留新增草稿 |
| 批量整理与直接置顶 | UI 添加领域后原正文完全一致；直接置顶；批量删除取消/确认；无效选择整批失败、已有条目完全不变 |
| 草稿真正持久化 | 本地文件、重启、真实 ZIP 导出/恢复后值一致，草稿封面/正文图片引用及实际字节一致；UI reload 后恢复标题/H2/加粗/两条链接；正式保存清理；设置丢弃取消/确认不改变已保存条目 |
| 富文本格式及链接 | UI 选中文字加链接、光标处插入链接；H2/strong 与 href 检查，刷新恢复后仍一致；原笔记语义由字段不变断言保护 |
| 旧备份与安全恢复 | 实际导入没有 workspace 的 V1 ZIP；恢复默认偏好/空草稿；workspace 与数据库一起模拟中断回滚 |
| 同目录实例保护 | 数据目录锁拒绝第二实例，按 token 释放；Windows 测试强制终止后同目录重新启动成功 |
| 原生产库 | 升级前完整安全 ZIP 已留在 data/backups；升级实际启动并经 Edge 只读 smoke；meta=1.1.0、schemaVersion=1、原条目数仍 0，未注入演示数据 |

浏览器测试曾暴露快速键盘选区同步与光标链接移除问题：改为校验真实选中文本、明确保留链接面板选区、光标插入 URL 时只清除后续输入的 stored mark。最终场景已通过，没有将早期失败记为通过。

## 规格验收对应

| 规格闭环 | 实际证据 |
|---|---|
| 手填知乎/抖音 URL，重启保留 | core.test.js 知乎 API + server/db 重开；startup.js 抖音 + Windows 服务进程重开 |
| 原创笔记、富文本与本地图片持久化 | core 字段/图片重开；browser H2、图片、原创笔记、页面 reload |
| 2 领域/2 标签/2 专题，筛选无副本 | core 每组逐项过滤；关联长度校验；browser UI 多选保存 |
| 待整理进入/移出 | core 空领域→分配领域→空领域；browser 待整理导航 |
| 搜索标题/简介/正文与空结果 | core 三类词和 HTML 实体符号；browser 正文词/空结果 |
| 卡片详情、独立原网站新标签 | browser 详情 + popup URL/安全 rel；测试拦截外网，无实际网页抓取 |
| 修改、删除、取消、重复提醒 | core 重复 409/允许重复/删除；browser 修改/取消删除/确认删除/重复提醒 |
| 默认封面、封面及正文图片 | desktop/mobile 截图复核；browser 封面上传、正文图片、恢复/reload 后 naturalWidth |
| 删除领域/标签/专题不删条目 | core 删除三类关联后条目数保留；图片继续保留 |
| 真实备份恢复 | core 字段、6 组关联、图片字节恢复一致；安全备份存在；browser ZIP 下载/删条目/上传恢复 |
| Windows 启动与重开 | startup.js 调用真实 .bat，禁用浏览器自动打开，两个服务进程；缺 Node 环境清晰报错 |
| 安全异常与生产检查 | 非法 URL、假图片、SVG、恶意 HTML、跨来源/Host、缺请求头、坏 ZIP/穿越/校验值错误；build/typecheck |
| 真浏览器关键流程 | Edge 的添加/搜索/编辑/上传/备份/恢复实际执行 |
| 交接与 Git | README/AGENTS/架构/设计/HANDOFF；无个人资料入库 |

额外：分页 27 条→24+3 且无重叠；置顶排序；恢复中途只移动了原数据库的模拟中断，恢复日志正确找回原库。

截图均在忽略的 test-results/，使用独立临时库中的六条合成收藏，没有个人内容：`v1.1-before-home/detail/editor.png` 为修改前实际 V1 截图；`v1.1-after-home/list/detail/editor/dark/mobile.png` 为最终 V1.1。脚本现在仅允许生成 after，避免用新版伪造 before。另有 V1 browser 的 home.png、mobile.png。实际生产空库截图带 private 前缀，不提交。

截图 API 曾发生一次暂时的 Page.captureScreenshot 失败，重新采集成功；最终图片均已读取复核。弹窗截取 viewport、主页 fullPage，关闭背景滚动；深色截图禁用动画，避免捕捉主题过渡色。1440px 桌面及 390px 窄屏自动化已通过，不等同于覆盖所有显示缩放和分辨率。

## 未验证的条件

- 未做 Explorer 鼠标物理双击和系统默认浏览器自动弹出的人工作业；执行的是同一 .bat 启动链，自动打开浏览器被测试开关禁用。
- 未在另一台干净 Windows 电脑完成 Node 安装/首次联网安装；本机已实际完成 npm ci 重装。无网络/权限/杀毒软件差异需要按 README 排查。
- 未做真实断电/磁盘损坏/磁盘满实验；已覆盖可重复的恢复中断与正常恢复。定期异盘备份仍必要。
- 未做数万条数据性能、所有浏览器版本或所有辅助技术的兼容性测试。当前 24 条分页和备份/图片上限已明确。
# 专业知识开发分支验证 / 2026-11-07（非V0.1最终验收）

`npm run build`通过，`npm test`98/98通过。新增专业模型3项测试均为临时库，覆盖schema11→12故障回滚/可校验预备份、真实知识ZIP往返、独立树/共享UUID/正文版本/CAS、种子幂等及人工修改保留。`node tests/browser-professional.js`在真实Edge的1920/1366/390验证页面、搜索阅读、溢出与个人列表/统计/内部AI本地范围检索；V18阅读/批注/引用/导入和V19导图三尺寸回归通过。来源审校、40张内容、专业双库恢复及任务台完整UI专项未完成。不得据这些结果宣布整体通过；具体状态见professional-knowledge/IMPLEMENTATION_STATUS.md。正式数据未打开或迁移，未调用付费AI。
