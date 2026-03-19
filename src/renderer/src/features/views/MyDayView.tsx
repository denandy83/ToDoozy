import { useCallback, useMemo, useRef, useEffect } from 'react'
import { useTaskStore } from '../../shared/stores'
import { useStatusesByProject } from '../../shared/stores'
import { useProjectStore, selectCurrentProject } from '../../shared/stores'
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
import { AddTaskInput, type AddTaskInputHandle } from '../tasks/AddTaskInput'
import { StatusSection } from '../tasks/StatusSection'
import { KanbanView } from '../tasks/KanbanView'
import type { Task } from '../../../../shared/types'
import type { DropIndicator } from '../tasks/useDragAndDrop'

interface MyDayViewProps {
  dropIndicator?: DropIndicator | null
}

export function MyDayView({ dropIndicator }: MyDayViewProps): React.JSX.Element {
  const currentProject = useProjectStore(selectCurrentProject)
  const projectId = currentProject?.id ?? ''
  const statuses = useStatusesByProject(projectId)
  const currentUser = useAuthStore((s) => s.currentUser)
  const { createTask, updateTask, setCurrentTask, addLabel, removeLabel, hydrateAllTaskLabels, setPendingDeleteTask } =
    useTaskStore()
  const currentTaskId = useTaskStore((s) => s.currentTaskId)
  const allTasks = useTaskStore((s) => s.tasks)
  const taskLabels = useTaskStore((s) => s.taskLabels)
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

  // My Day: is_in_my_day OR due today
  const myDayTasks = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    return Object.values(allTasks).filter(
      (t) =>
        t.is_archived === 0 &&
        t.is_template === 0 &&
        (t.is_in_my_day === 1 || (t.due_date && t.due_date.startsWith(today)))
    )
  }, [allTasks])

  // Labels in use within My Day tasks
  const labelsInUse = useMemo(() => {
    const usedLabelIds = new Set<string>()
    for (const task of myDayTasks) {
      const labels = taskLabels[task.id]
      if (labels) {
        for (const l of labels) usedLabelIds.add(l.id)
      }
    }
    return allLabels.filter((l) => usedLabelIds.has(l.id))
  }, [myDayTasks, taskLabels, allLabels])

  // Filter tasks
  const filteredMyDayTasks = useMemo(() => {
    if (!hasActiveFilters || filterMode !== 'hide') return myDayTasks
    return myDayTasks.filter((task) => {
      const labels = taskLabels[task.id] ?? []
      const labelIds = new Set(labels.map((l) => l.id))
      return [...activeLabelFilters].some((fid) => labelIds.has(fid))
    })
  }, [myDayTasks, taskLabels, activeLabelFilters, hasActiveFilters, filterMode])

  // Blur opacity map
  const blurOpacityStr = useSetting('label_blur_opacity')
  const blurOpacity = (blurOpacityStr ? parseInt(blurOpacityStr, 10) : 8) / 100

  const taskFilterOpacity = useMemo(() => {
    if (!hasActiveFilters || filterMode !== 'blur') return undefined
    const map: Record<string, number> = {}
    for (const task of myDayTasks) {
      const labels = taskLabels[task.id] ?? []
      const labelIds = new Set(labels.map((l) => l.id))
      const matches = [...activeLabelFilters].some((fid) => labelIds.has(fid))
      map[task.id] = matches ? 1 : blurOpacity
    }
    return map
  }, [myDayTasks, taskLabels, activeLabelFilters, hasActiveFilters, filterMode, blurOpacity])

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

  const flatTasks = useMemo(() => {
    const result: Task[] = []
    const sorted = [...statuses].sort((a, b) => a.order_index - b.order_index)
    for (const status of sorted) {
      const statusTasks = filteredMyDayTasks
        .filter((t) => t.status_id === status.id)
        .sort(prioritySortFn)
      result.push(...statusTasks)
    }
    return result
  }, [filteredMyDayTasks, statuses, prioritySortFn])

  const handleAddTask = useCallback(
    async (title: string) => {
      if (!currentUser || !currentProject) return
      const defaultStatus = statuses.find((s) => s.is_default === 1)
      if (!defaultStatus) return

      const maxOrder = myDayTasks.reduce((max, t) => Math.max(max, t.order_index), -1)
      await createTask({
        id: crypto.randomUUID(),
        project_id: currentProject.id,
        owner_id: currentUser.id,
        title,
        status_id: defaultStatus.id,
        order_index: maxOrder + 1,
        is_in_my_day: 1
      })
    },
    [currentUser, currentProject, statuses, myDayTasks, createTask]
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
      if (!currentProject) return
      await createLabelInStore({
        id: crypto.randomUUID(),
        project_id: currentProject.id,
        name,
        color
      })
    },
    [createLabelInStore, currentProject]
  )

  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      const currentIndex = currentTaskId
        ? flatTasks.findIndex((t) => t.id === currentTaskId)
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
          if (currentIndex <= 0) {
            setCurrentTask(null)
            addInputRef.current?.focus()
          } else {
            setCurrentTask(flatTasks[currentIndex - 1].id)
          }
          break
        }
        case 'Enter': {
          if (!currentTaskId) {
            e.preventDefault()
            addInputRef.current?.focus()
          }
          break
        }
        case ' ': {
          if (currentTaskId && !(e.target instanceof HTMLInputElement)) {
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
          if (currentTaskId && !(e.target instanceof HTMLInputElement)) {
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
          if (!(e.target instanceof HTMLInputElement)) {
            e.preventDefault()
            if (e.shiftKey) {
              const prevIndex = Math.max(currentIndex - 1, 0)
              if (flatTasks[prevIndex]) setCurrentTask(flatTasks[prevIndex].id)
            } else {
              const nextIndex = Math.min(currentIndex + 1, flatTasks.length - 1)
              if (flatTasks[nextIndex]) setCurrentTask(flatTasks[nextIndex].id)
            }
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
    statuses,
    handleStatusChange,
    handleDeleteTask
  ])

  const sortedStatuses = useMemo(
    () => [...statuses].sort((a, b) => a.order_index - b.order_index),
    [statuses]
  )

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden" tabIndex={-1}>
      <AddTaskInput ref={addInputRef} viewName="My Day" onSubmit={handleAddTask} />

      <LabelFilterBar labels={labelsInUse} />

      {layoutMode === 'kanban' ? (
        <KanbanView
          tasks={filteredMyDayTasks}
          statuses={statuses}
          selectedTaskId={currentTaskId}
          taskFilterOpacity={taskFilterOpacity}
          dropIndicator={dropIndicator}
          onSelectTask={handleSelectTask}
          onStatusChange={handleStatusChange}
          onDeleteTask={handleDeleteTask}
        />
      ) : (
        <div className="flex-1 overflow-y-auto" role="grid" aria-label="My Day tasks">
          {sortedStatuses.map((status) => {
            const statusTasks = filteredMyDayTasks
              .filter((t) => t.status_id === status.id)
              .sort(prioritySortFn)
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

          {filteredMyDayTasks.length === 0 && (
            <div className="px-6 py-4">
              <p className="text-sm font-light text-muted/60">
                No tasks for today.
              </p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-muted/40">
                Add tasks or add them to My Day
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
