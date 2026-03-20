import { useDroppable } from '@dnd-kit/core'
import { SortableContext } from '@dnd-kit/sortable'
import { useMemo } from 'react'
import type { Task, Status } from '../../../../shared/types'
import { KanbanCard } from './KanbanCard'
import type { DropIndicator } from './useDragAndDrop'

interface KanbanColumnProps {
  status: Status
  tasks: Task[]
  allStatuses: Status[]
  selectedTaskIds: Set<string>
  taskFilterOpacity?: Record<string, number>
  dropIndicator?: DropIndicator | null
  onSelectTask: (taskId: string, e: React.MouseEvent) => void
  onStatusChange: (taskId: string, newStatusId: string) => void
  onDeleteTask: (taskId: string) => void
}

export function KanbanColumn({
  status,
  tasks,
  allStatuses,
  selectedTaskIds,
  taskFilterOpacity,
  dropIndicator,
  onSelectTask,
  onStatusChange,
  onDeleteTask
}: KanbanColumnProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `kanban-column-${status.id}`,
    data: { type: 'kanban-column', statusId: status.id }
  })

  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks])

  return (
    <div
      className="flex min-w-[260px] max-w-[320px] flex-1 flex-col"
    >
      {/* Column header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div
          className="h-2 w-2 flex-shrink-0 rounded-full"
          style={{ backgroundColor: status.color || 'var(--color-muted)' }}
        />
        <span
          className="text-[10px] font-bold uppercase tracking-[0.3em]"
          style={{ color: status.color || undefined }}
        >
          {status.name}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
          {tasks.length}
        </span>
      </div>

      {/* Cards container */}
      <div
        ref={setNodeRef}
        className={`flex flex-1 flex-col gap-2 overflow-y-auto rounded-lg p-2 transition-colors motion-safe:duration-150 ${
          isOver ? 'bg-accent/10' : ''
        }`}
      >
        <SortableContext items={taskIds}>
          {tasks.map((task) => (
            <KanbanCard
              key={task.id}
              task={task}
              statuses={allStatuses}
              isSelected={selectedTaskIds.has(task.id)}
              filterOpacity={taskFilterOpacity?.[task.id]}
              dropIndicator={dropIndicator}
              onSelect={onSelectTask}
              onStatusChange={onStatusChange}
              onDeleteTask={onDeleteTask}
            />
          ))}
        </SortableContext>

        {tasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-8">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted/40">
              No tasks
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
