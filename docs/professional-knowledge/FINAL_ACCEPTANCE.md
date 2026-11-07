# V0.1 最终收尾验收 / 2026-11-07

基线：a85e36c05ce169409cb0a73baf5e11bd2bbcf433。结论：**开发及测试验收通过，待正式启用**。

| 状态 | 结论 | 边界 |
| --- | --- | --- |
| 功能完成 | 通过 | 使用前轮功能/UI验收，本轮不扩展范围 |
| 内容核验 | 原剩余5张通过 | 核对实际段落、定义、边界及关联语义；不等于自动人工采用全部卡片 |
| 备份恢复方案 | 隔离双库验证通过 | 逐表、任务全字段、草稿、附件字节一致 |
| 正式启用就绪 | 条件已明确，尚未获准执行 | 本轮没有读取或验证正式库当前快照，不能称正式数据已经备份或迁移 |

## 五张内容的核验依据

原网站正文读取失败后，前三类技术资料改用作者自己的公开书稿，不再依赖检索摘要。以下链接均实际读取到正文；只保留原创归纳和链接，不复制书稿。

| 卡片 | 正文证据与结论 | 适用范围及关联复核 |
| --- | --- | --- |
| 高内聚与低耦合 | [Nystrom原稿Observer](https://github.com/munificent/game-programming-patterns/blob/master/book/observer.markdown)中讨论把同一功能聚合、在不相关领域间维持最少通信的段落，支持卡片定义 | 不把组件数量当作质量指标；与组件/观察者及SRP是相关设计目标，不是等同关系 |
| 组件模式 | [原稿Component](https://github.com/munificent/game-programming-patterns/blob/master/book/component.markdown)的Intent、The Pattern、Loose ends及接口成本讨论，支持跨领域职责拆分及必要通信 | 不等同于ECS；与组合、内聚、ECS的关系均维持related候选 |
| 观察者与事件通知 | [原稿Observer](https://github.com/munificent/game-programming-patterns/blob/master/book/observer.markdown)的成就/物理例子、注册列表、同步通知及阻塞/锁风险讨论，与卡片一致 | 同步观察者不是异步事件队列；内聚关联不表示所有通信都应使用观察者 |
| 核心游戏循环 | 原Cook链接未取得正文，替换为[Apple Developer：Onboarding for Games](https://developer.apple.com/app-store/onboarding-for-games/)的Teaching Through Tutorials段落，明确给出战斗→金币→装备→更强挑战的闭环 | 改写正文以贴合新手引导语境，流程图标为本卡归纳；MDA/反馈是相关概念，不冒称Apple提出MDA |
| FSM | [原稿State](https://github.com/munificent/game-programming-patterns/blob/master/book/state.markdown)的Finite State Machines、Enter and Exit Actions及模型局限段落，支持有限状态/输入转换/进入退出动作 | 收窄为少量可区分状态；复杂AI可能需要其他模型。角色控制器关联仅表示应用场景，不能视作控制器必定采用FSM |

涉及这五张的8条关联逐项复核，均仍为import/candidate/related，不改为confirmed或更强因果语义。保留人工审核工作流。修订仅影响版本化种子；重复初始化不会覆盖已经存在的条目或人工来源修改。若曾在隔离环境初始化旧种子，需另行人工审核更新，不静默重写。

## 双库备份与恢复证据

加强tests/professional-workflow.test.js既有工作空间测试：当前应用代码创建独立临时library.sqlite和tasks.db，初始化40卡、来源和32候选，另放入专业草稿及真实WebP附件；通过生产工作空间API导出完整ZIP。备份后同时修改专业条目并增加任务，再通过同一生产恢复API恢复。

恢复后比较全部知识表的完整行集合、任务全部字段、专业草稿和附件SHA-256，全部相同。没有只检查数量，也没有手工解压覆盖数据库。旧版ZIP向前迁移、损坏拒绝、失败回滚由原回归继续验证。所有操作均在临时目录，未打开正式data。

## 本轮必要回归

- npm run build：通过（既有主块体积告警保留）。
- npm test：102/102通过；含加强的双库恢复断言和待核验来源数归零。
- 生产UI代码未改，无本轮新增UI行为；沿用前轮已通过的三尺寸与历史功能浏览器证据，不重复无关截图测试。

## 正式迁移及启用的安全条件

1. 必须另行取得用户正式启用确认；本次提交不包含该确认。
2. 经已有实例锁与正常服务流程，在受控维护窗口生成**届时当前正式双库**完整工作空间ZIP；不得用单库ZIP冒充完整备份，不绕过锁直接开库。
3. 对该正式ZIP校验清单与哈希，并恢复到新的隔离目录；比对双库全量数据、附件和workspace草稿。保存原包、验证结果及恢复路径。
4. 通过后才正常启动schema11→12顺序迁移；核对旧内容/引用与任务保留，最后人工预览初始化。失败时使用已验证方案恢复双库并保留previous-workspace与恢复日志。

正式数据当前内容、备份、迁移及启用未在本轮执行或验收；真实付费AI、断电和磁盘满不在本轮范围。
