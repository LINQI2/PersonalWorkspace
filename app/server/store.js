import { validateMindmaps } from './mindmaps.js';
import { validateReadingMarks } from './reading.js';
import { lifecycle, lifecycleVersion, validateLifecycle } from './lifecycle.js';
import { validateRelations } from './relations.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import sanitize from 'sanitize-html';
import { randomUUID } from 'node:crypto';
import { decodeHTML } from 'entities';
import { findDuplicate } from './library.js';
import { initializeStore } from './migrations.js';
import { validateReadingBackup } from './knowledge/structure.js';
import { validateUnified, unifiedVersion, assignPrimary, provenance } from './unified.js';
import { validateAssistantBackup } from './assistant/review.js';
import { validateKnowledgeBackup } from './knowledge/store.js';
import { validateTopicBackup } from './topics.js';

export const VERSION = 11;
export const toolKinds = ['website', 'online', 'ai', 'desktop', 'custom', 'other'];
export const kinds = ['domains', 'tags', 'collections'];
export function openStore(directory, options = {}) {
  mkdirSync(path.join(directory, 'attachments'), { recursive: true });
  const db = new DatabaseSync(path.join(directory, 'library.sqlite'));
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    initializeStore(db, directory, options);
    validateReadingBackup(db);
    validateAssistantBackup(db);
    validateUnified(db);
    validateRelations(db);
    validateLifecycle(db);
    validateReadingMarks(db);
    validateMindmaps(db);
    validateKnowledgeBackup(db);
    validateTopicBackup(db, db.prepare('SELECT * FROM assets').all());
    db.exec('PRAGMA journal_mode=WAL;');
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}
export function validUrl(value) {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password;
  } catch {
    return false;
  }
}
export function cleanContent(html) {
  if (typeof html !== 'string' || html.length > 1_000_000)
    throw new Error('笔记正文无效或超过 1 MB。');
  return sanitize(html, {
    allowedTags: [
      'p',
      'br',
      'h2',
      'h3',
      'strong',
      'em',
      'ul',
      'ol',
      'li',
      'a',
      'img',
      'blockquote',
      's',
    ],
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'data-entry-id', 'data-reading-mark'],
      img: ['src', 'alt'],
    },
    allowedSchemes: ['http', 'https'],
    allowProtocolRelative: false,
    transformTags: {
      a: (_tag, attrs) => ({
        tagName: 'a',
        attribs: {
          href: /^[a-f0-9-]{36}$/.test(attrs['data-entry-id'] || '')
            ? /^[a-f0-9-]{36}$/.test(attrs['data-reading-mark'] || '')
              ? '#quote-' + attrs['data-reading-mark']
              : '#'
            : validUrl(attrs.href)
              ? attrs.href
              : '',
          ...(/^[a-f0-9-]{36}$/.test(attrs['data-entry-id'] || '')
            ? { 'data-entry-id': attrs['data-entry-id'] }
            : {}),
          ...(/^[a-f0-9-]{36}$/.test(attrs['data-entry-id'] || '') &&
          /^[a-f0-9-]{36}$/.test(attrs['data-reading-mark'] || '')
            ? { 'data-reading-mark': attrs['data-reading-mark'] }
            : {}),
          target: '_blank',
          rel: 'noopener noreferrer',
        },
      }),
    },
    exclusiveFilter: (frame) =>
      frame.tag === 'img' && !/^\/assets\/[a-f0-9-]+\.webp$/.test(frame.attribs.src || ''),
  });
}
export function hydrate(db, row) {
  if (!row) return null;
  const knowledge =
    db.prepare('PRAGMA user_version').get().user_version >= 4
      ? db.prepare('SELECT kind FROM knowledge_records WHERE entry_id=?').get(row.id)
      : null;
  return {
    ...row,
    ...(db.prepare('PRAGMA user_version').get().user_version >= 11 &&
    db.prepare('SELECT entry_id FROM mindmaps WHERE entry_id=?').get(row.id)
      ? { mindmap: true }
      : {}),
    lifecycle: lifecycle(db, row.id),
    ...(unifiedVersion(db)
      ? {
          primary_domain_id:
            db.prepare('SELECT domain_id FROM content_primary_domains WHERE entry_id=?').get(row.id)
              ?.domain_id || null,
          provenance: provenance(db, row.id),
        }
      : {}),
    ...(knowledge ? { knowledge_kind: knowledge.kind } : {}),
    ...Object.fromEntries(
      kinds.map((kind) => [
        kind,
        db
          .prepare(
            `SELECT t.id,t.name FROM ${kind} t JOIN entry_${kind} r ON t.id=r.taxonomy_id WHERE r.entry_id=? ORDER BY t.name`,
          )
          .all(row.id),
      ]),
    ),
    cover: row.cover_asset_id
      ? db.prepare('SELECT filename FROM assets WHERE id=?').get(row.cover_asset_id)?.filename
      : null,
  };
}
export function saveEntry(db, input, id, { transaction = true, mapWrite = false } = {}) {
  if (
    id &&
    !mapWrite &&
    db.prepare('PRAGMA user_version').get().user_version >= 11 &&
    db.prepare('SELECT entry_id FROM mindmaps WHERE entry_id=?').get(id)
  )
    throw Error('请使用思维导图编辑器保存，未修改导图。');
  const existing = id ? db.prepare('SELECT * FROM entries WHERE id=?').get(id) : null;
  if (existing && lifecycle(db, id)?.state === 'trash')
    throw Error('内容在回收站，请先恢复后编辑。');
  const resourceKind = input.resource_kind ?? existing?.resource_kind ?? 'knowledge';
  const toolKind = input.tool_kind ?? existing?.tool_kind ?? '';
  const knowledge =
    existing && db.prepare('PRAGMA user_version').get().user_version >= 4
      ? db.prepare('SELECT entry_id,revision FROM knowledge_records WHERE entry_id=?').get(id)
      : null;
  if (knowledge && (input.type !== 'note' || resourceKind !== 'knowledge'))
    throw Error('知识记录需保持笔记类型；请在知识目录管理元数据。');
  if (
    !['knowledge', 'tool'].includes(resourceKind) ||
    (resourceKind === 'tool' ? !toolKinds.includes(toolKind) : toolKind !== '')
  )
    throw Error('工具类型无效。');
  if (!['bookmark', 'note'].includes(input.type)) throw new Error('请选择收藏网址或原创笔记。');
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title || title.length > 200) throw new Error('标题必填，最多 200 字。');
  if (typeof input.description !== 'string' || input.description.length > 2000)
    throw new Error('简介最多 2000 字。');
  const url =
    input.type === 'bookmark' || resourceKind === 'tool' ? input.url?.trim() || null : null;
  if ((input.type === 'bookmark' || url) && (!validUrl(url) || url.length > 4096))
    throw new Error('网址必须为有效的 http/https 地址，不含用户名或密码。');
  if (id && !db.prepare('SELECT id FROM entries WHERE id=?').get(id))
    throw new Error('条目不存在。');
  const duplicate = url && findDuplicate(db, url, id || '');
  if (duplicate && input.allowDuplicate !== true) return { duplicate };
  const content = cleanContent(input.content || '');
  for (const src of content.matchAll(/src="\/assets\/([^"]+)"/g))
    if (!db.prepare('SELECT id FROM assets WHERE filename=?').get(src[1]))
      throw new Error('正文图片不存在，请重新上传。');
  const cover = input.cover_asset_id || null;
  if (cover && !db.prepare('SELECT id FROM assets WHERE id=?').get(cover))
    throw new Error('封面图片不存在。');
  for (const kind of kinds) {
    if (
      !Array.isArray(input[kind]) ||
      input[kind].length > 100 ||
      input[kind].some(
        (x) => typeof x !== 'string' || !db.prepare(`SELECT id FROM ${kind} WHERE id=?`).get(x),
      )
    )
      throw new Error('分类选择无效，请刷新后重试。');
  }
  const now = new Date().toISOString();
  const entryId = id || randomUUID();
  const plain = decodeHTML(
    sanitize(content.replace(/<\/(p|h2|h3|li|blockquote)>/g, '</$1> '), {
      allowedTags: [],
      allowedAttributes: {},
    }),
  ).replace(/\u00a0/g, ' ');
  if (transaction) db.exec('BEGIN IMMEDIATE');
  try {
    if (
      existing &&
      !knowledge &&
      lifecycleVersion(db) &&
      (existing.title !== title ||
        existing.content !== content ||
        existing.description !== input.description)
    )
      db.prepare('INSERT INTO content_versions VALUES(?,?,?,?,?,?)').run(
        randomUUID(),
        id,
        existing.title,
        existing.description,
        existing.content,
        now,
      );
    if (transaction && knowledge && db.prepare('PRAGMA user_version').get().user_version >= 5)
      db.prepare('INSERT INTO knowledge_versions VALUES(?,?,?,?,?,?)').run(
        randomUUID(),
        id,
        existing.title,
        existing.content,
        knowledge.revision,
        now,
      );
    if (knowledge && (existing.title !== title || existing.content !== content))
      db.prepare(
        "UPDATE knowledge_records SET status=CASE WHEN status='confirmed' THEN 'review' ELSE status END,confirmed_at=NULL,revision=revision+1 WHERE entry_id=?",
      ).run(id);
    if (id)
      db.prepare(
        'UPDATE entries SET type=?,title=?,url=?,description=?,content=?,plain_text=?,cover_asset_id=?,pinned=?,updated_at=?,resource_kind=?,tool_kind=? WHERE id=?',
      ).run(
        input.type,
        title,
        url,
        input.description,
        content,
        plain,
        cover,
        input.pinned ? 1 : 0,
        now,
        resourceKind,
        toolKind,
        id,
      );
    else
      db.prepare(
        'INSERT INTO entries(id,type,title,url,description,content,plain_text,cover_asset_id,pinned,created_at,updated_at,resource_kind,tool_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ).run(
        entryId,
        input.type,
        title,
        url,
        input.description,
        content,
        plain,
        cover,
        input.pinned ? 1 : 0,
        now,
        now,
        resourceKind,
        toolKind,
      );
    for (const kind of kinds) {
      db.prepare(`DELETE FROM entry_${kind} WHERE entry_id=?`).run(entryId);
      for (const t of new Set(input[kind]))
        db.prepare(`INSERT INTO entry_${kind} VALUES(?,?)`).run(entryId, t);
    }
    if (unifiedVersion(db)) {
      const oldPrimary = db
        .prepare('SELECT domain_id FROM content_primary_domains WHERE entry_id=?')
        .get(entryId)?.domain_id;
      assignPrimary(
        db,
        entryId,
        Object.hasOwn(input, 'primary_domain_id')
          ? input.primary_domain_id || null
          : input.domains.includes(oldPrimary)
            ? oldPrimary
            : null,
      );
    }
    if (transaction) db.exec('COMMIT');
  } catch (e) {
    if (transaction) db.exec('ROLLBACK');
    throw e;
  }
  return hydrate(db, db.prepare('SELECT * FROM entries WHERE id=?').get(entryId));
}
