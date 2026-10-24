export type TaskStatus = 'todo' | 'doing' | 'done' | 'paused'

export interface Task {
  id: string
  parentId: string | null
  title: string
  note: string
  status: TaskStatus
  collapsed: boolean
  order: number
  createdAt: string
  updatedAt: string
}

export interface TaskNode extends Task {
  children: TaskNode[]
}

export interface FlatRow {
  node: TaskNode
  depth: number
  hasChildren: boolean
}

export interface AppInfo {
  dataDir: string
  dbFile: string
  backupDir: string
  stats: { total: number; byStatus: Record<TaskStatus, number> }
}

export interface StatusMeta {
  value: TaskStatus
  label: string
  color: string
  tint: string
}

export const STATUS_META: Record<TaskStatus, StatusMeta> = {
  todo: { value: 'todo', label: '未开始', color: '#94a3b8', tint: '#f1f5f9' },
  doing: { value: 'doing', label: '进行中', color: '#3b82f6', tint: '#eff6ff' },
  done: { value: 'done', label: '已完成', color: '#22c55e', tint: '#f0fdf4' },
  paused: { value: 'paused', label: '暂停', color: '#f59e0b', tint: '#fffbeb' },
}

export const STATUS_ORDER: TaskStatus[] = ['todo', 'doing', 'done', 'paused']
