# 专业知识只读访问

专业JSON导入格式见下例。仅使用已存在的专业领域ID；512KiB、1～100条。先预览并选择，存在同名必须明确另存，不覆盖任何原记录。导入全部保存为review状态，原包和来源进入既有备份。

```json
{"format":"professional-knowledge-v1","entries":[{"id":"local-1","title":"术语名","description":"核心定义","content":"<p>实际正文</p>","concept_kind":"concept","aliases":["English Name"],"scope_note":"适用条件与边界","professional_domains":["已有专业领域UUID"],"primary_domain":"已有专业领域UUID","sources":[{"kind":"website","title":"直接支持定义的来源","url":"https://example.com/reference","excerpt":"真实依据或明确标注的原创归纳","date_note":"适用版本、核验状态与日期"}]}]}
```

POST `/api/professional/import/preview` 接收 `{raw}`，commit接收 `{token,ids,confirm:"确认导入专业知识",duplicate?:"另存新知识"}`。这些是网站管理API，需现有同源/session保护，不属于外部只读CLI。

隔离验收可通过环境变量`PW_KNOWLEDGE_URL`选择显式IPv4回环端口。默认地址仍为127.0.0.1:5180。

运行 PersonalWorkspace 后，可使用 `node scripts/professional-read.mjs`。固定连接本机5180，不打开SQLite，不传递项目上下文，不具有写入命令。

| 命令 | 受控 HTTP GET | 返回 |
| --- | --- | --- |
| domains | /api/professional/domains | 独立领域树、范围和直接条目数 |
| search QUERY [DOMAIN_ID] | /api/professional/search?q=…&domain=…&kind=… | 最多200条稳定ID、名称、别名、摘要 |
| read ID | /api/professional/read/:id | 正文、版本、来源、状态、适用范围 |
| related ID | /api/professional/related/:id | 关系方向、状态和两端空间标识 |

目录返回 parent_id，以 null 为根；客户端可构建检索地图。搜索包含子领域、别名和正文。类别为 concept/principle/method/architecture/tool/case。未配置内容的目录允许存在。来源链接和知识空间身份均不等于已核验结论。

接口保留Host、Origin、回环地址、跨站请求和维护门检查；未新增CORS。CLI不提供人工管理API，网站写入仍需要同源标记与当前session。此版本访问边界是现有本机服务边界，并无新增账户或远程服务。
