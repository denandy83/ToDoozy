import { Minus, ArrowUp, AlertTriangle } from 'lucide-react'
import { PRIORITY_LEVELS } from './PriorityIndicator'

interface PriorityBadgeProps {
  priority: number
}

export function PriorityBadge({ priority }: PriorityBadgeProps): React.JSX.Element | null {
  if (priority === 0 || priority === 2) return null

  const level = PRIORITY_LEVELS[priority]
  if (!level) return null

  const Icon = priority === 1 ? Minus : priority === 3 ? ArrowUp : AlertTriangle
  const showLabel = priority >= 3

  return (
    <span
      className="inline-flex flex-shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider"
      style={{ color: level.color, backgroundColor: `${level.color}15` }}
    >
      <Icon size={10} />
      {showLabel && <span>{level.label}</span>}
    </span>
  )
}
