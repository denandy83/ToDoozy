import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useTaskStore, useTasksByProject } from '../../shared/stores'
import { useStatusesByProject } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores'
import {
  useLabelStore,
  useLabelsByProject,
  selectActiveLabelFilters,
  selectHasActiveLabelFilters,
  selectFilterMode
} from '../../shared/stores'
import { useViewStore, selectLayoutMode } from '../../shared/stores/viewStore'
import { useSetting } from '../../shared/stores/settingsStore'
import { usePrioritySettings } from '../../shared/hooks/usePrioritySettings'
import { LabelFilterBar } from '../../shared/components/LabelFilterBar'
import { AddTaskInput, type AddTaskInputHandle } from './AddTaskInput'
import { StatusSection } from './StatusSection'
import { KanbanView } from './KanbanView'
import type { Task } from '../../../../shared/types'
import type { DropIndicator } from './useDragAndDrop'

interface TaskListViewProps {
  projectId: string
  projectName: string
  dropIndicator?: DropIndicator | null
}

export function TaskListView({ projectId, projectName, dropIndicator }: TaskListViewProps): React.JSX.Element {
  const tasks = useTasksByProject(projectId)
  const statuses = useStatusesByProject(projectId)
  const currentUser = useAuthStore((s) => s.currentUser)
  const { createTask, updateTask, setCurrentTask, toggleExpanded, setExpanded, addLabel, removeLabel, hydrateAllTaskLabels, setPendingDeleteTask, setMovingTask, reorderTasks } =
    useTaskStore()
  const movingTaskId = useTaskStore((s) => s.movingTaskId)
  const currentTaskId = useTaskStore((s) => s.currentTaskId)
  const allTasks = useTaskStore((s) => s.tasks)
  const taskLabels = useTaskStore((s) => s.taskLabels)
  const expandedTaskIds = useTaskStore((s) => s.expandedTaskIds)
  const layoutMode = useViewStore(selectLayoutMode)
  const addInputRef = useRef<AddTaskInputHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Label state
  const allLabels = useLabelsByProject(projectId)
  const activeLabelFilters = useLabelStore(selectActiveLabelFilters)
  const hasActiveFilters = useLabelStore(selectHasActiveLabelFilters)
  const filterMode = useLabelStore(selectFilterMode)
  const { createLabel: createLabelInStore } = useLabelStore()
  const { autoSort: priorityAutoSort } = usePrioritySettings()

  // Hydrate all task labels for this project
  useEffect(() => {
    if (projectId) hydrateAllTaskLabels(projectId)
  }, [projectId, hydrateAllTaskLabels])

  // Labels actually in use (assigned to at least one task in this view)
  const labelsInUse = useMemo(() => {
    const usedLabelIds = new Set<string>()
    for (const task of tasks) {
      const labels = taskLabels[task.id]
      if (labels) {
        for (const l of labels) usedLabelIds.add(l.id)
      }
    }
    return allLabels.filter((l) => usedLabelIds.has(l.id))
  }, [tasks, taskLabels, allLabels])

  // Compute filter opacity for each task (for blur mode)
  const blurOpacityStr = useSetting('label_blur_opacity')
  const blurOpacity = (blurOpacityStr ? parseInt(blurOpacityStr, 10) : 8) / 100

  const taskFilterOpacity = useMemo(() => {
    if (!hasActiveFilters) return undefined
    const map: Record<string, number> = {}
    for (const task of tasks) {
      const labels = taskLabels[task.id] ?? []
      const labelIds = new Set(labels.map((l) => l.id))
      const matches = [...activeLabelFilters].some((fid) => labelIds.has(fid))
      if (filterMode === 'blur') {
        map[task.id] = matches ? 1 : blurOpacity
      }
    }
    return filterMode === 'blur' ? map : undefined
  }, [tasks, taskLabels, activeLabelFilters, hasActiveFilters, filterMode, blurOpacity])

  // Filter tasks for hide mode
  const filteredTasks = useMemo(() => {
    if (!hasActiveFilters || filterMode !== 'hide') return tasks
    return tasks.filter((task) => {
      const labels = taskLabels[task.id] ?? []
      const labelIds = new Set(labels.map((l) => l.id))
      return [...activeLabelFilters].some((fid) => labelIds.has(fid))
    })
  }, [tasks, taskLabels, activeLabelFilters, hasActiveFilters, filterMode])

  const prioritySortFn = useCallback(
    (a: Task, b: Task): number => {
      if (priorityAutoSort) {
        const priDiff = b.priority - a.priority
        if (priDiff !== 0) return priDiff
      }
      return a.order_index - b.order_index
    },
    [priorityAutoSort]
  )

  // Build flat ordered list of visible tasks (respecting expand/collapse) for keyboard nav
  const flatTasks = useMemo(() => {
    const result: Task[] = []
    const sorted = [...statuses].sort((a, b) => a.order_index - b.order_index)
    for (const status of sorted) {
      const statusTasks = filteredTasks
        .filter(
          (t) =>
            t.status_id === status.id &&
            t.is_archived === 0 &&
            t.is_template === 0 &&
            t.parent_id === null
        )
        .sort(prioritySortFn)

      const addWithChildren = (task: Task): void => {
        result.push(task)
        if (expandedTaskIds.has(task.id)) {
          const children = filteredTasks
            .filter((t) => t.parent_id === task.id)
            .sort(prioritySortFn)
          for (const child of children) {
            addWithChildren(child)
          }
        }
      }

      for (const task of statusTasks) {
        addWithChildren(task)
      }
    }
    return result
  }, [filteredTasks, statuses, expandedTaskIds, prioritySortFn])

  const handleAddTask = useCallback(
    async (title: string) => {
      if (!currentUser) return
      const defaultStatus = statuses.find((s) => s.is_default === 1)
      if (!defaultStatus) return

      const maxOrder = tasks.reduce((max, t) => Math.max(max, t.order_index), -1)
      await createTask({
        id: crypto.randomUUID(),
        project_id: projectId,
        owner_id: currentUser.id,
        title,
        status_id: defaultStatus.id,
        order_index: maxOrder + 1
      })
    },
    [currentUser, statuses, tasks, projectId, createTask]
  )

  const handleStatusChange = useCallback(
    async (taskId: string, newStatusId: string) => {
      const newStatus = statuses.find((s) => s.id === newStatusId)
      const update: { status_id: string; completed_date?: string | null } = {
        status_id: newStatusId
      }
      if (newStatus?.is_done === 1) {
        update.completed_date = new Date().toISOString()
      } else {
        update.completed_date = null
      }
      await updateTask(taskId, update)
    },
    [statuses, updateTask]
  )

  const handleTitleChange = useCallback(
    async (taskId: string, newTitle: string) => {
      await updateTask(taskId, { title: newTitle })
    },
    [updateTask]
  )

  const handleDeleteTask = useCallback(
    (taskId: string) => {
      setPendingDeleteTask(taskId)
    },
    [setPendingDeleteTask]
  )

  const handleSelectTask = useCallback(
    (taskId: string) => {
      setCurrentTask(taskId)
    },
    [setCurrentTask]
  )

  const handleAddLabel = useCallback(
    async (taskId: string, labelId: string) => {
      await addLabel(taskId, labelId)
    },
    [addLabel]
  )

  const handleRemoveLabel = useCallback(
    async (taskId: string, labelId: string) => {
      await removeLabel(taskId, labelId)
    },
    [removeLabel]
  )

  const handleCreateLabel = useCallback(
    async (name: string, color: string) => {
      await createLabelInStore({
        id: crypto.randomUUID(),
        project_id: projectId,
        name,
        color
      })
    },
    [createLabelInStore, projectId]
  )

  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const moveTask = async (direction: 'up' | 'down'): Promise<void> => {
      if (!movingTaskId) return
      // Read fresh state from the store to avoid stale closure data
      const freshTasks = useTaskStore.getState().tasks
      const task = freshTasks[movingTaskId]
      if (!task) return

      const sortedStatuses = [...statuses].sort((a, b) => a.order_index - b.order_index)
      const parentId = task.parent_id
      const statusId = task.status_id

      // Get siblings sorted the same way the view sorts them (priority + order_index)
      const siblings = Object.values(freshTasks)
        .filter((t) => t.parent_id === parentId && t.status_id === statusId && t.is_archived === 0 && t.is_template === 0)
        .sort(prioritySortFn)
      const idx = siblings.findIndex((t) => t.id === movingTaskId)

      if (direction === 'up' && idx > 0) {
        // Swap with previous sibling
        const newOrder = [...siblings]
        ;[newOrder[idx - 1], newOrder[idx]] = [newOrder[idx], newOrder[idx - 1]]
        await reorderTasks(newOrder.map((t) => t.id))
      } else if (direction === 'up' && idx === 0 && parentId === null) {
        // Move to previous status section — place at bottom
        const statusIdx = sortedStatuses.findIndex((s) => s.id === statusId)
        if (statusIdx > 0) {
          const prevStatus = sortedStatuses[statusIdx - 1]
          const prevSiblings = Object.values(freshTasks)
            .filter((t) => t.parent_id === null && t.status_id === prevStatus.id && t.is_archived === 0 && t.is_template === 0)
            .sort(prioritySortFn)
          // Place at bottom: append after all existing tasks in previous section
          const newOrder = [...prevSiblings.map((t) => t.id), movingTaskId]
          await handleStatusChange(movingTaskId, prevStatus.id)
          await reorderTasks(newOrder)
        }
      } else if (direction === 'down' && idx < siblings.length - 1) {
        // Swap with next sibling
        const newOrder = [...siblings]
        ;[newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1], newOrder[idx]]
        await reorderTasks(newOrder.map((t) => t.id))
      } else if (direction === 'down' && idx === siblings.length - 1 && parentId === null) {
        // Move to next status section — place at top
        const statusIdx = sortedStatuses.findIndex((s) => s.id === statusId)
        if (statusIdx < sortedStatuses.length - 1) {
          const nextStatus = sortedStatuses[statusIdx + 1]
          const nextSiblings = Object.values(freshTasks)
            .filter((t) => t.parent_id === null && t.status_id === nextStatus.id && t.is_archived === 0 && t.is_template === 0)
            .sort(prioritySortFn)
          // Place at top: prepend before all existing tasks in next section
          const newOrder = [movingTaskId, ...nextSiblings.map((t) => t.id)]
          await handleStatusChange(movingTaskId, nextStatus.id)
          await reorderTasks(newOrder)
        }
      }

      // Re-focus container so keyboard continues working after status change
      requestAnimationFrame(() => {
        containerRef.current?.focus()
      })
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      const currentIndex = currentTaskId
        ? flatTasks.findIndex((t) => t.id === currentTaskId)
        : -1

      // Move mode: intercept keys
      if (movingTaskId) {
        switch (e.key) {
          case 'ArrowDown': {
            e.preventDefault()
            moveTask('down')
            break
          }
          case 'ArrowUp': {
            e.preventDefault()
            moveTask('up')
            break
          }
          case 'Enter': {
            e.preventDefault()
            setMovingTask(null)
            break
          }
          case 'Escape': {
            e.preventDefault()
            setMovingTask(null)
            break
          }
        }
        return
      }

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = Math.min(currentIndex + 1, flatTasks.length - 1)
          if (flatTasks[nextIndex]) setCurrentTask(flatTasks[nextIndex].id)
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          if (currentIndex <= 0) {
            setCurrentTask(null)
            addInputRef.current?.focus()
          } else {
            setCurrentTask(flatTasks[currentIndex - 1].id)
          }
          break
        }
        case 'ArrowRight': {
          if (currentTaskId) {
            e.preventDefault()
            const hasChildren = tasks.some((t) => t.parent_id === currentTaskId)
            if (hasChildren) {
              setExpanded(currentTaskId, true)
            }
          }
          break
        }
        case 'ArrowLeft': {
          if (currentTaskId) {
            e.preventDefault()
            const task = allTasks[currentTaskId]
            if (expandedTaskIds.has(currentTaskId)) {
              setExpanded(currentTaskId, false)
            } else if (task?.parent_id) {
              setCurrentTask(task.parent_id)
            }
          }
          break
        }
        case 'Enter': {
          e.preventDefault()
          if (currentTaskId) {
            setMovingTask(currentTaskId)
          } else {
            addInputRef.current?.focus()
          }
          break
        }
        case ' ': {
          if (currentTaskId) {
            e.preventDefault()
            const task = allTasks[currentTaskId]
            if (task) {
              const sorted = [...statuses].sort((a, b) => a.order_index - b.order_index)
              const idx = sorted.findIndex((s) => s.id === task.status_id)
              const nextIdx = (idx + 1) % sorted.length
              handleStatusChange(currentTaskId, sorted[nextIdx].id)
            }
          }
          break
        }
        case 'Delete':
        case 'Backspace': {
          if (currentTaskId) {
            e.preventDefault()
            const nextIndex =
              currentIndex + 1 < flatTasks.length ? currentIndex + 1 : currentIndex - 1
            const nextTask = flatTasks[nextIndex]
            handleDeleteTask(currentTaskId)
            setCurrentTask(nextTask?.id ?? null)
          }
          break
        }
        case 'Tab': {
          e.preventDefault()
          if (e.shiftKey) {
            const prevIndex = Math.max(currentIndex - 1, 0)
            if (flatTasks[prevIndex]) setCurrentTask(flatTasks[prevIndex].id)
          } else {
            const nextIndex = Math.min(currentIndex + 1, flatTasks.length - 1)
            if (flatTasks[nextIndex]) setCurrentTask(flatTasks[nextIndex].id)
          }
          break
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [
    currentTaskId,
    flatTasks,
    setCurrentTask,
    allTasks,
    tasks,
    statuses,
    expandedTaskIds,
    toggleExpanded,
    setExpanded,
    handleStatusChange,
    handleDeleteTask,
    movingTaskId,
    setMovingTask,
    reorderTasks,
    prioritySortFn
  ])

  const sortedStatuses = useMemo(
    () => [...statuses].sort((a, b) => a.order_index - b.order_index),
    [statuses]
  )

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden" tabIndex={-1}>
      <AddTaskInput ref={addInputRef} viewName={projectName} onSubmit={handleAddTask} />

      <LabelFilterBar labels={labelsInUse} />

      {layoutMode === 'kanban' ? (
        <KanbanView
          tasks={filteredTasks.filter((t) => t.is_archived === 0 && t.is_template === 0)}
          statuses={statuses}
          selectedTaskId={currentTaskId}
          taskFilterOpacity={taskFilterOpacity}
          dropIndicator={dropIndicator}
          onSelectTask={handleSelectTask}
          onStatusChange={handleStatusChange}
          onDeleteTask={handleDeleteTask}
        />
      ) : (
        <div className="flex-1 overflow-y-auto" role="grid" aria-label="Task list">
          {sortedStatuses.map((status) => {
            const statusTasks = filteredTasks.filter(
              (t) => t.status_id === status.id && t.is_archived === 0 && t.is_template === 0
            )
            return (
              <StatusSection
                key={status.id}
                status={status}
                tasks={statusTasks}
                allStatuses={statuses}
                allLabels={allLabels}
                selectedTaskId={currentTaskId}
                taskFilterOpacity={taskFilterOpacity}
                dropIndicator={dropIndicator}
                onSelectTask={handleSelectTask}
                onStatusChange={handleStatusChange}
                onTitleChange={handleTitleChange}
                onDeleteTask={handleDeleteTask}
                onAddLabel={handleAddLabel}
                onRemoveLabel={handleRemoveLabel}
                onCreateLabel={handleCreateLabel}
              />
            )
          })}

          {sortedStatuses.length === 0 && (
            <div className="flex flex-1 items-center justify-center py-20">
              <p className="text-sm font-light text-muted/60">
                No statuses configured. Add statuses in project settings.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
