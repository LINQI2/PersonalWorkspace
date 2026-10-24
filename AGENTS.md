# 项目开发约定

进入项目先读 README、docs/HANDOFF.md、docs/TESTING.md、docs/PRODUCT_REQUIREMENTS_V1.md、docs/PRODUCT_REQUIREMENTS_V1_1.md、docs/PRODUCT_REQUIREMENTS_V1_2.md、docs/PRODUCT_REQUIREMENTS_V1_3.md、docs/AI.md 和相关架构/设计文档。

- 先检查 Git 状态、现有代码和数据，保护用户修改。
- 当前停在 V1.9 交付点，V1～V1.7 保留；先读 docs/PRODUCT_REQUIREMENTS_V1_9.md、docs/DESIGN_V1_9.md、docs/PRODUCT_REQUIREMENTS_V1_8.md、docs/DESIGN_V1_8.md、docs/DESIGN_V1_7_3.md、docs/DESIGN_V1_7_2_AUDIT.md、docs/PRODUCT_REQUIREMENTS_V1_7_1.md、docs/IMPORT.md 与交换 Schema。不自动进入下一阶段，不执行 ROADMAP 候选网页抓取。
- 不删除/覆盖个人 data、附件或备份；不公开发布，不自动抓取网页。
- schema 变更必须新增顺序迁移、备份与真实恢复测试，不能重新建库代替迁移。
- 依赖使用 package-lock.json；不要偷偷更换架构。
- 变更执行相应构建、类型检查及测试；UI 变更执行真实浏览器和截图复核。
- 不提交数据、附件、备份、密钥或测试个人信息。
- workspace.json 包含个人草稿，也属于 data，禁止提交；本地实例锁必须在打开或恢复数据前获取。
- 历史 schema9，仅追加content_lifecycle/content_versions，所有内容删除为软删除并保持ID/正文/来源/归属。引用和章节回收保守拒绝，旧1～8ZIP向前恢复；先读docs/DESIGN_V1_7_1.md。历史schema8，关联details/history两表追加，knowledge_relations历史kind不可直接作新语义；先读PRODUCT_REQUIREMENTS_V1_7.md。正式资料不可自动清理，有引用删除须先处理关联。历史schema7，六个统一内容关联表追加、23旧表不改；先读docs/PRODUCT_REQUIREMENTS_V1_6_1.md与CHATGPT_IMPORT_V2.md。旧目录仅兼容，AI结构只领域/标签/专题。清理仅候选，必须明确用户ID确认。V1.6原schema6，V1.6追加assistant_changes，结构审核绑定差异/来源/实际归属/全DB状态，事务保存；历史恢复不得覆盖后续成果，草稿冲突保守拒绝，5MB上限。B保留明确 knowledge_structure 和 knowledge_versions；父级与目录/候选关系不同，禁止同目录猜归属。保留 schema4 的知识元数据/来源/导入映射/关系/引用/草稿和旧 entries、工具、专题。支持旧 schema1/2/3/4/5 ZIP 向前恢复，迁移前完整校验 ZIP，不能降版本强开。导入须 Schema/来源/日期/ID/树/限额校验、短期预览及人工选择，事务写入；未知分类/目录需确认，不合并同名、不自动确认判断，原始包保留。知识草稿、AI审核与原 workspace/专题隔离。
- 完成更新 HANDOFF 与必要的 CHANGELOG，如实记录未完成验证。
- AI 默认手动触发、服务端持有密钥、严格 Schema 和现有分类 ID 验证；不能猜测 URL 内容或未经审核改正式记录。测试使用注入模拟 transport 和独立库，禁止未经用户确认调用付费 API。
- 凭据使用Windows CurrentUser DPAPI，绑定Provider/数据目录，密文存LOCALAPPDATA，不返回明文或进入ZIP/Git/日志；解密失败不覆盖，清除不回退环境变量。连接测试需同源/session/费用确认，仅虚构密钥模拟测试。
- 双击启动复用验证过的项目实例，后台无自启/自动重启，用停止脚本或设置正常关闭；保留身份锁和保守旧锁处理。测试预加载器只在tests使用，不进生产入口。

- V1.7.3 快速草稿为 workspace.drafts.quick，专用修订校验 API；不能用通用草稿覆盖/删除。浏览器仅对快速输入保存恢复副本，不含密钥。DeepSeek超时暂列疑似上游服务异常待复测，不擅改Provider/模型/超时。

- 历史schema10：仅在9追加reading_marks及索引；锚点须指纹/原文/前后文可靠且唯一，不靠偏移猜测。批注/引用软删，原摘录保留；引用追加必须重验来源、目标修订与草稿并事务保存。旧1～9ZIP先校验再隔离升级10；不自动改写/清理旧知识。粘贴导入复用JSON v2审核、原文快照、重复确认与事务。

- 当前schema11：仅追加mindmaps/mindmap_versions及历史索引。导图复用entries ID/分类/软删除，普通编辑器不可覆盖；shared/mindmap.js严格白名单/树/限额校验，跨分支arrows与全站关系分开。650ms串行/CAS+分类指纹、本浏览器窗口恢复副本不得提交；恢复基线不匹配只导出比较。导入仅创建新图，旧1～10 ZIP先验证后隔离升级11，不自动清理正式内容。
