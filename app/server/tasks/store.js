import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const TASK_STATUSES = ['todo', 'doing', 'done', 'paused'];
export const MAX_TITLE = 500;
export const MAX_NOTE = 20000;
export const TASK_DB_NAME = 'tasks.db';

export class TaskStoreError extends Error {
  constructor(message, status = 400, code = 'bad_request') {
    super(message);
    this.name = 'TaskStoreError';
    this.status = status;
    this.code = code;
  }
}

const nowIso = () => new Date().toISOString();
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function rowToTask(row) {
  if (!row) return null;
  return {
    id: row.id,
    parentId: row.parent_id ?? null,
    title: row.title,
    note: row.note ?? '',
    status: row.status,
    collapsed: Boolean(row.collapsed),
    order: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function validateTaskId(value) {
  if (typeof value !== 'string' || !ID_PATTERN.test(value))
    throw new TaskStoreError('任务 ID 无效', 400, 'invalid_id');
  return value;
}

function normalizeTitle(value) {
  if (typeof value !== 'string') throw new TaskStoreError('任务名称必须是文本');
  const title = value.trim();
  if (!title) throw new TaskStoreError('任务名称不能为空');
  if (title.length > MAX_TITLE) throw new TaskStoreError(`任务名称过长（最多 ${MAX_TITLE} 字）`);
  return title;
}

function normalizeStatus(value) {
  if (!TASK_STATUSES.includes(value)) throw new TaskStoreError('无效的任务状态');
  return value;
}

function normalizeNote(value, id) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new TaskStoreError(`任务 ${id} 的备注必须是文本`);
  if (value.length > MAX_NOTE)
    throw new TaskStoreError(`任务 ${id} 的备注过长（最多 ${MAX_NOTE} 字），未导入以免丢失内容`);
  return value;
}

function normalizeTime(value, fallback, id, field) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
    throw new TaskStoreError(`任务 ${id} 的${field}时间格式无效，未导入以免丢失数据`);
  return value;
}

/**
 * 任务数据独立的 SQLite 模块。与知识库共用进程和数据目录，但使用单独数据库文件，
 * 避免为整合改动知识库 schema11。
 */
