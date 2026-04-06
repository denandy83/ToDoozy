import { useEffect } from 'react'
import type { SharedTask, SharedStatus } from '../types'
import { PriorityBadge } from './PriorityBadge'
import { StatusBadge } from './StatusBadge'
import { formatDueDate, isOverdue, formatDateTime } from '../lib/dates'
import { getTelegramWebApp } from '../lib/telegram'

interface TaskDetailProps {
  task: SharedTask
  status: SharedStatus | undefined
  subtasks: SharedTask[]
  statuses: SharedStatus[]
  onBack: () => void
}

export function TaskDetail({ task, status, subtasks, statuses, onBack }: TaskDetailProps) {
  const labels: string[] = task.label_names ? JSON.parse(task.label_names) : []
  const overdue = task.due_date ? isOverdue(task.due_date) : false
  const isDone = status?.is_done === 1
  const statusMap = new Map(statuses.map(s => [s.id, s]))

  // Telegram back button
  useEffect(() => {
    const wa = getTelegramWebApp()
    if (wa) {
      wa.BackButton.show()
      wa.BackButton.onClick(onBack)
      return () => {
        wa.BackButton.offClick(onBack)
        wa.BackButton.hide()
      }
    }
  }, [onBack])

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--tg-theme-bg-color)' }}>
      {/* Header */}
      <div className="px-4 pt-4 pb-3">
        {/* Non-Telegram back button fallback */}
        <button
          onClick={onBack}
          className="mb-3 text-xs font-bold uppercase tracking-widest flex items-center gap-1"
          style={{ color: 'var(--tg-theme-link-color)' }}
        >
          ← Back
        </button>

        {/* Title */}
        <h1
          className="text-xl font-light tracking-tight leading-snug"
          style={{
            textDecoration: isDone ? 'line-through' : 'none',
            opacity: isDone ? 0.6 : 1
          }}
        >
          {task.title}
        </h1>

        {/* Badges */}
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <StatusBadge status={status} />
          <PriorityBadge priority={task.priority} />
          {task.due_date && (
            <span
              className="text-[10px] font-bold uppercase tracking-widest"
              style={{ color: overdue ? '#ef4444' : 'var(--tg-theme-hint-color)' }}
            >
              {overdue ? '⚠ ' : '📅 '}{formatDueDate(task.due_date)}
            </span>
          )}
        </div>

        {/* Labels */}
        {labels.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {labels.map(label => (
              <span
                key={label}
                className="text-[9px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
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

      {/* Divider */}
      <div className="h-px mx-4" style={{ backgroundColor: 'var(--tg-theme-secondary-bg-color)' }} />

      {/* Description */}
      {task.description && (
        <div className="px-4 py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] mb-2" style={{ color: 'var(--tg-theme-hint-color)' }}>
            Description
          </p>
          <div
            className="text-sm font-light leading-relaxed whitespace-pre-wrap"
            style={{ color: 'var(--tg-theme-text-color)', opacity: 0.85 }}
          >
            {task.description}
          </div>
        </div>
      )}

      {/* Subtasks */}
      {subtasks.length > 0 && (
        <div className="px-4 py-4">
          <p className="text-[10px] font-bold uppercase tracking-[0.3em] mb-2" style={{ color: 'var(--tg-theme-hint-color)' }}>
            Subtasks ({subtasks.filter(st => statusMap.get(st.status_id)?.is_done === 1).length}/{subtasks.length})
          </p>
          <div className="space-y-2">
            {subtasks.map(subtask => {
              const subStatus = statusMap.get(subtask.status_id)
              const subDone = subStatus?.is_done === 1
              return (
                <div key={subtask.id} className="flex items-center gap-2.5">
                  <div
                    className="w-3.5 h-3.5 rounded-full border-[1.5px] shrink-0 flex items-center justify-center"
                    style={{
                      borderColor: subStatus?.color ?? 'var(--tg-theme-hint-color)',
                      backgroundColor: subDone ? subStatus?.color : 'transparent'
                    }}
                  >
                    {subDone && (
                      <svg width="7" height="7" viewBox="0 0 8 8" fill="none">
                        <path d="M1.5 4L3.2 5.7L6.5 2.3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  <span
                    className="text-sm font-light"
                    style={{
                      textDecoration: subDone ? 'line-through' : 'none',
                      opacity: subDone ? 0.5 : 1
                    }}
                  >
                    {subtask.title}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="px-4 py-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.3em] mb-2" style={{ color: 'var(--tg-theme-hint-color)' }}>
          Details
        </p>
        <div className="space-y-2">
          {task.recurrence_rule && (
            <MetaRow label="Recurrence" value={task.recurrence_rule} />
          )}
          {task.reference_url && (
            <MetaRow label="Reference" value={task.reference_url} isLink />
          )}
          <MetaRow label="Created" value={formatDateTime(task.created_at)} />
          {task.completed_date && (
            <MetaRow label="Completed" value={formatDateTime(task.completed_date)} />
          )}
        </div>
      </div>
    </div>
  )
}

function MetaRow({ label, value, isLink }: { label: string; value: string; isLink?: boolean }) {
  return (
    <div className="flex items-baseline gap-3">
      <span className="text-[10px] font-bold uppercase tracking-widest shrink-0 w-20" style={{ color: 'var(--tg-theme-hint-color)' }}>
        {label}
      </span>
      {isLink ? (
        <a
          href={value}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-light truncate"
          style={{ color: 'var(--tg-theme-link-color)' }}
        >
          {value}
        </a>
      ) : (
        <span className="text-xs font-light" style={{ opacity: 0.85 }}>
          {value}
        </span>
      )}
    </div>
  )
}
