import type { Task, Status } from '../../../../shared/types'

interface TaskDragOverlayProps {
  task: Task
  statuses: Status[]
  count?: number
}

export function TaskDragOverlay({ task, statuses, count = 1 }: TaskDragOverlayProps): React.JSX.Element {
  const status = statuses.find((s) => s.id === task.status_id)
  const isDone = status?.is_done === 1
  const isMulti = count > 1

  return (
    <div className="relative" style={{ width: 'max-content', maxWidth: '400px' }}>
      {/* Stack shadow layers behind */}
      {isMulti && (
        <>
          <div
            className="absolute rounded-lg border border-accent/10 bg-surface"
            style={{ inset: 0, transform: 'translate(6px, 6px)', opacity: 0.5 }}
          />
          <div
            className="absolute rounded-lg border border-accent/10 bg-surface"
            style={{ inset: 0, transform: 'translate(3px, 3px)', opacity: 0.7 }}
          />
        </>
      )}

      {/* Main card */}
      <div
        className="relative flex items-center gap-2 rounded-lg border border-accent/20 bg-surface px-4 py-2 shadow-lg"
        style={{ opacity: 0.9 }}
      >
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

        {/* Count badge */}
        {isMulti && (
          <span className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[9px] font-bold uppercase tracking-wider text-accent-fg">
            {count}
          </span>
        )}
      </div>
    </div>
  )
}
