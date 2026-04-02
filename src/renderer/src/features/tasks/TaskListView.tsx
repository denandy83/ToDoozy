import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useCopyTasks } from '../../shared/hooks/useCopyTasks'
import { useTaskStore, useTasksByProject } from '../../shared/stores'
import { useStatusesByProject } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores'
import {
  useLabelStore,
  useLabelsByProject,
  selectActiveLabelFilters,
  selectHasActiveLabelFilters,
  selectFilterMode,
  selectAssigneeFilter
} from '../../shared/stores'
import { useViewStore, selectLayoutMode } from '../../shared/stores/viewStore'
import { useSetting } from '../../shared/stores/settingsStore'
import { usePrioritySettings } from '../../shared/hooks/usePrioritySettings'
import { useCreateOrMatchLabel } from '../../shared/hooks/useCreateOrMatchLabel'
import { LabelFilterBar } from '../../shared/components/LabelFilterBar'
import { AddTaskInput, type AddTaskInputHandle, type SmartTaskData } from './AddTaskInput'
import { StatusSection } from './StatusSection'
import { KanbanView } from './KanbanView'
import type { Task } from '../../../../shared/types'
import { shouldForceDelete } from '../../shared/utils/shiftDelete'
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
  const { createTask, updateTask, deleteTask, setCurrentTask, navigateTask, selectTask, toggleTaskInSelection, selectTaskRange, selectAllTasks, clearSelection, toggleExpanded, setExpanded, addLabel, removeLabel, hydrateAllTaskLabels, setPendingDeleteTask, setMovingTask, reorderTasks } =
    useTaskStore()
  const movingTaskId = useTaskStore((s) => s.movingTaskId)
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
  const lastSelectedTaskId = useTaskStore((s) => s.lastSelectedTaskId)
  const allTasks = useTaskStore((s) => s.tasks)
  const taskLabels = useTaskStore((s) => s.taskLabels)
  const expandedTaskIds = useTaskStore((s) => s.expandedTaskIds)
  const layoutMode = useViewStore(selectLayoutMode)
  const newTaskPosition = useSetting('new_task_position') ?? 'top'
  const addInputRef = useRef<AddTaskInputHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)


  // Label state
  const allLabels = useLabelsByProject(projectId)
  const activeLabelFilters = useLabelStore(selectActiveLabelFilters)
  const hasActiveFilters = useLabelStore(selectHasActiveLabelFilters)
  const filterMode = useLabelStore(selectFilterMode)
  const assigneeFilter = useLabelStore(selectAssigneeFilter)
  const createOrMatchLabel = useCreateOrMatchLabel(projectId)
  const { autoSort: priorityAutoSort } = usePrioritySettings()
  const { copySelectedTasks } = useCopyTasks()

  // Hydrate all task labels for this project
  useEffect(() => {
    if (projectId) hydrateAllTaskLabels(projectId)
  }, [projectId, hydrateAllTaskLabels])

  // Auto-select first task (without opening detail panel) when navigating to project
  // or when selection is cleared (e.g. clicking same project in sidebar)
  const hasSelection = selectedTaskIds.size > 0
  useEffect(() => {
    if (hasSelection) return
    requestAnimationFrame(() => {
      if (flatTasks.length > 0) {
        useTaskStore.setState({
          selectedTaskIds: new Set([flatTasks[0].id]),
          lastSelectedTaskId: flatTasks[0].id,
          showDetailPanel: false
        })
      }
      // Scroll to top and focus
      const grid = containerRef.current?.querySelector('[role="grid"]')
      if (grid) grid.scrollTop = 0
      containerRef.current?.focus()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, hasSelection])

  // Compute filter opacity for each task (for blur mode)
  const blurOpacityStr = useSetting('label_blur_opacity')
  const blurOpacity = (blurOpacityStr ? parseInt(blurOpacityStr, 10) : 8) / 100

  const hasAnyFilter = hasActiveFilters || !!assigneeFilter

  const taskFilterOpacity = useMemo(() => {
    if (!hasAnyFilter) return undefined
    const map: Record<string, number> = {}
    for (const task of tasks) {
      const labels = taskLabels[task.id] ?? []
      const labelIds = new Set(labels.map((l) => l.id))
      const labelMatch = !hasActiveFilters || [...activeLabelFilters].some((fid) => labelIds.has(fid))
      const assigneeMatch = !assigneeFilter || task.assigned_to === assigneeFilter
      const matches = labelMatch && assigneeMatch
      if (filterMode === 'blur') {
        map[task.id] = matches ? 1 : blurOpacity
      }
    }
    return filterMode === 'blur' ? map : undefined
  }, [tasks, taskLabels, activeLabelFilters, hasActiveFilters, assigneeFilter, hasAnyFilter, filterMode, blurOpacity])

  // Filter tasks for hide mode
  const filteredTasks = useMemo(() => {
    if (!hasAnyFilter || filterMode !== 'hide') return tasks
    return tasks.filter((task) => {
      const labelMatch = !hasActiveFilters || (() => {
        const labels = taskLabels[task.id] ?? []
        const labelIds = new Set(labels.map((l) => l.id))
        return [...activeLabelFilters].some((fid) => labelIds.has(fid))
      })()
      const assigneeMatch = !assigneeFilter || task.assigned_to === assigneeFilter
      return labelMatch && assigneeMatch
    })
  }, [tasks, taskLabels, activeLabelFilters, hasActiveFilters, assigneeFilter, hasAnyFilter, filterMode])

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
    // Sort statuses: default first, middle by order_index, done last
    const defaults = statuses.filter((s) => s.is_default === 1)
    const middle = statuses.filter((s) => s.is_default !== 1 && s.is_done !== 1).sort((a, b) => a.order_index - b.order_index)
    const doneStatuses = statuses.filter((s) => s.is_done === 1)
    const sorted = [...defaults, ...middle, ...doneStatuses]
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
    async (data: SmartTaskData) => {
      if (!currentUser) return
      const defaultStatus = statuses.find((s) => s.is_default === 1)
      if (!defaultStatus) return

      const statusTasks = tasks.filter((t) => t.status_id === defaultStatus.id && t.parent_id === null)
      const orderIndex = newTaskPosition === 'bottom'
        ? statusTasks.reduce((max, t) => Math.max(max, t.order_index), -1) + 1
        : statusTasks.reduce((min, t) => Math.min(min, t.order_index), 0) - 1
      const taskId = crypto.randomUUID()
      await createTask({
        id: taskId,
        project_id: projectId,
        owner_id: currentUser.id,
        title: data.title,
        status_id: defaultStatus.id,
        order_index: orderIndex,
        priority: data.priority,
        due_date: data.dueDate
      })
      // Assign labels
      for (const label of data.labels) {
        await addLabel(taskId, label.id)
      }
    },
    [currentUser, statuses, tasks, projectId, createTask, addLabel, newTaskPosition]
  )

  const handleStatusChange = useCallback(
    async (taskId: string, newStatusId: string) => {
      const newStatus = statuses.find((s) => s.id === newStatusId)
      const update: { status_id: string; completed_date?: string | null; order_index?: number } = {
        status_id: newStatusId
      }
      if (newStatus?.is_done === 1) {
        update.completed_date = new Date().toISOString()
      } else {
        update.completed_date = null
      }
      // Position task at top or bottom of target status group based on setting
      const allCurrentTasks = Object.values(useTaskStore.getState().tasks)
      const targetTasks = allCurrentTasks.filter((t) => t.status_id === newStatusId && t.parent_id === null && t.id !== taskId)
      if (targetTasks.length > 0) {
        update.order_index = newTaskPosition === 'bottom'
          ? Math.max(...targetTasks.map((t) => t.order_index)) + 1
          : Math.min(...targetTasks.map((t) => t.order_index)) - 1
      } else {
        update.order_index = 0
      }
      await updateTask(taskId, update)
      // Cascade status to all subtasks when marking done or resetting to default
      if (newStatus?.is_done === 1 || newStatus?.is_default === 1) {
        const allTasks = Object.values(useTaskStore.getState().tasks)
        const cascade = async (parentId: string): Promise<void> => {
          for (const t of allTasks.filter((t) => t.parent_id === parentId)) {
            await updateTask(t.id, {
              status_id: newStatusId,
              completed_date: newStatus.is_done === 1 ? new Date().toISOString() : null
            })
            await cascade(t.id)
          }
        }
        await cascade(taskId)
      }
      // Re-focus container and scroll task into view after status change
      requestAnimationFrame(() => {
        containerRef.current?.focus()
        const el = containerRef.current?.querySelector(`[data-task-id="${taskId}"]`)
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    },
    [statuses, updateTask, newTaskPosition]
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

  const clickOpensDetail = useSetting('click_opens_detail') ?? 'true'

  const handleSelectTask = useCallback(
    (taskId: string, e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey) {
        toggleTaskInSelection(taskId)
      } else if (e.shiftKey && lastSelectedTaskId) {
        const startIdx = flatTasks.findIndex((t) => t.id === lastSelectedTaskId)
        const endIdx = flatTasks.findIndex((t) => t.id === taskId)
        if (startIdx !== -1 && endIdx !== -1) {
          const lo = Math.min(startIdx, endIdx)
          const hi = Math.max(startIdx, endIdx)
          const rangeIds = flatTasks.slice(lo, hi + 1).map((t) => t.id)
          selectTaskRange(rangeIds)
        } else {
          selectTask(taskId, { openPanel: clickOpensDetail === 'true' })
        }
      } else {
        selectTask(taskId, { openPanel: clickOpensDetail === 'true' })
        if (clickOpensDetail === 'true') {
          requestAnimationFrame(() => {
            document.querySelector<HTMLElement>('[data-detail-title]')?.focus()
          })
        }
      }
    },
    [flatTasks, lastSelectedTaskId, selectTask, toggleTaskInSelection, selectTaskRange, clickOpensDetail]
  )

  const handleOpenDetail = useCallback(
    (taskId: string) => {
      selectTask(taskId, { openPanel: true })
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('[data-detail-title]')?.focus()
      })
    },
    [selectTask]
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
      await createOrMatchLabel(name, color)
    },
    [createOrMatchLabel]
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

      const sortedStatuses = [
        ...statuses.filter((s) => s.is_default === 1),
        ...statuses.filter((s) => s.is_default !== 1 && s.is_done !== 1).sort((a, b) => a.order_index - b.order_index),
        ...statuses.filter((s) => s.is_done === 1)
      ]
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

    const scrollTaskIntoView = (taskId: string): void => {
      requestAnimationFrame(() => {
        const el = container.querySelector(`[data-task-id="${taskId}"]`)
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      const currentTaskId = selectedTaskIds.size === 1 ? [...selectedTaskIds][0] : null
      const currentIndex = currentTaskId
        ? flatTasks.findIndex((t) => t.id === currentTaskId)
        : -1


      // Cmd+A = select all visible tasks
      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault()
        selectAllTasks(flatTasks.map((t) => t.id))
        return
      }

      // Cmd+C = copy selected task titles
      if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
        if (selectedTaskIds.size > 0) {
          e.preventDefault()
          copySelectedTasks(flatTasks)
        }
        return
      }

      // Escape: close panel first (keeps selection), then clear selection on second press
      if (e.key === 'Escape') {
        // If a date/time picker dropdown is open (or was just closed), don't close panel
        if (document.querySelector('.react-datepicker-popper')) return
        if ((e as KeyboardEvent & { _popupHandled?: boolean })._popupHandled) return
        const { showDetailPanel: panelOpen } = useTaskStore.getState()
        if (panelOpen) {
          e.preventDefault()
          useTaskStore.setState({ showDetailPanel: false })
          return
        }
        if (selectedTaskIds.size > 0) {
          e.preventDefault()
          clearSelection()
          return
        }
      }

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
          if (flatTasks[nextIndex]) {
            const id = flatTasks[nextIndex].id
            useTaskStore.setState((s) => ({
              selectedTaskIds: new Set([id]),
              lastSelectedTaskId: id,
              showDetailPanel: s.showDetailPanel
            }))
            scrollTaskIntoView(id)
          }
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          if (currentIndex <= 0) {
            useTaskStore.setState({ selectedTaskIds: new Set(), lastSelectedTaskId: null, showDetailPanel: false })
            addInputRef.current?.focus()
          } else {
            const id = flatTasks[currentIndex - 1].id
            useTaskStore.setState((s) => ({
              selectedTaskIds: new Set([id]),
              lastSelectedTaskId: id,
              showDetailPanel: s.showDetailPanel
            }))
            scrollTaskIntoView(id)
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
              useTaskStore.setState((s) => ({
                selectedTaskIds: new Set([task.parent_id!]),
                lastSelectedTaskId: task.parent_id!,
                showDetailPanel: s.showDetailPanel
              }))
            }
          }
          break
        }
        case 'Enter': {
          if (currentTaskId) {
            e.preventDefault()
            selectTask(currentTaskId)
            requestAnimationFrame(() => {
              const titleEl = document.querySelector<HTMLElement>('[data-detail-title]')
              titleEl?.focus()
            })
          } else {
            e.preventDefault()
            addInputRef.current?.focus()
          }
          break
        }
        case ' ': {
          e.preventDefault()
          const tasksToUpdate = selectedTaskIds.size > 0 ? [...selectedTaskIds] : currentTaskId ? [currentTaskId] : []
          if (tasksToUpdate.length > 0) {
            const sortedStatuses = [
              ...statuses.filter((s) => s.is_default === 1),
              ...statuses.filter((s) => s.is_default !== 1 && s.is_done !== 1).sort((a, b) => a.order_index - b.order_index),
              ...statuses.filter((s) => s.is_done === 1)
            ]
            const anchorId = currentTaskId ?? tasksToUpdate[0]
            for (const taskId of tasksToUpdate) {
              const task = allTasks[taskId]
              if (task) {
                const idx = sortedStatuses.findIndex((s) => s.id === task.status_id)
                const nextStatus = sortedStatuses[(idx + 1) % sortedStatuses.length]
                if (nextStatus) handleStatusChange(taskId, nextStatus.id)
              }
            }
            // Re-focus container and scroll anchor task into view after DOM update
            requestAnimationFrame(() => {
              containerRef.current?.focus()
              if (anchorId) scrollTaskIntoView(anchorId)
            })
          }
          break
        }
        case 'Delete':
        case 'Backspace': {
          if (shouldForceDelete(e)) {
            // Shift+Delete: silent delete without confirmation
            e.preventDefault()
            if (selectedTaskIds.size > 1) {
              const ids = [...selectedTaskIds]
              clearSelection()
              for (const id of ids) deleteTask(id)
            } else if (currentTaskId) {
              const nextIndex =
                currentIndex + 1 < flatTasks.length ? currentIndex + 1 : currentIndex - 1
              const nextTask = flatTasks[nextIndex]
              deleteTask(currentTaskId)
              setCurrentTask(nextTask?.id ?? null)
            }
          } else if (selectedTaskIds.size > 1) {
            e.preventDefault()
            setPendingDeleteTask(null)
            useTaskStore.getState().setPendingBulkDeleteTasks([...selectedTaskIds])
          } else if (currentTaskId) {
            e.preventDefault()
            const nextIndex =
              currentIndex + 1 < flatTasks.length ? currentIndex + 1 : currentIndex - 1
            const nextTask = flatTasks[nextIndex]
            handleDeleteTask(currentTaskId)
            setCurrentTask(nextTask?.id ?? null)
          }
          break
        }
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [
    selectedTaskIds,
    flatTasks,
    setCurrentTask,
    selectAllTasks,
    clearSelection,
    allTasks,
    tasks,
    statuses,
    expandedTaskIds,
    toggleExpanded,
    setExpanded,
    handleStatusChange,
    handleDeleteTask,
    setPendingDeleteTask,
    movingTaskId,
    setMovingTask,
    reorderTasks,
    prioritySortFn,
    copySelectedTasks,
    selectTask,
    navigateTask
  ])

  // Tab navigation: document-level capture so it fires before any element's handler
  useEffect(() => {
    const handleTab = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return
      // Only handle when focus is inside this container
      if (!container.contains(document.activeElement)) return
      // Don't intercept Tab in text inputs
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return
      // Don't intercept Tab when a date/time picker dropdown is open
      if (document.activeElement?.closest('.react-datepicker-popper')) return
      e.preventDefault()
      const tasks = flatTasks
      if (tasks.length === 0) return
      const selectedId = useTaskStore.getState().selectedTaskIds.values().next().value as string | undefined
      const idx = selectedId ? tasks.findIndex((t) => t.id === selectedId) : -1
      const nextId = e.shiftKey
        ? tasks[idx <= 0 ? tasks.length - 1 : idx - 1].id
        : tasks[idx >= tasks.length - 1 ? 0 : idx + 1].id
      navigateTask(nextId)
      requestAnimationFrame(() => {
        container.querySelector<HTMLElement>(`[data-task-id="${nextId}"]`)?.focus()
      })
    }
    document.addEventListener('keydown', handleTab, { capture: true })
    return () => document.removeEventListener('keydown', handleTab, { capture: true })
  }, [flatTasks, navigateTask])

  const sortedStatuses = useMemo(() => {
    const defaults = statuses.filter((s) => s.is_default === 1)
    const middle = statuses.filter((s) => s.is_default !== 1 && s.is_done !== 1).sort((a, b) => a.order_index - b.order_index)
    const done = statuses.filter((s) => s.is_done === 1)
    return [...defaults, ...middle, ...done]
  }, [statuses])

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden" tabIndex={-1}>
      <AddTaskInput ref={addInputRef} viewName={projectName} onSubmit={handleAddTask} labels={allLabels} projectId={projectId} />

      <LabelFilterBar labels={allLabels} projectId={projectId} />

      {layoutMode === 'kanban' ? (
        <KanbanView
          tasks={filteredTasks.filter((t) => t.is_archived === 0 && t.is_template === 0)}
          statuses={statuses}
          selectedTaskIds={selectedTaskIds}
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
                selectedTaskIds={selectedTaskIds}
                taskFilterOpacity={taskFilterOpacity}
                dropIndicator={dropIndicator}
                onSelectTask={handleSelectTask}
                onStatusChange={handleStatusChange}
                onTitleChange={handleTitleChange}
                onDeleteTask={handleDeleteTask}
                onAddLabel={handleAddLabel}
                onRemoveLabel={handleRemoveLabel}
                onCreateLabel={handleCreateLabel}
                onOpenDetail={clickOpensDetail === 'false' ? handleOpenDetail : undefined}
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
