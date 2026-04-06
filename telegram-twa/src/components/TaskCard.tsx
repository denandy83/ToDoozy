import type { SharedTask, SharedStatus } from '../types'
import { PriorityBadge } from './PriorityBadge'
import { StatusBadge } from './StatusBadge'
import { formatDueDate, isOverdue } from '../lib/dates'

interface TaskCardProps {
  task: SharedTask
  status: SharedStatus | undefined
  onSelect: (task: SharedTask) => void
}

export function TaskCard({ task, status, onSelect }: TaskCardProps) {
  const labels: string[] = task.label_names ? JSON.parse(task.label_names) : []
  const overdue = task.due_date ? isOverdue(task.due_date) : false
  const isDone = status?.is_done === 1

  return (
    <button
      onClick={() => onSelect(task)}
      className="w-full text-left px-4 py-3 border-b active:opacity-70"
      style={{ borderColor: 'var(--tg-theme-secondary-bg-color)' }}
    >
      <div className="flex items-start gap-3">
        {/* Completion indicator */}
        <div
          className="mt-1 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center"
          style={{
            borderColor: status?.color ?? 'var(--tg-theme-hint-color)',
            backgroundColor: isDone ? status?.color : 'transparent'
          }}
        >
          {isDone && (
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
              <path d="M1.5 4L3.2 5.7L6.5 2.3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title */}
          <p
            className="text-[15px] font-light tracking-tight leading-snug"
            style={{
              textDecoration: isDone ? 'line-through' : 'none',
              opacity: isDone ? 0.5 : 1
            }}
          >
            {task.title}
          </p>

          {/* Metadata row */}
          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
            <StatusBadge status={status} />
            <PriorityBadge priority={task.priority} />

            {task.due_date && (
              <span
                className="text-[10px] font-bold uppercase tracking-widest"
                style={{ color: overdue ? '#ef4444' : 'var(--tg-theme-hint-color)' }}
              >
                {overdue ? '⚠ ' : ''}{formatDueDate(task.due_date)}
              </span>
            )}

            {task.assigned_to && (
              <span
                className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'var(--tg-theme-secondary-bg-color)', color: 'var(--tg-theme-hint-color)' }}
              >
                Assigned
              </span>
            )}
          </div>

          {/* Labels */}
          {labels.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {labels.map(label => (
                <span
                  key={label}
                  className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: 'var(--tg-theme-secondary-bg-color)',
                    color: 'var(--tg-theme-hint-color)'
                  }}
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
