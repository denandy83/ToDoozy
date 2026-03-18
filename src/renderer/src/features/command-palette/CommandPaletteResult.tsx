import { useCallback } from 'react'
import { Calendar } from 'lucide-react'
import type { Task } from '../../../../shared/types'
import { useStatusStore } from '../../shared/stores/statusStore'
import { useTaskStore } from '../../shared/stores/taskStore'

const PRIORITY_COLORS: Record<number, string> = {
  0: '#888888',
  1: '#22c55e',
  2: '#3b82f6',
  3: '#f59e0b',
  4: '#ef4444'
}

const PRIORITY_LABELS: Record<number, string> = {
  0: '',
  1: 'Low',
  2: 'Normal',
  3: 'High',
  4: 'Urgent'
}

interface CommandPaletteResultProps {
  task: Task
  isSelected: boolean
  onSelect: (taskId: string) => void
  onHover: () => void
}

export function CommandPaletteResult({
  task,
  isSelected,
  onSelect,
  onHover
}: CommandPaletteResultProps): React.JSX.Element {
  const status = useStatusStore((s) => s.statuses[task.status_id])
  const taskLabels = useTaskStore((s) => s.taskLabels[task.id] ?? [])

  const handleClick = useCallback(() => {
    onSelect(task.id)
  }, [task.id, onSelect])

  const priorityColor = PRIORITY_COLORS[task.priority] ?? '#888888'
  const priorityLabel = PRIORITY_LABELS[task.priority] ?? ''

  const formattedDue = task.due_date ? formatDueDate(task.due_date) : null
  const isOverdue = task.due_date ? new Date(task.due_date) < new Date(new Date().toISOString().split('T')[0]) : false

  return (
    <div
      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors ${
        isSelected
          ? 'bg-accent/12 border border-accent/15'
          : 'border border-transparent hover:bg-foreground/6'
      }`}
      onClick={handleClick}
      onMouseEnter={onHover}
      role="option"
      aria-selected={isSelected}
    >
      {/* Priority dot */}
      <div
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: priorityColor }}
        title={priorityLabel || 'No priority'}
      />

      {/* Priority badge */}
      {task.priority > 0 && (
        <span
          className="shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white"
          style={{ backgroundColor: priorityColor }}
        >
          {priorityLabel}
        </span>
      )}

      {/* Title */}
      <span className="min-w-0 flex-1 truncate text-[15px] font-light tracking-tight text-foreground">
        {task.title}
      </span>

      {/* Labels */}
      {taskLabels.length > 0 && (
        <div className="flex shrink-0 items-center gap-1">
          {taskLabels.slice(0, 2).map((label) => (
            <span
              key={label.id}
              className="rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
              style={{
                backgroundColor: `${label.color}20`,
                color: label.color,
                border: `1px solid ${label.color}30`
              }}
            >
              {label.name}
            </span>
          ))}
          {taskLabels.length > 2 && (
            <span className="text-[9px] font-bold text-muted">+{taskLabels.length - 2}</span>
          )}
        </div>
      )}

      {/* Status */}
      {status && (
        <span
          className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
          style={{
            backgroundColor: `${status.color}20`,
            color: status.color
          }}
        >
          {status.name}
        </span>
      )}

      {/* Due date */}
      {formattedDue && (
        <span
          className={`flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-widest ${
            isOverdue ? 'text-red-500' : 'text-muted'
          }`}
        >
          <Calendar size={10} />
          {formattedDue}
        </span>
      )}
    </div>
  )
}

function formatDueDate(dateStr: string): string {
  const date = new Date(dateStr)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const dateOnly = new Date(date)
  dateOnly.setHours(0, 0, 0, 0)

  if (dateOnly.getTime() === today.getTime()) return 'Today'
  if (dateOnly.getTime() === tomorrow.getTime()) return 'Tomorrow'

  const diff = dateOnly.getTime() - today.getTime()
  const days = Math.round(diff / (1000 * 60 * 60 * 24))
  if (days < 0) return `${Math.abs(days)}d ago`
  if (days <= 7) return `${days}d`

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
