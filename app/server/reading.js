import { createHash, randomUUID } from 'node:crypto';
import { readingText, resolveAnchor } from '../shared/reading-anchor.js';
import { hydrate, saveEntry } from './store.js';
import { transaction, getRecord, saveRecord } from './knowledge/store.js';
import { owner } from './knowledge/structure.js';
import { lifecycle, visibleSql } from './lifecycle.js';
import { readWorkspace } from './workspace.js';
export const readingVersion = (db) => db.prepare('PRAGMA user_version').get().user_version >= 10;
export const textHash = (s) => createHash('sha256').update(s).digest('hex');
export const entryStamp = (e) => textHash(JSON.stringify([e.id, e.title, e.content, e.updated_at]));
const escape = (s) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const pageOwner = (db, id) =>
  db.prepare('SELECT entry_id FROM knowledge_records WHERE entry_id=?').get(id)
    ? owner(db, id)
    : null;
function source(db, id) {
  const e = db.prepare('SELECT * FROM entries WHERE id=?').get(id);
  if (!e || lifecycle(db, id)?.state === 'trash') throw Error('来源不存在或在回收站，原摘录保留。');
  return e;
}
function anchorFor(db, input) {
  const e = source(db, input.source_id),
    text = readingText(e.content);
  if (
    typeof input.quote !== 'string' ||
    input.quote.trim().length < 2 ||
    input.quote.length > 2000 ||
    !Number.isSafeInteger(input.start) ||
    !Number.isSafeInteger(input.end) ||
    input.start < 0 ||
    input.end <= input.start ||
    input.hash !== textHash(text) ||
    text.slice(input.start, input.end) !== input.quote
  )
    throw Error('选区已变化或无效，请在当前正文重新选择；未保存。');
  return {
    e,
    anchor: {
      version: 1,
      hash: input.hash,
      start: input.start,
      end: input.end,
      quote: input.quote,
      prefix: text.slice(Math.max(0, input.start - 64), input.start),
      suffix: text.slice(input.end, input.end + 64),
    },
  };
}
export function readingTargets(db, q = '') {
  if (typeof q !== 'string' || q.length > 200) throw Error('检索文字超限。');
  return db
    .prepare(
      `SELECT e.* FROM entries e WHERE e.type='note' AND ${visibleSql(db)} AND e.title LIKE ? ORDER BY e.updated_at DESC LIMIT 25`,
    )
    .all('%' + q.replace(/[\\%_]/g, '') + '%')
    .map((e) => ({ id: e.id, title: e.title, version: entryStamp(e) }));
}
export function markDetail(db, row) {
  const e = db.prepare('SELECT * FROM entries WHERE id=?').get(row.source_id),
    a = JSON.parse(row.anchor_json);
  const location = e
    ? resolveAnchor(readingText(e.content), a, textHash(readingText(e.content)))
    : { state: 'missing', start: null, end: null };
  return {
    ...row,
    anchor: a,
    location,
    sourceTitle: e?.title || row.source_title,
    pageId: pageOwner(db, row.source_id) || row.source_id,
    targetTitle: row.target_id
      ? db.prepare('SELECT title FROM entries WHERE id=?').get(row.target_id)?.title
      : null,
  };
}
export function readingMarks(db, id) {
  source(db, id);
  const ids = new Set([
    id,
    ...db
      .prepare(
        `WITH RECURSIVE tree(id) AS (SELECT entry_id FROM knowledge_structure WHERE parent_id=? UNION SELECT k.entry_id FROM knowledge_structure k JOIN tree t ON k.parent_id=t.id) SELECT id FROM tree`,
      )
      .all(id)
      .map((r) => r.id),
  ]);
  return db
    .prepare('SELECT * FROM reading_marks WHERE deleted_at IS NULL ORDER BY created_at DESC')
    .all()
    .filter((r) => ids.has(r.source_id) || ids.has(r.target_id))
    .map((r) => markDetail(db, r));
}
export function createMark(db, input, { beforeCommit, dir } = {}) {
  if (
    !['annotation', 'citation'].includes(input.kind) ||
    typeof input.comment !== 'string' ||
    input.comment.length > 5000 ||
    (input.kind === 'annotation' && !input.comment.trim()) ||
    input.confirm !== '确认保存批注或引用'
  )
    throw Error('请填写个人批注并明确确认。');
  return transaction(db, () => {
    const { e, anchor } = anchorFor(db, input),
      id = randomUUID(),
      now = new Date().toISOString();
    let target = null;
    if (input.kind === 'citation') {
      if (input.target_id === e.id) throw Error('不能引用到来源自身。');
      if (input.target_id) {
        target = source(db, input.target_id);
        if (
          (dir && readWorkspace(dir).drafts[target.id]) ||
          db.prepare('SELECT key FROM knowledge_drafts WHERE key=?').get(target.id)
        )
          throw Error('目标存在未保存草稿，请先保存或处理草稿，再追加引用。');
        if (target.type !== 'note' || entryStamp(target) !== input.target_version)
          throw Error('目标正文已变化，请重新选择后审核，未追加。');
      } else {
        if (
          typeof input.target_title !== 'string' ||
          !input.target_title.trim() ||
          input.target_title.length > 200
        )
          throw Error('请输入新笔记标题。');
      }
      const content =
        (target?.content || '') +
        '<blockquote><p>' +
        escape(anchor.quote) +
        '</p><p>引用：<a data-entry-id="' +
        e.id +
        '" data-reading-mark="' +
        id +
        '">' +
        escape(e.title) +
        '</a> · ' +
        now +
        '</p></blockquote>' +
        (input.comment ? '<p>个人批注：' + escape(input.comment) + '</p>' : '');
      let form = target
        ? { ...hydrate(db, target), content }
        : {
            type: 'note',
            title: input.target_title.trim(),
            url: '',
            description: '',
            content,
            cover_asset_id: null,
            pinned: 0,
            domains: [],
            tags: [],
            collections: [],
          };
      for (const k of ['domains', 'tags', 'collections'])
        if (target) form[k] = form[k].map((t) => t.id);
      const record =
        target &&
        db.prepare('SELECT entry_id FROM knowledge_records WHERE entry_id=?').get(target.id);
      if (record) {
        const old = getRecord(db, target.id);
        target = saveRecord(
          db,
          {
            ...old,
            ...form,
            status: old.status === 'confirmed' ? 'review' : old.status,
            references: old.references.map((r) => r.id),
          },
          target.id,
          { outer: true },
        );
      } else target = saveEntry(db, form, target?.id, { transaction: false });
      if(!target?.id)throw Error('目标存在重复网址或已变化，请先处理目标条目；未追加任何引用。');
    }
    db.prepare('INSERT INTO reading_marks VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
      id,
      input.kind,
      e.id,
      target?.id || null,
      e.title,
      pageOwner(db, e.id),
      anchor.quote,
      JSON.stringify(anchor),
      input.comment,
      1,
      now,
      now,
      null,
    );
    beforeCommit?.();
    return markDetail(db, db.prepare('SELECT * FROM reading_marks WHERE id=?').get(id));
  });
}
export function updateMark(db, id, input) {
  return transaction(db, () => {
    const r = db.prepare('SELECT * FROM reading_marks WHERE id=? AND deleted_at IS NULL').get(id);
    if (!r || input.revision !== r.revision) throw Error('批注已变化，请重新载入；未覆盖。');
    if (input.action === 'delete') {
      if (input.confirm !== '删除这条批注或引用') throw Error('请明确确认删除。');
      db.prepare('UPDATE reading_marks SET deleted_at=?,revision=revision+1 WHERE id=?').run(
        new Date().toISOString(),
        id,
      );
    } else {
      if (typeof input.comment !== 'string' || input.comment.length > 5000 || !input.comment.trim())
        throw Error('批注文字无效。');
      db.prepare(
        'UPDATE reading_marks SET comment=?,revision=revision+1,updated_at=? WHERE id=?',
      ).run(input.comment, new Date().toISOString(), id);
    }
    return { ok: true };
  });
}
export function validateReadingMarks(db) {
  if (!readingVersion(db)) return;
  for (const r of db.prepare('SELECT * FROM reading_marks').all()) {
    let a;
    try {
      a = JSON.parse(r.anchor_json);
    } catch {
      throw Error('批注定位信息损坏。');
    }
    if (
      !/^[a-f0-9-]{36}$/.test(r.id) ||
      !['annotation', 'citation'].includes(r.kind) ||
      typeof r.quote !== 'string' ||
      r.quote.trim().length < 2 ||
      r.quote.length > 2000 ||
      !a ||
      Object.keys(a).sort().join() !== 'end,hash,prefix,quote,start,suffix,version' ||
      a.version !== 1 ||
      a.quote !== r.quote ||
      !/^[a-f0-9]{64}$/.test(a.hash) ||
      !Number.isSafeInteger(a.start) ||
      a.start < 0 ||
      a.end !== a.start + r.quote.length ||
      typeof a.prefix !== 'string' ||
      a.prefix.length > 64 ||
      typeof a.suffix !== 'string' ||
      a.suffix.length > 64 ||
      typeof r.comment !== 'string' ||
      r.comment.length > 5000 ||
      (r.kind === 'annotation' && !r.comment.trim()) ||
      typeof r.source_title !== 'string' ||
      !r.source_title ||
      r.source_title.length > 200 ||
      r.source_id === r.target_id ||
      (r.kind === 'citation' ? !r.target_id : r.target_id !== null) ||
      !Number.isSafeInteger(r.revision) ||
      r.revision < 1 ||
      typeof r.created_at !== 'string' ||
      typeof r.updated_at !== 'string' ||
      !/^\d{4}-\d\d-\d\dT/.test(r.created_at) ||
      !Number.isFinite(Date.parse(r.created_at)) ||
      !Number.isFinite(Date.parse(r.updated_at)) ||
      (r.deleted_at !== null &&
        (typeof r.deleted_at !== 'string' || !Number.isFinite(Date.parse(r.deleted_at))))
    )
      throw Error('批注或引用结构无效，已拒绝启动/恢复。');
  }
}
