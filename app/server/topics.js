import { visibleSql } from './lifecycle.js';
import { unifiedVersion, ruleMembers } from './unified.js';
import { randomUUID, createHash } from 'node:crypto';
import { cleanContent, validUrl } from './store.js';
import { validateSchema } from './ai/schema.js';
import { collectionSchema } from './ai/collection.js';
const hash = (entry) =>
  createHash('sha256')
    .update(
      JSON.stringify([
        entry.id,
        entry.title,
        entry.description,
        entry.content,
        entry.url,
        entry.updated_at,
      ]),
    )
    .digest('hex');
export const sourceSnapshot = (entry, evidence) => ({
  id: entry.id,
  title: entry.title,
  url: entry.url,
  type: entry.type,
  updated_at: entry.updated_at,
  hash: hash(entry),
  evidence,
});
export function validateSources(sources) {
  if (
    !Array.isArray(sources) ||
    sources.length > 100 ||
    new Set(sources.map((s) => s?.id)).size !== sources.length ||
    sources.some(
      (s) =>
        !s ||
        typeof s.id !== 'string' ||
        s.id.length > 100 ||
        typeof s.title !== 'string' ||
        !s.title.trim() ||
        s.title.length > 200 ||
        !['bookmark', 'note'].includes(s.type) ||
        typeof s.evidence !== 'boolean' ||
        !Number.isFinite(Date.parse(s.updated_at)) ||
        !/^[a-f0-9]{64}$/.test(s.hash) ||
        !(s.url === null || (typeof s.url === 'string' && s.url.length <= 4096 && validUrl(s.url))),
    )
  )
    throw Error('专题来源记录无效。');
  return sources;
}
function checkContent(db, content, sources) {
  const html = cleanContent(content);
  for (const src of html.matchAll(/src="\/assets\/([^"]+)"/g))
    if (!db.prepare('SELECT id FROM assets WHERE filename=?').get(src[1]))
      throw Error('专题图片不存在，请重新上传。');
  for (const ref of html.matchAll(/data-entry-id="([^"]+)"/g))
    if (!sources.some((s) => s.id === ref[1])) throw Error('专题正文引用不属于已审核的来源。');
  return html;
}
export function getCollection(db, id) {
  const row = db.prepare('SELECT * FROM collections WHERE id=?').get(id);
  if (!row) throw Error('专题不存在。');
  const doc = db.prepare('SELECT * FROM collection_documents WHERE collection_id=?').get(id);
  return {
    ...row,
    introduction: doc?.introduction || '',
    content: doc?.content || '',
    revision: doc?.revision || 0,
    updated_at: doc?.updated_at || '',
    sources: JSON.parse(doc?.sources_json || '[]'),
    count: unifiedVersion(db)
      ? new Set([
          ...db
            .prepare(
              'SELECT r.entry_id FROM entry_collections r JOIN entries e ON e.id=r.entry_id WHERE r.taxonomy_id=? AND ' +
                visibleSql(db),
            )
            .all(id)
            .map((r) => r.entry_id),
          ...ruleMembers(db, id),
        ]).size
      : db.prepare('SELECT count(*) n FROM entry_collections WHERE taxonomy_id=?').get(id).n,
  };
}
export function validateCollectionForm(db, form, sources) {
  if (
    !form ||
    typeof form.name !== 'string' ||
    !form.name.trim() ||
    form.name.trim().length > 50 ||
    typeof form.introduction !== 'string' ||
    form.introduction.length > 2000 ||
    typeof form.content !== 'string' ||
    !Number.isSafeInteger(form.revision) ||
    form.revision < 0
  )
    throw Error('专题标题/介绍/版本无效。');
  return {
    name: form.name.trim(),
    introduction: form.introduction,
    content: checkContent(db, form.content, sources),
    revision: form.revision,
    aiDraftId: form.aiDraftId || '',
    adoptMode: form.adoptMode || 'append',
  };
}
export function readCollectionDraft(db, id, kind) {
  getCollection(db, id);
  const row = db
    .prepare('SELECT * FROM collection_drafts WHERE collection_id=? AND kind=?')
    .get(id, kind);
  return row
    ? { ...JSON.parse(row.payload), baseRevision: row.base_revision, savedAt: row.saved_at }
    : null;
}
export function updateAiReview(db, id, input) {
  const draft = readCollectionDraft(db, id, 'ai');
  if (
    !draft ||
    draft.id !== input?.id ||
    typeof input.reviewTitle !== 'string' ||
    input.reviewTitle.length > 200 ||
    typeof input.review !== 'string' ||
    input.review.length > 50000
  )
    throw Error('AI 审核草稿已变化或格式无效。');
  const { baseRevision, savedAt, ...payload } = draft;
  return writeCollectionDraft(
    db,
    id,
    'ai',
    { ...payload, reviewTitle: input.reviewTitle, review: input.review },
    baseRevision,
  );
}
export function writeCollectionDraft(db, id, kind, payload, baseRevision) {
  const json = JSON.stringify(payload);
  if (Buffer.byteLength(json) > 2 * 1024 * 1024) throw Error('专题草稿过大。');
  db.prepare(
    'INSERT INTO collection_drafts VALUES(?,?,?,?,?) ON CONFLICT(collection_id,kind) DO UPDATE SET payload=excluded.payload,base_revision=excluded.base_revision,saved_at=excluded.saved_at',
  ).run(id, kind, json, baseRevision, new Date().toISOString());
  return readCollectionDraft(db, id, kind);
}
export function validateLiveSources(db, id, sources) {
  const dynamic = new Set(unifiedVersion(db) ? ruleMembers(db, id) : []);
  for (const s of sources) {
    const manual = db
      .prepare(
        'SELECT e.* FROM entries e JOIN entry_collections r ON r.entry_id=e.id WHERE r.taxonomy_id=? AND e.id=?',
      )
      .get(id, s.id);
    const row =
      manual ||
      (dynamic.has(s.id) ? db.prepare('SELECT * FROM entries WHERE id=?').get(s.id) : null);
    if (!row || hash(row) !== s.hash)
      throw Error('AI 来源收藏已更新/移除，请重新生成，未保存任何修改。');
  }
}
function adoptionSources(db, id, current, form) {
  if (form.historyVersionId) {
    const version = db
      .prepare('SELECT * FROM collection_versions WHERE id=? AND collection_id=?')
      .get(form.historyVersionId, id);
    if (!version) throw Error('专题历史版本不存在。');
    return JSON.parse(version.sources_json);
  }
  if (!form.aiDraftId) return current.sources;
  const draft = readCollectionDraft(db, id, 'ai');
  if (!draft || draft.id !== form.aiDraftId || draft.baseRevision !== current.revision)
    throw Error('AI 草稿已变化或过期，请重新审核。');
  if (!['append', 'replace'].includes(form.adoptMode)) throw Error('请选择追加或替换。');
  validateLiveSources(db, id, draft.sources);
  return form.adoptMode === 'replace'
    ? draft.sources
    : [
        ...current.sources.map((s) => draft.sources.find((p) => p.id === s.id) || s),
        ...draft.sources.filter((s) => !current.sources.some((p) => p.id === s.id)),
      ];
}
export function saveCollection(db, id, input) {
  const current = getCollection(db, id);
  if (input?.revision !== current.revision)
    throw Error('专题已更新，请保留草稿并重新载入，避免覆盖。');
  const sources = validateSources(adoptionSources(db, id, current, input));
  const form = validateCollectionForm(db, input, sources);
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('INSERT INTO collection_versions VALUES(?,?,?,?,?,?,?,?)').run(
      randomUUID(),
      id,
      current.name,
      current.introduction,
      current.content,
      JSON.stringify(current.sources),
      current.revision,
      new Date().toISOString(),
    );
    db.prepare('UPDATE collections SET name=? WHERE id=?').run(form.name, id);
    db.prepare(
      'INSERT INTO collection_documents VALUES(?,?,?,?,?,?) ON CONFLICT(collection_id) DO UPDATE SET introduction=excluded.introduction,content=excluded.content,sources_json=excluded.sources_json,revision=excluded.revision,updated_at=excluded.updated_at',
    ).run(
      id,
      form.introduction,
      form.content,
      JSON.stringify(sources),
      current.revision + 1,
      new Date().toISOString(),
    );
    db.prepare('DELETE FROM collection_drafts WHERE collection_id=?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getCollection(db, id);
}
export function saveManualCollectionDraft(db, id, input) {
  const current = getCollection(db, id);
  // A dirty draft can be retained after an optimistic conflict, but not adopted without review.
  const ai = input.aiDraftId ? readCollectionDraft(db, id, 'ai') : null;
  const sources =
    ai && ai.id === input.aiDraftId
      ? validateSources([
          ...current.sources,
          ...ai.sources.filter((s) => !current.sources.some((p) => p.id === s.id)),
        ])
      : current.sources;
  const form = validateCollectionForm(db, input, sources);
  return writeCollectionDraft(db, id, 'manual', { form }, form.revision);
}
export function collectionRelations(db, id, { ids, action }) {
  getCollection(db, id);
  if (
    !['add', 'remove'].includes(action) ||
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 100 ||
    ids.some(
      (x) => typeof x !== 'string' || !db.prepare('SELECT id FROM entries WHERE id=?').get(x),
    )
  )
    throw Error('专题资源选择无效。');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const entry of new Set(ids))
      if (action === 'add')
        db.prepare('INSERT OR IGNORE INTO entry_collections VALUES(?,?)').run(entry, id);
      else
        db.prepare('DELETE FROM entry_collections WHERE entry_id=? AND taxonomy_id=?').run(
          entry,
          id,
        );
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return getCollection(db, id);
}
export function validateTopicBackup(db, assets) {
  const check = (content, sources) => {
    validateSources(sources);
    if (cleanContent(content) !== content) throw Error('专题备份含不安全正文。');
    for (const src of content.matchAll(/src="\/assets\/([^"]+)"/g))
      if (!assets.some((a) => a.filename === src[1])) throw Error('专题备份图片缺失。');
    for (const ref of content.matchAll(/data-entry-id="([^"]+)"/g))
      if (!sources.some((s) => s.id === ref[1])) throw Error('专题备份引用无效。');
  };
  for (const table of ['collection_documents', 'collection_versions'])
    for (const row of db.prepare(`SELECT * FROM ${table}`).all()) {
      if (
        typeof row.introduction !== 'string' ||
        row.introduction.length > 2000 ||
        !Number.isSafeInteger(row.revision) ||
        row.revision < 0
      )
        throw Error('专题备份字段无效。');
      check(row.content, JSON.parse(row.sources_json));
    }
  for (const row of db.prepare('SELECT * FROM collection_drafts').all()) {
    const payload = JSON.parse(row.payload);
    if (
      Buffer.byteLength(row.payload) > 2 * 1024 * 1024 ||
      !Number.isSafeInteger(row.base_revision) ||
      row.base_revision < 0
    )
      throw Error('专题草稿备份无效。');
    if (row.kind === 'manual') {
      const current = getCollection(db, row.collection_id);
      const ai = readCollectionDraft(db, row.collection_id, 'ai');
      const sources =
        payload.form?.aiDraftId && ai
          ? validateSources([
              ...current.sources,
              ...ai.sources.filter((s) => !current.sources.some((p) => p.id === s.id)),
            ])
          : current.sources;
      const form = validateCollectionForm(db, payload.form, sources);
      check(form.content, sources);
    } else {
      if (
        (payload.reviewTitle !== undefined &&
          (typeof payload.reviewTitle !== 'string' || payload.reviewTitle.length > 200)) ||
        (payload.review !== undefined &&
          (typeof payload.review !== 'string' || payload.review.length > 50000))
      )
        throw Error('AI 审核文本备份无效。');
      validateSources(payload.sources);
      validateSchema(
        payload.suggestion,
        collectionSchema(payload.sources.filter((s) => s.evidence).map((s) => s.id)),
      );
    }
  }
}
