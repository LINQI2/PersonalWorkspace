import { CloseIcon, PlusIcon, SearchIcon, UndoIcon } from './Icons';

interface TopBarProps {
  query: string;
  onQueryChange: (value: string) => void;
  resultCount: number;
  searching: boolean;
  canUndo: boolean;
  busy: boolean;
  onUndo: () => void;
  onNewTask: () => void;
}

/** 任务台模块工具条：只保留搜索、撤销和新建，品牌与全局导航由统一外壳提供。 */
export default function TopBar({
  query,
  onQueryChange,
  resultCount,
  searching,
  canUndo,
  busy,
  onUndo,
  onNewTask,
}: TopBarProps) {
  return (
    <header className="topbar module-toolbar">
      <div className={`search-box ${searching ? 'is-active' : ''}`}>
        <SearchIcon size={15} className="search-icon" />
        <input
          type="text"
          value={query}
          placeholder="搜索任务或备注…"
          aria-label="搜索任务"
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {query && (
          <button
            type="button"
            className="search-clear"
            title="清除搜索"
            onClick={() => onQueryChange('')}
          >
            <CloseIcon size={13} />
          </button>
        )}
        {searching && <span className="search-result-badge">{resultCount} 个结果</span>}
      </div>

      <div className="topbar-actions">
        <span className="toolbar-hint">右键任务查看更多操作，拖动可调整顺序与层级</span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onUndo}
          disabled={!canUndo || busy}
          title="撤销上一步操作"
        >
          <UndoIcon size={15} />
          撤销
        </button>
        <button type="button" className="btn btn-primary" onClick={onNewTask} disabled={busy}>
          <PlusIcon size={15} />
          新建任务
        </button>
      </div>
    </header>
  );
}
