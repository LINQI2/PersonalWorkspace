import { relationTypes } from '../relations.js';
import { parseProfessional } from '../professional-import.js';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { cleanContent, validUrl } from '../store.js';
export const exchangeSchema = JSON.parse(
  readFileSync(new URL('../../../docs/knowledge-exchange.schema.json', import.meta.url), 'utf8'),
);
export const exchangeSchemaV2 = JSON.parse(
  readFileSync(new URL('../../../docs/knowledge-exchange-v2.schema.json', import.meta.url), 'utf8'),
);
export const MAX_INPUT = 512 * 1024;
export const escapeText = (s) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
export const textHtml = (s) =>
  s
    .split(/\r?\n/)
    .map((l) => '<p>' + escapeText(l) + '</p>')
    .join('');
export function bounded(value, depth = 0) {
  if (depth > 8) throw Error('资料嵌套超过 8 层。');
  if (value && typeof value === 'object')
    for (const [key, v] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key))
        throw Error('资料含不安全字段。');
      bounded(v, depth + 1);
    }
}
export function validateExchangeSchema(value, schema = exchangeSchema, path = '资料') {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const type = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (!types.includes(type) && !(types.includes('integer') && Number.isSafeInteger(value)))
    throw Error(path + ' 类型无效。');
  if (schema.enum && !schema.enum.includes(value)) throw Error(path + ' 候选值无效。');
  if (type === 'null') return;
  if (
    type === 'number' &&
    (!Number.isFinite(value) ||
      value < (schema.minimum ?? -Infinity) ||
      value > (schema.maximum ?? Infinity))
  )
    throw Error(path + ' 数值无效。');
  if (
    type === 'string' &&
    (value.length > (schema.maxLength ?? Infinity) ||
      value.length < (schema.minLength ?? 0) ||
      (schema.pattern && !new RegExp(schema.pattern).test(value)))
  )
    throw Error(path + ' 长度或格式无效。');
  if (type === 'array') {
    if (value.length > (schema.maxItems ?? Infinity) || value.length < (schema.minItems ?? 0))
      throw Error(path + ' 数量无效。');
    value.forEach((v, i) => validateExchangeSchema(v, schema.items, path + '[' + i + ']'));
  }
  if (type === 'object') {
    if (
      (schema.required || []).some((k) => !Object.hasOwn(value, k)) ||
      Object.keys(value).some((k) => !Object.hasOwn(schema.properties, k))
    )
      throw Error(path + ' 缺少必填或含未知字段。');
    for (const [k, v] of Object.entries(value))
      validateExchangeSchema(v, schema.properties[k], path + '.' + k);
  }
}
export function checkedDate(value) {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number(value.slice(0, 4)) < 1
  )
    throw Error('原始日期必须为 YYYY-MM-DD 或未知。');
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw Error('原始日期不存在。');
  return value;
}
export function parseExchange(raw, format = 'json') {
  if (typeof raw !== 'string' || !raw.trim() || Buffer.byteLength(raw) > MAX_INPUT)
    throw Error('导入资料为空或超过 512 KiB。');
  if (!['json', 'markdown', 'text'].includes(format)) throw Error('导入格式无效。');
  let value;
  if (format === 'json') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw Error('JSON 无法解析，请核对完整对象，不要包含代码围栏。');
    }
    bounded(value);
    if(value.format==='professional-knowledge-v1'){
      const canonical=JSON.parse(raw);parseProfessional(raw);
      return {raw,format:'json',value:{...value,items:value.entries},hash:createHash('sha256').update(JSON.stringify(canonical)).digest('hex')};
    }
    if (value.version === 2) return parseV2(value, raw);
    validateExchangeSchema(value);
  } else {
    if (raw.length > 100000)
      throw Error('人工粘贴单条资料最多 100000 字，请拆分原文，不会静默截断。');
    value = {
      format: 'personal-knowledge-exchange',
      version: 1,
      sources: [{ id: 'raw', kind: 'other', title: '人工粘贴原始资料', excerpt: raw }],
      items: [
        {
          id: 'raw-record',
          title: format === 'markdown' ? 'Markdown 原始收集' : '文本原始收集',
          body: raw,
          kind: 'capture',
          status: 'inbox',
          epistemic: 'reported_fact',
          references: [{ source_id: 'raw', quote: '' }],
        },
      ],
    };
  }
  const unique = (rows, label) => {
    if (new Set(rows.map((r) => r.id)).size !== rows.length) throw Error(label + ' ID 重复。');
  };
  unique(value.sources, '来源');
  unique(value.items, '知识');
  unique(value.directories || [], '目录');
  const sources = new Map(value.sources.map((s) => [s.id, s])),
    items = new Set(value.items.map((i) => i.id)),
    dirs = new Map((value.directories || []).map((d) => [d.id, d]));
  for (const s of sources.values()) {
    checkedDate(s.original_date);
    checkedTimestamp(s.recorded_at);
    if (s.url != null && !validUrl(s.url))
      throw Error('来源网址不安全；仅允许用户提供 HTTP/HTTPS，不代表已验证。');
    if (!s.title.trim()) throw Error('来源标题为空。');
  }
  for (const d of dirs.values()) {
    if (!d.name.trim()) throw Error('目录名称为空。');
    const visited = new Set([d.id]);
    let p = d.parent;
    while (p) {
      if (!dirs.has(p) || visited.has(p) || visited.size >= 8)
        throw Error('目录父级缺失、循环或超过 8 层。');
      visited.add(p);
      p = dirs.get(p).parent;
    }
  }
  for (const i of value.items) {
    for (const k of ['domains', 'tags', 'collections'])
      if ((i[k] || []).some((n) => !n.trim())) throw Error('分类建议名称为空。');
    if (!i.title.trim()) throw Error('知识标题为空。');
    checkedDate(i.original_date);
    checkedTimestamp(i.recorded_at);
    if (i.directory && !dirs.has(i.directory)) throw Error('建议目录 ID 不存在。');
    if (i.parent && (!items.has(i.parent) || i.parent === i.id))
      throw Error('上下级建议 ID 不存在或引用自己。');
    const seen = new Set();
    for (const ref of i.references || []) {
      const s = sources.get(ref.source_id);
      if (!s || seen.has(ref.source_id) || (ref.quote && !s.excerpt.includes(ref.quote)))
        throw Error('来源引用缺失、重复或摘录不属于源文字。');
      seen.add(ref.source_id);
    }
    if (
      i.body_format === 'html' &&
      (/\b(on\w+\s*=|javascript:|data:|data-entry-id)/i.test(i.body) ||
        /<\/?(script|iframe|object|style|img)\b/i.test(i.body))
    )
      throw Error('导入 HTML 含不安全内容或外部图片；请改为纯文本。');
    i.content = i.body_format === 'html' ? cleanContent(i.body) : textHtml(i.body);
  }
  for (const r of value.relations || [])
    if (!items.has(r.from) || !items.has(r.to) || r.from === r.to)
      throw Error('关系引用不属于本次资料。');
  const canonical = { ...value, items: value.items.map(({ content, ...i }) => i) };
  return {
    value,
    raw,
    format,
    hash: createHash('sha256')
      .update(format + '\n' + JSON.stringify(canonical))
      .digest('hex'),
  };
}
export function checkedTimestamp(value) {
  if (value == null) return null;
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    Number(value.slice(11, 13)) > 23 ||
    Number(value.slice(14, 16)) > 59 ||
    Number(value.slice(17, 19)) > 59
  )
    throw Error('用户记录时间需为带时区的有效 ISO 时间或未知。');
  checkedDate(value.slice(0, 10));
  return value;
}

