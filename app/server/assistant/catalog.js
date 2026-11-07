import { spaceSql } from '../space.js';
import { lifecycle, visibleSql } from '../lifecycle.js';
import { unifiedVersion, provenance, domainTree } from '../unified.js';
import { createHash } from 'node:crypto';
import sanitize from 'sanitize-html';
import { decodeHTML } from 'entities';
import { owner, chapterRows } from '../knowledge/structure.js';
export const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const plain = (html) =>
  decodeHTML(sanitize(html || '', { allowedTags: [], allowedAttributes: {} }));
export const groups = ['domains', 'tags', 'collections', 'directories', 'entries'];
export function resolve(db, key) {
  if (typeof key !== 'string') throw Error('资料 ID 无效。');
  const [kind, id, ...extra] = key.split(':');
  if (!groups.includes(kind) || !id || extra.length) throw Error('资料 ID 无效。');
  let r,
    count,
    text = '',
    date = null,
    pageId = null;
  if (kind === 'entries') {
    r = db.prepare('SELECT * FROM entries WHERE id=?').get(id);
    if (!r || lifecycle(db, id)?.state === 'trash')
      throw Error('来源已不存在或在回收站，请先恢复。');
    const k = db.prepare('SELECT * FROM knowledge_records WHERE entry_id=?').get(id),
      s = db.prepare('SELECT * FROM knowledge_structure WHERE entry_id=?').get(id);
    count = 1;
    text = r.description + '\n' + r.plain_text;
    date =
      k?.original_date ||
      (unifiedVersion(db) ? provenance(db, id).record?.original_date : null) ||
      null;
    pageId = k ? owner(db, id) : null;
    const imported = unifiedVersion(db) ? provenance(db, id) : null;
    const sourceRows = k
      ? db
          .prepare(
            'SELECT s.id,s.kind,s.title,s.url,s.original_date,s.date_note,s.excerpt,r.quote FROM knowledge_sources s JOIN knowledge_entry_sources r ON r.source_id=s.id WHERE r.entry_id=? ORDER BY s.id',
          )
          .all(id)
      : imported?.sources || [];
    return {
      key,
      kind,
      id,
      name: r.title,
      text,
      date,
      status: k?.status || imported?.record?.status || null,
      epistemic: k?.epistemic || imported?.record?.epistemic || 'user_material',
      sourceDates: sourceRows.map((s) => ({
        id: s.id,
        kind: s.kind,
        title:s.title,
        url:s.url,
        date: s.original_date,
        note: s.date_note,
      })),
      pageId,
      entryKind: k?.kind || r.resource_kind,
      space: db.prepare('PRAGMA user_version').get().user_version >= 12 && db.prepare('SELECT 1 FROM professional_entries WHERE entry_id=?').get(id) ? 'professional' : 'personal',
      hasEvidence: text.replace(/https?:\/\/\S+/g, '').replace(/\s/g, '').length >= 24,
      count: 1,
      parent: s?.parent_id || null,
      directory: k?.directory_id || null,
      categories: Object.fromEntries(
        ['domains', 'tags', 'collections'].map((kind) => [
          kind,
          db
            .prepare(
              `SELECT t.id,t.name FROM ${kind} t JOIN entry_${kind} r ON r.taxonomy_id=t.id WHERE r.entry_id=? ORDER BY t.id`,
            )
            .all(id)
            .map((t) => ({ key: kind + ':' + t.id, name: t.name })),
        ]),
      ),
      hash: hash([
        r,
        k,
        s,
        sourceRows,
        imported,
        unifiedVersion(db)
          ? db.prepare('SELECT * FROM content_primary_domains WHERE entry_id=?').all(id)
          : [],
        unifiedVersion(db) ? domainTree(db) : [],
        db.prepare('SELECT * FROM entry_domains WHERE entry_id=?').all(id),
        db.prepare('SELECT * FROM entry_tags WHERE entry_id=?').all(id),
        db.prepare('SELECT * FROM entry_collections WHERE entry_id=?').all(id),
      ]),
    };
  }
  if (kind === 'directories') {
    r = db.prepare('SELECT * FROM knowledge_directories WHERE id=?').get(id);
    if (!r) throw Error('目录已不存在。');
    const records = db
        .prepare(
          'SELECT e.id,e.title FROM entries e JOIN knowledge_records k ON k.entry_id=e.id WHERE k.directory_id=? ORDER BY e.id',
        )
        .all(id),
      children = db
        .prepare('SELECT * FROM knowledge_directories WHERE parent_id=? ORDER BY id')
        .all(id);
    count = records.length + children.length;
    text =
      '目录结构元数据（不代表正文）：' +
      r.name +
      '；资源数量 ' +
      records.length +
      '；子目录 ' +
      children.map((c) => c.name).join('、');
    return {
      key,
      kind,
      id,
      name: r.name,
      text,
      date: null,
      count,
      parent: r.parent_id,
      parentName: r.parent_id
        ? db.prepare('SELECT name FROM knowledge_directories WHERE id=?').get(r.parent_id)?.name
        : null,
      hasEvidence: true,
      hash: hash([r, records, children]),
    };
  }
  r = db.prepare(`SELECT * FROM ${kind} WHERE id=?`).get(id);
  if (!r) throw Error('分类已不存在。');
  const links = db
    .prepare(`SELECT entry_id FROM entry_${kind} WHERE taxonomy_id=? ORDER BY entry_id`)
    .all(id);
  count = links.length;
  const doc =
    kind === 'collections'
      ? db.prepare('SELECT * FROM collection_documents WHERE collection_id=?').get(id)
      : null;
  if (doc) text = doc.introduction + '\n' + plain(doc.content);
  else text = '分类结构元数据（不代表资源正文）：' + r.name + '；关联资源数量 ' + count;
  return {
    key,
    kind,
    id,
    name: r.name,
    text,
    date: null,
    count,
    parent:
      kind === 'domains' && unifiedVersion(db)
        ? domainTree(db).find((d) => d.id === id)?.parent_id || null
        : null,
    hasEvidence: kind === 'collections' ? text.replace(/\s/g, '').length >= 24 : true,
    hash: hash([
      r,
      kind === 'domains' && unifiedVersion(db)
        ? db.prepare('SELECT * FROM domain_structure WHERE domain_id=? OR parent_id=?').all(id, id)
        : [],
      links,
      doc,
      kind === 'collections'
        ? db.prepare('SELECT * FROM collection_drafts WHERE collection_id=? ORDER BY kind').all(id)
        : [],
    ]),
  };
}
export function catalog(db) {
  const out = [];
  for (const kind of groups.filter((k) => !unifiedVersion(db) || k !== 'directories')) {
    const table = kind === 'directories' ? 'knowledge_directories' : kind;
    for (const r of db
      .prepare(
        `SELECT id FROM ${table} e ${kind === 'entries' ? 'WHERE ' + visibleSql(db) + ' AND ' + spaceSql(db) : ''} ORDER BY id`,
      )
      .all())
      out.push(resolve(db, kind + ':' + r.id));
  }
  return out;
}
const normalized = (s) =>
  s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}]/gu, '');
