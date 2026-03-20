import { useCallback } from 'react'
import { Archive } from 'lucide-react'
import type { Status } from '../../../../shared/types'

interface DetailStatusRowProps {
  currentStatusId: string
  statuses: Status[]
  isArchived: boolean
  onStatusChange: (statusId: string) => void
  onToggleArchive: () => void
}

export function DetailStatusRow({
  currentStatusId,
  statuses,
  isArchived,
  onStatusChange,
  onToggleArchive
}: DetailStatusRowProps): React.JSX.Element {
  const defaultStatuses = statuses.filter((s) => s.is_default === 1)
  const middleStatuses = statuses.filter((s) => s.is_default !== 1 && s.is_done !== 1).sort((a, b) => a.order_index - b.order_index)
  const doneStatuses = statuses.filter((s) => s.is_done === 1)
  const sorted = [...defaultStatuses, ...middleStatuses, ...doneStatuses]

  return (
    <div className="flex flex-wrap items-center gap-1">
      {sorted.map((status) => (
        <StatusChip
          key={status.id}
          status={status}
          isActive={currentStatusId === status.id}
          onSelect={onStatusChange}
        />
      ))}
      <button
        onClick={onToggleArchive}
        className={`ml-1 flex items-center gap-1 rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
          isArchived
            ? 'bg-muted/20 text-foreground'
            : 'text-muted hover:bg-foreground/6'
        }`}
        title={isArchived ? 'Unarchive' : 'Archive'}
        aria-label={isArchived ? 'Unarchive' : 'Archive'}
        aria-pressed={isArchived}
      >
        <Archive size={12} />
        Archive
      </button>
    </div>
  )
}

interface StatusChipProps {
  status: Status
  isActive: boolean
  onSelect: (statusId: string) => void
}

function StatusChip({ status, isActive, onSelect }: StatusChipProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(status.id)
  }, [status.id, onSelect])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(status.id)
      }
    },
    [status.id, onSelect]
  )

  return (
    <button
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
        isActive ? 'text-accent-fg' : 'text-muted hover:bg-foreground/6'
      }`}
      style={isActive ? { backgroundColor: status.color } : undefined}
      role="radio"
      aria-checked={isActive}
      aria-label={status.name}
    >
      {status.name}
    </button>
  )
}
