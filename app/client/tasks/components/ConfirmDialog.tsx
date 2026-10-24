import { useEffect } from 'react'
import type { ReactNode } from 'react'

interface ConfirmDialogProps {
  title: string
  message: ReactNode
  confirmText?: string
  cancelText?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel, onConfirm])

  return (
    <div className="overlay overlay-center" onMouseDown={onCancel}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <h2 className="dialog-title">{title}</h2>
        <div className="dialog-body">{message}</div>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
