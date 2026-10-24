import type { SVGProps } from 'react'
import type { TaskStatus } from '../types'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

const base = ({ size = 16, ...props }: IconProps) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  ...props,
})

export const ChevronIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 6l6 6-6 6" />
  </svg>
)

export const PlusIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const SearchIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </svg>
)

export const UndoIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h9a6 6 0 010 12h-3" />
  </svg>
)

export const DotsIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth={2.4}>
    <circle cx="5" cy="12" r="0.6" fill="currentColor" />
    <circle cx="12" cy="12" r="0.6" fill="currentColor" />
    <circle cx="19" cy="12" r="0.6" fill="currentColor" />
  </svg>
)

export const NoteIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 3.5h8l4 4V20a.5.5 0 01-.5.5h-11A.5.5 0 016 20V3.5z" />
    <path d="M14 3.5V8h4" />
  </svg>
)

export const CloseIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const TrashIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M4 7h16M10 4h4M6 7l1 13h10l1-13" />
    <path d="M10 11v6M14 11v6" />
  </svg>
)

export const DownloadIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 4v10M8 10l4 4 4-4" />
    <path d="M5 19h14" />
  </svg>
)

export const UploadIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 15V5M8 9l4-4 4 4" />
    <path d="M5 19h14" />
  </svg>
)

export const CameraIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3.5 8.5h3l1.5-2h8l1.5 2h3v10h-17z" />
    <circle cx="12" cy="13.5" r="3.2" />
  </svg>
)

export const InfoIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.6v.4" />
  </svg>
)

export const FolderIcon = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M3.5 6.5h6l2 2.2h9V19h-17z" />
  </svg>
)

export const CheckIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth={2.6}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
)

export const GripIcon = (props: IconProps) => (
  <svg {...base(props)} strokeWidth={2}>
    <circle cx="9" cy="7" r="0.7" fill="currentColor" />
    <circle cx="15" cy="7" r="0.7" fill="currentColor" />
    <circle cx="9" cy="12" r="0.7" fill="currentColor" />
    <circle cx="15" cy="12" r="0.7" fill="currentColor" />
    <circle cx="9" cy="17" r="0.7" fill="currentColor" />
    <circle cx="15" cy="17" r="0.7" fill="currentColor" />
  </svg>
)

export const StatusIcon = ({ status, size = 16, ...props }: IconProps & { status: TaskStatus }) => {
  if (status === 'done') {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" {...props}>
        <circle cx="10" cy="10" r="8.6" fill="#22c55e" />
        <path d="M6 10.4l2.6 2.6L14.2 7.4" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (status === 'doing') {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" {...props}>
        <circle cx="10" cy="10" r="8.6" stroke="#3b82f6" strokeWidth="1.8" />
        <circle cx="10" cy="10" r="4" fill="#3b82f6" />
      </svg>
    )
  }
  if (status === 'paused') {
    return (
      <svg width={size} height={size} viewBox="0 0 20 20" fill="none" {...props}>
        <circle cx="10" cy="10" r="8.6" fill="#fef3c7" stroke="#f59e0b" strokeWidth="1.6" />
        <path d="M8 6.6v6.8M12 6.6v6.8" stroke="#b45309" strokeWidth="1.9" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" {...props}>
      <circle cx="10" cy="10" r="8.6" stroke="#b6c0cf" strokeWidth="1.8" />
    </svg>
  )
}

export const BrandMark = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <rect width="32" height="32" rx="9" fill="url(#brand-gradient)" />
    <path d="M9 16.5l4.5 4.5L23 11.5" stroke="white" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    <defs>
      <linearGradient id="brand-gradient" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
        <stop stopColor="#6366f1" />
        <stop offset="1" stopColor="#4338ca" />
      </linearGradient>
    </defs>
  </svg>
)
