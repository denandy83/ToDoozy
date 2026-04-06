import type { SharedStatus } from '../types'

interface StatusBadgeProps {
  status: SharedStatus | undefined
}

export function StatusBadge({ status }: StatusBadgeProps) {
  if (!status) return null

  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded flex items-center gap-1"
      style={{ backgroundColor: status.color + '20', color: status.color }}
    >
      {status.is_done ? '✓ ' : ''}{status.name}
    </span>
  )
}
