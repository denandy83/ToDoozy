import type { Task, Status } from '../../../../shared/types'

interface TaskDragOverlayProps {
  task: Task
  statuses: Status[]
}

export function TaskDragOverlay({ task, statuses }: TaskDragOverlayProps): React.JSX.Element {
  const status = statuses.find((s) => s.id === task.status_id)
  const isDone = status?.is_done === 1

  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-accent/20 bg-surface px-4 py-2 shadow-lg"
      style={{ opacity: 0.8, width: 'max-content', maxWidth: '400px' }}
    >
      {/* Status dot */}
      <div
        className="h-2.5 w-2.5 flex-shrink-0 rounded-full border-2"
        style={{
          borderColor: status?.color || 'var(--color-muted)',
          backgroundColor: isDone ? status?.color || 'var(--color-muted)' : 'transparent'
        }}
      />

      <span
        className={`truncate text-[15px] font-light tracking-tight ${
          isDone ? 'text-muted line-through' : 'text-foreground'
        }`}
      >
        {task.title}
      </span>
    </div>
  )
}
