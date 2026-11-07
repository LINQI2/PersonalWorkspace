import { spaceSql } from './space.js';
import { visibleSql } from './lifecycle.js';
import { randomUUID, createHash } from 'node:crypto';
import { transaction } from './knowledge/store.js';
import { parseExchange, checkedDate, checkedTimestamp } from './knowledge/exchange.js';
export const unifiedTables = [
  'domain_structure',
  'content_primary_domains',
  'content_provenance',
  'content_source_links',
  'collection_rules',
  'library_views',
];
export const unifiedVersion = (db) => db.prepare('PRAGMA user_version').get().user_version >= 7;
export function domainTree(db) {
  const rows = db
    .prepare(
      `SELECT d.*,s.parent_id,coalesce(s.position,0) position,
    (SELECT count(*) FROM entry_domains e WHERE e.taxonomy_id=d.id) count
    FROM domains d LEFT JOIN domain_structure s ON s.domain_id=d.id ORDER BY position,d.name,d.id`,
    )
    .all();
  const map = new Map(rows.map((r) => [r.id, r]));
  for (const r of rows) {
    let p = r.parent_id;
    const seen = new Set([r.id]);
    while (p) {
      if (!map.has(p) || seen.has(p) || seen.size >= 8)
        throw Error('领域树父级缺失、循环或超过8层。');
      seen.add(p);
      p = map.get(p).parent_id;
    }
  }
  return rows;
}
export function domainScope(db, id) {
  const rows = domainTree(db);
  if (!rows.some((r) => r.id === id)) throw Error('领域已不存在。');
  const ids = [id];
  for (let n = 0; n < ids.length; n++)
    ids.push(...rows.filter((r) => r.parent_id === ids[n]).map((r) => r.id));
  return ids;
}
export function saveDomain(db, input, id) {
  const work = () => {
    const name = input.name?.trim();
    if (!name || name.length > 50) throw Error('领域名称必填，最多50字。');
    if (id && !db.prepare('SELECT id FROM domains WHERE id=?').get(id)) throw Error('领域不存在。');
    const key = id || randomUUID(),
      old = id ? domainTree(db).find((r) => r.id === id) : null;
    const parent = Object.hasOwn(input, 'parent_id') ? input.parent_id : old?.parent_id || null;
    if (parent && !db.prepare('SELECT id FROM domains WHERE id=?').get(parent))
      throw Error('父领域不存在。');
    if (id) db.prepare('UPDATE domains SET name=? WHERE id=?').run(name, id);
    else db.prepare('INSERT INTO domains VALUES(?,?)').run(key, name);
    const position =
      input.position ??
      old?.position ??
      domainTree(db).filter((r) => r.parent_id === parent).length;
    if (!Number.isSafeInteger(position) || position < 0) throw Error('领域排序无效。');
    db.prepare(
      'INSERT INTO domain_structure VALUES(?,?,?) ON CONFLICT(domain_id) DO UPDATE SET parent_id=excluded.parent_id,position=excluded.position',
    ).run(key, parent, position);
    domainTree(db);
    return { id: key, name, parent_id: parent, position };
  };
  return db.isTransaction ? work() : transaction(db, work);
}
export function deleteDomain(db, id) {
  if (
    db.prepare('SELECT domain_id FROM domain_structure WHERE parent_id=?').get(id) ||
    db.prepare('SELECT entry_id FROM entry_domains WHERE taxonomy_id=?').get(id) ||
    db.prepare('SELECT entry_id FROM content_primary_domains WHERE domain_id=?').get(id)
  )
    throw Error('领域仍有子领域或内容，请先明确调整归属。');
  if (
    db
      .prepare('SELECT rules_json FROM collection_rules')
      .all()
      .some((r) => JSON.parse(r.rules_json).domains.includes(id)) ||
    db
      .prepare('SELECT filters_json FROM library_views')
      .all()
      .some((r) => JSON.parse(r.filters_json).domains.includes(id))
  )
    throw Error('专题规则或快捷视图仍引用此领域，请先修改规则。');
  db.prepare('DELETE FROM domains WHERE id=?').run(id);
  return { ok: true };
}
export function assignPrimary(db, id, domain) {
  if (!db.prepare('SELECT id FROM entries WHERE id=?').get(id)) throw Error('内容不存在。');
  if (
    domain &&
    !db
      .prepare('SELECT entry_id FROM entry_domains WHERE entry_id=? AND taxonomy_id=?')
      .get(id, domain)
  )
    throw Error('主要领域必须来自已选领域。');
  db.prepare('DELETE FROM content_primary_domains WHERE entry_id=?').run(id);
  if (domain) db.prepare('INSERT INTO content_primary_domains VALUES(?,?)').run(id, domain);
}
export const contentType = (e) =>
  e.mindmap
    ? 'mindmap'
    : e.resource_kind === 'tool'
      ? 'tool'
      : e.knowledge_kind === 'page'
        ? 'document'
        : e.type === 'bookmark'
          ? 'bookmark'
          : 'note';
