import type { FlatRow, Task, TaskNode } from './types'

/** 把扁平任务列表构建为按 order 排序的任务树 */
export function buildTree(tasks: Task[]): TaskNode[] {
  const nodes = new Map<string, TaskNode>()
  for (const task of tasks) nodes.set(task.id, { ...task, children: [] })

  const roots: TaskNode[] = []
  for (const task of tasks) {
    const node = nodes.get(task.id)!
    const parent = task.parentId ? nodes.get(task.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }

  const sortRec = (list: TaskNode[]) => {
    list.sort((a, b) => a.order - b.order)
    for (const item of list) sortRec(item.children)
  }
  sortRec(roots)
  return roots
}

/** 展开为可见行（依据 collapsed 状态与临时展开集合） */
export function flattenTree(roots: TaskNode[], expanded: (node: TaskNode) => boolean): FlatRow[] {
  const rows: FlatRow[] = []
  const walk = (list: TaskNode[], depth: number) => {
    for (const node of list) {
      rows.push({ node, depth, hasChildren: node.children.length > 0 })
      if (node.children.length > 0 && expanded(node)) walk(node.children, depth + 1)
    }
  }
  walk(roots, 0)
  return rows
}

/** 某个任务的所有后代 id */
export function descendantIds(tasks: Task[], id: string): string[] {
  const childrenOf = new Map<string, string[]>()
  for (const task of tasks) {
    if (!task.parentId) continue
    const list = childrenOf.get(task.parentId) ?? []
    list.push(task.id)
    childrenOf.set(task.parentId, list)
  }
  const result: string[] = []
  const stack = [...(childrenOf.get(id) ?? [])]
  while (stack.length) {
    const current = stack.pop()!
    result.push(current)
    stack.push(...(childrenOf.get(current) ?? []))
  }
  return result
}

/** 从根到某任务的祖先 id 列表（不含自身） */
export function ancestorIds(tasks: Task[], id: string): string[] {
  const byId = new Map(tasks.map((t) => [t.id, t]))
  const chain: string[] = []
  let cursor = byId.get(id)?.parentId ?? null
  let guard = 0
  while (cursor && guard++ < 200) {
    chain.unshift(cursor)
    cursor = byId.get(cursor)?.parentId ?? null
  }
  return chain
}

/** 判断 candidate 是否为 id 的后代（用于阻止循环拖拽） */
export function isDescendantOf(tasks: Task[], candidate: string, id: string): boolean {
  if (candidate === id) return true
  return descendantIds(tasks, id).includes(candidate)
}

export interface SearchResult {
  matched: Set<string>
  keep: Set<string>
  expand: Set<string>
  count: number
}

/** 计算搜索命中集合：保留命中项及其祖先 */
export function searchTasks(tasks: Task[], rawQuery: string): SearchResult {
  const query = rawQuery.trim().toLowerCase()
  const matched = new Set<string>()
  const keep = new Set<string>()
  const expand = new Set<string>()
  if (!query) return { matched, keep, expand, count: 0 }

  for (const task of tasks) {
    if (task.title.toLowerCase().includes(query) || task.note.toLowerCase().includes(query)) {
      matched.add(task.id)
    }
  }
  for (const id of matched) {
    keep.add(id)
    for (const ancestor of ancestorIds(tasks, id)) {
      keep.add(ancestor)
      expand.add(ancestor)
    }
  }
  return { matched, keep, expand, count: matched.size }
}

/** 根据搜索条件裁剪树 */
export function filterTree(roots: TaskNode[], keep: Set<string>): TaskNode[] {
  const walk = (list: TaskNode[]): TaskNode[] => {
    const result: TaskNode[] = []
    for (const node of list) {
      if (!keep.has(node.id)) continue
      result.push({ ...node, children: walk(node.children) })
    }
    return result
  }
  return walk(roots)
}

/** 计算同级插入位置（排除被拖拽任务本身），用于拖拽落点 */
export function siblingDropIndex(tasks: Task[], parentId: string | null, targetId: string, position: 'before' | 'after', draggedId: string): number {
  const siblings = tasks
    .filter((t) => t.parentId === parentId && t.id !== draggedId)
    .sort((a, b) => a.order - b.order)
  const index = siblings.findIndex((t) => t.id === targetId)
  if (index === -1) return siblings.length
  return position === 'before' ? index : index + 1
}
