import { useEffect } from 'react'
import { CloseIcon } from './Icons'

export interface ToastData {
  id: number
  message: string
  tone?: 'default' | 'error'
  actionLabel?: string
  onAction?: () => void
}

interface ToastProps {
  toast: ToastData
  onClose: () => void
}

export default function Toast({ toast, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, toast.actionLabel ? 8000 : 4000)
    return () => clearTimeout(timer)
  }, [toast.id, toast.actionLabel, onClose])

  return (
    <div className={`toast ${toast.tone === 'error' ? 'is-error' : ''}`} role="status">
      <span className="toast-message">{toast.message}</span>
      {toast.actionLabel && (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            onClose()
            toast.onAction?.()
          }}
        >
          {toast.actionLabel}
        </button>
      )}
      <button type="button" className="toast-close" onClick={onClose} aria-label="关闭提示">
        <CloseIcon size={12} />
      </button>
    </div>
  )
}
