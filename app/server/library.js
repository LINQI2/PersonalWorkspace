import { setLifecycle, visibleSql } from './lifecycle.js';
import { checkDelete } from './relations.js';
import { kinds, validUrl } from './store.js';
export function urlKey(value) {
  if (!validUrl(value)) return null;
  const url = new URL(value);
  url.hash = '';
  return url.href;
}
export function findDuplicate(db, url, exclude = '') {
  const key = urlKey(url);
  if (!key) return null;
  // Preserve the entered URL; normalize protocol/host/default port/trailing root slash and fragment only for comparison.
  return (
    db
      .prepare(
        'SELECT id,title,url FROM entries e WHERE url IS NOT NULL AND id<>? AND ' +
          visibleSql(db) +
          ' ORDER BY created_at DESC',
      )
      .all(exclude)
      .find((e) => urlKey(e.url) === key) || null
  );
}
export function recentTaxonomy(db) {
  return Object.fromEntries(
    kinds.map((k) => [
      k,
      db
        .prepare(
          `SELECT t.id,t.name,MAX(e.updated_at) last_used FROM ${k} t JOIN entry_${k} r ON r.taxonomy_id=t.id JOIN entries e ON e.id=r.entry_id GROUP BY t.id ORDER BY last_used DESC,t.name LIMIT 6`,
        )
        .all(),
    ]),
  );
}
export function batchEntries(db, input) {
  const ids = input.ids;
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 100 ||
    ids.some((id) => typeof id !== 'string') ||
    new Set(ids).size !== ids.length
  )
    throw new Error('每次选择 1–100 个不同条目。');
  const allowed = ['pin', 'unpin', 'add', 'delete'];
  if (!allowed.includes(input.action)) throw new Error('批量操作无效。');
  if (input.action === 'delete' && input.confirm !== '删除所选条目')
    throw new Error('请明确确认删除所选条目。');
  if (
    input.action === 'add' &&
    (!kinds.includes(input.kind) ||
      !Array.isArray(input.taxonomyIds) ||
      !input.taxonomyIds.length ||
      input.taxonomyIds.length > 100 ||
      input.taxonomyIds.some(
        (id) =>
          typeof id !== 'string' || !db.prepare(`SELECT id FROM ${input.kind} WHERE id=?`).get(id),
      ))
  )
    throw new Error('请选择有效的分类。');
  if (ids.some((id) => !db.prepare('SELECT id FROM entries WHERE id=?').get(id)))
    throw new Error('所选条目已变化，请刷新后重新选择。');
  if (input.action === 'add' && db.prepare('PRAGMA user_version').get().user_version >= 12 && ids.some(id=>db.prepare('SELECT 1 FROM professional_entries WHERE entry_id=?').get(id)))
    throw Error('请在专业知识模块管理专业归属，未修改个人分类。');
  if (input.action === 'delete') checkDelete(db, ids);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const id of ids) {
      if (input.action === 'delete')
        setLifecycle(db, id, { action: 'trash', confirm: '移入回收站' }, true);
      else if (input.action === 'add') {
        for (const tid of new Set(input.taxonomyIds))
          db.prepare(`INSERT OR IGNORE INTO entry_${input.kind} VALUES(?,?)`).run(id, tid);
        db.prepare('UPDATE entries SET updated_at=? WHERE id=?').run(new Date().toISOString(), id);
      } else
        db.prepare('UPDATE entries SET pinned=?,updated_at=? WHERE id=?').run(
          input.action === 'pin' ? 1 : 0,
          new Date().toISOString(),
          id,
        );
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { ok: true, count: ids.length };
}
