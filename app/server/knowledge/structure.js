import { randomUUID } from 'node:crypto';
import { cleanContent } from '../store.js';
import { validateRelations } from '../relations.js';

// Ownership is explicit. A directory, reference or candidate relation is never ownership.
export function owner(db, id) {
  let current = id;
  const seen = new Set();
  for (let depth = 0; depth < 8; depth++) {
    if (seen.has(current)) throw Error('章节关系循环。');
    seen.add(current);
    const r = db.prepare('SELECT kind FROM knowledge_records WHERE entry_id=?').get(current);
    if (!r) throw Error('章节记录缺失。');
    if (r.kind === 'page') return current;
    const s = db.prepare('SELECT parent_id FROM knowledge_structure WHERE entry_id=?').get(current);
    if (!s) return null;
    current = s.parent_id;
  }
  throw Error('章节超过 8 层。');
}
export function validateStructure(db) {
  for (const s of db.prepare('SELECT * FROM knowledge_structure').all()) {
    const r = db.prepare('SELECT kind FROM knowledge_records WHERE entry_id=?').get(s.entry_id);
    if (
      r?.kind !== 'point' ||
      !Number.isSafeInteger(s.position) ||
      s.position < 0 ||
      !owner(db, s.entry_id)
    )
      throw Error('章节必须是知识点并归属于有效混合页面。');
  }
}
export function attach(db, input) {
  if (
    !Array.isArray(input.items) ||
    !input.items.length ||
    input.items.length > 100 ||
    new Set(input.items.map((i) => i.id)).size !== input.items.length
  )
    throw Error('请选择 1～100 条不同知识点。');
  for (const i of input.items) {
    if(isProfessional(db,i.id)||isProfessional(db,i.parent_id))throw Error('专业知识不能移入个人文档章节；请建立明确引用。');
    const r = db.prepare('SELECT * FROM knowledge_records WHERE entry_id=?').get(i.id);
    if (!r || r.kind !== 'point' || (i.revision !== undefined && r.revision !== i.revision))
      throw Error('知识点已变化或类型不支持，请重新载入。');
    if (i.parent_id) {
      const p = db.prepare('SELECT kind FROM knowledge_records WHERE entry_id=?').get(i.parent_id);
      if (!p || !['point', 'page'].includes(p.kind)) throw Error('章节父级无效。');
      const n = db
        .prepare('SELECT COALESCE(MAX(position),-1)+1 n FROM knowledge_structure WHERE parent_id=?')
        .get(i.parent_id).n;
      db.prepare(
        'INSERT INTO knowledge_structure VALUES(?,?,?) ON CONFLICT(entry_id) DO UPDATE SET parent_id=excluded.parent_id,position=excluded.position',
      ).run(i.id, i.parent_id, n);
    } else db.prepare('DELETE FROM knowledge_structure WHERE entry_id=?').run(i.id);
  }
  validateStructure(db);
  validateRelations(db);
  for (const i of input.items)
    db.prepare('UPDATE knowledge_records SET revision=revision+1 WHERE entry_id=?').run(i.id);
  return { ok: true };
}
export function chapterRows(db, pageId) {
  const out = [];
  const walk = (parent, depth) => {
    if (depth >= 8) throw Error('章节超过 8 层。');
    for (const r of db
      .prepare(
        'SELECT s.*,e.title,k.revision,k.status,k.priority FROM knowledge_structure s JOIN entries e ON e.id=s.entry_id JOIN knowledge_records k ON k.entry_id=s.entry_id WHERE s.parent_id=? ORDER BY s.position,e.id',
      )
      .all(parent)) {
      out.push({ ...r, id: r.entry_id, depth });
      walk(r.entry_id, depth + 1);
    }
  };
  walk(pageId, 0);
  return out;
}
export function structuralSuggestions(db, pageId) {
  // Only explicit parent fields in the immutable import snapshot or parent candidates.
  const found = new Map();
  for (const b of db
    .prepare(
      'SELECT i.raw_input,i.format,m.batch_id,m.local_id FROM knowledge_import_entries m JOIN knowledge_imports i ON i.id=m.batch_id WHERE m.entry_id=?',
    )
    .all(pageId)) {
    if (b.format !== 'json') continue;
    const raw = JSON.parse(b.raw_input),
      local = new Map(
        db
          .prepare('SELECT local_id,entry_id FROM knowledge_import_entries WHERE batch_id=?')
          .all(b.batch_id)
          .map((r) => [r.local_id, r.entry_id]),
      );
    const items = raw.items || [];
    const under = (item) => {
      let p = item.parent;
      const seen = new Set();
      while (p && !seen.has(p)) {
        if (p === b.local_id) return true;
        seen.add(p);
        p = items.find((i) => i.id === p)?.parent;
      }
      return false;
    };
    for (const i of items)
      if (under(i) && local.has(i.id) && local.has(i.parent))
        found.set(local.get(i.id), {
          id: local.get(i.id),
          parent_id: local.get(i.parent),
          reason: '原始导入包的显式 parent 建议',
        });
  }
  for (const r of db
    .prepare(
      "SELECT to_id id,from_id parent_id FROM knowledge_relations WHERE from_id=? AND kind='parent'",
    )
    .all(pageId))
    found.set(r.id, { ...r, reason: '已有上下级关系建议' });
  return [...found.values()]
    .filter(
      (i) =>
        !isProfessional(db,i.id)&&
        db
          .prepare("SELECT entry_id FROM knowledge_records WHERE entry_id=? AND kind='point'")
          .get(i.id) &&
        !db.prepare('SELECT entry_id FROM knowledge_structure WHERE entry_id=?').get(i.id),
    )
    .map((i) => ({ ...i, ...db.prepare('SELECT title FROM entries WHERE id=?').get(i.id) }));
}
export function saveVersion(db, r) {
  db.prepare('INSERT INTO knowledge_versions VALUES(?,?,?,?,?,?)').run(
    randomUUID(),
    r.id,
    r.title,
    r.content,
    r.revision,
    new Date().toISOString(),
  );
}
export function validateReadingBackup(db) {
  if (db.prepare('PRAGMA user_version').get().user_version < 5) return;
  validateStructure(db);
  const assets = db
    .prepare('SELECT filename FROM assets')
    .all()
    .map((a) => a.filename);
  for (const v of db.prepare('SELECT * FROM knowledge_versions').all()) {
    if (
      !v.title?.trim() ||
      v.title.length > 200 ||
      !Number.isSafeInteger(v.revision) ||
      v.revision < 1 ||
      !Number.isFinite(Date.parse(v.created_at)) ||
      cleanContent(v.content) !== v.content
    )
      throw Error('知识历史无效。');
    for (const img of v.content.matchAll(/src="\/assets\/([^"]+)"/g))
      if (!assets.includes(img[1])) throw Error('历史图片缺失。');
  }
}
import { isProfessional } from '../space.js';
