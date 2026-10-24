import { transaction } from './knowledge/store.js';
import { saveEntry, cleanContent } from './store.js';
import { checkDelete } from './relations.js';
export const lifecycleVersion = (db) => db.prepare('PRAGMA user_version').get().user_version >= 9;
export const visibleSql = (db, alias = 'e') =>
  lifecycleVersion(db)
    ? `NOT EXISTS(SELECT 1 FROM content_lifecycle l WHERE l.entry_id=${alias}.id AND l.state='trash')`
    : '1';
export function lifecycle(db, id) {
  return lifecycleVersion(db)
    ? db.prepare('SELECT * FROM content_lifecycle WHERE entry_id=?').get(id) || null
    : null;
}
export function setLifecycle(db, id, input, outer = false) {
  if (!['inbox', 'later', 'done', 'trash', 'restore'].includes(input.action))
    throw Error('处理操作无效。');
  const e = db.prepare('SELECT * FROM entries WHERE id=?').get(id);
  if (!e) throw Error('内容不存在。');
  if (input.updated_at && input.updated_at !== e.updated_at)
    throw Error('内容已变化，请刷新后再操作。');
  const apply = () => {
    const old = lifecycle(db, id);
    if (old?.state === 'trash' && input.action === 'trash') throw Error('内容已在回收站。');
    if (input.action === 'trash') {
      if (input.confirm !== '移入回收站') throw Error('请明确确认移入回收站。');
      // Explicit references and document ownership remain intact. Refuse unsafe hiding.
      checkDelete(db, [id]);
      if (db.prepare('SELECT parent_id FROM knowledge_structure WHERE entry_id=?').get(id))
        throw Error('内容是文档内部章节，请先在整理模式移出文档再回收；原章节保留。');
      if (db.prepare('SELECT entry_id FROM knowledge_structure WHERE parent_id=? LIMIT 1').get(id))
        throw Error('综合文档仍有章节，请先在整理模式处理章节归属；未移入回收站。');
    } else if (old?.state === 'trash' && input.action !== 'restore')
      throw Error('请先恢复回收站内容。');
    if (input.action === 'restore' && old?.state !== 'trash') throw Error('内容不在回收站。');
    if (input.action === 'restore' && old.previous_state === null) {
      db.prepare('DELETE FROM content_lifecycle WHERE entry_id=?').run(id);
      return { ok: true, id, state: 'active' };
    }
    const state = input.action === 'restore' ? old.previous_state : input.action;
    db.prepare(
      'INSERT INTO content_lifecycle VALUES(?,?,?,?,?) ON CONFLICT(entry_id) DO UPDATE SET state=excluded.state,previous_state=excluded.previous_state,changed_at=excluded.changed_at,deleted_at=excluded.deleted_at',
    ).run(
      id,
      state,
      state === 'trash' ? old?.state || null : null,
      new Date().toISOString(),
      state === 'trash' ? new Date().toISOString() : null,
    );
    return { ok: true, id, state };
  };
  return outer ? apply() : transaction(db, apply);
}
export function quickCapture(db, input) {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text || text.length > 20000) throw Error('请输入 1～20000 字的文字或链接。');
  const urls = text.match(/https?:\/\/[^\s<>"'，。！？、；：]+/g) || [];
  const url = urls[0]?.replace(/[，。！？、；：)）\]}]+$/u, '') || '';
  const escape = (s) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return transaction(db, () => {
    const e = saveEntry(
      db,
      {
        type: url ? 'bookmark' : 'note',
        title: input.title?.trim() || text.split('\n')[0].slice(0, 100),
        url,
        description: '',
        content: text
          .split('\n')
          .map((s) => '<p>' + escape(s) + '</p>')
          .join(''),
        domains: input.domains || [],
        tags: input.tags || [],
        collections: [],
        pinned: 0,
      },
      undefined,
      { transaction: false },
    );
    if (e.duplicate) throw Error('该网址已存在，请查看已有收藏。');
    setLifecycle(db, e.id, { action: 'inbox' }, true);
    return e;
  });
}
export function validateLifecycle(db) {
  if (!lifecycleVersion(db)) return;
  for (const r of db.prepare('SELECT * FROM content_versions').all())
    if (
      typeof r.title !== 'string' ||
      !r.title.trim() ||
      r.title.length > 200 ||
      typeof r.description !== 'string' ||
      r.description.length > 2000 ||
      typeof r.content !== 'string' ||
      r.content.length > 1000000 ||
      !/^[a-f0-9-]{36}$/.test(r.id) ||
      r.content !== cleanContent(r.content) ||
      !Number.isFinite(Date.parse(r.created_at))
    )
      throw Error('正文历史格式损坏。');
  for (const r of db.prepare('SELECT content FROM content_versions').all())
    for (const m of r.content.matchAll(/src="\/assets\/([a-f0-9-]+\.webp)"/g))
      if (!db.prepare('SELECT id FROM assets WHERE filename=?').get(m[1]))
        throw Error('正文历史的图片引用缺失。');
  for (const r of db.prepare('SELECT * FROM content_lifecycle').all()) {
    if (r.state === 'trash') {
      checkDelete(db, [r.entry_id]);
      if (
        db
          .prepare(
            'SELECT entry_id FROM knowledge_structure WHERE entry_id=? OR parent_id=? LIMIT 1',
          )
          .get(r.entry_id, r.entry_id)
      )
        throw Error('回收站章节归属冲突，已拒绝打开或恢复。');
    }
    if (
      !['inbox', 'later', 'done', 'trash'].includes(r.state) ||
      (r.previous_state !== null && !['inbox', 'later', 'done'].includes(r.previous_state)) ||
      !Number.isFinite(Date.parse(r.changed_at)) ||
      (r.state === 'trash'
        ? !r.deleted_at || !Number.isFinite(Date.parse(r.deleted_at))
        : r.deleted_at !== null || r.previous_state !== null)
    )
      throw Error('内容处理状态或回收站记录损坏，原数据保留。');
  }
}
