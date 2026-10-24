import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { ChevronIcon, DotsIcon, NoteIcon, PlusIcon, StatusIcon } from './Icons';
import { flattenTree, isDescendantOf, siblingDropIndex } from '../tree';
import type { FlatRow, Task, TaskNode } from '../types';

interface OutlineProps {
  tasks: Task[];
  roots: TaskNode[];
  searching: boolean;
  searchExpand: Set<string>;
  matched: Set<string>;
  selectedId: string | null;
  editingId: string | null;
  onSelect: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onSetCollapsed: (id: string, collapsed: boolean) => void;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onStatusMenu: (id: string, x: number, y: number) => void;
  onAddChild: (id: string) => void;
  onMove: (id: string, parentId: string | null, index: number) => void;
  onCreateFirst: () => void;
}

type DropPosition = 'before' | 'inside' | 'after' | 'end';

interface DragState {
  id: string;
  title: string;
  x: number;
  y: number;
}

interface DropState {
  targetId: string | null;
  position: DropPosition;
}

interface DragSession {
  id: string;
  startX: number;
  startY: number;
  active: boolean;
}

export default function Outline(props: OutlineProps) {
  const {
    tasks,
    roots,
    searching,
    searchExpand,
    matched,
    selectedId,
    editingId,
    onSelect,
    onToggleCollapse,
    onSetCollapsed,
    onStartEdit,
    onCommitEdit,
    onCancelEdit,
    onContextMenu,
    onStatusMenu,
    onAddChild,
    onMove,
    onCreateFirst,
  } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<DragSession | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [drop, setDrop] = useState<DropState | null>(null);
  const [autoExpand, setAutoExpand] = useState<string | null>(null);
  const expandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dropRef = useRef<DropState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragEndAt = useRef(0);

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const nodeById = useMemo(() => {
    const map = new Map<string, TaskNode>();
    const walk = (list: TaskNode[]) => {
      for (const node of list) {
        map.set(node.id, node);
        walk(node.children);
      }
    };
    walk(roots);
    return map;
  }, [roots]);

  const rows = useMemo(
    () =>
      flattenTree(roots, (node) => {
        if (searching) return searchExpand.has(node.id);
        if (!node.collapsed) return true;
        return autoExpand === node.id;
      }),
    [roots, searching, searchExpand, autoExpand],
  );

  useEffect(() => {
    return () => {
      if (expandTimer.current) clearTimeout(expandTimer.current);
    };
  }, []);

  function setDropState(next: DropState | null) {
    dropRef.current = next;
    setDrop(next);
  }

  function scheduleAutoExpand(id: string | null) {
    if (expandTimer.current) {
      clearTimeout(expandTimer.current);
      expandTimer.current = null;
    }
    if (!id) {
      setAutoExpand(null);
      return;
    }
    expandTimer.current = setTimeout(() => {
      setAutoExpand(id);
    }, 500);
  }

  function computeDrop(clientY: number): DropState | null {
    const container = containerRef.current;
    const session = sessionRef.current;
    if (!container || !session) return null;
    const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-row-id]'));
    if (elements.length === 0) return null;

    const scrollerRect = container.getBoundingClientRect();
    if (clientY < scrollerRect.top + 6) container.scrollTop -= 14;
    if (clientY > scrollerRect.bottom - 6) container.scrollTop += 14;

    let hoverExpandId: string | null = null;
    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom) continue;
      const id = el.dataset.rowId!;
      if (isDescendantOf(tasks, id, session.id)) {
        scheduleAutoExpand(null);
        return null;
      }
      const ratio = (clientY - rect.top) / Math.max(rect.height, 1);
      let position: DropPosition = 'inside';
      if (ratio < 0.28) position = 'before';
      else if (ratio > 0.72) position = 'after';

      const node = nodeById.get(id);
      if (position === 'inside' && node && node.children.length > 0 && node.collapsed) {
        hoverExpandId = id;
      }
      scheduleAutoExpand(hoverExpandId);
      return { targetId: id, position };
    }

    const firstRect = elements[0].getBoundingClientRect();
    const lastRect = elements[elements.length - 1].getBoundingClientRect();
    scheduleAutoExpand(null);
    if (clientY < firstRect.top) {
      const firstId = elements[0].dataset.rowId!;
      if (isDescendantOf(tasks, firstId, session.id)) return null;
      return { targetId: firstId, position: 'before' };
    }
    if (clientY > lastRect.bottom) return { targetId: null, position: 'end' };
    return null;
  }

  function beginPointer(e: React.PointerEvent<HTMLDivElement>, node: TaskNode) {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button, input, textarea, a, [data-no-drag]')) return;
    sessionRef.current = { id: node.id, startX: e.clientX, startY: e.clientY, active: false };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }

  function movePointer(e: React.PointerEvent<HTMLDivElement>) {
    const session = sessionRef.current;
    if (!session) return;
    const dx = e.clientX - session.startX;
    const dy = e.clientY - session.startY;
    if (!session.active) {
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return;
      session.active = true;
      const node = byId.get(session.id);
      if (!node) return;
      const next = { id: node.id, title: node.title, x: e.clientX, y: e.clientY };
      dragRef.current = next;
      setDrag(next);
      document.body.classList.add('tw-dragging');
    }
    const nextDrag = { ...(dragRef.current as DragState), x: e.clientX, y: e.clientY };
    dragRef.current = nextDrag;
    setDrag(nextDrag);
    setDropState(computeDrop(e.clientY));
  }

  function endPointer(e: React.PointerEvent<HTMLDivElement>) {
    const session = sessionRef.current;
    const currentDrag = dragRef.current;
    const currentDrop = dropRef.current;
    sessionRef.current = null;
    dragRef.current = null;
    dropRef.current = null;
    setDrag(null);
    setDrop(null);
    setAutoExpand(null);
    if (expandTimer.current) {
      clearTimeout(expandTimer.current);
      expandTimer.current = null;
    }
    document.body.classList.remove('tw-dragging');
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    if (!session || !session.active || !currentDrag) return;
    dragEndAt.current = Date.now();
    if (!currentDrop) return;

    const draggedId = currentDrag.id;
    if (currentDrop.position === 'end') {
      const rootCount = tasks.filter((t) => t.parentId === null && t.id !== draggedId).length;
      onMove(draggedId, null, rootCount);
      return;
    }
    const targetId = currentDrop.targetId;
    if (!targetId) return;
    const target = byId.get(targetId);
    if (!target) return;
    if (currentDrop.position === 'inside') {
      onMove(draggedId, targetId, 0);
      if (target.collapsed) onSetCollapsed(targetId, false);
      return;
    }
    const index = siblingDropIndex(
      tasks,
      target.parentId,
      targetId,
      currentDrop.position,
      draggedId,
    );
    onMove(draggedId, target.parentId, index);
  }

  if (rows.length === 0) {
    return (
      <div className="outline-empty">
        {searching ? (
          <>
            <p className="empty-title">没有匹配的任务</p>
            <p className="empty-hint">换个关键词试试，或在右上角新建任务。</p>
          </>
        ) : (
          <>
            <p className="empty-title">还没有任务</p>
            <p className="empty-hint">
              把想做的事情记下来，再拆成小步骤。右键任意任务可以添加子任务。
            </p>
            <button type="button" className="btn btn-primary" onClick={onCreateFirst}>
              <PlusIcon size={15} />
              新建第一个任务
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="outline" ref={containerRef}>
      <div className={`outline-inner ${drag ? 'is-dragging' : ''}`}>
        {rows.map((row) => (
          <TaskRow
            key={row.node.id}
            row={row}
            selected={selectedId === row.node.id}
            editing={editingId === row.node.id}
            matched={matched.has(row.node.id)}
            searching={searching}
            dragging={drag?.id === row.node.id}
            drop={drop}
            onSelect={onSelect}
            onToggleCollapse={onToggleCollapse}
            onStartEdit={onStartEdit}
            onCommitEdit={onCommitEdit}
            onCancelEdit={onCancelEdit}
            onContextMenu={onContextMenu}
            onStatusMenu={onStatusMenu}
            onAddChild={onAddChild}
            shouldIgnoreClick={() => Date.now() - dragEndAt.current < 250}
            onBeginPointer={beginPointer}
            onMovePointer={movePointer}
            onEndPointer={endPointer}
          />
        ))}
        <div className={`outline-tail ${drop?.position === 'end' ? 'drop-end' : ''}`} />
      </div>

      {drag && (
        <div className="drag-ghost" style={{ left: drag.x + 14, top: drag.y + 10 }}>
          <span className="drag-ghost-dot" />
          {drag.title}
        </div>
      )}
      {drag && !drop && <div className="drag-hint">拖到任务上：上/下边缘排序，中间放入子任务</div>}
      {drag && drop?.position === 'inside' && (
        <div className="drag-hint">
          放入「{byId.get(drop.targetId ?? '')?.title ?? ''}」作为第一个子任务
        </div>
      )}
    </div>
  );
}

interface TaskRowProps {
  row: FlatRow;
  selected: boolean;
  editing: boolean;
  matched: boolean;
  searching: boolean;
  dragging: boolean;
  drop: DropState | null;
  onSelect: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, title: string) => void;
  onCancelEdit: () => void;
  onContextMenu: (id: string, x: number, y: number) => void;
  onStatusMenu: (id: string, x: number, y: number) => void;
  onAddChild: (id: string) => void;
  shouldIgnoreClick: () => boolean;
  onBeginPointer: (e: React.PointerEvent<HTMLDivElement>, node: TaskNode) => void;
  onMovePointer: (e: React.PointerEvent<HTMLDivElement>) => void;
  onEndPointer: (e: React.PointerEvent<HTMLDivElement>) => void;
}

function collectProgress(node: TaskNode): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const child of node.children) {
    total += 1;
    if (child.status === 'done') done += 1;
    const sub = collectProgress(child);
    done += sub.done;
    total += sub.total;
  }
  return { done, total };
}

