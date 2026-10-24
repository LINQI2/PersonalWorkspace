import { DatabaseSync } from 'node:sqlite';
import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportBackup, validateBackup } from './backup.js';
import { analyzeTasks, TASK_STATUSES } from './tasks/store.js';

export const WORKSPACE_BACKUP_FORMAT = 'personal-workspace';
export const WORKSPACE_BACKUP_VERSION = 1;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const README = `PersonalWorkspace 完整工作空间备份
=================================

workspace-manifest.json  版本、数量与 SHA-256 清单
knowledge.zip            知识库标准备份（数据库、附件、workspace 偏好/草稿）
tasks/tasks.db           任务台 SQLite 一致性快照
tasks/tasks.json         任务台可读 JSON（与旧任务台备份格式兼容）

恢复请在 PersonalWorkspace → 设置 → 备份与草稿 → 完整工作空间备份 中操作。
不要手工解压覆盖 data 目录；恢复前程序会再次校验并保存当前快照。
本备份不包含 API Key、DPAPI 密文、AI 用量日志或实例锁。
`;

/** 生成包含知识库与任务台的统一 ZIP 备份。调用方负责设置维护门。 */
export async function buildWorkspaceBackup({ dataDir, db, taskStore, appVersion }) {
  const knowledge = await exportBackup(db, dataDir);
  const tasksPayload = taskStore.exportPayload();
  const tasksDigest = analyzeTasks(tasksPayload.tasks).digest;
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'pw-tasks-'));
  try {
    const snapshot = path.join(tmp, 'tasks.db');
    taskStore.snapshotTo(snapshot);
    const tasksDb = readFileSync(snapshot);
    const tasksJson = Buffer.from(JSON.stringify(tasksPayload, null, 2));
    const schema = db.prepare('PRAGMA user_version').get().user_version;
    const manifest = {
      format: WORKSPACE_BACKUP_FORMAT,
      version: WORKSPACE_BACKUP_VERSION,
      appVersion,
      createdAt: new Date().toISOString(),
      knowledge: {
        path: 'knowledge.zip',
        schema,
        sha256: sha256(knowledge),
        size: knowledge.length,
      },
      tasks: {
        schema: 1,
        count: tasksPayload.tasks.length,
        digest: tasksDigest,
        db: 'tasks/tasks.db',
        dbSha256: sha256(tasksDb),
        json: 'tasks/tasks.json',
        jsonSha256: sha256(tasksJson),
      },
    };
    const zip = new AdmZip();
    zip.addFile('workspace-manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    zip.addFile('knowledge.zip', knowledge);
    zip.addFile('tasks/tasks.db', tasksDb);
    zip.addFile('tasks/tasks.json', tasksJson);
    zip.addFile('README.txt', Buffer.from(README));
    const bytes = zip.toBuffer();
    if (bytes.length > 512 * 1024 * 1024)
      throw new Error('工作空间备份超过 512 MB 上限，请停止服务后直接复制 data 目录。');
    return { bytes, manifest };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** 判断一个 ZIP 是统一工作空间备份还是旧知识库备份。 */
export function classifyBackup(buffer) {
  const zip = new AdmZip(buffer);
  const names = new Set(zip.getEntries().map((e) => e.entryName));
  if (names.has('workspace-manifest.json')) return 'workspace';
  if (names.has('manifest.json')) return 'knowledge';
  return 'unknown';
}

function readTasksDatabase(tmp, manifest, directory) {
  const rows = tmp
    .prepare(
      'SELECT id, parent_id, title, note, status, collapsed, sort_order, created_at, updated_at FROM tasks',
    )
    .all();
  const tasks = rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id ?? null,
    title: row.title,
    note: row.note ?? '',
    status: row.status,
    collapsed: Boolean(row.collapsed),
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
  for (const task of tasks)
    if (!TASK_STATUSES.includes(task.status))
      throw new Error('任务备份包含无法识别的状态，已拒绝恢复。');
  const version = tmp.prepare('PRAGMA user_version').get().user_version;
  const integrity = tmp.prepare('PRAGMA integrity_check').get().integrity_check;
  const fk = tmp.prepare('PRAGMA foreign_key_check').all().length;
  if (integrity !== 'ok' || fk || (version !== 0 && version !== 1))
    throw new Error('任务数据库校验失败，已拒绝恢复；当前数据未改变。');
  const analysis = analyzeTasks(tasks);
  if (manifest && analysis.total !== manifest.count)
    throw new Error('任务数量与备份清单不一致，已拒绝恢复。');
  if (manifest && analysis.digest !== manifest.digest)
    throw new Error('任务内容与备份清单不一致，已拒绝恢复。');
  return { tasks, analysis, version, directory };
}

/**
 * 完整校验统一备份；返回解析结果。调用方必须在 finally 中 dispose()。
 * 校验全部通过前不会改动任何正式数据。
 */
export function inspectWorkspaceBackup(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 32) throw new Error('备份文件为空或格式不正确。');
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length > 10000) throw new Error('备份文件数量超过限制。');
  let total = 0;
  const seen = new Set();
  const allow = new Set([
    'workspace-manifest.json',
    'knowledge.zip',
    'tasks/tasks.db',
    'tasks/tasks.json',
    'README.txt',
  ]);
  for (const entry of entries) {
    if (entry.isDirectory || seen.has(entry.entryName) || !allow.has(entry.entryName))
      throw new Error('工作空间备份包含未知路径或重复文件，已拒绝恢复。');
    seen.add(entry.entryName);
    total += entry.header.size;
    if (entry.header.size > 384 * 1024 * 1024 || total > 640 * 1024 * 1024)
      throw new Error('工作空间备份超过解压上限，已拒绝恢复。');
  }
  for (const required of [
    'workspace-manifest.json',
    'knowledge.zip',
    'tasks/tasks.db',
    'tasks/tasks.json',
  ])
    if (!seen.has(required)) throw new Error('工作空间备份缺少必要文件，已拒绝恢复。');

  const manifest = JSON.parse(zip.getEntry('workspace-manifest.json').getData().toString());
  if (
    manifest.format !== WORKSPACE_BACKUP_FORMAT ||
    manifest.version !== WORKSPACE_BACKUP_VERSION ||
    !manifest.knowledge ||
    !manifest.tasks
  )
    throw new Error('工作空间备份格式或版本不兼容，请使用当前版本或更新版本恢复。');

  const knowledgeBytes = zip.getEntry('knowledge.zip').getData();
  const tasksDbBytes = zip.getEntry('tasks/tasks.db').getData();
  const tasksJsonBytes = zip.getEntry('tasks/tasks.json').getData();
  if (sha256(knowledgeBytes) !== manifest.knowledge.sha256)
    throw new Error('知识库部分校验失败，已拒绝恢复。');
  if (sha256(tasksDbBytes) !== manifest.tasks.dbSha256)
    throw new Error('任务数据库校验失败，已拒绝恢复。');
  if (sha256(tasksJsonBytes) !== manifest.tasks.jsonSha256)
    throw new Error('任务 JSON 校验失败，已拒绝恢复。');

  let checked;
  let tmpDb;
  const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'pw-inspect-'));
  try {
    checked = validateBackup(knowledgeBytes);
    const dbPath = path.join(tmpDir, 'tasks.db');
    writeFileSync(dbPath, tasksDbBytes);
    tmpDb = new DatabaseSync(dbPath, { readOnly: true });
    const dbState = readTasksDatabase(tmpDb, manifest.tasks, tmpDb);
    const jsonPayload = JSON.parse(tasksJsonBytes.toString());
    const jsonTasks = Array.isArray(jsonPayload) ? jsonPayload : jsonPayload?.tasks;
    if (!Array.isArray(jsonTasks)) throw new Error('任务 JSON 缺少 tasks 列表。');
    const jsonAnalysis = analyzeTasks(
      jsonTasks.map((t, i) => ({
        ...t,
        note: t.note ?? '',
        collapsed: Boolean(t.collapsed),
        order: Number.isFinite(t.order) ? t.order : i,
      })),
    );
    if (
      jsonAnalysis.total !== dbState.analysis.total ||
      jsonAnalysis.digest !== dbState.analysis.digest
    )
      throw new Error('任务 JSON 与任务数据库不一致，已拒绝恢复。');
    return {
      type: 'workspace',
      manifest,
      knowledge: { count: checked.count, createdAt: checked.createdAt },
      tasks: { count: dbState.analysis.total, digest: dbState.analysis.digest },
      tmp: checked.tmp,
      tasksDbPath: path.join(tmpDir, 'tasks.db'),
      dispose: () => {
        try {
          tmpDb?.close();
        } catch {
          /* ignore */
        }
        checked.dispose();
        rmSync(tmpDir, { recursive: true, force: true });
      },
    };
  } catch (error) {
    try {
      tmpDb?.close();
    } catch {
      /* ignore */
    }
    checked?.dispose();
    rmSync(tmpDir, { recursive: true, force: true });
    throw error;
  }
}
