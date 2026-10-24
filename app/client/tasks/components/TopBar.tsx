import { useEffect, useRef, useState } from 'react'
import { BrandMark, CameraIcon, CloseIcon, DownloadIcon, InfoIcon, PlusIcon, SearchIcon, UndoIcon, UploadIcon } from './Icons'

interface TopBarProps {
  query: string
  onQueryChange: (value: string) => void
  resultCount: number
  searching: boolean
  canUndo: boolean
  busy: boolean
  onUndo: () => void
  onNewTask: () => void
  onExport: () => void
  onSnapshot: () => void
  onRestoreFile: (file: File) => void
  onShowInfo: () => void
}

export default function TopBar({
  query,
  onQueryChange,
  resultCount,
  searching,
  canUndo,
  busy,
  onUndo,
  onNewTask,
  onExport,
  onSnapshot,
  onRestoreFile,
  onShowInfo,
}: TopBarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark size={30} />
        <div className="brand-text">
          <span className="brand-name">个人任务台</span>
          <span className="brand-sub">PersonalTaskHub</span>
        </div>
      </div>

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
          <button type="button" className="search-clear" title="清除搜索" onClick={() => onQueryChange('')}>
            <CloseIcon size={13} />
          </button>
        )}
        {searching && <span className="search-result-badge">{resultCount} 个结果</span>}
      </div>

      <div className="topbar-actions">
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

        <div className="dropdown" ref={menuRef}>
          <button
            type="button"
            className={`btn btn-ghost ${menuOpen ? 'is-open' : ''}`}
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <DownloadIcon size={15} />
            备份
          </button>
          {menuOpen && (
            <div className="dropdown-menu" role="menu">
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  onExport()
                }}
              >
                <DownloadIcon size={15} />
                <span>导出备份文件</span>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  onSnapshot()
                }}
              >
                <CameraIcon size={15} />
                <span>立即创建本地快照</span>
              </button>
              <div className="menu-separator" />
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  fileRef.current?.click()
                }}
              >
                <UploadIcon size={15} />
                <span>从备份文件恢复…</span>
              </button>
              <div className="menu-separator" />
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  onShowInfo()
                }}
              >
                <InfoIcon size={15} />
                <span>数据与备份位置</span>
              </button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) onRestoreFile(file)
              e.target.value = ''
            }}
          />
        </div>

        <button type="button" className="btn btn-primary" onClick={onNewTask} disabled={busy}>
          <PlusIcon size={15} />
          新建任务
        </button>
      </div>
    </header>
  )
}
