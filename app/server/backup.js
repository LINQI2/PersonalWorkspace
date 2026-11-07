import { professionalTables, validateProfessional } from './professional.js';
import { validateMindmaps } from './mindmaps.js';
import { validateReadingMarks } from './reading.js';
import { validateLifecycle } from './lifecycle.js';
import { validateRelations } from './relations.js';
import { backup, DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import AdmZip from 'adm-zip';
import { VERSION, kinds, cleanContent, validUrl, openStore, toolKinds } from './store.js';
import { workspaceName, readWorkspace, validateWorkspace } from './workspace.js';
import { assertDatabaseSchema } from './migrations.js';
import { validateTopicBackup } from './topics.js';
import { knowledgeTables, validateKnowledgeBackup } from './knowledge/store.js';
import { unifiedTables, validateUnified } from './unified.js';
import { validateAssistantBackup } from './assistant/review.js';
const hash = (b) => createHash('sha256').update(b).digest('hex');
function schema(db) {
  return db
    .prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
}
export async function exportBackup(db, dir) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'pk-export-'));
  try {
    await backup(db, path.join(tmp, 'library.sqlite'));
    const zip = new AdmZip();
    const files = [];
    const add = (name, bytes) => {
      zip.addFile(name, bytes);
      files.push({ path: name, size: bytes.length, sha256: hash(bytes) });
    };
    add('library.sqlite', readFileSync(path.join(tmp, 'library.sqlite')));
    if (existsSync(path.join(dir, workspaceName)))
      add(workspaceName, Buffer.from(JSON.stringify(readWorkspace(dir))));
    for (const filename of readdirSync(path.join(dir, 'attachments')))
      if (/^[a-f0-9-]+\.webp$/.test(filename))
        add('attachments/' + filename, readFileSync(path.join(dir, 'attachments', filename)));
    if (files.length + 1 > 10000 || files.reduce((n, f) => n + f.size, 0) > 512 * 1024 * 1024)
      throw new Error(
        '当前库超过 ZIP 恢复上限（10000 文件 / 512 MB）。请停止服务后复制完整 data 目录备份。',
      );
    zip.addFile(
      'manifest.json',
      Buffer.from(
        JSON.stringify({
          format: 'personal-knowledge',
          version: db.prepare('PRAGMA user_version').get().user_version,
          createdAt: new Date().toISOString(),
          files,
        }),
      ),
    );
    const bytes = zip.toBuffer();
    if (bytes.length > 256 * 1024 * 1024)
      throw new Error('压缩包超过 256 MB 恢复上限，请停止服务后备份完整 data 目录。');
    return bytes;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
export function validateBackup(buffer, { upgrade = true } = {}) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'pk-import-'));
  let db;
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    if (entries.length > 10000) throw new Error('备份文件数量超过限制。');
    const seen = new Set();
    let total = 0;
    for (const e of entries) {
      if (
        e.isDirectory ||
        seen.has(e.entryName) ||
        !(
          e.entryName === 'manifest.json' ||
          e.entryName === 'library.sqlite' ||
          e.entryName === workspaceName ||
          /^attachments\/[a-f0-9-]+\.webp$/.test(e.entryName)
        )
      )
        throw new Error('备份含非法路径、目录或重复文件。');
      seen.add(e.entryName);
      total += e.header.size;
      if (e.header.size > 256 * 1024 * 1024 || total > 512 * 1024 * 1024)
        throw new Error('解压后的备份超过 512 MB 限制。');
    }
    const manifestEntry = zip.getEntry('manifest.json');
    if (!manifestEntry || manifestEntry.header.size > 2 * 1024 * 1024)
      throw new Error('缺少有效备份清单。');
    const manifest = JSON.parse(manifestEntry.getData().toString());
    if (
      manifest.format !== 'personal-knowledge' ||
      ![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, VERSION].includes(manifest.version) ||
      !Array.isArray(manifest.files) ||
      manifest.files.length !== entries.length - 1
    )
      throw new Error('备份格式或版本不兼容。');
    const listed = new Set();
    mkdirSync(path.join(tmp, 'attachments'));
    for (const f of manifest.files) {
      const e = zip.getEntry(f.path);
      if (!e || f.path === 'manifest.json' || listed.has(f.path))
        throw new Error('备份清单不完整。');
      listed.add(f.path);
      const bytes = e.getData();
      if (bytes.length !== f.size || hash(bytes) !== f.sha256)
        throw new Error('备份文件校验失败。');
      writeFileSync(path.join(tmp, f.path), bytes);
    }
    if (!existsSync(path.join(tmp, 'library.sqlite'))) throw new Error('备份缺少数据库。');
    db = new DatabaseSync(path.join(tmp, 'library.sqlite'), { readOnly: true });
    if (
      db.prepare('PRAGMA user_version').get().user_version !== manifest.version ||
      db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
      db.prepare('PRAGMA foreign_key_check').all().length
    )
      throw new Error('数据库结构或完整性检查失败。');
    // Accept only the exact schema for the declared supported version.
    const objects = schema(db);
    assertDatabaseSchema(db, manifest.version);
    const tables = [
      'assets',
      'entries',
      ...kinds,
      ...kinds.map((k) => 'entry_' + k),
      ...(manifest.version >= 2
        ? ['collection_documents', 'collection_versions', 'collection_drafts']
        : []),
      ...(manifest.version >= 4 ? knowledgeTables : []),
      ...(manifest.version >= 5 ? ['knowledge_structure', 'knowledge_versions'] : []),
      ...(manifest.version >= 6 ? ['assistant_changes'] : []),
      ...(manifest.version >= 7 ? unifiedTables : []),
      ...(manifest.version >= 8 ? ['relation_details', 'relation_history'] : []),
      ...(manifest.version >= 9 ? ['content_lifecycle', 'content_versions'] : []),
      ...(manifest.version >= 10 ? ['reading_marks'] : []),
      ...(manifest.version >= 11 ? ['mindmaps', 'mindmap_versions'] : []),
      ...(manifest.version >= 12 ? professionalTables : []),
    ].sort();
    if (
      objects
        .filter((x) => x.type === 'table')
        .map((x) => x.name)
        .sort()
        .join() !== tables.join() ||
      objects.some((x) => !['table', 'index'].includes(x.type))
    )
      throw new Error('数据库含不支持的结构。');
    const required = {
      assets: ['id', 'filename', 'mime', 'size'],
      entries: [
        'id',
        'type',
        'title',
        'url',
        'description',
        'content',
        'plain_text',
        'cover_asset_id',
        'pinned',
        'created_at',
        'updated_at',
        ...(manifest.version >= 3 ? ['resource_kind', 'tool_kind'] : []),
      ],
      domains: ['id', 'name'],
      tags: ['id', 'name'],
      collections: ['id', 'name'],
      entry_domains: ['entry_id', 'taxonomy_id'],
      entry_tags: ['entry_id', 'taxonomy_id'],
      entry_collections: ['entry_id', 'taxonomy_id'],
    };
    for (const [table, columns] of Object.entries(required))
      if (
        db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .map((x) => x.name)
          .join() !== columns.join()
      )
        throw new Error('数据库字段不兼容。');
    const assets = db.prepare('SELECT * FROM assets').all();
    if (existsSync(path.join(tmp, workspaceName))) {
      const w = validateWorkspace(JSON.parse(readFileSync(path.join(tmp, workspaceName), 'utf8')));
      for (const d of Object.values(w.drafts)) {
        if (d.form.cover_asset_id && !assets.some((a) => a.id === d.form.cover_asset_id))
          throw new Error('草稿封面附件缺失。');
        for (const image of d.form.content.matchAll(/src="\/assets\/([^"]+)"/g))
          if (!assets.some((a) => a.filename === image[1])) throw new Error('草稿正文图片缺失。');
      }
    }
    for (const a of assets)
      if (
        !/^[a-f0-9-]+\.webp$/.test(a.filename) ||
        a.mime !== 'image/webp' ||
        !listed.has('attachments/' + a.filename) ||
        readFileSync(path.join(tmp, 'attachments', a.filename)).length !== a.size
      )
        throw new Error('图片记录与附件清单不一致。');
    for (const kind of kinds)
      for (const t of db.prepare(`SELECT * FROM ${kind}`).all())
        if (typeof t.name !== 'string' || !t.name.trim() || t.name.length > 50)
          throw new Error('备份分类无效。');
    for (const e of db.prepare('SELECT * FROM entries').all()) {
      if (
        !['bookmark', 'note'].includes(e.type) ||
        !e.title?.trim() ||
        e.title.length > 200 ||
        typeof e.description !== 'string' ||
        e.description.length > 2000 ||
        (e.type === 'bookmark' && !validUrl(e.url)) ||
        (manifest.version >= 3 &&
          (!['knowledge', 'tool'].includes(e.resource_kind) ||
            (e.resource_kind === 'tool'
              ? !toolKinds.includes(e.tool_kind) || (e.url !== null && !validUrl(e.url))
              : e.tool_kind !== ''))) ||
        cleanContent(e.content) !== e.content
      )
        throw new Error('备份条目内容无效或不安全。');
      for (const image of e.content.matchAll(/src="\/assets\/([^"]+)"/g))
        if (!assets.some((a) => a.filename === image[1])) throw new Error('笔记图片缺失。');
    }
    const count = db.prepare('SELECT count(*) count FROM entries').get().count;
    if (manifest.version >= 2) validateTopicBackup(db, assets);
    if (manifest.version >= 4) validateKnowledgeBackup(db);
    if (manifest.version >= 6) validateAssistantBackup(db);
    if (manifest.version >= 7) validateUnified(db);
    if (manifest.version >= 8) validateRelations(db);
    if (manifest.version >= 9) validateLifecycle(db);
    if (manifest.version >= 10) validateReadingMarks(db);
    if (manifest.version >= 11) validateMindmaps(db);
    if (manifest.version >= 12) validateProfessional(db);
    db.close();
    db = null;
    // Validate the original package first; upgrade only this isolated extracted copy.
    if (manifest.version < VERSION && upgrade) {
      const upgraded = openStore(tmp);
      upgraded.close();
    }
    return {
      tmp,
      count,
      createdAt: manifest.createdAt,
      sourceSchema: manifest.version,
      dispose: () => rmSync(tmp, { recursive: true, force: true }),
    };
  } catch (e) {
    db?.close();
    rmSync(tmp, { recursive: true, force: true });
    throw new Error('无法恢复：' + e.message);
  }
}
