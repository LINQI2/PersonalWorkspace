import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CheckIcon, ChevronIcon, PlusIcon, StatusIcon, TrashIcon } from './Icons';
import { STATUS_META, STATUS_ORDER } from '../types';
import type { Task, TaskStatus } from '../types';

interface ContextMenuProps {
  x: number;
  y: number;
  task: Task;
  hasChildren: boolean;
  childCount: number;
  onClose: () => void;
  onAddSibling: () => void;
  onAddChild: () => void;
  onRename: () => void;
  onSetStatus: (status: TaskStatus) => void;
  onToggleCollapse: () => void;
  onDelete: () => void;
}

export default function ContextMenu({
  x,
  y,
  task,
  hasChildren,
  childCount,
  onClose,
  onAddSibling,
  onAddChild,
  onRename,
  onSetStatus,
  onToggleCollapse,
  onDelete,
}: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [statusOpen, setStatusOpen] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const left = Math.max(10, Math.min(x, window.innerWidth - rect.width - 10));
    const top = Math.max(10, Math.min(y, window.innerHeight - rect.height - 10));
    setPos({ left, top });
  }, [x, y, statusOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };

  return (
    <div
      className="overlay"
      onMouseDown={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        className="context-menu"
        ref={ref}
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={(e) => e.stopPropagation()}
        role="menu"
        aria-label="任务操作菜单"
      >
        <div className="context-menu-title" title={task.title}>
          {task.title}
        </div>
        <button type="button" className="menu-item" onClick={run(onAddSibling)}>
          <PlusIcon size={15} />
          <span>新增同级任务</span>
        </button>
        <button type="button" className="menu-item" onClick={run(onAddChild)}>
          <PlusIcon size={15} />
          <span>新增子任务</span>
        </button>
        <button type="button" className="menu-item" onClick={run(onRename)}>
          <span className="menu-icon-text">A</span>
          <span>重命名</span>
        </button>
        {hasChildren && (
          <button type="button" className="menu-item" onClick={run(onToggleCollapse)}>
            <ChevronIcon size={15} className={task.collapsed ? '' : 'menu-chevron-open'} />
            <span>{task.collapsed ? '展开子任务' : '折叠子任务'}</span>
            <span className="menu-hint">{childCount}</span>
          </button>
        )}

        <div className="menu-separator" />

        <button
          type="button"
          className={`menu-item ${statusOpen ? 'is-open' : ''}`}
          onClick={() => setStatusOpen((v) => !v)}
        >
          <StatusIcon status={task.status} size={15} />
          <span>修改状态</span>
          <ChevronIcon size={13} className="menu-sub-chevron" />
        </button>
        {statusOpen && (
          <div className="submenu">
            {STATUS_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                className={`menu-item sub-item ${status === task.status ? 'is-active' : ''}`}
                onClick={run(() => onSetStatus(status))}
              >
                <StatusIcon status={status} size={15} />
                <span>{STATUS_META[status].label}</span>
                {status === task.status && <CheckIcon size={13} className="menu-check" />}
              </button>
            ))}
          </div>
        )}

        <div className="menu-separator" />

        <button type="button" className="menu-item is-danger" onClick={run(onDelete)}>
          <TrashIcon size={15} />
          <span>删除任务</span>
        </button>
      </div>
    </div>
  );
}