export function validateFilters(db, rule) {
  if (
    !rule ||
    typeof rule !== 'object' ||
    Array.isArray(rule) ||
    Object.keys(rule).some((k) => !['domains', 'tags', 'types'].includes(k))
  )
    throw Error('动态专题规则格式无效。');
  for (const k of ['domains', 'tags', 'types'])
    if (!Array.isArray(rule[k]) || rule[k].length > 20 || new Set(rule[k]).size !== rule[k].length)
      throw Error('动态专题条件无效。');
  for (const k of ['domains', 'tags'])
    for (const id of rule[k])
      if (typeof id !== 'string' || !db.prepare(`SELECT id FROM ${k} WHERE id=?`).get(id))
        throw Error('动态专题分类已变化。');
  if (rule.types.some((t) => !['note', 'bookmark', 'tool', 'document', 'mindmap'].includes(t)))
    throw Error('内容类型无效。');
  return rule;
}
export function ruleMembers(db, id, providedRule) {
  const r = providedRule
    ? { rules_json: JSON.stringify(providedRule) }
    : db.prepare('SELECT rules_json FROM collection_rules WHERE collection_id=?').get(id);
  if (!r) return [];
  const rule = validateFilters(db, JSON.parse(r.rules_json));
  const domains = new Set(rule.domains.flatMap((d) => domainScope(db, d)));
  return db
    .prepare(
      `SELECT e.id,e.type,e.resource_kind,k.kind knowledge_kind,EXISTS(SELECT 1 FROM mindmaps m WHERE m.entry_id=e.id) mindmap FROM entries e LEFT JOIN knowledge_records k ON k.entry_id=e.id WHERE ${visibleSql(db)} AND ${spaceSql(db)} AND NOT EXISTS(SELECT 1 FROM knowledge_structure s WHERE s.entry_id=e.id)`,
    )
    .all()
    .filter(
      (e) =>
        (!rule.types.length || rule.types.includes(contentType(e))) &&
        (!domains.size ||
          db
            .prepare('SELECT taxonomy_id FROM entry_domains WHERE entry_id=?')
            .all(e.id)
            .some((r) => domains.has(r.taxonomy_id))) &&
        (!rule.tags.length ||
          db
            .prepare('SELECT taxonomy_id FROM entry_tags WHERE entry_id=?')
            .all(e.id)
            .some((r) => rule.tags.includes(r.taxonomy_id))),
    )
    .map((e) => e.id);
}
export function setRule(db, id, input) {
  if (input.confirm !== '确认专题筛选规则') throw Error('请审核规则后明确确认。');
  if (!db.prepare('SELECT id FROM collections WHERE id=?').get(id)) throw Error('专题不存在。');
  if (input.rules === null)
    db.prepare('DELETE FROM collection_rules WHERE collection_id=?').run(id);
  else {
    validateFilters(db, input.rules);
    db.prepare(
      'INSERT INTO collection_rules VALUES(?,?,?) ON CONFLICT(collection_id) DO UPDATE SET rules_json=excluded.rules_json,updated_at=excluded.updated_at',
    ).run(id, JSON.stringify(input.rules), new Date().toISOString());
  }
  return { ids: ruleMembers(db, id) };
}
export function provenance(db, id) {
  const record = db.prepare('SELECT * FROM content_provenance WHERE entry_id=?').get(id);
  const sources = db
    .prepare(
      'SELECT s.*,r.quote FROM knowledge_sources s JOIN content_source_links r ON r.source_id=s.id WHERE r.entry_id=?',
    )
    .all(id);
  const relations = db
    .prepare(
      'SELECT r.*,a.title from_title,b.title to_title FROM knowledge_relations r JOIN entries a ON a.id=r.from_id JOIN entries b ON b.id=r.to_id WHERE r.from_id=? OR r.to_id=? ORDER BY r.created_at',
    )
    .all(id, id);
  return { record: record || null, sources, relations };
}
export function cleanupCandidates(db) {
  // Read-only inventory. A title match is only a candidate, never authorization to delete.
  const rows = db
    .prepare(
      `SELECT e.id,e.title,k.kind,k.directory_id,k.original_date,k.revision,e.updated_at,
    (SELECT count(*) FROM knowledge_entry_sources s WHERE s.entry_id=e.id) sources,
    (SELECT count(*) FROM entry_collections c WHERE c.entry_id=e.id) topics,
    (SELECT count(*) FROM knowledge_structure s WHERE s.parent_id=e.id) children
    FROM entries e JOIN knowledge_records k ON k.entry_id=e.id ORDER BY e.created_at`,
    )
    .all();
  return {
    notice: '仅候选清单，未清理。须用户逐项确认；其他内容、来源、专题和凭据保留。',
    candidates: rows.map((r) => ({
      ...r,
      reason: '旧知识结构候选；仅凭标题不认定为可删除测试数据',
    })),
    legacyDirectories: db.prepare('SELECT * FROM knowledge_directories').all(),
  };
}
export function validateUnified(db) {
  if (!unifiedVersion(db)) return;
  domainTree(db);
  for (const r of db.prepare('SELECT * FROM content_primary_domains').all())
    if (
      !db
        .prepare('SELECT entry_id FROM entry_domains WHERE entry_id=? AND taxonomy_id=?')
        .get(r.entry_id, r.domain_id)
    )
      throw Error('主要领域与关联不一致。');
  for (const r of db.prepare('SELECT * FROM content_provenance').all()) {
    checkedDate(r.original_date);
    checkedTimestamp(r.provided_recorded_at);
    const b = db.prepare('SELECT * FROM knowledge_imports WHERE id=?').get(r.batch_id);
    if (!b || !parseExchange(b.raw_input, b.format).value.items.some((i) => i.id === r.local_id))
      throw Error('统一内容导入追溯无效。');
  }
  for (const r of db
    .prepare(
      'SELECT r.quote,s.excerpt FROM content_source_links r JOIN knowledge_sources s ON s.id=r.source_id',
    )
    .all())
    if (r.quote.length > 10000 || (r.quote && !r.excerpt.includes(r.quote)))
      throw Error('统一内容引用摘录无效。');
  for (const r of db.prepare('SELECT * FROM collection_rules').all()) {
    validateFilters(db, JSON.parse(r.rules_json));
    checkedTimestamp(r.updated_at);
  }
  for (const r of db.prepare('SELECT * FROM library_views').all()) {
    if (!r.name.trim() || r.name.length > 50) throw Error('快捷视图名称无效。');
    validateFilters(db, JSON.parse(r.filters_json));
  }
}
