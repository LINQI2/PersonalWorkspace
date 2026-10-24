# V1.9 思维导图与视觉化记录

## 入口和日常使用

全局「＋新建 → 思维导图」创建正式内容，进入编辑器并聚焦中心主题输入。知识库新增「思维导图」类型，主体直接打开画布；标题和所有节点文字参与原本地搜索，沿用领域/主要领域、标签、专题、置顶、软删除与恢复。新建不是图片附件，也不调用AI。回收站导图不可编辑，恢复后继续使用原ID。

顶部为返回、标题、保存状态、手动保存与原置顶/更多菜单。第二行是节点与视图工具。默认画布优先，大纲和节点检查器按需展开；1366px可并排，390px两面板覆盖两侧、各自可收起并内部滚动。桌面为主要编辑环境，窄屏能查看、选择及基本编辑。长节点自动换行，最多2000字，最大显示宽度260px。

## 选型与许可证

2026-10-15核验官方资料及实际发布包：

| 项目 | Mind Elixir | React Flow / xyflow |
| --- | --- | --- |
| 本地与许可 | MIT、无框架依赖、无账户/云服务 | MIT，React节点/边画布，无强制云服务 |
| 树形编辑 | 已有树布局、父子拖动、同级顺序、复制/折叠、节点编辑 | 成熟平移缩放/拖动/连接；树布局和树编辑规则需自行组合 |
| 跨分支关系 | 独立arrows、方向、文字、控制点 | 独立edges，适合通用流程图 |
| 撤销/导出 | 内置撤销及SVG/PNG；本项目统一快照撤销以覆盖大纲/属性修改 | 序列化节点/边；撤销、树快捷键和图片导出需另行组合 |
| 集成结论 | 选用稳定5.15.1；实际React19/TS/Vite构建和Edge验证 | 可行，但本轮需要补更多树业务，不增加第二画布依赖 |

