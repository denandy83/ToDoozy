import { useMemo, useEffect, useRef } from 'react'
import { usePrioritySettings } from '../../shared/hooks/usePrioritySettings'
import { useTaskStore } from '../../shared/stores'
import type { Task, Status } from '../../../../shared/types'
import { KanbanColumn } from './KanbanColumn'
import type { DropIndicator } from './useDragAndDrop'

interface KanbanViewProps {
  tasks: Task[]
  statuses: Status[]
  selectedTaskIds: Set<string>
  taskFilterOpacity?: Record<string, number>
  dropIndicator?: DropIndicator | null
  onSelectTask: (taskId: string, e: React.MouseEvent) => void
  onStatusChange: (taskId: string, newStatusId: string) => void
  onDeleteTask: (taskId: string) => void
}

export function KanbanView({
  tasks,
  statuses,
  selectedTaskIds,
  taskFilterOpacity,
  dropIndicator,
  onSelectTask,
  onStatusChange,
  onDeleteTask
}: KanbanViewProps): React.JSX.Element {
  const { autoSort: priorityAutoSort } = usePrioritySettings()
  const { setCurrentTask } = useTaskStore()
  const containerRef = useRef<HTMLDivElement>(null)

  const sortedStatuses = useMemo(
    () => [...statuses].sort((a, b) => a.order_index - b.order_index),
    [statuses]
  )

  const tasksByStatus = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const status of sortedStatuses) {
      const statusTasks = tasks
        .filter((t) => t.status_id === status.id && t.parent_id === null)
        .sort((a, b) => {
          if (priorityAutoSort) {
            const priDiff = b.priority - a.priority
            if (priDiff !== 0) return priDiff
          }
          return a.order_index - b.order_index
        })
      map[status.id] = statusTasks
    }
    return map
  }, [tasks, sortedStatuses, priorityAutoSort])

  // Flat list of all visible tasks for keyboard nav
  const flatTasks = useMemo(() => {
    const result: Task[] = []
    for (const status of sortedStatuses) {
      result.push(...(tasksByStatus[status.id] ?? []))
    }
    return result
  }, [sortedStatuses, tasksByStatus])

  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement) return

      const currentId = selectedTaskIds.size === 1 ? [...selectedTaskIds][0] : null
      const currentIndex = currentId
        ? flatTasks.findIndex((t) => t.id === currentId)
        : -1

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = Math.min(currentIndex + 1, flatTasks.length - 1)
          if (flatTasks[nextIndex]) setCurrentTask(flatTasks[nextIndex].id)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          const prevIndex = Math.max(currentIndex - 1, 0)
          if (flatTasks[prevIndex]) setCurrentTask(flatTasks[prevIndex].id)
          break
        }
        case 'ArrowRight': {
          if (currentId) {
            e.preventDefault()
            const task = flatTasks.find((t) => t.id === currentId)
            if (task) {
              const statusIdx = sortedStatuses.findIndex((s) => s.id === task.status_id)
              if (statusIdx < sortedStatuses.length - 1) {
                onStatusChange(task.id, sortedStatuses[statusIdx + 1].id)
              }
            }
          }
          break
        }
        case 'ArrowLeft': {
          if (currentId) {
            e.preventDefault()
            const task = flatTasks.find((t) => t.id === currentId)
            if (task) {
              const statusIdx = sortedStatuses.findIndex((s) => s.id === task.status_id)
              if (statusIdx > 0) {
                onStatusChange(task.id, sortedStatuses[statusIdx - 1].id)
              }
            }
          }
          break
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskIds, flatTasks, sortedStatuses, setCurrentTask, onStatusChange])

  return (
    <div
      ref={containerRef}
      className="flex flex-1 gap-4 overflow-x-auto p-4"
      role="region"
      aria-label="Kanban board"
      tabIndex={-1}
    >
      {sortedStatuses.map((status) => (
        <KanbanColumn
          key={status.id}
          status={status}
          tasks={tasksByStatus[status.id] ?? []}
          allStatuses={statuses}
          selectedTaskIds={selectedTaskIds}
          taskFilterOpacity={taskFilterOpacity}
          dropIndicator={dropIndicator}
          onSelectTask={onSelectTask}
          onStatusChange={onStatusChange}
          onDeleteTask={onDeleteTask}
        />
      ))}
    </div>
  )
}
