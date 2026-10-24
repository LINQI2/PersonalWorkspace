# ChatGPT 整理与 v2 导入

新技能说明见 [SKILL.md](skills/knowledge-import-v2/SKILL.md)。可把该说明、[机器Schema](knowledge-exchange-v2.schema.json)与[合成成功样例](examples/content-v2-success.json)一并交给ChatGPT，再提供本次愿意整理的资料。不会自动读取完整聊天历史或把订阅转换为API额度。

网站：知识库→统一导入→粘贴JSON/选择文件→本地解析→审核类型、领域、标签、专题、正文与章节父级→勾选创建建议→确认写入。来源、原始包和关联候选可查看；任何AI推断均不是人工确认。

v2：format=personal-knowledge-exchange、version=2，sources/items必填；domains/relations可选。content_type为note/bookmark/tool/document/block/unspecified。block必须明确parent，最终到document；章节不属于领域目录。bookmark必须HTTP/HTTPS网址，tool可无网址但需tool_kind。优先body_format=plain；HTML不导入外部图片/脚本。primary_domain指本包domains的local ID，其余domains/tags/collections为名称建议。来源引用quote必须属于对应excerpt；正文与引用日期未知时null。

旧技能升级：保留旧技能文件作为v1归档，不自动覆盖已经安装的技能。新说明改用content_type、domains树及显式文档parent；删除kind/directory的v1写法。网站勾选“确认将旧v1/纯文本转换”可继续导入旧JSON：原v1包原样保存，旧page→document，有明确页面根的point→block，其余point/capture→note；旧directory转为可审核领域建议。不会按目录猜父级，也不会未经确认创建领域树。未知分类默认不创建；同名领域已有不同父级时拒绝创建，需人工选择已有领域。

长资料上限512KiB/100条/8层，每正文或摘录100000字，拒绝而不截断。分包时每个block的文档根也必须在同一选中集合；关联两端未选中不写入，原始包仍完整保留。当前不接受远程图片；之后可用本地编辑器上传。

失败样例：[content-v2-invalid.json](examples/content-v2-invalid.json)。独立测试：node --test tests/unified.test.js。旧[knowledge-exchange.schema.json](knowledge-exchange.schema.json)保持v1，不把新v2字段塞入旧协议。