参考：[Mind Elixir仓库与功能](https://github.com/SSShooter/mind-elixir-core)、[API](https://docs.mind-elixir.com/docs/api)、[MIT](https://github.com/SSShooter/mind-elixir-core/blob/master/LICENSE)、[xyflow思维导图教程](https://reactflow.dev/learn/tutorials/mind-map-app-with-react-flow)、[序列化](https://reactflow.dev/examples/interaction/save-and-restore)、[许可说明](https://reactflow.dev/api-reference/types/pro-options)。锁定5.15.1，未选择npm默认的6.0预发布标签。许可原文见 [mind-elixir-MIT.txt](licenses/mind-elixir-MIT.txt)。无新增服务端运行依赖、付费插件或外部资源请求。

## 树、位置、大纲与独立连线

使用**自动树布局**。拖动节点改变父级、同级顺序及主分支左右位置；服务端保存完整顺序与direction。重新打开按相同规则布局。没有任意XY节点自由位置模式；不会显示可自由放置却保存后丢弃的坐标。窗口宽度、缩放和长文字会影响实际像素尺寸；视口平移/缩放用于当前查看，不当作知识节点坐标。跨分支连线的delta1/delta2控制点单独保存。

Tab创建子节点、Enter同级、F2/双击编辑、Delete确认删除分支、Ctrl+Z撤销、Ctrl+Y/Ctrl+Shift+Z重做。原生文字输入期间不截获节点快捷键。根节点不可删除，循环父级不能采用。父级下拉和上下移动是拖动的可访问替代。复制分支重新生成节点ID，保留文字/样式/知识链接；不会自动复制原分支对外的跨分支连线。

文字大纲与画布共用同一份结构和稳定节点ID，不做双向猜测转换。大纲箭头折叠/展开同时影响画布；点击名称选中定位。选中后使用同一工具栏和检查器编辑、添加、改父级、排序与删除。查找节点可展开祖先并居中定位。两种明暗画布主题、分支颜色和粗体均随结构JSON保存。

「节点与关联 → 跨分支连线」选择目标、说明、单向/双向；列表可改说明和删除，画布可调整控制点。树父子边和arrows独立，arrows不写knowledge_relations，不改变章节归属，也不宣称知识被人工证实。删除分支同时清除它的悬空arrows，撤销时整份结构一起恢复。重复同方向连线、自连接及不存在节点拒绝；跨分支连线可形成环，因为它不代表树父级。

## 链接既有知识

检查器本地搜索entries，可链接现有笔记、网站、工具、文档、章节、独立点或其他导图；或把标题插为新节点并链接原ID。仅保存metadata.contentId，不复制原文；节点边框/提示和大纲↗区分已链接节点。站内打开和「返回思维导图」入口保留。改名仍以ID解析，回收站目标明确提示先恢复，未知ID的导入/保存拒绝。删除导图不会删除节点链接的知识。

这些轻量节点链接不自动制造正式全站关系；原七类全站关系引擎仍在。导图本身可作为原关系引擎的真实目标，显示思维导图类型。来源、正文批注、AI审核和文档章节语义不变。

## 保存、恢复与冲突

650ms防抖，单实例仅一个写请求。每次发送独立快照；收到响应只更新相应已保存基线，期间新输入继续排队，迟到响应不覆盖当前编辑。界面区分未保存、保存中、已保存与失败。服务器事务验证修订及标题/领域/标签/专题指纹，包含其他入口的分类变更；冲突不强制覆盖。

本浏览器按数据目录+导图ID+窗口隔离恢复副本，包含正文结构，**属于个人数据**。不包含Key，不复用workspace.drafts.quick、普通笔记/知识/专题草稿。刷新恢复需明确采用；只有原修订和分类指纹均匹配才允许直接恢复。正式版本改变时只允许导出恢复稿、重新加载或明确放弃，不能悄悄覆盖。成功保存只清除此窗口相同草稿，失败不自动重试。浏览器清理存储/隐私模式/配额不足会降低恢复能力，错误时应手动保存或导出JSON。

画布文字输入期间同步保护临时结构，Esc撤销文字输入会重新同步原状态；空文字失焦遵循引擎还原，超限操作回退上一份有效结构并明确报错。真实修改刷新/关闭会提示；返回、全局导航和站内跳转先尝试保存，失败后保留恢复副本并确认。保存中拒绝立即离开。最近80次本次编辑操作可撤销，跨重启正式历史从「管理与导出 → 恢复历史」放回编辑器，再保存；不会直接覆盖正式记录。

## 数据、接口与导入导出

schema10→11只追加mindmaps(entry_id,data_json,revision,updated_at)、mindmap_versions(id,entry_id,title,data_json,revision,created_at)和历史索引。entries保留原表约束，以note/knowledge承载稳定通用内容ID；hydrate.mindmap和统一contentType将其标为独立内容类型。普通编辑接口拒绝覆盖导图。节点文字投影到plain_text，仅用于检索，正式结构始终在mindmaps。原34表不改写、不回填。

shared/mindmap.js为两端同一确定性白名单：500节点、12层（根为0）、500跨分支连线、结构UTF-8≤750000字节、每节点2000字、标题200字；导入文件≤1MB。拒绝HTML渲染、图片、任意URL、脚本、未知字段、外部样式和不存在ID。只允许安全颜色/粗体、主题枚举及有限数字控制点。新建/保存/导入预览使用原localhost、Host/Origin/session/JSON/X-PK-Request保护。GET不返回任何凭据。

兼容交换格式为 `personal-knowledge-mindmap` version1（不是全站knowledge-exchange v2）：

```json
{
  "format":"personal-knowledge-mindmap",
  "version":1,
  "title":"研究地图",
  "data":{
    "nodeData":{"id":"root","topic":"研究中心","expanded":true,"children":[{"id":"method","topic":"实验方法"},{"id":"evidence","topic":"可验证证据"}]},
    "arrows":[{"id":"edge1","from":"method","to":"evidence","label":"需要验证","bidirectional":false}],
    "direction":2,"compact":false,"appearance":"light"
  }
}
```

JSON保留节点ID、顺序、折叠、左右方向、样式、跨分支线和知识ID；导入先验证/预览，再明确创建新导图，绝不覆盖旧图。跨库未知知识ID会拒绝；可在文件副本中明确去掉metadata再导入，不自动猜测替换ID。JSON不导出站点分类ID，跨库基本分类在创建后重新选择。原JSON v1/v2内容导入不改变，也不提供不能保存的mindmap类型选项。

PNG/SVG复用引擎几何，由mindmapExport.ts按实际DOM位置重建安全文字及连线说明，过滤可执行SVG元素/属性，不把节点文字交给innerHTML；PNG上限16384单边/6400万像素。图片是实际画布图像导出；原库本地数据不送第三方。Markdown仅为文字层级和站内知识ID链接，不含完整连线、样式、折叠、历史，不承诺无损恢复。图片也不携带可编辑数据，长期迁移请用JSON或完整ZIP。ZIP包含导图和正式历史，凭据及用量日志仍不进入ZIP。旧1～10 ZIP先严格校验原结构/语义，再隔离升级11；不降级打开。

## 测试与真实截图

`npm test`、`npm run build`、`npm run typecheck`、`npm run test:browser:v19`；实际矩阵和正式保护结果见 [TESTING](TESTING.md)、[HANDOFF](HANDOFF.md)。Edge通过Playwright的msedge无头运行，不是用户手工验收。截图全部来自隔离合成库，实际打开复核：

| 界面 | 证据 |
| --- | --- |
| 画布/多层节点 | [01-map](design/v1.9/screens/01-map.png) |
| 连线与大纲 | [02-crosslink-outline](design/v1.9/screens/02-crosslink-outline.png) |
| 知识节点 | [03-knowledge-link](design/v1.9/screens/03-knowledge-link.png) |
| 1920 / 1366 / 390 | [1920](design/v1.9/screens/04-editor-1920.png)、[1366](design/v1.9/screens/04-editor-1366.png)、[390](design/v1.9/screens/04-editor-390.png) |
| 知识库/新建/空白 | [05-library](design/v1.9/screens/05-library.png)、[06-new](design/v1.9/screens/06-new.png)、[07-empty](design/v1.9/screens/07-empty.png) |
| 深色画布 | [00-dark](design/v1.9/screens/00-dark.png) |

## 限制与后续候选

不做无限白板/任意XY排布、协作、AI导图生成、全库自动关联、第三方专有格式或云端。导图JSON为本软件兼容格式，不宣称支持任意Mind Elixir插件字段；不支持的字段明确拒绝，避免静默丢弃。节点知识链接为ID跳转，不是V1.8精确原文选区锚点；未把导图节点伪装为正文批注。撤销栈为本次会话80步，正式历史列表显示最近50次，旧历史仍保留数据库/ZIP。

未做数万节点压力、所有触屏/辅助技术、干净机器初装、断电/磁盘满或Windows整机重启；云端AI全部模拟，DeepSeek旧超时仍疑似上游异常待复测。后续可评估更精细的画布导航记忆、大图虚拟化和受控交换协议扩展；本轮停止V1.9，不自行实施。
