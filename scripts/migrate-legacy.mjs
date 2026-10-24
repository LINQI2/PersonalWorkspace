/**
 * 一次性受控迁移：知识收藏馆 V1.9 正式数据 + 个人任务台正式任务 → PersonalWorkspace。
 *
 * 安全约束：
 * - 只读原项目，不修改、不删除原数据；目标目录已有数据库时拒绝执行。
 * - 知识库用 VACUUM INTO 获取包含 WAL 最新状态的一致快照，不直接复制主文件。
 * - 任务台优先通过正在运行的本地 API 读取最新导出；否则用 SQLite 读取（自动包含 WAL）。
 * - 迁移后核对表数量、任务结构指纹与状态分布，并写入迁移报告。
 */
import { DatabaseSync } from 'node:sqlite';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskStore, analyzeTasks } from '../app/server/tasks/store.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf('--' + name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const knowledgeDir = path.resolve(option('knowledge', 'D:/Projects/PersonalKnowledge/data'));
const taskSourceDir = path.resolve(option('tasks', 'D:/Projects/PersonalTaskHub/data'));
const taskApi = option('task-api', 'http://127.0.0.1:5175');
const target = path.resolve(option('target', path.join(root, 'data')));

const sha256 = (file) =>
  existsSync(file) ? createHash('sha256').update(readFileSync(file)).digest('hex') : null;

function assertWritableTarget() {
  if (existsSync(path.join(target, 'library.sqlite')) || existsSync(path.join(target, 'tasks.db')))
    throw new Error(
      `目标目录已包含工作空间数据库：${target}。为避免覆盖已有数据，迁移已拒绝执行。`,
    );
  mkdirSync(target, { recursive: true });
  mkdirSync(path.join(target, 'attachments'), { recursive: true });
  mkdirSync(path.join(target, 'backups'), { recursive: true });
}

async function readTasks() {
  try {
    const response = await fetch(taskApi + '/api/tasks', { signal: AbortSignal.timeout(2500) });
    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data.tasks))
        return { source: 'running-api', url: taskApi, payload: { tasks: data.tasks } };
    }
  } catch {
    /* 原服务未运行则回退到数据库读取 */
  }
  const dbFile = path.join(taskSourceDir, 'taskhub.db');
  if (!existsSync(dbFile)) throw new Error('未找到原任务数据库：' + dbFile);
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    const rows = db
      .prepare(
        'SELECT id, parent_id, title, note, status, collapsed, sort_order, created_at, updated_at FROM tasks',
      )
      .all();
    return {
      source: 'sqlite-readonly',
      dbFile,
      schema: version,
      payload: {
        tasks: rows.map((row) => ({
          id: row.id,
          parentId: row.parent_id ?? null,
          title: row.title,
          note: row.note ?? '',
          status: row.status,
          collapsed: Boolean(row.collapsed),
          order: row.sort_order,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        })),
      },
    };
  } finally {
    db.close();
  }
}

