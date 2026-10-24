import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const STATUSES = ['todo', 'doing', 'done', 'paused']

export class StoreError extends Error {
  constructor(message, status = 400, code = 'bad_request') {
    super(message)
    this.name = 'StoreError'
    this.status = status
    this.code = code
  }
}

const nowIso = () => new Date().toISOString()

function rowToTask(row) {
  if (!row) return null
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
  }
}

function normalizeTitle(value) {
  if (typeof value !== 'string') throw new StoreError('任务名称必须是文本')
  const title = value.trim()
  if (!title) throw new StoreError('任务名称不能为空')
  if (title.length > 500) throw new StoreError('任务名称过长（最多 500 字）')
  return title
}

function normalizeStatus(value) {
  if (!STATUSES.includes(value)) throw new StoreError('无效的任务状态')
  return value
}

export function createStore({ dbFile, backupDir }) {
  fs.mkdirSync(path.dirname(dbFile), { recursive: true })
  fs.mkdirSync(backupDir, { recursive: true })

  const db = new DatabaseSync(dbFile)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec('PRAGMA busy_timeout = 5000')
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
  `)

  let txDepth = 0
  function tx(fn) {
    if (txDepth > 0) return fn()
    db.exec('BEGIN IMMEDIATE')
    txDepth++
    try {
      const result = fn()
      db.exec('COMMIT')
      return result
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* ignore */
      }
      throw err
    } finally {
      txDepth--
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
    delete: db.prepare('DELETE FROM tasks WHERE id = ?'),
    setOrder: db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?'),
    shiftUp: db.prepare('UPDATE tasks SET sort_order = sort_order + 1 WHERE parent_id IS ? AND sort_order >= ?'),
    descendants: db.prepare(`
      WITH RECURSIVE sub(id) AS (
        SELECT id FROM tasks WHERE parent_id = ?
        UNION ALL
        SELECT t.id FROM tasks t JOIN sub s ON t.parent_id = s.id
      )
      SELECT id FROM sub
    `),
    countAll: db.prepare('SELECT COUNT(*) AS c FROM tasks'),
  }

  function requireTask(id) {
    const task = rowToTask(q.get.get(id))
    if (!task) throw new StoreError('任务不存在', 404, 'not_found')
    return task
  }

  function requireParent(parentId) {
    if (parentId === null || parentId === undefined || parentId === '') return null
    if (typeof parentId !== 'string') throw new StoreError('无效的父任务')
    if (!q.get.get(parentId)) throw new StoreError('父任务不存在', 404, 'not_found')
    return parentId
  }

  function reindex(parentId) {
    const children = q.children.all(parentId)
    children.forEach((row, index) => {
      if (row.sort_order !== index) {
        db.prepare('UPDATE tasks SET sort_order = ? WHERE id = ?').run(index, row.id)
      }
    })
  }

  function listTasks() {
    return q.list.all().map(rowToTask)
  }

  function getTask(id) {
    return requireTask(id)
  }

  function descendantIds(id) {
    return q.descendants.all(id).map((r) => r.id)
  }

  function createTask({ parentId = null, title, note = '', status = 'todo', afterId = null, beforeId = null, collapsed = false } = {}) {
    const cleanTitle = normalizeTitle(title ?? '')
    const parent = requireParent(parentId)
    const cleanStatus = normalizeStatus(status)
    return tx(() => {
      const siblings = q.children.all(parent)
      let index = siblings.length
      if (afterId) {
        const found = siblings.findIndex((s) => s.id === afterId)
        if (found === -1) throw new StoreError('参照任务不存在', 404, 'not_found')
        index = found + 1
      } else if (beforeId) {
        const found = siblings.findIndex((s) => s.id === beforeId)
        if (found === -1) throw new StoreError('参照任务不存在', 404, 'not_found')
        index = found
      }
      q.shiftUp.run(parent, index)
      const id = randomUUID()
      const ts = nowIso()
      q.insert.run(id, parent, cleanTitle, typeof note === 'string' ? note : '', cleanStatus, collapsed ? 1 : 0, index, ts, ts)
      return rowToTask(q.get.get(id))
    })
  }

  function updateTask(id, patch = {}) {
    const task = requireTask(id)
    const fields = []
    const values = []
    if (patch.title !== undefined) {
      fields.push('title = ?')
      values.push(normalizeTitle(patch.title))
    }
    if (patch.note !== undefined) {
      if (typeof patch.note !== 'string') throw new StoreError('备注必须是文本')
      fields.push('note = ?')
      values.push(patch.note.slice(0, 20000))
    }
    if (patch.status !== undefined) {
      fields.push('status = ?')
      values.push(normalizeStatus(patch.status))
    }
    if (patch.collapsed !== undefined) {
      fields.push('collapsed = ?')
      values.push(patch.collapsed ? 1 : 0)
    }
    if (fields.length === 0) return task
    fields.push('updated_at = ?')
    values.push(nowIso())
    db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values, id)
    return rowToTask(q.get.get(id))
  }

  /**
   * 移动任务到新的父任务下的指定位置。
   * index 为在目标父任务子级列表中的插入位置（0 表示最前，超出则放到最后）。
   */
  function moveTask(id, { parentId = null, index = 0 } = {}) {
    const task = requireTask(id)
    const targetParent = requireParent(parentId)
    if (targetParent === id) throw new StoreError('不能把任务移动到自身下面', 400, 'cycle')
    if (targetParent) {
      const desc = descendantIds(id)
      if (desc.includes(targetParent)) throw new StoreError('不能把任务移动到自己的子任务下', 400, 'cycle')
    }
    const targetIndex = Number.isFinite(index) ? Math.max(0, Math.trunc(index)) : 0
    return tx(() => {
      const oldSiblings = q.children.all(task.parentId).filter((s) => s.id !== id)
      oldSiblings.forEach((row, i) => q.setOrder.run(i, row.id))

      const siblings = targetParent === task.parentId ? oldSiblings : q.children.all(targetParent).filter((s) => s.id !== id)
      const clamped = Math.min(targetIndex, siblings.length)
      const ordered = [...siblings.slice(0, clamped), { id }, ...siblings.slice(clamped)]

      db.prepare('UPDATE tasks SET parent_id = ?, updated_at = ? WHERE id = ?').run(targetParent, nowIso(), id)
      ordered.forEach((row, i) => q.setOrder.run(i, row.id))

      return { task: rowToTask(q.get.get(id)), childCount: q.children.all(id).length }
    })
  }

  function deleteTask(id) {
    const task = requireTask(id)
    const ids = [id, ...descendantIds(id)]
    tx(() => {
      for (const childId of ids) q.delete.run(childId)
      reindex(task.parentId)
    })
    return { deletedIds: ids, deletedCount: ids.length }
  }

  function exportPayload() {
    return {
      app: 'PersonalTaskHub',
      formatVersion: 1,
      exportedAt: nowIso(),
      tasks: listTasks(),
    }
  }

  function validateSnapshot(input) {
    const raw = Array.isArray(input) ? input : input?.tasks
    if (!Array.isArray(raw)) throw new StoreError('备份文件格式不正确：缺少 tasks 列表')
    const seen = new Set()
    const tasks = raw.map((item, i) => {
      if (!item || typeof item !== 'object') throw new StoreError(`备份文件第 ${i + 1} 条任务格式不正确`)
      const id = typeof item.id === 'string' && item.id ? item.id : randomUUID()
      if (seen.has(id)) throw new StoreError('备份文件包含重复的任务 ID')
      seen.add(id)
      const status = STATUSES.includes(item.status) ? item.status : 'todo'
      return {
        id,
        parentId: item.parentId ?? null,
        title: normalizeTitle(item.title ?? ''),
        note: typeof item.note === 'string' ? item.note : '',
        status,
        collapsed: Boolean(item.collapsed),
        order: Number.isFinite(item.order) ? Number(item.order) : i,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : nowIso(),
        updatedAt: nowIso(),
      }
    })
    const byId = new Map(tasks.map((t) => [t.id, t]))
    for (const task of tasks) {
      if (task.parentId !== null && !byId.has(task.parentId)) {
        throw new StoreError('备份文件层级损坏：存在找不到父任务的任务')
      }
      if (task.parentId === task.id) throw new StoreError('备份文件层级损坏：任务不能是自己的父任务')
    }
    // 循环检测
    for (const task of tasks) {
      const chain = new Set([task.id])
      let cursor = task.parentId
      while (cursor) {
        if (chain.has(cursor)) throw new StoreError('备份文件层级损坏：存在循环父子关系')
        chain.add(cursor)
        cursor = byId.get(cursor)?.parentId ?? null
      }
    }
    return tasks
  }

  /** 用快照整体替换所有任务（用于恢复备份和撤销） */
  function replaceAll(input) {
    const tasks = validateSnapshot(input)
    return tx(() => {
      db.exec('DELETE FROM tasks')

      // 必须按“父任务先于子任务”的顺序写入，否则外键约束会失败
      const byParent = new Map()
      for (const task of tasks) {
        const key = task.parentId ?? '__root__'
        const list = byParent.get(key) ?? []
        list.push(task)
        byParent.set(key, list)
      }
      for (const list of byParent.values()) list.sort((a, b) => a.order - b.order)

      const insertSubtree = (parentKey) => {
        const list = byParent.get(parentKey) ?? []
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
            nowIso(),
          )
          insertSubtree(task.id)
        })
      }
      insertSubtree('__root__')

      return listTasks()
    })
  }

  function snapshotFile(tag) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const file = path.join(backupDir, `${tag}-${stamp}.json`)
    const payload = exportPayload()
    fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8')
    return { file, taskCount: payload.tasks.length }
  }

  function pruneBackups(prefix, keep) {
    try {
      const files = fs
        .readdirSync(backupDir)
        .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
        .sort()
      for (const file of files.slice(0, Math.max(0, files.length - keep))) {
        fs.rmSync(path.join(backupDir, file), { force: true })
      }
    } catch {
      /* 备份清理失败不影响主流程 */
    }
  }

  /** 启动时按天自动快照，最多保留 10 份 */
  function autoSnapshot() {
    const day = new Date().toISOString().slice(0, 10)
    const target = path.join(backupDir, `auto-${day}.json`)
    if (!fs.existsSync(target)) {
      const payload = exportPayload()
      if (payload.tasks.length === 0) return null
      fs.writeFileSync(target, JSON.stringify(payload, null, 2), 'utf8')
    }
    pruneBackups('auto-', 10)
    return target
  }

  function restoreFromPayload(input) {
    const pre = snapshotFile('pre-restore')
    const tasks = replaceAll(input)
    return { tasks, count: tasks.length, preRestoreSnapshot: pre.file }
  }

  function stats() {
    const total = q.countAll.get().c
    const byStatus = { todo: 0, doing: 0, done: 0, paused: 0 }
    for (const row of db.prepare('SELECT status, COUNT(*) AS c FROM tasks GROUP BY status').all()) {
      byStatus[row.status] = row.c
    }
    return { total, byStatus }
  }

  function close() {
    try {
      db.close()
    } catch {
      /* ignore */
    }
  }

  return {
    dbFile,
    backupDir,
    listTasks,
    getTask,
    createTask,
    updateTask,
    moveTask,
    deleteTask,
    descendantIds,
    replaceAll,
    exportPayload,
    restoreFromPayload,
    snapshotFile,
    autoSnapshot,
    stats,
    close,
  }
}
