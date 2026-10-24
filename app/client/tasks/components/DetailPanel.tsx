import { useCallback, useEffect, useRef, useState } from 'react';
import { CloseIcon, PlusIcon, StatusIcon, TrashIcon } from './Icons';
import { STATUS_META, STATUS_ORDER } from '../types';
import type { Task, TaskStatus } from '../types';

interface PathItem {
  id: string;
  title: string;
}

interface DetailPanelProps {
  task: Task;
  path: PathItem[];
  childCount: number;
  descendantCount: number;
  onClose: () => void;
  onRename: (id: string, title: string) => void;
  onStatus: (id: string, status: TaskStatus) => void;
  onNote: (id: string, note: string) => Promise<void>;
  onAddChild: (id: string) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
}

const formatTime = (iso: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function DetailPanel({
  task,
  path,
  childCount,
  descendantCount,
  onClose,
  onRename,
  onStatus,
  onNote,
  onAddChild,
  onDelete,
  onSelect,
}: DetailPanelProps) {
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [noteDraft, setNoteDraft] = useState(task.note);
  const [noteState, setNoteState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [titleError, setTitleError] = useState(false);

  const activeIdRef = useRef(task.id);
  const savedNoteRef = useRef(task.note);
  const noteDraftRef = useRef(task.note);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);

  noteDraftRef.current = noteDraft;

  const flushNote = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const id = activeIdRef.current;
    const value = noteDraftRef.current;
    if (value === savedNoteRef.current) return;
    savedNoteRef.current = value;
    setNoteState('saving');
    onNote(id, value)
      .then(() => setNoteState('saved'))
      .catch(() => setNoteState('idle'));
  }, [onNote]);

  // 切换任务：先保存上一个任务的备注，再同步当前任务内容
  useEffect(() => {
    if (activeIdRef.current === task.id) return;
    flushNote();
    activeIdRef.current = task.id;
    savedNoteRef.current = task.note;
    setTitleDraft(task.title);
    setNoteDraft(task.note);
    setNoteState('idle');
    setTitleError(false);
  }, [task.id, task.title, task.note, flushNote]);

  // 标题被外部修改（例如撤销）时同步显示
  useEffect(() => {
    if (task.id !== activeIdRef.current) return;
    if (document.activeElement === titleInputRef.current) return;
    setTitleDraft(task.title);
  }, [task.title, task.id]);

  // 备注被外部修改（例如撤销）时同步显示
  useEffect(() => {
    if (
      task.id === activeIdRef.current &&
      task.note !== savedNoteRef.current &&
      !timerRef.current
    ) {
      savedNoteRef.current = task.note;
      setNoteDraft(task.note);
    }
  }, [task.note, task.id]);

  useEffect(() => {
    return () => flushNote();
  }, [flushNote]);

  // 离开页面/切换视图时尽量把尚未提交的备注写入，不依赖组件卸载后的异步回调
  useEffect(() => {
    const onHide = () => flushNote();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [flushNote]);

  function scheduleNote(value: string) {
    setNoteDraft(value);
    setNoteState('idle');
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      flushNote();
    }, 500);
  }

  function commitTitle() {
    const value = titleDraft.trim();
    if (!value) {
      setTitleError(true);
      setTitleDraft(task.title);
      return;
    }
    setTitleError(false);
    if (value !== task.title) onRename(task.id, value);
  }

  const meta = STATUS_META[task.status];

  return (
    <aside className="detail-panel" aria-label="任务详情">
      <div className="detail-header">
        <span className="detail-eyebrow">任务详情</span>
        <button type="button" className="icon-btn detail-close" title="关闭详情" onClick={onClose}>
          <CloseIcon size={15} />
        </button>
      </div>

      <div className="detail-scroll">
        <input
          ref={titleInputRef}
          className={`detail-title ${titleError ? 'has-error' : ''}`}
          value={titleDraft}
          aria-label="任务名称"
          onChange={(e) => {
            setTitleDraft(e.target.value);
            setTitleError(false);
          }}
          onBlur={commitTitle}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              setTitleDraft(task.title);
              e.currentTarget.blur();
            }
          }}
        />

        <div className="detail-path">
          {path.length === 0 ? (
            <span className="path-empty">顶层任务</span>
          ) : (
            path.map((item, index) => (
              <span key={item.id} className="path-segment">
                {index > 0 && <span className="path-sep">/</span>}
                <button type="button" className="path-item" onClick={() => onSelect(item.id)}>
                  {item.title}
                </button>
              </span>
            ))
          )}
        </div>

        <div className="field">
          <div className="field-label">
            状态
            <span className="status-pill" style={{ color: meta.color, background: meta.tint }}>
              <StatusIcon status={task.status} size={13} />
              {meta.label}
            </span>
          </div>
          <div className="status-select" role="group" aria-label="修改任务状态">
            {STATUS_ORDER.map((status) => {
              const item = STATUS_META[status];
              const active = status === task.status;
              return (
                <button
                  key={status}
                  type="button"
                  className={`status-option ${active ? 'is-active' : ''}`}
                  style={
                    active
                      ? { borderColor: item.color, background: item.tint, color: '#1e293b' }
                      : undefined
                  }
                  onClick={() => onStatus(task.id, status)}
                >
                  <StatusIcon status={status} size={14} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field field-grow">
          <div className="field-label">
            <span>备注</span>
            <span className={`note-state ${noteState}`}>
              {noteState === 'saving'
                ? '保存中…'
                : noteState === 'saved'
                  ? '已保存'
                  : `${noteDraft.length} 字`}
            </span>
          </div>
          <textarea
            className="note-input"
            value={noteDraft}
            placeholder="补充说明、链接、下一步动作…（自动保存）"
            spellCheck={false}
            onChange={(e) => scheduleNote(e.target.value)}
            onBlur={flushNote}
          />
        </div>

        <div className="meta-list">
          <div className="meta-row">
            <span>子任务</span>
            <span>
              {childCount} 个
              {descendantCount > childCount ? ` · 全部下级 ${descendantCount} 个` : ''}
            </span>
          </div>
          <div className="meta-row">
            <span>创建时间</span>
            <span>{formatTime(task.createdAt)}</span>
          </div>
          <div className="meta-row">
            <span>最近更新</span>
            <span>{formatTime(task.updatedAt)}</span>
          </div>
        </div>

        <div className="detail-actions">
          <button type="button" className="btn" onClick={() => onAddChild(task.id)}>
            <PlusIcon size={15} />
            添加子任务
          </button>
          <button type="button" className="btn btn-ghost-danger" onClick={() => onDelete(task.id)}>
            <TrashIcon size={15} />
            删除
          </button>
        </div>
      </div>
    </aside>
  );
}
