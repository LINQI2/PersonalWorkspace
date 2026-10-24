import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';
import { ancestorIds, buildTree, descendantIds, filterTree, searchTasks } from './tree';
import type { Task, TaskStatus } from './types';
import { STATUS_META, STATUS_ORDER } from './types';
import TopBar from './components/TopBar';
import Outline from './components/Outline';
import DetailPanel from './components/DetailPanel';
import ContextMenu from './components/ContextMenu';
import StatusMenu from './components/StatusMenu';
import ConfirmDialog from './components/ConfirmDialog';
import Toast from './components/Toast';
import type { ToastData } from './components/Toast';

interface ConfirmState {
  title: string;
  message: ReactNode;
  confirmText: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
}

interface TasksModuleProps {
  active: boolean;
}

const messageOf = (err: unknown, fallback = '操作失败，请重试') =>
  err instanceof Error && err.message ? err.message : fallback;

/**
 * 任务台模块：作为统一工作空间的一个视图常驻挂载。
 * 切换到知识库时只隐藏，不卸载，避免搜索、选中、展开状态和未保存备注丢失。
 */
export default function TasksModule({ active }: TasksModuleProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [history, setHistory] = useState<Task[][]>([]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ taskId: string; x: number; y: number } | null>(null);
  const [statusMenu, setStatusMenu] = useState<{ taskId: string; x: number; y: number } | null>(
    null,
  );
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [toast, setToast] = useState<ToastData | null>(null);

  const tasksRef = useRef<Task[]>([]);
  const toastSeq = useRef(0);
  const undoRef = useRef<() => void>(() => {});

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const showToast = useCallback((message: string, options: Partial<ToastData> = {}) => {
    toastSeq.current += 1;
    setToast({ id: toastSeq.current, message, ...options });
  }, []);

  const fail = useCallback(
    (err: unknown, fallback?: string) => {
      showToast(messageOf(err, fallback), { tone: 'error' });
    },
    [showToast],
  );

  const refresh = useCallback(async () => {
    const next = await api.list();
    setTasks(next);
    return next;
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .list()
      .then((list) => {
        if (alive) setTasks(list);
      })
      .catch((err) => {
        if (alive) setLoadError(messageOf(err, '无法加载数据'));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const pushHistory = useCallback(() => {
    setHistory((prev) => [...prev.slice(-29), tasksRef.current]);
  }, []);

  const undo = useCallback(async () => {
    if (history.length === 0 || busy) return;
    const snapshot = history[history.length - 1];
    setBusy(true);
    try {
      const restored = await api.replaceAll(snapshot);
      setTasks(restored);
      setHistory((prev) => prev.slice(0, -1));
      setSelectedId((prev) => (prev && restored.some((t) => t.id === prev) ? prev : null));
      setEditingId(null);
      showToast('已撤销上一步操作');
    } catch (err) {
      fail(err, '撤销失败');
    } finally {
      setBusy(false);
    }
  }, [history, busy, showToast, fail]);

  undoRef.current = () => {
    void undo();
  };

  const selectTask = useCallback(
    (id: string) => {
      if (selectedId === id) {
        setDetailOpen((open) => !open);
        return;
      }
      setSelectedId(id);
      setDetailOpen(true);
    },
    [selectedId],
  );

  const addTask = useCallback(
    async (parentId: string | null, afterId: string | null = null, expandParent = false) => {
      if (busy) return;
      setBusy(true);
      setQuery('');
      pushHistory();
      try {
        if (expandParent && parentId) {
          const parent = tasksRef.current.find((t) => t.id === parentId);
          if (parent?.collapsed) await api.update(parentId, { collapsed: false });
        }
        const task = await api.create({ parentId, title: '新任务', afterId });
        await refresh();
        setSelectedId(task.id);
        setDetailOpen(false);
        setEditingId(task.id);
      } catch (err) {
        fail(err, '创建任务失败');
      } finally {
        setBusy(false);
      }
    },
    [busy, pushHistory, refresh, fail],
  );

  const renameTask = useCallback(
    async (id: string, title: string) => {
      setEditingId(null);
      pushHistory();
      try {
        const updated = await api.update(id, { title });
        setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      } catch (err) {
        fail(err, '重命名失败');
        await refresh().catch(() => {});
      }
    },
    [pushHistory, refresh, fail],
  );

  const setTaskStatus = useCallback(
    async (id: string, status: TaskStatus) => {
      const current = tasksRef.current.find((t) => t.id === id);
      if (!current || current.status === status) return;
      pushHistory();
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status } : t)));
      try {
        const updated = await api.update(id, { status });
        setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
      } catch (err) {
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, status: current.status } : t)));
        fail(err, '修改状态失败');
      }
    },
    [pushHistory, fail],
  );

  const setCollapsed = useCallback(async (id: string, collapsed: boolean) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, collapsed } : t)));
    try {
      await api.update(id, { collapsed });
    } catch {
      /* 折叠状态保存失败不打断使用 */
    }
  }, []);

  const toggleCollapse = useCallback(
    (id: string) => {
      const task = tasksRef.current.find((t) => t.id === id);
      if (!task) return;
      void setCollapsed(id, !task.collapsed);
    },
    [setCollapsed],
  );

  const moveTask = useCallback(
    async (id: string, parentId: string | null, index: number) => {
      pushHistory();
      try {
        await api.move(id, parentId, index);
        await refresh();
      } catch (err) {
        fail(err, '移动任务失败');
        await refresh().catch(() => {});
      }
    },
    [pushHistory, refresh, fail],
  );

  const requestDelete = useCallback(
    (id: string) => {
      const task = tasksRef.current.find((t) => t.id === id);
      if (!task) return;
      const children = descendantIds(tasksRef.current, id).length;
      setConfirm({
        title: '删除任务',
        danger: true,
        confirmText: '删除',
        message: (
          <>
            <p>
              确定删除「<strong>{task.title}</strong>」吗？
            </p>
            {children > 0 && (
              <p className="dialog-warn">
                它的 {children} 个子任务也会被一并删除，删除父任务会同时移除整棵子树。
              </p>
            )}
            <p className="dialog-hint">误删后可以点击顶部「撤销」恢复。</p>
          </>
        ),
        onConfirm: async () => {
          setConfirm(null);
          pushHistory();
          try {
            const result = await api.remove(id);
            await refresh();
            setSelectedId((prev) => (prev === id ? null : prev));
            setDetailOpen((prev) => (prev && selectedId === id ? false : prev));
            showToast(
              result.deletedCount > 1
                ? `已删除任务及其 ${result.deletedCount - 1} 个子任务`
                : '已删除任务',
              { actionLabel: '撤销', onAction: () => undoRef.current() },
            );
          } catch (err) {
            fail(err, '删除失败');
          }
        },
      });
    },
    [pushHistory, refresh, selectedId, showToast, fail],
  );

  const saveNote = useCallback(async (id: string, note: string) => {
    const updated = await api.update(id, { note });
    setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
  }, []);

  const closeToast = useCallback(() => setToast(null), []);

  // 切换到其他模块时关闭任务台的临时浮层，不打断已经在进行的数据保存
  useEffect(() => {
    if (active) return;
    setMenu(null);
    setStatusMenu(null);
    setEditingId(null);
  }, [active]);

  const searching = query.trim().length > 0;
  const search = useMemo(() => searchTasks(tasks, query), [tasks, query]);
  const roots = useMemo(() => buildTree(tasks), [tasks]);
  const visibleRoots = useMemo(
    () => (searching ? filterTree(roots, search.keep) : roots),
    [searching, roots, search.keep],
  );

  const selectedTask = selectedId ? (tasks.find((t) => t.id === selectedId) ?? null) : null;
  const selectedPath = useMemo(() => {
    if (!selectedTask) return [];
    const byId = new Map(tasks.map((t) => [t.id, t]));
    return ancestorIds(tasks, selectedTask.id).map((id) => ({
      id,
      title: byId.get(id)?.title ?? '',
    }));
  }, [selectedTask, tasks]);
  const selectedChildCount = selectedTask
    ? tasks.filter((t) => t.parentId === selectedTask.id).length
    : 0;
  const selectedDescendantCount = selectedTask ? descendantIds(tasks, selectedTask.id).length : 0;
  const counts = useMemo(() => {
    const byStatus: Record<TaskStatus, number> = { todo: 0, doing: 0, done: 0, paused: 0 };
    for (const task of tasks) byStatus[task.status] += 1;
    return byStatus;
  }, [tasks]);

  const menuTask = menu ? (tasks.find((t) => t.id === menu.taskId) ?? null) : null;
  const statusTask = statusMenu ? (tasks.find((t) => t.id === statusMenu.taskId) ?? null) : null;

  if (loading) {
    return (
      <div className="tw-app">
        <div className="boot-screen">
          <div className="boot-spinner" />
          <p>正在打开任务台…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="tw-app">
        <div className="boot-screen">
          <p className="boot-error">{loadError}</p>
          <p className="boot-hint">请确认本地服务已启动，然后重试。</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => window.location.reload()}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tw-app">
      <TopBar
        query={query}
        onQueryChange={setQuery}
        resultCount={search.count}
        searching={searching}
        canUndo={history.length > 0}
        busy={busy}
        onUndo={() => void undo()}
        onNewTask={() => void addTask(null)}
      />

      <div className={`workspace ${detailOpen && selectedTask ? 'with-detail' : ''}`}>
        <section className="outline-pane">
          <div className="outline-head">
            <div className="outline-head-left">
              <span className="outline-title">{searching ? '搜索结果' : '全部任务'}</span>
              <span className="outline-sub">
                {searching
                  ? `${search.count} 个匹配`
                  : '右键任务查看更多操作，拖动可调整顺序与层级'}
              </span>
            </div>
          </div>

          <Outline
            tasks={tasks}
            roots={visibleRoots}
            searching={searching}
            searchExpand={search.expand}
            matched={search.matched}
            selectedId={selectedId}
            editingId={editingId}
            onSelect={selectTask}
            onToggleCollapse={toggleCollapse}
            onSetCollapsed={(id, collapsed) => void setCollapsed(id, collapsed)}
            onStartEdit={(id) => {
              setSelectedId(id);
              setEditingId(id);
            }}
            onCommitEdit={(id, title) => void renameTask(id, title)}
            onCancelEdit={() => setEditingId(null)}
            onContextMenu={(id, x, y) => {
              setSelectedId(id);
              setMenu({ taskId: id, x, y });
            }}
            onStatusMenu={(id, x, y) => setStatusMenu({ taskId: id, x, y })}
            onAddChild={(id) => void addTask(id, null, true)}
            onMove={(id, parentId, index) => void moveTask(id, parentId, index)}
            onCreateFirst={() => void addTask(null)}
          />

          <footer className="statusbar">
            <div className="statusbar-counts">
              <span>共 {tasks.length} 项</span>
              {STATUS_ORDER.filter((s) => counts[s] > 0).map((status) => (
                <span key={status} className="statusbar-item">
                  <i style={{ background: STATUS_META[status].color }} />
                  {STATUS_META[status].label} {counts[status]}
                </span>
              ))}
            </div>
            <span className="statusbar-data">本地自动保存 · 统一工作空间</span>
          </footer>
        </section>

        {detailOpen && selectedTask && (
          <DetailPanel
            task={selectedTask}
            path={selectedPath}
            childCount={selectedChildCount}
            descendantCount={selectedDescendantCount}
            onClose={() => setDetailOpen(false)}
            onRename={(id, title) => void renameTask(id, title)}
            onStatus={(id, status) => void setTaskStatus(id, status)}
            onNote={saveNote}
            onAddChild={(id) => void addTask(id, null, true)}
            onDelete={requestDelete}
            onSelect={selectTask}
          />
        )}
      </div>

      {menu && menuTask && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          task={menuTask}
          hasChildren={tasks.some((t) => t.parentId === menuTask.id)}
          childCount={descendantIds(tasks, menuTask.id).length}
          onClose={() => setMenu(null)}
          onAddSibling={() => void addTask(menuTask.parentId, menuTask.id)}
          onAddChild={() => void addTask(menuTask.id, null, true)}
          onRename={() => {
            setEditingId(menuTask.id);
            setQuery('');
          }}
          onSetStatus={(status) => void setTaskStatus(menuTask.id, status)}
          onToggleCollapse={() => toggleCollapse(menuTask.id)}
          onDelete={() => requestDelete(menuTask.id)}
        />
      )}

      {statusMenu && statusTask && (
        <StatusMenu
          x={statusMenu.x}
          y={statusMenu.y}
          current={statusTask.status}
          onPick={(status) => {
            setStatusMenu(null);
            void setTaskStatus(statusTask.id, status);
          }}
          onClose={() => setStatusMenu(null)}
        />
      )}

      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmText={confirm.confirmText}
          danger={confirm.danger}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void confirm.onConfirm()}
        />
      )}

      {toast && <Toast toast={toast} onClose={closeToast} />}
    </div>
  );
}