export function createTaskStore({ dbFile, readOnly = false } = {}) {
  if (!dbFile) throw new TaskStoreError('缺少任务数据库路径');
  fs.mkdirSync(path.dirname(dbFile), { recursive: true });

  const db = readOnly ? new DatabaseSync(dbFile, { readOnly: true }) : new DatabaseSync(dbFile);
  if (!readOnly) {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA busy_timeout = 5000');
    if (db.prepare('PRAGMA user_version').get().user_version === 0)
      db.exec('PRAGMA user_version = 1');
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        parent_id TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'todo',
        collapsed INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id, sort_order);
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  let txDepth = 0;
  function tx(fn) {
    if (txDepth > 0) return fn();
    db.exec('BEGIN IMMEDIATE');
    txDepth++;
    try {
      const result = fn();
      db.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      txDepth--;
    }
  }

  const q = {
    list: db.prepare('SELECT * FROM tasks ORDER BY parent_id IS NOT NULL, parent_id, sort_order'),
    get: db.prepare('SELECT * FROM tasks WHERE id = ?'),
    children: db.prepare('SELECT * FROM tasks WHERE parent_id IS ? ORDER BY sort_order'),
    insert: db.prepare(`
      INSERT INTO tasks (id, parent_id, title, note, status, collapsed, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    remove: db.prepare('DELETE FROM tasks WHERE id = ?'),
    setOrder: db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?'),
    shiftUp: db.prepare(
      'UPDATE tasks SET sort_order = sort_order + 1 WHERE parent_id IS ? AND sort_order >= ?',
    ),
    descendants: db.prepare(`
      WITH RECURSIVE sub(id) AS (
        SELECT id FROM tasks WHERE parent_id = ?
        UNION ALL
        SELECT t.id FROM tasks t JOIN sub s ON t.parent_id = s.id
      )
      SELECT id FROM sub
    `),
    countAll: db.prepare('SELECT COUNT(*) AS c FROM tasks'),
  };

  function requireTask(id) {
    const task = rowToTask(q.get.get(validateTaskId(id)));
    if (!task) throw new TaskStoreError('任务不存在', 404, 'not_found');
    return task;
  }

  function requireParent(parentId) {
    if (parentId === null || parentId === undefined || parentId === '') return null;
    validateTaskId(parentId);
    if (!q.get.get(parentId)) throw new TaskStoreError('父任务不存在', 404, 'not_found');
    return parentId;
  }

  function listTasks() {
    return q.list.all().map(rowToTask);
  }

  function getTask(id) {
    return requireTask(id);
  }

  function descendantIds(id) {
    validateTaskId(id);
    return q.descendants.all(id).map((r) => r.id);
  }

  function createTask({
    parentId = null,
    title,
    note = '',
    status = 'todo',
    afterId = null,
    beforeId = null,
  } = {}) {
    const cleanTitle = normalizeTitle(title ?? '');
    const parent = requireParent(parentId);
    const cleanStatus = normalizeStatus(status);
    const cleanNote = normalizeNote(note, 'new');
    return tx(() => {
      const siblings = q.children.all(parent);
      let index = siblings.length;
      if (afterId) {
        validateTaskId(afterId);
        const found = siblings.findIndex((s) => s.id === afterId);
        if (found === -1) throw new TaskStoreError('参照任务不存在', 404, 'not_found');
        index = found + 1;
      } else if (beforeId) {
        validateTaskId(beforeId);
        const found = siblings.findIndex((s) => s.id === beforeId);
        if (found === -1) throw new TaskStoreError('参照任务不存在', 404, 'not_found');
        index = found;
      }
      q.shiftUp.run(parent, index);
      const id = randomUUID();
      const ts = nowIso();
      q.insert.run(id, parent, cleanTitle, cleanNote, cleanStatus, 0, index, ts, ts);
      return rowToTask(q.get.get(id));
    });
  }

  function updateTask(id, patch = {}) {
    validateTaskId(id);
    const task = requireTask(id);
    if (!patch || typeof patch !== 'object' || Array.isArray(patch))
      throw new TaskStoreError('更新内容格式不正确');
    const fields = [];
    const values = [];
    if (patch.title !== undefined) {
      fields.push('title = ?');
      values.push(normalizeTitle(patch.title));
    }
    if (patch.note !== undefined) {
      fields.push('note = ?');
      values.push(normalizeNote(patch.note, id));
    }
    if (patch.status !== undefined) {
      fields.push('status = ?');
      values.push(normalizeStatus(patch.status));
    }
    if (patch.collapsed !== undefined) {
      if (typeof patch.collapsed !== 'boolean') throw new TaskStoreError('折叠状态必须是布尔值');
      fields.push('collapsed = ?');
      values.push(patch.collapsed ? 1 : 0);
    }
    if (fields.length === 0) return task;
    fields.push('updated_at = ?');
    values.push(nowIso());
    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
    return rowToTask(q.get.get(id));
  }

  /** 移动任务到目标父任务的指定位置；服务端再次校验循环父子关系。 */
  function moveTask(id, { parentId = null, index = 0 } = {}) {
    const task = requireTask(id);
    const targetParent = requireParent(parentId);
    if (targetParent === id) throw new TaskStoreError('不能把任务移动到自身下面', 400, 'cycle');
    if (targetParent) {
      if (descendantIds(id).includes(targetParent))
        throw new TaskStoreError('不能把任务移动到自己的子任务下', 400, 'cycle');
    }
    if (typeof index !== 'number' || !Number.isFinite(index))
      throw new TaskStoreError('插入位置无效');
    const targetIndex = Math.max(0, Math.trunc(index));
    return tx(() => {
      const oldSiblings = q.children.all(task.parentId).filter((s) => s.id !== id);
      oldSiblings.forEach((row, i) => q.setOrder.run(i, row.id));

      const siblings =
        targetParent === task.parentId
          ? oldSiblings
          : q.children.all(targetParent).filter((s) => s.id !== id);
      const clamped = Math.min(targetIndex, siblings.length);
      const ordered = [...siblings.slice(0, clamped), { id }, ...siblings.slice(clamped)];

      db.prepare('UPDATE tasks SET parent_id = ?, updated_at = ? WHERE id = ?').run(
        targetParent,
        nowIso(),
        id,
      );
      ordered.forEach((row, i) => q.setOrder.run(i, row.id));

      return { task: rowToTask(q.get.get(id)), childCount: q.children.all(id).length };
    });
  }

  function deleteTask(id) {
    const task = requireTask(id);
    const ids = [id, ...descendantIds(id)];
    tx(() => {
      for (const childId of ids) q.remove.run(childId);
      q.children.all(task.parentId).forEach((row, index) => q.setOrder.run(index, row.id));
    });
    return { deletedIds: ids, deletedCount: ids.length };
  }

  function exportPayload() {
    return {
      app: 'PersonalWorkspace',
      format: 'tasks',
      formatVersion: 1,
      exportedAt: nowIso(),
      tasks: listTasks(),
    };
  }

  /**
   * 严格校验要写入/迁移的任务快照。宁可整体拒绝，也不静默丢弃或改写记录。
   */
  function validateSnapshot(input) {
    const raw = Array.isArray(input) ? input : input?.tasks;
    if (!Array.isArray(raw)) throw new TaskStoreError('备份文件格式不正确：缺少 tasks 列表');
    if (raw.length > 50000) throw new TaskStoreError('任务数量超过上限（50000）');
    const seen = new Set();
    const tasks = raw.map((item, i) => {
      if (!item || typeof item !== 'object' || Array.isArray(item))
        throw new TaskStoreError(`备份文件第 ${i + 1} 条任务格式不正确`);
      const id = validateTaskId(typeof item.id === 'string' && item.id ? item.id : randomUUID());
      if (seen.has(id)) throw new TaskStoreError('备份文件包含重复的任务 ID');
      seen.add(id);
      if (!TASK_STATUSES.includes(item.status))
        throw new TaskStoreError(
          `任务 ${id} 的状态「${String(item.status)}」无法识别，未导入以免丢失状态`,
        );
      const createdAt = normalizeTime(item.createdAt, nowIso(), id, '创建');
      const updatedAt = normalizeTime(item.updatedAt, createdAt, id, '更新');
      return {
        id,
        parentId: item.parentId ?? null,
        title: normalizeTitle(item.title ?? ''),
        note: normalizeNote(item.note, id),
        status: item.status,
        collapsed: Boolean(item.collapsed),
        order: Number.isFinite(item.order) ? Number(item.order) : i,
        createdAt,
        updatedAt,
      };
    });
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (const task of tasks) {
      if (task.parentId !== null) {
        validateTaskId(task.parentId);
        if (!byId.has(task.parentId))
          throw new TaskStoreError('备份文件层级损坏：存在找不到父任务的任务');
      }
      if (task.parentId === task.id)
        throw new TaskStoreError('备份文件层级损坏：任务不能是自己的父任务');
    }
    for (const task of tasks) {
      const chain = new Set([task.id]);
      let cursor = task.parentId;
      while (cursor) {
        if (chain.has(cursor)) throw new TaskStoreError('备份文件层级损坏：存在循环父子关系');
        chain.add(cursor);
        cursor = byId.get(cursor)?.parentId ?? null;
      }
    }
    return tasks;
  }

  function insertSnapshot(tasks) {
    const byParent = new Map();
    for (const task of tasks) {
      const key = task.parentId ?? '__root__';
      const list = byParent.get(key) ?? [];
      list.push(task);
      byParent.set(key, list);
    }
    for (const list of byParent.values()) list.sort((a, b) => a.order - b.order);

    const insertSubtree = (parentKey) => {
      const list = byParent.get(parentKey) ?? [];
      list.forEach((task, index) => {
        q.insert.run(
          task.id,
          task.parentId,
          task.title,
          task.note,
          task.status,
          task.collapsed ? 1 : 0,
          index,
          task.createdAt,
          task.updatedAt,
        );
        insertSubtree(task.id);
      });
    };
    insertSubtree('__root__');
  }

  /** 用快照整体替换所有任务（撤销与恢复共用）。 */
  function replaceAll(input) {
    const tasks = validateSnapshot(input);
    return tx(() => {
      db.exec('DELETE FROM tasks');
      insertSnapshot(tasks);
      return listTasks();
    });
  }

  /** 导入前核对统计，用于迁移报告与恢复后校验。 */
  function analyze() {
    return analyzeTasks(listTasks());
  }

  function snapshotTo(target) {
    db.exec('PRAGMA wal_checkpoint(FULL)');
    db.exec(`VACUUM INTO '${String(target).replace(/'/g, "''")}'`);
  }

  function integrity() {
    const result = db.prepare('PRAGMA integrity_check').get();
    const fk = db.prepare('PRAGMA foreign_key_check').all();
    return {
      ok: result.integrity_check === 'ok' && fk.length === 0,
      integrity: result.integrity_check,
      foreignKeyViolations: fk.length,
    };
  }

  function stats() {
    return analyze();
  }

  function close() {
    try {
      if (!readOnly) db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {
      /* 已关闭或只读连接无需再次检查点 */
    }
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }

  return {
    dbFile,
    listTasks,
    getTask,
    createTask,
    updateTask,
    moveTask,
    deleteTask,
    descendantIds,
    replaceAll,
    validateSnapshot,
    exportPayload,
    analyze,
    integrity,
    stats,
    snapshotTo,
    close,
  };
}

