import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { baseSchema } from '../app/server/migrations.js';
import { saveEntry, hydrate, cleanContent } from '../app/server/store.js';
import { randomUUID } from 'node:crypto';
import { fixtureForm } from './ai-fixture.js';
export function legacyStore(dir) {
  mkdirSync(path.join(dir, 'attachments'), { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'library.sqlite'));
  db.exec('PRAGMA foreign_keys=ON');
  db.exec(baseSchema);
  return db;
}
// Historical fixture writes the historical schema rather than using today's writer.
export function seedEntry(db, form) {
  if (db.prepare('PRAGMA user_version').get().user_version >= 3) return saveEntry(db, form);
  const id = randomUUID(),
    now = new Date().toISOString(),
    content = cleanContent(form.content);
  db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
    id,
    form.type,
    form.title,
    form.type === 'bookmark' ? form.url : null,
    form.description,
    content,
    content.replace(/<[^>]*>/g, ''),
    form.cover_asset_id || null,
    form.pinned ? 1 : 0,
    now,
    now,
  );
  for (const k of ['domains', 'tags', 'collections'])
    for (const t of form[k]) db.prepare(`INSERT INTO entry_${k} VALUES(?,?)`).run(id, t);
  return hydrate(db, db.prepare('SELECT * FROM entries WHERE id=?').get(id));
}
export function seedTopic(db) {
  db.prepare('INSERT INTO collections VALUES(?,?)').run('topic', '前端实践专题');
  db.prepare('INSERT INTO collections VALUES(?,?)').run('other', '另一专题');
  db.prepare('INSERT INTO domains VALUES(?,?)').run('code', '前端开发');
  const entries = Array.from({ length: 4 }, (_, n) =>
    seedEntry(db, {
      ...fixtureForm,
      title: ['信息层级设计', '网格布局实践', '响应式与可读性', '未选中的私有资料'][n],
      url: 'https://example.com/v13/' + n,
      description: n === 3 ? 'UNSELECTED_PRIVATE_DATA' : fixtureForm.description,
      domains: ['code'],
      collections: ['topic', 'other'],
    }),
  );
  return entries;
}
export function topicSuggestion(payload) {
  const ids = payload.sources.filter((s) => s.hasEvidence).map((s) => s.id);
  return {
    status: 'ready',
    title: '界面布局：从结构到实践',
    reason: '仅综合选中资料，保留具体数据与不确定性。',
    sections: [
      {
        heading: '结构与实践',
        paragraphs: [{ text: '实验17天，成本320元，结果仍存在不确定性。', sourceIds: [ids[0]] }],
      },
    ],
    core: [{ text: '信息层级服务于可读性。', sourceIds: [ids[0]] }],
    related: [{ text: '多份资料都讨论布局与阅读路径。', sourceIds: ids.slice(0, 2) }],
    differences: [{ text: '资料侧重点不同，不能据此推断效果优劣。', sourceIds: ids.slice(0, 2) }],
    uncertainties: [{ text: '实际效果仍无法确定。', sourceIds: [ids[0]] }],
    verification: [{ text: '需要继续验证更多使用场景。', sourceIds: [] }],
  };
}
