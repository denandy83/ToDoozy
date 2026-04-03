import { useDroppable, useDndContext } from '@dnd-kit/core'
import { useMemo } from 'react'
import { Ban } from 'lucide-react'
import type { Task, Status } from '../../../../shared/types'
import { useTaskStore, useStatusStore } from '../../shared/stores'
import { findProjectStatusForBucket } from '../views/myDayBuckets'
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
  const { active } = useDndContext()
  const allTasks = useTaskStore((s) => s.tasks)
  const allStatusMap = useStatusStore((s) => s.statuses)

  // Check if this is the In Progress bucket column and the dragged task's project has no in-progress status
  const isDropBlocked = useMemo(() => {
    if (!status.id.startsWith('__bucket_in_progress') || !active?.id) return false
    const task = allTasks[String(active.id)]
    if (!task) return false
    return !findProjectStatusForBucket(task.project_id, 'in_progress', allStatusMap)
  }, [status.id, active?.id, allTasks, allStatusMap])

  const { setNodeRef, isOver } = useDroppable({
    id: `kanban-column-${status.id}`,
    data: { type: 'kanban-column', statusId: status.id }
  })

  return (
    <div
      className="flex min-w-[260px] max-w-[320px] flex-1 flex-col"
    >
      {/* Column header */}
      <div className="flex items-center justify-center gap-2 px-3 py-2">
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
          isOver && !isDropBlocked ? 'bg-accent/10' : ''
        } ${isOver && isDropBlocked ? 'bg-danger/5' : ''}`}
      >
        {isOver && isDropBlocked && (
          <div className="flex items-center justify-center gap-1 py-2 text-danger/60">
            <Ban size={14} strokeWidth={1.5} />
            <span className="text-[9px] font-bold uppercase tracking-wider">No in-progress status</span>
          </div>
        )}
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

        {tasks.length === 0 && !(isOver && isDropBlocked) && (
          <p className="py-3 text-center text-[10px] font-bold uppercase tracking-widest text-muted/40">
            No tasks
          </p>
        )}
      </div>
    </div>
  )
}