function migrateKnowledge() {
  const sourceDb = path.join(knowledgeDir, 'library.sqlite');
  if (!existsSync(sourceDb)) throw new Error('未找到原知识库：' + sourceDb);
  const lockFile = path.join(knowledgeDir, '.server-lock.json');
  if (existsSync(lockFile)) {
    // 旧实例可能仍在运行；迁移仍使用 SQLite 一致性快照，但提示更安全做法。
    console.warn('[提示] 检测到知识库实例锁，请确认原知识库已停止；本次使用 SQLite 一致性快照。');
  }
  const db = new DatabaseSync(sourceDb, { readOnly: true });
  try {
    const schema = db.prepare('PRAGMA user_version').get().user_version;
    if (schema !== 11)
      throw new Error(`原知识库 schema ${schema} 与 V1.9(schema11) 不一致，已停止。`);
    const integrity = db.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw new Error('原知识库完整性校验失败，已停止。');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name);
    const counts = {};
    for (const table of tables)
      counts[table] = db.prepare(`SELECT COUNT(*) c FROM "${table}"`).get().c;
    const destination = path.join(target, 'library.sqlite');
    db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
    const copy = new DatabaseSync(destination, { readOnly: true });
    try {
      if (copy.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok')
        throw new Error('迁移后的知识库完整性校验失败。');
      if (copy.prepare('SELECT COUNT(*) c FROM entries').get().c !== counts.entries)
        throw new Error('迁移后的内容数量与来源不一致。');
      if (copy.prepare('PRAGMA user_version').get().user_version !== 11)
        throw new Error('迁移后的 schema 版本不正确。');
    } finally {
      copy.close();
    }
    const attachments = path.join(knowledgeDir, 'attachments');
    if (existsSync(attachments))
      cpSync(attachments, path.join(target, 'attachments'), { recursive: true });
    for (const name of ['workspace.json', 'ai-usage.json']) {
      const file = path.join(knowledgeDir, name);
      if (existsSync(file)) cpSync(file, path.join(target, name));
    }
    const legacyBackups = path.join(knowledgeDir, 'backups');
    if (existsSync(legacyBackups)) {
      const folder = path.join(target, 'backups', 'knowledge-legacy');
      mkdirSync(folder, { recursive: true });
      let copied = 0;
      for (const name of readdirSync(legacyBackups)) {
        if (!name.endsWith('.zip')) continue;
        const file = path.join(legacyBackups, name);
        if (statSync(file).size > 512 * 1024 * 1024) continue;
        cpSync(file, path.join(folder, name));
        copied++;
      }
      console.log(`[知识库] 复制旧备份 ${copied} 个到 backups/knowledge-legacy。`);
    }
    return {
      source: knowledgeDir,
      schema,
      counts,
      entries: counts.entries,
      assets: counts.assets,
      mindmaps: counts.mindmaps,
      mindmapVersions: counts.mindmap_versions,
      attachments: existsSync(attachments) ? readdirSync(attachments).length : 0,
      sha256: sha256(destination),
      legacyBackupsCopied: existsSync(legacyBackups),
    };
  } finally {
    db.close();
  }
}

async function main() {
  console.log('个人工作空间迁移');
  console.log('  知识库来源：' + knowledgeDir);
  console.log('  任务台来源：' + taskSourceDir);
  console.log('  目标目录：' + target);
  assertWritableTarget();

  const knowledge = migrateKnowledge();
  const taskSource = await readTasks();
  const analysisBefore = analyzeTasks(taskSource.payload.tasks);
  const store = createTaskStore({ dbFile: path.join(target, 'tasks.db') });
  let analysisAfter;
  try {
    const snapshot = path.join(target, 'backups', 'tasks-migrated-' + Date.now() + '.json');
    writeFileSync(snapshot, JSON.stringify(taskSource.payload, null, 2), 'utf8');
    const imported = store.replaceAll(taskSource.payload);
    analysisAfter = analyzeTasks(imported);
    if (analysisAfter.digest !== analysisBefore.digest)
      throw new Error('迁移后任务结构指纹与来源不一致，已停止；请检查源数据。');
    const integrity = store.integrity();
    if (!integrity.ok) throw new Error('迁移后的任务库完整性校验失败。');
  } finally {
    store.close();
  }

  const report = {
    migratedAt: new Date().toISOString(),
    knowledge,
    tasks: {
      source: taskSource.source,
      sourcePath: taskSource.dbFile || taskSource.url,
      before: analysisBefore,
      after: analysisAfter,
      dbSha256: sha256(path.join(target, 'tasks.db')),
    },
    target,
    rollback: '原项目保持不变，可继续使用；如需回滚，删除本工作空间 data 目录即可重新启动。',
  };
  writeFileSync(path.join(target, 'migration-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('迁移失败：' + error.message);
  process.exit(1);
});
