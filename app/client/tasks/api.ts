import { api as request } from '../shared';
import type { Task } from './types';

export interface CreateTaskInput {
  parentId?: string | null;
  title: string;
  afterId?: string | null;
}

/**
 * 任务模块只通过统一服务访问 /api/tasks 命名空间；
 * shared 的 api() 负责附加 X-PK-Request 同源请求标记。
 */
export const api = {
  list: () => request<{ tasks: Task[] }>('/tasks').then((r) => r.tasks),

  create: (input: CreateTaskInput) =>
    request<{ task: Task }>('/tasks', {
      method: 'POST',
      body: JSON.stringify(input),
    }).then((r) => r.task),

  update: (id: string, patch: Partial<Pick<Task, 'title' | 'note' | 'status' | 'collapsed'>>) =>
    request<{ task: Task }>(`/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }).then((r) => r.task),

  move: (id: string, parentId: string | null, index: number) =>
    request<{ task: Task }>(`/tasks/${id}/move`, {
      method: 'POST',
      body: JSON.stringify({ parentId, index }),
    }).then((r) => r.task),

  remove: (id: string) =>
    request<{ deletedIds: string[]; deletedCount: number }>(`/tasks/${id}`, {
      method: 'DELETE',
    }),

  replaceAll: (tasks: Task[]) =>
    request<{ tasks: Task[] }>('/tasks', {
      method: 'PUT',
      body: JSON.stringify({ tasks }),
    }).then((r) => r.tasks),
};
