import { useCallback, useMemo } from 'react'
import { Circle, CircleDot, CheckCircle2 } from 'lucide-react'
import type { Status } from '../../../../shared/types'

interface StatusButtonProps {
  currentStatusId: string
  statuses: Status[]
  onStatusChange: (newStatusId: string) => void
  size?: number
}

export function StatusButton({
  currentStatusId,
  statuses,
  onStatusChange,
  size = 16
}: StatusButtonProps): React.JSX.Element {
  const sorted = useMemo(() => [
    ...statuses.filter((s) => s.is_default === 1),
    ...statuses.filter((s) => s.is_default !== 1 && s.is_done !== 1).sort((a, b) => a.order_index - b.order_index),
    ...statuses.filter((s) => s.is_done === 1)
  ], [statuses]
  )

  const current = useMemo(
    () => sorted.find((s) => s.id === currentStatusId),
    [sorted, currentStatusId]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (sorted.length === 0) return
      const currentIndex = sorted.findIndex((s) => s.id === currentStatusId)
      const nextIndex = (currentIndex + 1) % sorted.length
      onStatusChange(sorted[nextIndex].id)
    },
    [sorted, currentStatusId, onStatusChange]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight') {
        e.preventDefault()
        e.stopPropagation()
        if (sorted.length === 0) return
        const currentIndex = sorted.findIndex((s) => s.id === currentStatusId)
        const nextIndex = (currentIndex + 1) % sorted.length
        onStatusChange(sorted[nextIndex].id)
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        if (sorted.length === 0) return
        const currentIndex = sorted.findIndex((s) => s.id === currentStatusId)
        const prevIndex = (currentIndex - 1 + sorted.length) % sorted.length
        onStatusChange(sorted[prevIndex].id)
      }
    },
    [sorted, currentStatusId, onStatusChange]
  )

  const isDone = current?.is_done === 1
  const isInProgress = current && !isDone && current.order_index > 0

  const Icon = isDone ? CheckCircle2 : isInProgress ? CircleDot : Circle
  const color = current?.color || '#888'

  return (
    <div className="group/status relative flex-shrink-0">
      <button
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className="rounded p-0.5 transition-colors hover:bg-foreground/6 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        aria-label={`Status: ${current?.name ?? 'Unknown'}. Click to cycle.`}
      >
        <Icon size={size} style={{ color }} strokeWidth={isDone ? 2.5 : 1.5} />
      </button>
      <div className="pointer-events-none absolute left-1/2 top-full mt-1.5 z-50 -translate-x-1/2 whitespace-nowrap rounded bg-surface px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted opacity-0 shadow-md ring-1 ring-border transition-opacity group-hover/status:opacity-100">
        {current?.name ?? 'Status'}
      </div>
    </div>
  )
}