function TaskRow({
  row,
  selected,
  editing,
  matched,
  searching,
  dragging,
  drop,
  onSelect,
  onToggleCollapse,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onContextMenu,
  onStatusMenu,
  onAddChild,
  shouldIgnoreClick,
  onBeginPointer,
  onMovePointer,
  onEndPointer,
}: TaskRowProps) {
  const { node, depth, hasChildren } = row;
  const [draft, setDraft] = useState(node.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committed = useRef(false);

  useEffect(() => {
    if (!editing) return;
    committed.current = false;
    setDraft(node.title);
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => clearTimeout(timer);
  }, [editing, node.title]);

  useEffect(() => {
    return () => {
      if (clickTimer.current) clearTimeout(clickTimer.current);
    };
  }, []);

  const progress = hasChildren ? collectProgress(node) : null;
  const dropInside = drop?.position === 'inside' && drop.targetId === node.id;
  const dropBefore = drop?.position === 'before' && drop.targetId === node.id;
  const dropAfter = drop?.position === 'after' && drop.targetId === node.id;

  function commit() {
    if (committed.current) return;
    committed.current = true;
    const value = draft.trim();
    if (!value || value === node.title) {
      onCancelEdit();
      return;
    }
    onCommitEdit(node.id, value);
  }

  function handleRowClick(e: React.MouseEvent) {
    if (editing) return;
    if (shouldIgnoreClick()) return;
    if ((e.target as HTMLElement).closest('button, input')) return;
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
      return;
    }
    clickTimer.current = setTimeout(() => {
      clickTimer.current = null;
      onSelect(node.id);
    }, 190);
  }

  function handleDoubleClick() {
    if (shouldIgnoreClick()) return;
    if (clickTimer.current) {
      clearTimeout(clickTimer.current);
      clickTimer.current = null;
    }
    if (!editing) onStartEdit(node.id);
  }

  const rowStyle = {
    paddingLeft: 8 + depth * 22,
    '--row-indent': `${8 + depth * 22}px`,
  } as CSSProperties;

  return (
    <div
      className={[
        'row',
        selected ? 'is-selected' : '',
        editing ? 'is-editing' : '',
        dragging ? 'is-dragging-row' : '',
        dropInside ? 'drop-inside' : '',
        dropBefore ? 'drop-before' : '',
        dropAfter ? 'drop-after' : '',
        searching && matched ? 'is-match' : '',
        searching && !matched ? 'is-context' : '',
        node.status === 'done' ? 'is-done' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={rowStyle}
      data-row-id={node.id}
      onPointerDown={(e) => onBeginPointer(e, node)}
      onPointerMove={onMovePointer}
      onPointerUp={onEndPointer}
      onClick={handleRowClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        if (editing) return;
        onContextMenu(node.id, e.clientX, e.clientY);
      }}
    >
      {Array.from({ length: depth }).map((_, i) => (
        <span key={i} className="tree-guide" style={{ left: 8 + i * 22 + 10 }} />
      ))}

      <button
        type="button"
        className={`twisty ${hasChildren ? '' : 'is-hidden'} ${!node.collapsed ? 'is-open' : ''}`}
        tabIndex={-1}
        aria-label={node.collapsed ? '展开子任务' : '折叠子任务'}
        onClick={(e) => {
          e.stopPropagation();
          if (hasChildren) onToggleCollapse(node.id);
        }}
      >
        <ChevronIcon size={14} />
      </button>

      <button
        type="button"
        className="status-btn"
        tabIndex={-1}
        aria-label="修改状态"
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          onStatusMenu(node.id, rect.left, rect.bottom + 4);
        }}
      >
        <StatusIcon status={node.status} size={16} />
      </button>

      <div className="row-main">
        {editing ? (
          <input
            ref={inputRef}
            className="title-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                committed.current = true;
                onCancelEdit();
              }
            }}
          />
        ) : (
          <span
            className={`row-title ${node.status === 'done' ? 'strike' : ''}`}
            title={node.title}
          >
            {node.title}
          </span>
        )}
        {node.note.trim() && (
          <span className="row-note" title="有备注">
            <NoteIcon size={12} />
          </span>
        )}
      </div>

      {progress && progress.total > 0 && (
        <span
          className={`row-progress ${progress.done === progress.total ? 'is-complete' : ''}`}
          title="子任务完成进度"
        >
          {progress.done}/{progress.total}
        </span>
      )}

      <div className="row-actions">
        <button
          type="button"
          className="icon-btn"
          title="添加子任务"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onAddChild(node.id);
          }}
        >
          <PlusIcon size={14} />
        </button>
        <button
          type="button"
          className="icon-btn"
          title="更多操作"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            onContextMenu(node.id, rect.left, rect.bottom + 4);
          }}
        >
          <DotsIcon size={14} />
        </button>
      </div>
    </div>
  );
}

export { TaskRow };
export type { TaskRowProps };
