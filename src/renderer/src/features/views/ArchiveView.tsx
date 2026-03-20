import { useMemo, useRef, useEffect, useCallback } from 'react'
import { useTaskStore } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import type { Task } from '../../../../shared/types'
import { StatusButton } from '../../shared/components/StatusButton'
import { useStatusesByProject } from '../../shared/stores'
import { useProjectStore, selectCurrentProject } from '../../shared/stores'
import { formatDate } from '../../shared/utils/dateFormat'

export function ArchiveView(): React.JSX.Element {
  const currentProject = useProjectStore(selectCurrentProject)
  const projectId = currentProject?.id ?? ''
  const allTasks = useTaskStore((s) => s.tasks)
  const statuses = useStatusesByProject(projectId)
  const { updateTask, setCurrentTask } = useTaskStore()
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
  const { addToast } = useToast()
  const containerRef = useRef<HTMLDivElement>(null)

  const archivedTasks = useMemo(
    () =>
      Object.values(allTasks)
        .filter((t) => t.is_archived === 1)
        .sort((a, b) => {
          // Sort by completed_date descending (most recent first)
          const aDate = a.completed_date ?? a.updated_at
          const bDate = b.completed_date ?? b.updated_at
          return bDate.localeCompare(aDate)
        }),
    [allTasks]
  )

  const handleUnarchive = useCallback(
    async (task: Task) => {
      await updateTask(task.id, { is_archived: 0 })
      addToast({
        message: `"${task.title}" restored`,
        action: {
          label: 'Undo',
          onClick: async () => {
            await updateTask(task.id, { is_archived: 1 })
          }
        }
      })
    },
    [updateTask, addToast]
  )

  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      const currentTaskId = selectedTaskIds.size === 1 ? [...selectedTaskIds][0] : null
      const currentIndex = currentTaskId
        ? archivedTasks.findIndex((t) => t.id === currentTaskId)
        : -1

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = Math.min(currentIndex + 1, archivedTasks.length - 1)
          if (archivedTasks[nextIndex]) setCurrentTask(archivedTasks[nextIndex].id)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          if (currentIndex <= 0) {
            setCurrentTask(null)
          } else {
            setCurrentTask(archivedTasks[currentIndex - 1].id)
          }
          break
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [selectedTaskIds, archivedTasks, setCurrentTask])

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden" tabIndex={-1}>
      <div className="flex-1 overflow-y-auto">
        {archivedTasks.map((task) => (
          <div
            key={task.id}
            onClick={() => setCurrentTask(task.id)}
            className={`group flex items-center gap-3 border-b border-border/50 px-6 py-2.5 transition-colors ${
              selectedTaskIds.has(task.id)
                ? 'bg-accent/12 border-l-2 border-l-accent/15'
                : 'hover:bg-foreground/6'
            }`}
            role="row"
          >
            <StatusButton
              currentStatusId={task.status_id}
              statuses={statuses}
              onStatusChange={() => {
                /* read-only in archive */
              }}
              size={14}
            />
            <span className="flex-1 text-[15px] font-light tracking-tight text-muted line-through">
              {task.title}
            </span>
            {task.completed_date && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted/40">
                {formatDate(task.completed_date)}
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleUnarchive(task)
              }}
              className="rounded px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-muted opacity-0 transition-opacity hover:bg-foreground/6 group-hover:opacity-100"
            >
              Restore
            </button>
          </div>
        ))}

        {archivedTasks.length === 0 && (
          <div className="flex flex-1 items-center justify-center py-20">
            <div className="text-center">
              <p className="text-sm font-light text-muted/60">No archived tasks.</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted/40">
                Completed tasks will appear here
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
