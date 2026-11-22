# PersonalWorkspace 文档索引

本页以默认分支 `main` 的 V1.0 整合版为准。第一次使用请从[项目首页](../README.md)开始。

## 使用与维护

| 想了解什么 | 阅读 |
| --- | --- |
| 数据位置、双库备份与恢复、从旧项目迁移 | [V1.0 整合记录](INTEGRATION_V1_0.md) |
| 导入知识的操作和格式 | [导入说明](IMPORT.md)、[JSON v2 交换说明](CHATGPT_IMPORT_V2.md)、[示例文件](examples/) |
| AI 的配置、费用和数据边界 | [AI 使用与设计说明](AI.md) |

## 开发与验证

| 想了解什么 | 阅读 |
| --- | --- |
| React、Node 和双 SQLite 的分工 | [架构说明](ARCHITECTURE.md) |
| 测试范围、命令与各版本验收结果 | [测试记录](TESTING.md) |
| 数据保护及代码改动约定 | [仓库开发约定](../AGENTS.md) |
| 接续维护时的背景与限制 | [开发交接](HANDOFF.md) |

`app/client/` 放 React 界面，`app/server/` 放本机 API 与数据服务，`app/shared/` 放前后端共享逻辑。`scripts/` 放启动和迁移工具，`tests/` 放自动化与浏览器测试。

## 版本历史与开发分支

- [变更日志](CHANGELOG.md)记录已完成工作。[演进路线](ROADMAP.md)记录历史计划与候选方向。
- [V1.9 思维导图设计](DESIGN_V1_9.md)、[V1.8 阅读与批注设计](DESIGN_V1_8.md)及[历版界面记录](design/)保留了相关设计决策和截图。
- [专业知识 V0.1 分支文档](https://github.com/LINQI2/PersonalWorkspace/tree/codex/professional-knowledge-v01/docs/professional-knowledge)介绍独立领域树、知识卡和外部只读接口。
