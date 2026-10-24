import { randomUUID } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import path from 'node:path';
import { defaultWorkspace, workspaceName } from './workspace.js';

export const WORKSPACE_JOURNAL = 'workspace-restore-journal.json';

const KNOWLEDGE_FILES = [
  'library.sqlite',
  'library.sqlite-wal',
  'library.sqlite-shm',
  'attachments',
  workspaceName,
];
const TASK_FILES = ['tasks.db', 'tasks.db-wal', 'tasks.db-shm'];
const ALL_FILES = [...KNOWLEDGE_FILES, ...TASK_FILES];

function moveIfExists(from, toDir) {
  if (!existsSync(from)) return false;
  mkdirSync(toDir, { recursive: true });
  renameSync(from, path.join(toDir, path.basename(from)));
  return true;
}

/**
 * 启动时处理上一次未完成的工作空间恢复：把旧数据搬回，避免知识新库 + 任务旧库的混合状态。
 */
export function recoverWorkspaceRestore(dataDir) {
  const dir = path.resolve(dataDir);
  const journalPath = path.join(dir, WORKSPACE_JOURNAL);
  if (!existsSync(journalPath)) return null;
  let journal;
  try {
    journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  } catch {
    throw new Error('工作空间恢复日志损坏，已停止启动以保护数据，请人工检查 data 目录。');
  }
  const old = path.join(dir, String(journal.previous || ''));
  if (!journal.previous || !existsSync(old)) {
    rmSync(journalPath, { force: true });
    return null;
  }
  const failed = path.join(dir, 'failed-restore-' + Date.now());
  for (const name of ALL_FILES) moveIfExists(path.join(dir, name), failed);
  for (const name of ALL_FILES) moveIfExists(path.join(old, name), dir);
  rmSync(journalPath, { force: true });
  return { restoredFrom: old, failedDir: existsSync(failed) ? failed : null };
}

/**
 * 用已完整校验的工作空间备份替换知识库与任务库。
 * 任一步失败都会把旧文件搬回并重新打开数据库；旧数据保留在 previous-workspace-* 目录。
 */
export async function restoreWorkspaceBackup({
  parsed,
  dataDir,
  getDb,
  getTasks,
  buildSafetyBackup,
  closeKnowledge,
  openKnowledge,
  openTasks,
  setKnowledgeDb,
  setTasks,
  setBusy,
}) {
  const dir = path.resolve(dataDir);
  const stage = path.join(dir, 'workspace-stage-' + randomUUID());
  const old = path.join(dir, 'previous-workspace-' + randomUUID());
  const journalPath = path.join(dir, WORKSPACE_JOURNAL);
  let safetyPath = null;
  let newMoved = false;
  let closed = false;
  let reopened = false;
  setBusy(true);
  try {
    // 1. 先保存当前完整快照
    const safety = await buildSafetyBackup();
    mkdirSync(path.join(dir, 'backups'), { recursive: true });
    safetyPath = path.join(
      dir,
      'backups',
      'before-restore-workspace-' + new Date().toISOString().replace(/[:.]/g, '-') + '.zip',
    );
    writeFileSync(safetyPath, safety);

    // 2. 准备暂存目录（全部来自已校验的临时解压结果）
    mkdirSync(stage, { recursive: true });
    cpSync(path.join(parsed.tmp, 'library.sqlite'), path.join(stage, 'library.sqlite'));
    cpSync(path.join(parsed.tmp, 'attachments'), path.join(stage, 'attachments'), {
      recursive: true,
    });
    if (existsSync(path.join(parsed.tmp, workspaceName)))
      cpSync(path.join(parsed.tmp, workspaceName), path.join(stage, workspaceName));
    else writeFileSync(path.join(stage, workspaceName), JSON.stringify(defaultWorkspace()));
    cpSync(parsed.tasksDbPath, path.join(stage, 'tasks.db'));

    // 3. 关闭连接并搬走旧数据；日志先落盘，崩溃后可在启动时回滚
    try {
      getDb().exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* 已关闭的库无需检查点 */
    }
    closeKnowledge();
    getTasks().close();
    closed = true;
    writeFileSync(journalPath, JSON.stringify({ previous: path.basename(old) }), 'utf8');
    mkdirSync(old, { recursive: true });
    for (const name of ALL_FILES) moveIfExists(path.join(dir, name), old);

    // 4. 切换
    for (const name of ['library.sqlite', 'attachments', workspaceName, 'tasks.db'])
      renameSync(path.join(stage, name), path.join(dir, name));
    newMoved = true;

    // 5. 重新打开并复核
    setKnowledgeDb(openKnowledge());
    setTasks(openTasks());
    reopened = true;
    const taskState = getTasks().analyze();
    if (taskState.total !== parsed.tasks.count)
      throw new Error(
        `恢复后任务数量核对失败（期望 ${parsed.tasks.count}，实际 ${taskState.total}）。已回滚。`,
      );
    if (taskState.digest !== parsed.tasks.digest)
      throw new Error('恢复后任务内容核对失败，已回滚。');
    const knowledgeIntegrity = getDb().prepare('PRAGMA integrity_check').get().integrity_check;
    if (knowledgeIntegrity !== 'ok') throw new Error('恢复后知识库完整性校验失败，已回滚。');

    rmSync(journalPath, { force: true });
    rmSync(stage, { recursive: true, force: true });
    return {
      ok: true,
      safetyBackup: safetyPath,
      previousDir: old,
      tasks: taskState,
      knowledge: parsed.knowledge,
    };
  } catch (error) {
    // 6. 回滚：新文件移出，旧文件搬回，重新打开
    if (closed) {
      try {
        if (reopened) {
          getTasks().close();
          closeKnowledge();
        }
      } catch {
        /* ignore */
      }
      const failed = path.join(dir, 'failed-restore-' + Date.now());
      for (const name of ALL_FILES) moveIfExists(path.join(dir, name), failed);
      for (const name of ALL_FILES) moveIfExists(path.join(old, name), dir);
      try {
        setKnowledgeDb(openKnowledge());
        setTasks(openTasks());
        rmSync(journalPath, { force: true });
      } catch {
        // 保留日志，下次启动时继续回滚
      }
    }
    throw error;
  } finally {
    if (!newMoved) rmSync(stage, { recursive: true, force: true });
    setBusy(false);
  }
}
