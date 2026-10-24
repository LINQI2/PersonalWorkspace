---
name: knowledge-import-v2
description: 将用户提供的对话或研究资料整理为个人知识收藏馆可人工审核导入的JSON v2，保留来源、认知日期和文档章节；不读取私人历史或直接写入知识库。
---

# 知识馆 v2 整理导出

先读用户提供的[Schema](../../knowledge-exchange-v2.schema.json)及[样例](../../examples/content-v2-success.json)；这里的相对链接按本仓库docs/skills层级使用。交给ChatGPT时同时附上这些文件。只整理用户本次提供或明确选择的资料。

输出单个JSON对象，不含代码围栏。format固定personal-knowledge-exchange，version=2。使用Schema定义的字段，拒绝自行添加字段。

- 普通笔记用note，网址收藏用bookmark且提供真实HTTP/HTTPS网址，工具用tool并选择tool_kind（网址可空），完整研究用一个document概览。
- 研究的知识块用block，parent明确指向该document或其block；最多8层、无环。不要把完整研究拆成大量独立平铺note，不以相同领域推定从属关系。需要单独维护的独立内容才用note。
- 未能可靠确定类型时用unspecified，让用户审核选择。所有正文保留，优先plain；不生成远程图片、脚本或可执行HTML。
- domains定义领域树local ID/name/parent；item.primary_domain指local ID，item.domains/tags/collections仅提供名称建议。专题按任务组织，章节不当子领域。
- sources记录真正给出的原始摘录、来源类型和网址；item.references的source_id只能引用包内真实来源，quote必须逐字存在于excerpt。网址未读正文不能称已验证；不虚构引用。
- original_date是实际可证实的认知或来源日期，不是本次整理日期；未知null。recorded_at只填确有证据的带时区记录时间，否则null。
- epistemic区分reported_fact/ai_inference/user_judgment。user_judgment只是原资料声称的判断；导入不能输出confirmed状态。建议status=review。
- relations仅生成duplicate/complement/conflict/revision/parent候选，保留不同阶段判断和不确定性，不擅自合并冲突，不删除原文。

提交前核对local ID唯一、父级/来源/关联两端存在、日期与引文真实、输入大小及100条上限。超过限额先提供可审核分包计划，每包含必要文档根和来源，不静默截断。模型输出只供用户导入预览、修改和确认，不授权写入数据库、调用付费API或清理资料。
