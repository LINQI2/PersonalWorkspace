import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  rmSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import AdmZip from 'adm-zip';
export const baseSchema = `BEGIN;
    CREATE TABLE assets(id TEXT PRIMARY KEY, filename TEXT UNIQUE NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL);
    CREATE TABLE entries(id TEXT PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('bookmark','note')), title TEXT NOT NULL, url TEXT, description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', plain_text TEXT NOT NULL DEFAULT '', cover_asset_id TEXT REFERENCES assets(id), pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE domains(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
    CREATE TABLE tags(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
    CREATE TABLE collections(id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL);
    CREATE TABLE entry_domains(entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE, taxonomy_id TEXT REFERENCES domains(id) ON DELETE CASCADE, PRIMARY KEY(entry_id,taxonomy_id));
    CREATE TABLE entry_tags(entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE, taxonomy_id TEXT REFERENCES tags(id) ON DELETE CASCADE, PRIMARY KEY(entry_id,taxonomy_id));
    CREATE TABLE entry_collections(entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE, taxonomy_id TEXT REFERENCES collections(id) ON DELETE CASCADE, PRIMARY KEY(entry_id,taxonomy_id));
    CREATE INDEX entries_created ON entries(created_at DESC);
    CREATE INDEX entries_url ON entries(url);
    CREATE INDEX entries_updated ON entries(updated_at DESC);
    CREATE INDEX domain_entries ON entry_domains(taxonomy_id);
    CREATE INDEX tag_entries ON entry_tags(taxonomy_id);
    CREATE INDEX collection_entries ON entry_collections(taxonomy_id);
    PRAGMA user_version=1; COMMIT;`;
