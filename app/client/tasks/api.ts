import type { AppInfo, Task, TaskStatus } from './types'

export class ApiError extends Error {}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    })
  } catch {
    throw new ApiError('无法连接本地服务，请确认服务已启动')
  }
  if (!res.ok) {
    let message = `操作失败（${res.status}）`
    try {
      const data = await res.json()
      if (data?.error) message = data.error
    } catch {
      /* ignore */
    }
    throw new ApiError(message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export interface CreateTaskInput {
  parentId?: string | null
  title: string
  afterId?: string | null
}

export const api = {
  list: () => request<{ tasks: Task[] }>('/api/tasks').then((r) => r.tasks),

  create: (input: CreateTaskInput) =>
    request<{ task: Task }>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.task),

  update: (id: string, patch: Partial<Pick<Task, 'title' | 'note' | 'status' | 'collapsed'>>) =>
    request<{ task: Task }>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then((r) => r.task),

  move: (id: string, parentId: string | null, index: number) =>
    request<{ task: Task }>(`/api/tasks/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ parentId, index }),
    }).then((r) => r.task),

  remove: (id: string) =>
    request<{ deletedIds: string[]; deletedCount: number }>(`/api/tasks/${id}`, { method: 'DELETE' }),

  replaceAll: (tasks: Task[]) =>
    request<{ tasks: Task[] }>('/api/tasks', { method: 'PUT', body: JSON.stringify({ tasks }) }).then((r) => r.tasks),

  info: () => request<AppInfo>('/api/info'),

  snapshot: () => request<{ file: string; taskCount: number }>('/api/backup/snapshot', { method: 'POST' }),

  restore: (payload: unknown) =>
    request<{ tasks: Task[]; count: number; preRestoreSnapshot: string }>('/api/backup/restore', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
}

export const statusLabel = (status: TaskStatus): string =>
  ({ todo: '未开始', doing: '进行中', done: '已完成', paused: '暂停' })[status]