export function inspect(db) {
  const objects = catalog(db),
    candidates = [];
  for (const o of objects) {
    if (
      o.kind !== 'entries' &&
      (o.name.length > 20 || ['其他', '资料', '新目录', '未分类'].includes(o.name))
    )
      candidates.push({
        key: o.key,
        target: '',
        action: 'rename',
        reason: '名称过长或含糊，请核对实际含义',
        count: o.count,
      });
    if (o.kind === 'entries') {
      const noTags = !db.prepare('SELECT entry_id FROM entry_tags WHERE entry_id=?').get(o.id);
      if (noTags || (o.entryKind === 'point' && !o.pageId))
        candidates.push({
          key: o.key,
          target: '',
          action: 'keep',
          reason: noTags
            ? '缺少标签，需结合正文人工判断'
            : '独立知识点尚无页面归属，不能按同目录猜测',
          count: 1,
        });
    }
    if (o.kind === 'directories' || o.kind === 'domains') {
      let depth = 1,
        p = o.parent;
      while (p && depth <= 8) {
        depth++;
        p = objects.find((v) => v.key === o.kind + ':' + p)?.parent;
      }
      if (depth >= 5)
        candidates.push({
          key: o.key,
          target: '',
          action: 'move',
          reason: '目录层级较深（' + depth + '层），请核对是否有必要',
          count: o.count,
        });
    }
  }
  for (const kind of groups.filter((k) => k !== 'entries')) {
    const rows = objects.filter((o) => o.kind === kind),
      buckets = new Map();
    for (const o of rows) {
      const key = normalized(o.name),
        prior = buckets.get(key);
      if (prior)
        candidates.push({
          key: o.key,
          target: prior.key,
          action: 'merge',
          reason: '标准化名称相同，仅为候选，不等于语义相同',
          count: o.count,
        });
      else buckets.set(key, o);
    }
  }
  return {
    objects: objects.map(({ text, ...r }) => ({ ...r, excerpt: text.slice(0, 240) })),
    candidates: candidates.slice(0, 100),
    totalCandidates: candidates.length,
  };
}
export function retrieve(db, question, space = 'personal') {
  if (typeof question !== 'string' || !question.trim() || question.length > 1000)
    throw Error('请输入 1～1000 字问题。');
  const stop = new Set([
    '的',
    '了',
    '是',
    '有',
    '什么',
    '哪些',
    '如何',
    '请',
    '我',
    '你',
    '吗',
    '关于',
    '和',
    '与',
    '知识',
    '资料',
  ]);
  const terms = [
    ...new Set(
      [...new Intl.Segmenter('zh', { granularity: 'word' }).segment(question)]
        .filter((s) => s.isWordLike && !stop.has(s.segment))
        .map((s) => s.segment),
    ),
  ].slice(0, 12);
  if (!terms.length) return { items: [], terms, notice: '未找到具体检索词，请补充主题。' };
  // SQL narrows candidates locally. Only user-selected complete evidence is sent to the model.
  const rows = [];
  for (const kind of groups) {
    const table = kind === 'directories' ? 'knowledge_directories' : kind;
    const expr =
      kind === 'entries'
        ? "title||' '||description||' '||plain_text" + (db.prepare('PRAGMA user_version').get().user_version >= 12 ? "||' '||COALESCE((SELECT aliases_json FROM professional_entries WHERE entry_id=e.id),'')" : '')
        : kind === 'collections'
          ? "name||' '||COALESCE((SELECT introduction||' '||content FROM collection_documents WHERE collection_id=e.id),'')"
          : 'name';
    const clause = terms.map(() => `(${expr}) LIKE ? ESCAPE '\\'`).join(' OR ');
    for (const r of db
      .prepare(`SELECT id FROM ${table} e WHERE (${clause}) AND ${kind === 'entries' ? spaceSql(db,space)+' AND '+visibleSql(db) : space === 'professional' ? '0' : '1'} LIMIT 80`)
      .all(...terms.map((t) => '%' + t.replace(/[\\%_]/g, '\\$&') + '%')))
      rows.push(resolve(db, kind + ':' + r.id));
  }
  const scored = rows
    .map((r) => ({
      ...r,
      score: terms.reduce(
        (n, t) =>
          n +
          (r.name.toLowerCase().includes(t.toLowerCase()) ? 4 : 0) +
          (r.text.toLowerCase().includes(t.toLowerCase()) ? 1 : 0),
        0,
      ),
    }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
  return {
    items: scored.slice(0, 40).map(({ text, ...r }) => ({ ...r, excerpt: text.slice(0, 240) })),
    terms,
    notice: 'SQLite 本地关键词召回；预览为节选，AI 使用你选中的完整文字。网址不会被抓取。',
  };
}
export function scope(db, input) {
  if (!Array.isArray(input.keys) || input.keys.length > 20) throw Error('范围选择无效。');
  const ids = new Set();
  for (const key of input.keys) {
    const r = resolve(db, key);
    if (r.kind === 'entries') {
      const k = db.prepare('SELECT kind FROM knowledge_records WHERE entry_id=?').get(r.id);
      if (!k) continue;
      ids.add(r.id);
      if (k.kind === 'page') chapterRows(db, r.id).forEach((c) => ids.add(c.id));
    } else if (r.kind === 'domains' && unifiedVersion(db)) {
      const descendants = new Set([r.id]);
      const domains = domainTree(db);
      for (let changed = true; changed;) {
        changed = false;
        for (const d of domains)
          if (d.parent_id && descendants.has(d.parent_id) && !descendants.has(d.id)) {
            descendants.add(d.id);
            changed = true;
          }
      }
      const placeholders = [...descendants].map(() => '?').join(',');
      for (const row of db
        .prepare(
          'SELECT k.entry_id FROM knowledge_records k JOIN entry_domains d ON d.entry_id=k.entry_id WHERE d.taxonomy_id IN (' +
            placeholders +
            ')',
        )
        .all(...descendants)) {
        ids.add(row.entry_id);
        if (
          db.prepare('SELECT kind FROM knowledge_records WHERE entry_id=?').get(row.entry_id)
            ?.kind === 'page'
        )
          chapterRows(db, row.entry_id).forEach((c) => ids.add(c.id));
      }
    } else if (r.kind === 'directories') {
      const walk = (id, depth) => {
        if (depth >= 8) throw Error('目录层级无效。');
        db.prepare('SELECT entry_id FROM knowledge_records WHERE directory_id=?')
          .all(id)
          .forEach((r) => ids.add(r.entry_id));
        db.prepare('SELECT id FROM knowledge_directories WHERE parent_id=?')
          .all(id)
          .forEach((r) => walk(r.id, depth + 1));
      };
      walk(r.id, 0);
    }
  }
  if (ids.size > 200) throw Error('范围超过200条，请缩小目录选择，未截断。');
  return {
    items: [...ids].map((id) => {
      const { text, ...r } = resolve(db, 'entries:' + id);
      return { ...r, excerpt: text.slice(0, 240) };
    }),
    count: ids.size,
  };
}