/** 对一组任务计算稳定的结构指纹，用于迁移/恢复前后核对。 */
export function analyzeTasks(tasks) {
  const byStatus = { todo: 0, doing: 0, done: 0, paused: 0 };
  for (const task of tasks) byStatus[task.status] += 1;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const depthOf = (task) => {
    let depth = 0;
    let cursor = task.parentId;
    const guard = new Set([task.id]);
    while (cursor && byId.has(cursor) && !guard.has(cursor)) {
      guard.add(cursor);
      depth += 1;
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return depth;
  };
  const maxDepth = tasks.reduce((max, task) => Math.max(max, depthOf(task)), 0);
  const canonical = tasks
    .map((t) =>
      [
        t.id,
        t.parentId ?? '',
        t.order,
        t.status,
        t.title,
        t.note,
        t.collapsed ? 1 : 0,
        t.createdAt,
        t.updatedAt,
      ].join('\u0001'),
    )
    .sort()
    .join('\n');
  return {
    total: tasks.length,
    roots: tasks.filter((t) => t.parentId === null).length,
    notes: tasks.filter((t) => t.note.trim()).length,
    collapsed: tasks.filter((t) => t.collapsed).length,
    maxDepth,
    byStatus,
    digest: createHash('sha256').update(canonical).digest('hex'),
  };
}
