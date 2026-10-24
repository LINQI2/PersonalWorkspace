import { useEffect, useState } from 'react'
import { FolderIcon } from './Icons'
import { STATUS_META, STATUS_ORDER } from '../types'
import type { AppInfo } from '../types'

interface DataInfoDialogProps {
  info: AppInfo | null
  onClose: () => void
}

export default function DataInfoDialog({ info, onClose }: DataInfoDialogProps) {
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(value)
      setTimeout(() => setCopied(null), 1800)
    } catch {
      setCopied(null)
    }
  }

  const rows: Array<{ label: string; value: string }> = info
    ? [
        { label: '数据目录', value: info.dataDir },
        { label: '数据库文件', value: info.dbFile },
        { label: '备份目录', value: info.backupDir },
      ]
    : []

  return (
    <div className="overlay overlay-center" onMouseDown={onClose}>
      <div className="dialog dialog-wide" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="dialog-title">数据与备份</h2>
        <div className="dialog-body">
          <p className="dialog-text">
            所有任务保存在本机 SQLite 数据库中，不联网、不上传。关闭浏览器或重启电脑后数据仍会保留。
          </p>

          <div className="path-list">
            {rows.map((row) => (
              <div className="path-row" key={row.label}>
                <div className="path-row-label">
                  <FolderIcon size={14} />
                  {row.label}
                </div>
                <div className="path-row-value">
                  <code>{row.value}</code>
                  <button type="button" className="btn btn-mini" onClick={() => copy(row.value)}>
                    {copied === row.value ? '已复制' : '复制'}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {info && (
            <div className="info-stats">
              <div className="info-stat">
                <span className="info-stat-value">{info.stats.total}</span>
                <span className="info-stat-label">任务总数</span>
              </div>
              {STATUS_ORDER.map((status) => (
                <div className="info-stat" key={status}>
                  <span className="info-stat-value" style={{ color: STATUS_META[status].color }}>
                    {info.stats.byStatus[status] ?? 0}
                  </span>
                  <span className="info-stat-label">{STATUS_META[status].label}</span>
                </div>
              ))}
            </div>
          )}

          <p className="dialog-hint">
            备份：顶部「备份 → 导出备份文件」可下载 JSON 备份；「立即创建本地快照」会在备份目录生成文件。
            恢复：选择备份 JSON 即可整体还原，恢复前的数据会自动另存为 pre-restore-*.json。
          </p>
        </div>
        <div className="dialog-actions">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            知道了
          </button>
        </div>
      </div>
    </div>
  )
}
