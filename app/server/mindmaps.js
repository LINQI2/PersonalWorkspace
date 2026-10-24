import { randomUUID, createHash } from 'node:crypto';
import { validateMap, mapNodes, mapFormat } from '../shared/mindmap.js';
import { hydrate, saveEntry } from './store.js';
import { transaction } from './knowledge/store.js';
const version = (db) => db.prepare('PRAGMA user_version').get().user_version >= 11;
export function getMap(db, id) {
  const row = db.prepare('SELECT * FROM mindmaps WHERE entry_id=?').get(id);
  if (!row) throw Error('思维导图不存在。');
  const data = JSON.parse(row.data_json);
  const linked = validateMap(data).targets.map((id) => {
    const e = hydrate(db, db.prepare('SELECT * FROM entries WHERE id=?').get(id));
    return { id, title: e?.title || '目标缺失', state: e?.lifecycle?.state || 'done' };
  });
  const entry = hydrate(db, db.prepare('SELECT * FROM entries WHERE id=?').get(id));
  const stamp = createHash('sha256')
    .update(
      JSON.stringify([
        entry.title,
        entry.domains,
        entry.tags,
        entry.collections,
        entry.primary_domain_id,
      ]),
    )
    .digest('hex');
  return { entry, data, revision: row.revision, stamp, linked };
}
export function saveMap(db, input, id) {
  const check = validateMap(input.data);
  for (const target of check.targets) {
    if (!db.prepare('SELECT id FROM entries WHERE id=?').get(target))
      throw Error('关联知识ID不存在，请先解除未知关联后导入。');
    if (target === id) throw Error('节点不能链接当前导图自身。');
  }
  return transaction(db, () => {
    const old = id ? getMap(db, id) : null;
    if (old && (input.revision !== old.revision || input.stamp !== old.stamp))
      throw Error('导图或分类已被其他窗口修改。未覆盖，请保留恢复副本并重新加载。');
    const title = typeof input.title === 'string' ? input.title.trim() : '';
    if (!title || title.length > 200) throw Error('导图标题必填，最多200字。');
    const e = old?.entry;
    const form = {
      type: 'note',
      resource_kind: 'knowledge',
      tool_kind: '',
      title,
      url: '',
      description: '',
      content: '',
      cover_asset_id: null,
      pinned: e?.pinned || 0,
      ...Object.fromEntries(
        ['domains', 'tags', 'collections'].map((k) => [
          k,
          input[k] ?? e?.[k].map((t) => t.id) ?? [],
        ]),
      ),
      primary_domain_id: Object.hasOwn(input, 'primary_domain_id')
        ? input.primary_domain_id
        : (e?.primary_domain_id ?? null),
    };
    const saved = saveEntry(db, form, id, { transaction: false, mapWrite: true });
    const now = new Date().toISOString();
    if (old)
      db.prepare('INSERT INTO mindmap_versions VALUES(?,?,?,?,?,?)').run(
        randomUUID(),
        id,
        e.title,
        JSON.stringify(old.data),
        old.revision,
        now,
      );
    const json = JSON.stringify(input.data);
    db.prepare(
      'INSERT INTO mindmaps VALUES(?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET data_json=excluded.data_json,revision=excluded.revision,updated_at=excluded.updated_at',
    ).run(saved.id, json, (old?.revision || 0) + 1, now);
    db.prepare('UPDATE entries SET plain_text=?,description=? WHERE id=?').run(
      mapNodes(input.data)
        .map((r) => r.node.topic)
        .join('\n'),
      `${check.count} 个节点 · ${input.data.arrows.length} 条跨分支连线`,
      saved.id,
    );
    return getMap(db, saved.id);
  });
}
export function importMap(value) {
  if (
    !value ||
    Object.keys(value).some((k) => !['format', 'version', 'title', 'data'].includes(k)) ||
    value.format !== mapFormat ||
    value.version !== 1
  )
    throw Error('仅支持personal-knowledge-mindmap v1 JSON。');
  validateMap(value.data);
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200)
    throw Error('导入标题必填，最多200字。');
  return { title: value.title, data: value.data };
}
export function validateMindmaps(db) {
  if (!version(db)) return;
  for (const r of db.prepare('SELECT * FROM mindmaps').all()) {
    const e = db.prepare('SELECT * FROM entries WHERE id=?').get(r.entry_id),
      data = JSON.parse(r.data_json);
    if (
      !e ||
      e.type !== 'note' ||
      e.resource_kind !== 'knowledge' ||
      e.content !== '' ||
      db.prepare('SELECT entry_id FROM knowledge_records WHERE entry_id=?').get(r.entry_id) ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 1 ||
      !Number.isFinite(Date.parse(r.updated_at))
    )
      throw Error('导图记录损坏。');
    for (const id of validateMap(data).targets)
      if (id === r.entry_id || !db.prepare('SELECT id FROM entries WHERE id=?').get(id))
        throw Error('导图知识引用无效。');
    if (
      e.plain_text !==
      mapNodes(data)
        .map((r) => r.node.topic)
        .join('\n')
    )
      throw Error('导图搜索索引与节点不一致。');
  }
  for (const r of db.prepare('SELECT * FROM mindmap_versions').all()) {
    if (
      !r.title?.trim() ||
      r.title.length > 200 ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 1 ||
      !Number.isFinite(Date.parse(r.created_at))
    )
      throw Error('导图历史无效。');
    validateMap(JSON.parse(r.data_json));
  }
}
