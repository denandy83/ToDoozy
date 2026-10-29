import { useSemanticColor } from '../hooks/useSemanticColor'
import { Minus, Circle, ArrowUp, AlertTriangle } from 'lucide-react'
import { PRIORITY_LEVELS } from './PriorityIndicator'

interface PriorityBadgeProps {
  priority: number
  showIcon?: boolean
  showLabel?: boolean
}

const PRIORITY_ICONS: Record<number, typeof Circle> = {
  1: Minus,
  2: Circle,
  3: ArrowUp,
  4: AlertTriangle
}

export function PriorityBadge({ priority, showIcon = true, showLabel = true }: PriorityBadgeProps): React.JSX.Element | null {
  const level = PRIORITY_LEVELS[priority]
  const appearance = useSemanticColor(level?.color ?? '#888888')
  if (priority === 0) return null
  if (!showIcon && !showLabel) return null

  if (!level) return null

  const Icon = PRIORITY_ICONS[priority] ?? Circle

  return (
    <span
      className="inline-flex flex-shrink-0 items-center gap-0.5 rounded px-1 py-0.5 ui-metadata"
      style={{ color: appearance.text, backgroundColor: `${level.color}15` }}
    >
      {showIcon && <Icon size={10} />}
      {showLabel && <span>{level.label}</span>}
    </span>
  )
}