export const topicSchema = `
CREATE TABLE collection_documents(collection_id TEXT PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE, introduction TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', sources_json TEXT NOT NULL DEFAULT '[]', revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0), updated_at TEXT NOT NULL DEFAULT '');
CREATE TABLE collection_versions(id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, title TEXT NOT NULL, introduction TEXT NOT NULL, content TEXT NOT NULL, sources_json TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX collection_history ON collection_versions(collection_id,revision DESC);
CREATE TABLE collection_drafts(collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('manual','ai')), payload TEXT NOT NULL, base_revision INTEGER NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY(collection_id,kind));
`;
const definitions = new Map();
export const toolSchema = `
ALTER TABLE entries ADD COLUMN resource_kind TEXT NOT NULL DEFAULT 'knowledge' CHECK(resource_kind IN ('knowledge','tool'));
ALTER TABLE entries ADD COLUMN tool_kind TEXT NOT NULL DEFAULT '' CHECK(tool_kind IN ('','website','online','ai','desktop','custom','other'));
CREATE INDEX entries_resource_kind ON entries(resource_kind,tool_kind);
`;
const objects = (db) =>
  db
    .prepare("SELECT type,name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
export function assertDatabaseSchema(db, version) {
  if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(version))
    throw Error('数据库来自不兼容版本，请使用对应软件打开。');
  if (!definitions.has(version)) {
    const expected = new DatabaseSync(':memory:');
    try {
      expected.exec(baseSchema);
      if (version >= 2) expected.exec(topicSchema);
      if (version >= 3) expected.exec(toolSchema);
      if (version >= 4) expected.exec(knowledgeSchema);
      if (version >= 5) expected.exec(readingSchema);
      if (version >= 6) expected.exec(assistantSchema);
      if (version >= 7) expected.exec(unifiedSchema);
      if (version >= 8) expected.exec(relationSchema);
      if (version >= 9) expected.exec(lifecycleSchema);
      if (version >= 10) expected.exec(readingMarksSchema);
      if (version >= 11) expected.exec(mindmapSchema);
      definitions.set(version, JSON.stringify(objects(expected)));
    } finally {
      expected.close();
    }
  }
  if (
    JSON.stringify(objects(db)) !== definitions.get(version) ||
    db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' ||
    db.prepare('PRAGMA foreign_key_check').all().length
  )
    throw Error('数据库 schema 不兼容或完整性检查失败，已拒绝升级/打开，原数据保留。');
}
function migrationBackup(db, dir, targetVersion) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'pk-migration-'));
  try {
    const target = path.join(tmp, 'library.sqlite');
    db.exec("VACUUM INTO '" + target.replace(/'/g, "''") + "'");
    const zip = new AdmZip(),
      files = [];
    const add = (name, bytes) => {
      zip.addFile(name, bytes);
      files.push({
        path: name,
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    };
    add('library.sqlite', readFileSync(target));
    if (existsSync(path.join(dir, 'workspace.json')))
      add('workspace.json', readFileSync(path.join(dir, 'workspace.json')));
    for (const filename of readdirSync(path.join(dir, 'attachments')))
      if (/^[a-f0-9-]+\.webp$/.test(filename))
        add('attachments/' + filename, readFileSync(path.join(dir, 'attachments', filename)));
    if (files.length + 1 > 10000 || files.reduce((n, f) => n + f.size, 0) > 512 * 1024 * 1024)
      throw Error('升级备份超过恢复限制，请先处理数据规模；未执行迁移。');
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
    if (bytes.length > 256 * 1024 * 1024) throw Error('升级备份超过恢复限制，未执行迁移。');
    mkdirSync(path.join(dir, 'backups'), { recursive: true });
    writeFileSync(
      path.join(dir, 'backups', 'pre-schema-' + targetVersion + '-' + randomUUID() + '.zip'),
      bytes,
      {
        flag: 'wx',
      },
    );
    return bytes;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
export function initializeStore(db, dir, { beforeMigrationCommit, validateMigrationBackup } = {}) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version === 0) {
    if (objects(db).length) throw Error('无版本标识的非空数据库，无法安全升级，请保留并检查。');
    db.exec(baseSchema);
  } else assertDatabaseSchema(db, version);
  if (version < 2) {
    if (version === 1) {
      const bytes = migrationBackup(db, dir, 2);
      validateMigrationBackup?.(bytes);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(topicSchema);
      db.exec('PRAGMA user_version=2');
      beforeMigrationCommit?.(db);
      assertDatabaseSchema(db, 2);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  if (version < 3) {
    if (version > 0) {
      const bytes = migrationBackup(db, dir, 3);
      validateMigrationBackup?.(bytes);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(toolSchema);
      db.exec('PRAGMA user_version=3');
      beforeMigrationCommit?.(db);
      assertDatabaseSchema(db, 3);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  if (version < 4) {
    if (version > 0) {
      const bytes = migrationBackup(db, dir, 4);
      validateMigrationBackup?.(bytes);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(knowledgeSchema);
      db.exec('PRAGMA user_version=4');
      beforeMigrationCommit?.(db);
      assertDatabaseSchema(db, 4);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  if (version < 5) {
    if (version > 0) {
      const bytes = migrationBackup(db, dir, 5);
      validateMigrationBackup?.(bytes);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readingSchema);
      db.exec('PRAGMA user_version=5');
      beforeMigrationCommit?.(db);
      assertDatabaseSchema(db, 5);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  if (version < 6) {
    if (version > 0) {
      const bytes = migrationBackup(db, dir, 6);
      validateMigrationBackup?.(bytes);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(assistantSchema);
      db.exec('PRAGMA user_version=6');
      beforeMigrationCommit?.(db);
      assertDatabaseSchema(db, 6);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  if (version < 7) {
    if (version > 0) {
      const bytes = migrationBackup(db, dir, 7);
      validateMigrationBackup?.(bytes);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(unifiedSchema);
      db.exec('PRAGMA user_version=7');
      beforeMigrationCommit?.(db);
      assertDatabaseSchema(db, 7);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  if (version < 8) {
    if (version > 0) {
      const bytes = migrationBackup(db, dir, 8);
      validateMigrationBackup?.(bytes);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(relationSchema);
      db.exec('PRAGMA user_version=8');
      beforeMigrationCommit?.(db);
      assertDatabaseSchema(db, 8);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  if (version < 9) assertDatabaseSchema(db, 8);
  if (version < 9) {
    if (version > 0) {
      const bytes = migrationBackup(db, dir, 9);
      validateMigrationBackup?.(bytes);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(lifecycleSchema);
      db.exec('PRAGMA user_version=9');
      beforeMigrationCommit?.(db);
      assertDatabaseSchema(db, 9);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  if (version < 10) {
    assertDatabaseSchema(db, 9);
    if (version > 0) {
      const bytes = migrationBackup(db, dir, 10);
      validateMigrationBackup?.(bytes);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(readingMarksSchema);
      db.exec('PRAGMA user_version=10');
      beforeMigrationCommit?.(db);
      assertDatabaseSchema(db, 10);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  if (version < 11) {
    assertDatabaseSchema(db, 10);
    if (version > 0) {
      const bytes = migrationBackup(db, dir, 11);
      validateMigrationBackup?.(bytes);
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(mindmapSchema);
      db.exec('PRAGMA user_version=11');
      beforeMigrationCommit?.(db);
      assertDatabaseSchema(db, 11);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  assertDatabaseSchema(db, 11);
}

export const lifecycleSchema = `
CREATE TABLE content_lifecycle(entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE, state TEXT NOT NULL CHECK(state IN ('inbox','later','done','trash')), previous_state TEXT CHECK(previous_state IN ('inbox','later','done')), changed_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX content_lifecycle_state ON content_lifecycle(state,changed_at);
CREATE TABLE content_versions(id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX content_versions_entry ON content_versions(entry_id,created_at);
`;

export const relationSchema = `
CREATE TABLE relation_details(relation_id TEXT PRIMARY KEY REFERENCES knowledge_relations(id) ON DELETE CASCADE, relation_type TEXT NOT NULL CHECK(relation_type IN ('reference','complement','conflict','revision','dependency','composition','related')), origin TEXT NOT NULL CHECK(origin IN ('manual','ai','import')), evidence_json TEXT NOT NULL, uncertainty TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>=1));
CREATE INDEX relation_outgoing ON knowledge_relations(from_id,to_id);
CREATE INDEX relation_incoming ON knowledge_relations(to_id,from_id);
CREATE TABLE relation_history(id TEXT PRIMARY KEY,before_json TEXT NOT NULL,after_hash TEXT NOT NULL,created_at TEXT NOT NULL);
`;

export const unifiedSchema = `
CREATE TABLE domain_structure(domain_id TEXT PRIMARY KEY REFERENCES domains(id) ON DELETE CASCADE, parent_id TEXT REFERENCES domains(id) ON DELETE RESTRICT, position INTEGER NOT NULL DEFAULT 0 CHECK(position>=0));
CREATE INDEX domain_children ON domain_structure(parent_id,position);
CREATE TABLE content_primary_domains(entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE, domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE RESTRICT);
CREATE TABLE content_provenance(entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE, batch_id TEXT NOT NULL REFERENCES knowledge_imports(id) ON DELETE RESTRICT, local_id TEXT NOT NULL, original_date TEXT, provided_recorded_at TEXT, epistemic TEXT NOT NULL CHECK(epistemic IN ('reported_fact','ai_inference','user_judgment')), status TEXT NOT NULL CHECK(status IN ('inbox','draft','review','archived')), priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 3));
CREATE TABLE content_source_links(entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE RESTRICT, quote TEXT NOT NULL DEFAULT '', PRIMARY KEY(entry_id,source_id));
CREATE TABLE collection_rules(collection_id TEXT PRIMARY KEY REFERENCES collections(id) ON DELETE CASCADE, rules_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE library_views(id TEXT PRIMARY KEY, name TEXT NOT NULL, filters_json TEXT NOT NULL, position INTEGER NOT NULL CHECK(position>=0));
`;

export const assistantSchema = `CREATE TABLE assistant_changes(id TEXT PRIMARY KEY, before_json TEXT NOT NULL, after_hash TEXT NOT NULL, changes_json TEXT NOT NULL, created_at TEXT NOT NULL);`;

export const readingSchema = `
CREATE TABLE knowledge_structure(entry_id TEXT PRIMARY KEY REFERENCES knowledge_records(entry_id) ON DELETE CASCADE, parent_id TEXT NOT NULL REFERENCES knowledge_records(entry_id) ON DELETE RESTRICT, position INTEGER NOT NULL CHECK(position>=0));
CREATE INDEX knowledge_structure_parent ON knowledge_structure(parent_id,position);
CREATE TABLE knowledge_versions(id TEXT PRIMARY KEY, entry_id TEXT NOT NULL REFERENCES knowledge_records(entry_id) ON DELETE CASCADE, title TEXT NOT NULL, content TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX knowledge_versions_entry ON knowledge_versions(entry_id,revision DESC);
`;

export const knowledgeSchema = `
CREATE TABLE knowledge_directories(id TEXT PRIMARY KEY, name TEXT NOT NULL, parent_id TEXT REFERENCES knowledge_directories(id) ON DELETE RESTRICT, position INTEGER NOT NULL DEFAULT 0 CHECK(position>=0));
CREATE TABLE knowledge_records(entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('capture','page','point')), directory_id TEXT REFERENCES knowledge_directories(id) ON DELETE RESTRICT, priority INTEGER NOT NULL DEFAULT 0 CHECK(priority BETWEEN 0 AND 3), status TEXT NOT NULL CHECK(status IN ('inbox','draft','review','confirmed','archived')), epistemic TEXT NOT NULL CHECK(epistemic IN ('reported_fact','ai_inference','user_judgment')), questions TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0 CHECK(position>=0), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1), confirmed_at TEXT, original_date TEXT, date_note TEXT NOT NULL DEFAULT '', provided_recorded_at TEXT);
CREATE INDEX knowledge_directory_order ON knowledge_records(directory_id,position);
CREATE TABLE knowledge_imports(id TEXT PRIMARY KEY, hash TEXT NOT NULL, raw_input TEXT NOT NULL, format TEXT NOT NULL CHECK(format IN ('json','markdown','text')), recorded_at TEXT NOT NULL);
CREATE INDEX knowledge_import_hash ON knowledge_imports(hash);
CREATE TABLE knowledge_sources(id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('chatgpt','report','inspiration','website','other')), title TEXT NOT NULL, url TEXT, original_date TEXT, date_note TEXT NOT NULL DEFAULT '', excerpt TEXT NOT NULL, recorded_at TEXT NOT NULL, batch_id TEXT REFERENCES knowledge_imports(id) ON DELETE RESTRICT, provided_recorded_at TEXT);
CREATE TABLE knowledge_entry_sources(entry_id TEXT NOT NULL REFERENCES knowledge_records(entry_id) ON DELETE CASCADE, source_id TEXT NOT NULL REFERENCES knowledge_sources(id) ON DELETE RESTRICT, quote TEXT NOT NULL DEFAULT '', PRIMARY KEY(entry_id,source_id));
CREATE TABLE knowledge_relations(id TEXT PRIMARY KEY, from_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, to_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, kind TEXT NOT NULL CHECK(kind IN ('duplicate','complement','conflict','revision','parent')), state TEXT NOT NULL CHECK(state IN ('candidate','confirmed')), note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE TABLE knowledge_references(page_id TEXT NOT NULL REFERENCES knowledge_records(entry_id) ON DELETE CASCADE, target_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE, position INTEGER NOT NULL CHECK(position>=0), PRIMARY KEY(page_id,target_id));
CREATE TABLE knowledge_drafts(key TEXT PRIMARY KEY, payload TEXT NOT NULL, saved_at TEXT NOT NULL);
CREATE TABLE knowledge_import_entries(entry_id TEXT PRIMARY KEY REFERENCES knowledge_records(entry_id) ON DELETE CASCADE, batch_id TEXT NOT NULL REFERENCES knowledge_imports(id) ON DELETE RESTRICT, local_id TEXT NOT NULL);
`;

export const readingMarksSchema = `
CREATE TABLE reading_marks(id TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('annotation','citation')),source_id TEXT NOT NULL REFERENCES entries(id) ON DELETE RESTRICT,target_id TEXT REFERENCES entries(id) ON DELETE RESTRICT,source_title TEXT NOT NULL,source_page_id TEXT REFERENCES entries(id) ON DELETE RESTRICT,quote TEXT NOT NULL,anchor_json TEXT NOT NULL,comment TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
CREATE INDEX reading_marks_source ON reading_marks(source_id,created_at);
CREATE INDEX reading_marks_target ON reading_marks(target_id);
`;

export const mindmapSchema = `
CREATE TABLE mindmaps(entry_id TEXT PRIMARY KEY REFERENCES entries(id) ON DELETE RESTRICT,data_json TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),updated_at TEXT NOT NULL);
CREATE TABLE mindmap_versions(id TEXT PRIMARY KEY,entry_id TEXT NOT NULL REFERENCES mindmaps(entry_id) ON DELETE RESTRICT,title TEXT NOT NULL,data_json TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>=1),created_at TEXT NOT NULL);
CREATE INDEX mindmap_history ON mindmap_versions(entry_id,revision DESC);
`;
