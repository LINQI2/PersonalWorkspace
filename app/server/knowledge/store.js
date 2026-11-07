import { spaceSql } from '../space.js';
import { randomUUID } from 'node:crypto';
import { saveEntry, hydrate, kinds, cleanContent, validUrl } from '../store.js';
import { checkedDate, checkedTimestamp, bounded, parseExchange } from './exchange.js';
import { owner, saveVersion, validateStructure, validateReadingBackup } from './structure.js';
export const recordKinds = ['capture', 'page', 'point'];
export const statuses = ['inbox', 'draft', 'review', 'confirmed', 'archived'];
export const epistemics = ['reported_fact', 'ai_inference', 'user_judgment'];
export const sourceKinds = ['chatgpt', 'report', 'inspiration', 'website', 'other'];
export const relationKinds = ['duplicate', 'complement', 'conflict', 'revision', 'parent'];
export const knowledgeTables = [
  'knowledge_directories',
  'knowledge_records',
  'knowledge_imports',
  'knowledge_sources',
  'knowledge_entry_sources',
  'knowledge_relations',
  'knowledge_references',
  'knowledge_drafts',
  'knowledge_import_entries',
];
export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
const string = (s, max, label) => {
  if (typeof s !== 'string' || s.length > max) throw Error(label + ' 格式或长度无效。');
  return s;
};
export function directories(db) {
  return db
    .prepare(
      'SELECT d.*, (SELECT count(*) FROM knowledge_records WHERE directory_id=d.id) count FROM knowledge_directories d ORDER BY position,name,id',
    )
    .all();
}
export function validateTree(rows) {
  const map = new Map(rows.map((r) => [r.id, r]));
  for (const d of rows) {
    if (
      !d.name?.trim() ||
      d.name.length > 50 ||
      !Number.isSafeInteger(d.position) ||
      d.position < 0
    )
      throw Error('知识目录无效。');
    const seen = new Set([d.id]);
    let p = d.parent_id;
    while (p) {
      if (!map.has(p) || seen.has(p) || seen.size >= 8)
        throw Error('目录父级缺失、循环或超过 8 层。');
      seen.add(p);
      p = map.get(p).parent_id;
    }
  }
}
export function saveDirectory(db, input, id) {
  const name = string(input.name, 50, '目录名称').trim();
  if (!name) throw Error('目录名称必填。');
  if (id && !db.prepare('SELECT id FROM knowledge_directories WHERE id=?').get(id))
    throw Error('目录不存在。');
  const parent = input.parent_id || null,
    entry = {
      id: id || randomUUID(),
      name,
      parent_id: parent,
      position: id
        ? db.prepare('SELECT position FROM knowledge_directories WHERE id=?').get(id).position
        : db.prepare('SELECT COALESCE(MAX(position),-1)+1 n FROM knowledge_directories').get().n,
    };
  validateTree([...directories(db).filter((d) => d.id !== entry.id), entry]);
  db.prepare(
    'INSERT INTO knowledge_directories(id,name,parent_id,position) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,parent_id=excluded.parent_id',
  ).run(entry.id, name, parent, entry.position);
  return entry;
}
export function getRecord(db, id) {
  const row = db
    .prepare(
      'SELECT e.*,k.kind,k.directory_id,k.priority,k.status,k.epistemic,k.questions,k.position,k.revision,k.confirmed_at,k.original_date,k.date_note,k.provided_recorded_at FROM entries e JOIN knowledge_records k ON k.entry_id=e.id WHERE e.id=?',
    )
    .get(id);
  if (!row) throw Error('知识记录不存在。');
  return {
    ...hydrate(db, row),
    ...(db.prepare('PRAGMA user_version').get().user_version >= 5
      ? {
          parent_id:
            db.prepare('SELECT parent_id FROM knowledge_structure WHERE entry_id=?').get(id)
              ?.parent_id || null,
          page_id: owner(db, id),
        }
      : {}),
    import_batch:
      db
        .prepare('SELECT batch_id,local_id FROM knowledge_import_entries WHERE entry_id=?')
        .get(id) || null,
    sources: db
      .prepare(
        'SELECT s.*,r.quote FROM knowledge_sources s JOIN knowledge_entry_sources r ON r.source_id=s.id WHERE r.entry_id=? ORDER BY s.recorded_at,s.id',
      )
      .all(id),
    references: db
      .prepare(
        'SELECT e.id,e.type,e.title,e.url,e.description,e.cover_asset_id,e.pinned,e.created_at,e.updated_at,e.resource_kind,e.tool_kind FROM entries e JOIN knowledge_references r ON r.target_id=e.id WHERE r.page_id=? ORDER BY r.position',
      )
      .all(id)
      .map((e) => hydrate(db, e)),
    relations: db
      .prepare(
        'SELECT r.*,a.title from_title,b.title to_title FROM knowledge_relations r JOIN entries a ON a.id=r.from_id JOIN entries b ON b.id=r.to_id WHERE r.from_id=? OR r.to_id=? ORDER BY r.created_at DESC',
      )
      .all(id, id),
  };
}
export function validateRecord(input) {
  bounded(input);
  if (
    !recordKinds.includes(input.kind) ||
    !statuses.includes(input.status) ||
    !epistemics.includes(input.epistemic) ||
    !Number.isInteger(input.priority) ||
    input.priority < 0 ||
    input.priority > 3
  )
    throw Error('知识类型、状态或优先级无效。');
  string(input.questions || '', 10000, '待验证问题');
  string(input.date_note || '', 300, '日期说明');
  checkedDate(input.original_date);
  checkedTimestamp(input.provided_recorded_at);
  if (input.status === 'confirmed' && input.confirm !== '确认判断')
    throw Error('人工确认判断需要明确确认。');
  if (
    !Array.isArray(input.references) ||
    input.references.length > 40 ||
    new Set(input.references).size !== input.references.length ||
    input.references.some((r) => typeof r !== 'string')
  )
    throw Error('混合页面引用无效。');
  if (input.kind !== 'page' && input.references.length) throw Error('只有混合页面可嵌入资源。');
}
export function validateSource(s) {
  if (!sourceKinds.includes(s.kind) || !string(s.title, 200, '来源标题').trim())
    throw Error('来源类型或标题无效。');
  string(s.excerpt, 100000, '原始摘录');
  string(s.date_note || '', 300, '日期说明');
  checkedDate(s.original_date);
  checkedTimestamp(s.provided_recorded_at ?? s.recorded_at);
  if (s.url && (!validUrl(s.url) || s.url.length > 4096)) throw Error('来源网址无效。');
}
export function addSource(db, source, batchId = null) {
  validateSource(source);
  const id = randomUUID(),
    now = new Date().toISOString();
  db.prepare('INSERT INTO knowledge_sources VALUES(?,?,?,?,?,?,?,?,?,?)').run(
    id,
    source.kind,
    source.title,
    source.url || null,
    checkedDate(source.original_date),
    source.date_note || '',
    source.excerpt,
    now,
    batchId,
    checkedTimestamp(source.provided_recorded_at ?? source.recorded_at),
  );
  return id;
}
export function saveRecord(db, input, id, { outer = false, professionalWrite = false } = {}) {
  const run = () => {
    validateRecord(input);
    const current = id ? getRecord(db, id) : null;
    if (current && (current.revision !== input.revision || current.updated_at !== input.updated_at))
      throw Error('知识已更新，请保留编辑内容并重新载入。');
    if (current && db.prepare('PRAGMA user_version').get().user_version >= 5)
      saveVersion(db, current);
    if (
      input.directory_id &&
      !db.prepare('SELECT id FROM knowledge_directories WHERE id=?').get(input.directory_id)
    )
      throw Error('目录不存在。');
    for (const target of input.references)
      if (target === id || !db.prepare('SELECT id FROM entries WHERE id=?').get(target))
        throw Error('引用条目已不存在或引用自己。');
    const e = saveEntry(
      db,
      { ...input, type: 'note', resource_kind: 'knowledge', tool_kind: '', url: '' },
      id,
      { transaction: false, professionalWrite },
    );
    const position =
      current?.position ??
      db
        .prepare(
          'SELECT COALESCE(MAX(position),-1)+1 n FROM knowledge_records WHERE directory_id IS ?',
        )
        .get(input.directory_id || null).n;
    const confirmed =
      input.status === 'confirmed'
        ? current?.content === e.content && current?.title === e.title
          ? current?.confirmed_at || new Date().toISOString()
          : new Date().toISOString()
        : null;
    db.prepare(
      'INSERT INTO knowledge_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET kind=excluded.kind,directory_id=excluded.directory_id,priority=excluded.priority,status=excluded.status,epistemic=excluded.epistemic,questions=excluded.questions,revision=excluded.revision,confirmed_at=excluded.confirmed_at,original_date=excluded.original_date,date_note=excluded.date_note,provided_recorded_at=excluded.provided_recorded_at',
    ).run(
      e.id,
      input.kind,
      input.directory_id || null,
      input.priority,
      input.status,
      input.epistemic,
      input.questions || '',
      position,
      (current?.revision || 0) + 1,
      confirmed,
      checkedDate(input.original_date),
      input.date_note || '',
      checkedTimestamp(input.provided_recorded_at),
    );
    db.prepare('DELETE FROM knowledge_references WHERE page_id=?').run(e.id);
    input.references.forEach((target, n) =>
      db.prepare('INSERT INTO knowledge_references VALUES(?,?,?)').run(e.id, target, n),
    );
    if (input.newSource && input.newSource.excerpt?.trim()) {
      const source = addSource(db, input.newSource);
      db.prepare('INSERT INTO knowledge_entry_sources VALUES(?,?,?)').run(e.id, source, '');
    } else if (!current && !outer && input.kind === 'capture') {
      const original = addSource(db, {
        kind: 'inspiration',
        title: e.title,
        excerpt: e.plain_text,
        original_date: input.original_date,
        date_note: input.date_note || '',
        provided_recorded_at: input.provided_recorded_at,
      });
      db.prepare('INSERT INTO knowledge_entry_sources VALUES(?,?,?)').run(e.id, original, '');
    }
    if (!outer) db.prepare('DELETE FROM knowledge_drafts WHERE key=?').run(id || 'new');
    if (db.prepare('PRAGMA user_version').get().user_version >= 5) validateStructure(db);
    return getRecord(db, e.id);
  };
  return outer ? run() : transaction(db, run);
}
export function listRecords(db, q = {}) {
  const conditions = [spaceSql(db)],
    values = [];
  if (q.directory) {
    conditions.push('k.directory_id=?');
    values.push(String(q.directory));
  }
  if (q.inbox === '1') conditions.push("k.status='inbox'");
  if (!q.q && q.inbox !== '1' && q.all !== '1') {
    conditions.push('NOT EXISTS(SELECT 1 FROM knowledge_structure s WHERE s.entry_id=e.id)');
    const hasPages = q.directory
      ? db
          .prepare(
            "SELECT entry_id FROM knowledge_records WHERE kind='page' AND directory_id=? LIMIT 1",
          )
          .get(String(q.directory))
      : db.prepare("SELECT entry_id FROM knowledge_records WHERE kind='page' LIMIT 1").get();
    if (hasPages) conditions.push("k.kind='page'");
  }
  if (q.q) {
    conditions.push(
      "(e.title LIKE ? ESCAPE '\\' OR e.plain_text LIKE ? ESCAPE '\\' OR k.questions LIKE ? ESCAPE '\\')",
    );
    const keyword =
      '%' +
      String(q.q)
        .slice(0, 200)
        .replace(/[\\%_]/g, '\\$&') +
      '%';
    values.push(keyword, keyword, keyword);
  }
  const where = conditions.length ? ' WHERE ' + conditions.join(' AND ') : '',
    page = Math.max(1, Math.min(100000, Number(q.page) || 1));
  const total = db
    .prepare('SELECT count(*) n FROM knowledge_records k JOIN entries e ON e.id=k.entry_id' + where)
    .get(...values).n;
  const order =
    q.sort === 'priority'
      ? 'k.priority DESC,k.position,e.id'
      : q.sort === 'recent'
        ? 'e.updated_at DESC,e.id'
        : 'k.position,e.id';
  const rows = db
    .prepare(
      'SELECT e.id FROM knowledge_records k JOIN entries e ON e.id=k.entry_id' +
        where +
        ' ORDER BY ' +
        order +
        ' LIMIT 24 OFFSET ?',
    )
    .all(...values, (page - 1) * 24);
  return {
    items: rows.map((r) => {
      const row = db
        .prepare(
          'SELECT e.id,e.type,e.title,e.url,e.description,e.cover_asset_id,e.pinned,e.created_at,e.updated_at,e.resource_kind,e.tool_kind,k.*,(SELECT count(*) FROM knowledge_entry_sources WHERE entry_id=e.id) source_count,(SELECT count(*) FROM knowledge_references WHERE page_id=e.id) reference_count FROM entries e JOIN knowledge_records k ON k.entry_id=e.id WHERE e.id=?',
        )
        .get(r.id);
      const pageId = owner(db, r.id);
      return {
        ...hydrate(db, row),
        page_id: pageId,
        page_title: pageId
          ? db.prepare('SELECT title FROM entries WHERE id=?').get(pageId)?.title
          : null,
      };
    }),
    total,
    page,
    pageSize: 24,
  };
}
export function moveRecord(db, id, direction) {
  if (![-1, 1].includes(direction)) throw Error('排序方向无效。');
  return transaction(db, () => {
    const structure = db
      .prepare('SELECT parent_id FROM knowledge_structure WHERE entry_id=?')
      .get(id);
    if (structure) {
      const siblings = db
        .prepare(
          'SELECT entry_id FROM knowledge_structure WHERE parent_id=? ORDER BY position,entry_id',
        )
        .all(structure.parent_id)
        .map((r) => r.entry_id);
      const n = siblings.indexOf(id),
        next = n + direction;
      if (next >= 0 && next < siblings.length)
        [siblings[n], siblings[next]] = [siblings[next], siblings[n]];
      siblings.forEach((key, index) =>
        db.prepare('UPDATE knowledge_structure SET position=? WHERE entry_id=?').run(index, key),
      );
      return { ok: true };
    }
    const r = getRecord(db, id),
      ids = db
        .prepare(
          'SELECT entry_id FROM knowledge_records WHERE directory_id IS ? ORDER BY position,entry_id',
        )
        .all(r.directory_id)
        .map((r) => r.entry_id),
      i = ids.indexOf(id),
      j = i + direction;
    if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
    ids.forEach((v, n) =>
      db
        .prepare('UPDATE knowledge_records SET position=?,revision=revision+1 WHERE entry_id=?')
        .run(n, v),
    );
    return { ok: true };
  });
}
export function moveDirectory(db, id, direction) {
  if (![-1, 1].includes(direction)) throw Error('目录排序方向无效。');
  return transaction(db, () => {
    const d = db.prepare('SELECT * FROM knowledge_directories WHERE id=?').get(id);
    if (!d) throw Error('目录不存在。');
    const siblings = db
        .prepare(
          'SELECT id FROM knowledge_directories WHERE parent_id IS ? ORDER BY position,name,id',
        )
        .all(d.parent_id)
        .map((r) => r.id),
      i = siblings.indexOf(id),
      j = i + direction;
    if (j >= 0 && j < siblings.length) [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    siblings.forEach((key, n) =>
      db.prepare('UPDATE knowledge_directories SET position=? WHERE id=?').run(n, key),
    );
    return { ok: true };
  });
}
export function saveKnowledgeDraft(db, key, payload) {
  if (!/^(professional:)?(new|[a-f0-9-]{36})$/.test(key)) throw Error('知识草稿标识无效。');
  bounded(payload);
  if (
    typeof payload?.content !== 'string' ||
    Buffer.byteLength(JSON.stringify(payload)) > 1_500_000
  )
    throw Error('知识草稿无效或过长。');
  const safe = { ...payload, content: cleanContent(payload.content) };
  for (const image of safe.content.matchAll(/src="\/assets\/([^"]+)"/g))
    if (!db.prepare('SELECT id FROM assets WHERE filename=?').get(image[1]))
      throw Error('知识草稿图片缺失。');
  if (db.prepare('SELECT count(*) n FROM knowledge_drafts WHERE key<>?').get(key).n >= 50)
    throw Error('知识草稿超过 50 份，请先保存或放弃。');
  db.prepare(
    'INSERT INTO knowledge_drafts VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET payload=excluded.payload,saved_at=excluded.saved_at',
  ).run(key, JSON.stringify(safe), new Date().toISOString());
  return { ok: true };
}
export function validateKnowledgeBackup(db) {
  validateReadingBackup(db);
  validateTree(directories(db));
  for (const s of db.prepare('SELECT * FROM knowledge_sources').all()) validateSource(s);
  for (const k of db
    .prepare(
      'SELECT k.*,e.type,e.resource_kind FROM knowledge_records k JOIN entries e ON e.id=k.entry_id',
    )
    .all()) {
    const refs = db
      .prepare('SELECT target_id FROM knowledge_references WHERE page_id=?')
      .all(k.entry_id)
      .map((r) => r.target_id);
    validateRecord({ ...k, references: refs, confirm: k.status === 'confirmed' ? '确认判断' : '' });
    if (
      k.type !== 'note' ||
      k.resource_kind !== 'knowledge' ||
      (k.status === 'confirmed') !== !!k.confirmed_at ||
      refs.includes(k.entry_id) ||
      !Number.isSafeInteger(k.position) ||
      !Number.isSafeInteger(k.revision)
    )
      throw Error('知识元数据无效。');
    checkedTimestamp(k.confirmed_at);
  }
  for (const r of db
    .prepare(
      'SELECT r.*,s.excerpt FROM knowledge_entry_sources r JOIN knowledge_sources s ON s.id=r.source_id',
    )
    .all())
    if (
      typeof r.quote !== 'string' ||
      r.quote.length > 10000 ||
      (r.quote && !r.excerpt.includes(r.quote))
    )
      throw Error('知识来源摘录不匹配。');
  for (const b of db.prepare('SELECT * FROM knowledge_imports').all())
    if (parseExchange(b.raw_input, b.format).hash !== b.hash) throw Error('导入快照无效。');
  for (const r of db.prepare('SELECT * FROM knowledge_relations').all())
    if (r.from_id === r.to_id || r.note.length > 1000 || !checkedTimestamp(r.created_at))
      throw Error('知识关系无效。');
  for (const link of db
    .prepare(
      'SELECT r.*,b.raw_input,b.format FROM knowledge_import_entries r JOIN knowledge_imports b ON b.id=r.batch_id',
    )
    .all())
    if (!parseExchange(link.raw_input, link.format).value.items.some((i) => i.id === link.local_id))
      throw Error('导入知识追溯 ID 无效。');
  for (const d of db.prepare('SELECT * FROM knowledge_drafts').all()) {
    const p = JSON.parse(d.payload);
    bounded(p);
    if (
      !/^(professional:)?(new|[a-f0-9-]{36})$/.test(d.key) ||
      typeof p.content !== 'string' ||
      cleanContent(p.content) !== p.content ||
      Buffer.byteLength(d.payload) > 1_500_000
    )
      throw Error('知识草稿不安全。');
    for (const image of p.content.matchAll(/src="\/assets\/([^"]+)"/g))
      if (!db.prepare('SELECT id FROM assets WHERE filename=?').get(image[1]))
        throw Error('知识草稿图片缺失。');
  }
}
