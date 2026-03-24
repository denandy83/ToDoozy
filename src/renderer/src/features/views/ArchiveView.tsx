import { useMemo, useRef, useEffect, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTaskStore } from '../../shared/stores'
import { useToast } from '../../shared/components/Toast'
import type { Task, Project } from '../../../../shared/types'
import { ChevronRight, Trash2 } from 'lucide-react'
import { StatusButton } from '../../shared/components/StatusButton'
import { useStatusStore } from '../../shared/stores/statusStore'
import { useProjectStore, selectAllProjects } from '../../shared/stores'
import { formatDate } from '../../shared/utils/dateFormat'

export function ArchiveView(): React.JSX.Element {
  const allProjects = useProjectStore(selectAllProjects)
  const allTasks = useTaskStore((s) => s.tasks)
  const allStatuses = useStatusStore((s) => s.statuses)
  const { updateTask, deleteTask, setCurrentTask, selectTask, toggleTaskInSelection, selectTaskRange, clearSelection } = useTaskStore()
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
  const lastSelectedTaskId = useTaskStore((s) => s.lastSelectedTaskId)
  const { addToast } = useToast()
  const containerRef = useRef<HTMLDivElement>(null)
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(() => new Set(allProjects.map((p) => p.id)))

  const toggleProjectCollapse = useCallback((projectId: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }, [])

  // Group archived tasks by project, sorted by completed_date desc within each group
  const groupedByProject = useMemo(() => {
    const archived = Object.values(allTasks)
      .filter((t) => t.is_archived === 1)
      .sort((a, b) => {
        const aDate = a.completed_date ?? a.updated_at
        const bDate = b.completed_date ?? b.updated_at
        return bDate.localeCompare(aDate)
      })

    const groups: { project: Project; tasks: Task[] }[] = []
    const byProject: Record<string, Task[]> = {}
    for (const task of archived) {
      if (!byProject[task.project_id]) byProject[task.project_id] = []
      byProject[task.project_id].push(task)
    }
    for (const project of allProjects) {
      if (byProject[project.id]?.length) {
        groups.push({ project, tasks: byProject[project.id] })
      }
    }
    return groups
  }, [allTasks, allProjects])

  const archivedTasks = useMemo(
    () => groupedByProject.flatMap((g) => g.tasks),
    [groupedByProject]
  )

  const handleSelect = useCallback(
    (taskId: string, e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        toggleTaskInSelection(taskId)
      } else if (e.shiftKey && lastSelectedTaskId) {
        const startIdx = archivedTasks.findIndex((t) => t.id === lastSelectedTaskId)
        const endIdx = archivedTasks.findIndex((t) => t.id === taskId)
        if (startIdx !== -1 && endIdx !== -1) {
          const lo = Math.min(startIdx, endIdx)
          const hi = Math.max(startIdx, endIdx)
          selectTaskRange(archivedTasks.slice(lo, hi + 1).map((t) => t.id))
        } else {
          selectTask(taskId)
        }
      } else {
        selectTask(taskId)
        setCurrentTask(taskId)
      }
    },
    [archivedTasks, lastSelectedTaskId, selectTask, toggleTaskInSelection, selectTaskRange, setCurrentTask]
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

  const handleBulkRestore = useCallback(async () => {
    const ids = [...selectedTaskIds]
    const count = ids.length
    for (const id of ids) {
      await updateTask(id, { is_archived: 0 })
    }
    clearSelection()
    addToast({
      message: `${count} task${count === 1 ? '' : 's'} restored`,
      action: {
        label: 'Undo',
        onClick: async () => {
          for (const id of ids) {
            await updateTask(id, { is_archived: 1 })
          }
        }
      }
    })
  }, [selectedTaskIds, updateTask, clearSelection, addToast])

  const handleBulkDelete = useCallback(async (shiftKey: boolean) => {
    const ids = [...selectedTaskIds]
    const count = ids.length
    if (shiftKey) {
      for (const id of ids) await deleteTask(id)
      clearSelection()
      return
    }
    addToast({
      message: `Permanently delete ${count} task${count === 1 ? '' : 's'}?`,
      persistent: true,
      actions: [
        {
          label: 'Delete',
          variant: 'danger',
          onClick: async () => {
            for (const id of ids) {
              await deleteTask(id)
            }
            clearSelection()
          }
        },
        { label: 'Cancel', variant: 'muted', onClick: () => {} }
      ]
    })
  }, [selectedTaskIds, deleteTask, clearSelection, addToast])

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

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)

  const handleContextMenu = useCallback((e: React.MouseEvent, taskId: string) => {
    e.preventDefault()
    e.stopPropagation()
    if (!selectedTaskIds.has(taskId)) {
      selectTask(taskId)
    }
    // Adjust position to stay within viewport
    const menuWidth = 208 // w-52 = 13rem = 208px
    const menuHeight = 120 // approximate height
    const x = Math.min(e.clientX, window.innerWidth - menuWidth - 8)
    const y = Math.min(e.clientY, window.innerHeight - menuHeight - 8)
    setContextMenu({ x, y })
  }, [selectedTaskIds, selectTask])

  // Close context menu on click outside or escape
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (): void => setContextMenu(null)
    const handleEscape = (e: KeyboardEvent): void => { if (e.key === 'Escape') setContextMenu(null) }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [contextMenu])

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden" tabIndex={-1}>
      {/* Right-click context menu */}
      {contextMenu && createPortal(
        <div
          className="fixed z-[9999] w-52 rounded-lg border border-border bg-surface p-1 shadow-lg motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in motion-safe:duration-100"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted">
            {selectedTaskIds.size} task{selectedTaskIds.size === 1 ? '' : 's'} selected
          </div>
          <button
            onClick={() => { handleBulkRestore(); setContextMenu(null) }}
            className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm font-light text-foreground transition-colors hover:bg-foreground/6"
          >
            Restore
          </button>
          <button
            onClick={(e) => { handleBulkDelete(e.shiftKey); setContextMenu(null) }}
            className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-sm font-light text-danger transition-colors hover:bg-danger/10"
          >
            Delete
          </button>
        </div>,
        document.body
      )}
      <div className="flex-1 overflow-y-auto">
        {groupedByProject.map(({ project, tasks }) => {
          const projectStatuses = Object.values(allStatuses).filter((s) => s.project_id === project.id)
          const isCollapsed = collapsedProjects.has(project.id)
          return (
            <div key={project.id}>
              <div
                className="sticky top-0 z-10 flex cursor-pointer items-center gap-2 bg-background px-6 py-2 border-b border-border select-none hover:bg-foreground/6 transition-colors"
                onClick={() => toggleProjectCollapse(project.id)}
              >
                <ChevronRight
                  size={12}
                  className={`text-muted transition-transform ${isCollapsed ? '' : 'rotate-90'}`}
                />
                <div
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: project.color }}
                />
                <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
                  {project.name}
                </span>
                <span className="text-[10px] text-muted/40">{tasks.length}</span>
              </div>
              {!isCollapsed && tasks.map((task) => (
                <div
                  key={task.id}
                  onClick={(e) => handleSelect(task.id, e)}
                  onContextMenu={(e) => handleContextMenu(e, task.id)}
                  className={`group flex items-center gap-3 border-b border-border/50 px-6 py-2.5 transition-colors select-none ${
                    selectedTaskIds.has(task.id)
                      ? 'bg-accent/12 border-l-2 border-l-accent/15'
                      : 'hover:bg-foreground/6'
                  }`}
                  role="row"
                >
                  <StatusButton
                    currentStatusId={task.status_id}
                    statuses={projectStatuses}
                    onStatusChange={() => {
                      /* read-only in archive */
                    }}
                    size={14}
                  />
                  <span className="flex-1 text-[15px] font-light tracking-tight text-muted">
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
                  <button
                    onClick={async (e) => {
                      e.stopPropagation()
                      if (e.shiftKey) {
                        await deleteTask(task.id)
                        return
                      }
                      addToast({
                        message: `Permanently delete "${task.title}"?`,
                        persistent: true,
                        actions: [
                          { label: 'Delete', variant: 'danger', onClick: async () => { await deleteTask(task.id) } },
                          { label: 'Cancel', variant: 'muted', onClick: () => {} }
                        ]
                      })
                    }}
                    className="rounded p-1 text-danger opacity-0 transition-opacity hover:bg-danger/10 group-hover:opacity-100"
                    title="Delete permanently"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          )
        })}

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