function parseV2(value, raw) {
  validateExchangeSchema(value, exchangeSchemaV2);
  const legacy = {
    ...value,
    version: 1,
    directories: value.domains || [],
    items: value.items.map((i) => {
      const { content_type, url, description, tool_kind, primary_domain, ...rest } = i;
      if ((content_type === 'bookmark' || url) && !validUrl(url))
        throw Error('网站收藏需要有效HTTP/HTTPS网址。');
      if (content_type === 'tool' && !tool_kind) throw Error('工具需要明确工具类型。');
      if (primary_domain && !(value.domains || []).some((d) => d.id === primary_domain))
        throw Error('主要领域建议ID不存在。');
      if (i.parent && content_type !== 'block') throw Error('只有文档知识块可以设置章节父级。');
      return {
        ...rest,
        kind: content_type === 'document' ? 'page' : content_type === 'block' ? 'point' : 'capture',
      };
    }),
  };
  delete legacy.domains;
  legacy.relations = (legacy.relations || []).map((r) => ({
    ...r,
    kind:
      relationTypes.includes(r.kind) && !['complement', 'conflict', 'revision'].includes(r.kind)
        ? 'parent'
        : r.kind,
  }));
  const checked = parseExchange(JSON.stringify(legacy)).value;
  const map = new Map(value.items.map((i) => [i.id, i]));
  for (const i of value.items) {
    if (i.content_type === 'block') {
      let p = i.parent;
      const seen = new Set([i.id]);
      while (p) {
        if (seen.has(p) || seen.size >= 8) throw Error('文档章节循环或超过8层。');
        seen.add(p);
        const r = map.get(p);
        if (!r) throw Error('章节父级缺失。');
        if (r.content_type === 'document') {
          p = null;
          break;
        }
        if (r.content_type !== 'block') throw Error('章节最终必须属于综合文档。');
        p = r.parent;
      }
      if (!i.parent || map.get([...seen].at(-1))?.content_type !== 'document')
        throw Error('知识块必须明确属于综合文档。');
    }
    i.content = checked.items.find((r) => r.id === i.id).content;
  }
  const canonical = { ...value, items: value.items.map(({ content, ...i }) => i) };
  return {
    value,
    raw,
    format: 'json',
    hash: createHash('sha256')
      .update('json\n' + JSON.stringify(canonical))
      .digest('hex'),
  };
}
