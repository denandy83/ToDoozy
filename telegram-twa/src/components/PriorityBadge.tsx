import { PRIORITY_LABELS, PRIORITY_COLORS } from '../types'

interface PriorityBadgeProps {
  priority: number
}

export function PriorityBadge({ priority }: PriorityBadgeProps) {
  if (priority === 0) return null

  const label = PRIORITY_LABELS[priority] ?? 'Unknown'
  const color = PRIORITY_COLORS[priority] ?? '#888888'

  return (
    <span
      className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
      style={{ backgroundColor: color + '20', color }}
    >
      {label}
    </span>
  )
}
