import { useCallback, useMemo, useRef, useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useCopyTasks } from '../../shared/hooks/useCopyTasks'
import { useTaskStore } from '../../shared/stores'
import { useStatusStore } from '../../shared/stores'
import { useProjectStore, selectAllProjects } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores'
import {
  useLabelStore,
  selectActiveLabelFilters,
  selectHasActiveLabelFilters,
  selectFilterMode
} from '../../shared/stores'
import { useViewStore, selectLayoutMode } from '../../shared/stores/viewStore'
import { useSetting } from '../../shared/stores/settingsStore'
import { usePrioritySettings } from '../../shared/hooks/usePrioritySettings'
import { LabelFilterBar } from '../../shared/components/LabelFilterBar'
import { AddTaskInput, type AddTaskInputHandle, type SmartTaskData } from '../tasks/AddTaskInput'
import { StatusSection } from '../tasks/StatusSection'
import { KanbanView } from '../tasks/KanbanView'
import type { Task, Status, Label, Project } from '../../../../shared/types'
import type { DropIndicator } from '../tasks/useDragAndDrop'

interface MyDayViewProps {
  dropIndicator?: DropIndicator | null
}

export function MyDayView({ dropIndicator }: MyDayViewProps): React.JSX.Element {
  const allProjects = useProjectStore(selectAllProjects)
  const currentUser = useAuthStore((s) => s.currentUser)
  const { createTask, updateTask, setCurrentTask, selectTask, toggleTaskInSelection, selectTaskRange, selectAllTasks, clearSelection, addLabel, removeLabel, hydrateAllTaskLabels, setPendingDeleteTask } =
    useTaskStore()
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
  const lastSelectedTaskId = useTaskStore((s) => s.lastSelectedTaskId)
  const allTasks = useTaskStore((s) => s.tasks)
  const taskLabels = useTaskStore((s) => s.taskLabels)
  const allStatuses = useStatusStore((s) => s.statuses)
  const layoutMode = useViewStore(selectLayoutMode)
  const newTaskPosition = useSetting('new_task_position') ?? 'top'
  const addInputRef = useRef<AddTaskInputHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Project selector for add-task input
  const defaultProject = useMemo(
    () => allProjects.find((p) => p.is_default === 1) ?? allProjects[0],
    [allProjects]
  )
  const [addTaskProjectId, setAddTaskProjectId] = useState<string>('')

  useEffect(() => {
    if (defaultProject && !addTaskProjectId) {
      setAddTaskProjectId(defaultProject.id)
    }
  }, [defaultProject, addTaskProjectId])

  const addTaskProject = allProjects.find((p) => p.id === addTaskProjectId) ?? defaultProject

  // Label state
  const activeLabelFilters = useLabelStore(selectActiveLabelFilters)
  const hasActiveFilters = useLabelStore(selectHasActiveLabelFilters)
  const filterMode = useLabelStore(selectFilterMode)
  const { createLabel: createLabelInStore } = useLabelStore()
  const { autoSort: priorityAutoSort } = usePrioritySettings()
  const { copySelectedTasks } = useCopyTasks()

  // Hydrate task labels for all projects that have my-day tasks
  const myDayProjectIds = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    const ids = new Set<string>()
    for (const t of Object.values(allTasks)) {
      if (
        t.is_archived === 0 &&
        t.is_template === 0 &&
        (t.is_in_my_day === 1 || (t.due_date && t.due_date.startsWith(today)))
      ) {
        ids.add(t.project_id)
      }
    }
    return [...ids]
  }, [allTasks])

  useEffect(() => {
    for (const pid of myDayProjectIds) {
      hydrateAllTaskLabels(pid)
    }
  }, [myDayProjectIds, hydrateAllTaskLabels])

  // My Day tasks
  const myDayTasks = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    return Object.values(allTasks).filter(
      (t) =>
        t.is_archived === 0 &&
        t.is_template === 0 &&
        (t.is_in_my_day === 1 || (t.due_date && t.due_date.startsWith(today)))
    )
  }, [allTasks])

  // Aggregate labels from ALL projects with My Day tasks
  const allLabelsAcrossProjects = useMemo(() => {
    const labelStore = useLabelStore.getState()
    const labels: Label[] = []
    const seen = new Set<string>()
    for (const pid of myDayProjectIds) {
      const projectLabels = Object.values(labelStore.labels).filter(
        (l) => l.project_id === pid
      )
      for (const l of projectLabels) {
        if (!seen.has(l.id)) {
          seen.add(l.id)
          labels.push(l)
        }
      }
    }
    return labels
  }, [myDayProjectIds])

  // Labels for the add-task input (current add-task project)
  const addTaskLabels = useMemo(() => {
    const labelStore = useLabelStore.getState()
    return Object.values(labelStore.labels)
      .filter((l) => l.project_id === addTaskProjectId)
      .sort((a, b) => a.order_index - b.order_index)
  }, [addTaskProjectId])

  // Labels in use within My Day tasks
  const labelsInUse = useMemo(() => {
    const usedLabelIds = new Set<string>()
    for (const task of myDayTasks) {
      const labels = taskLabels[task.id]
      if (labels) {
        for (const l of labels) usedLabelIds.add(l.id)
      }
    }
    return allLabelsAcrossProjects.filter((l) => usedLabelIds.has(l.id))
  }, [myDayTasks, taskLabels, allLabelsAcrossProjects])

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

  // Group tasks by project, then by status within each project
  const projectGroups = useMemo(() => {
    const groups: Array<{
      project: Project
      statuses: Status[]
      tasks: Task[]
    }> = []

    // Get unique project IDs from filtered tasks
    const projectIds = [...new Set(filteredMyDayTasks.map((t) => t.project_id))]

    // Sort projects by sidebar_order
    const sortedProjectIds = projectIds.sort((a, b) => {
      const pa = allProjects.find((p) => p.id === a)
      const pb = allProjects.find((p) => p.id === b)
      return (pa?.sidebar_order ?? 0) - (pb?.sidebar_order ?? 0)
    })

    for (const pid of sortedProjectIds) {
      const project = allProjects.find((p) => p.id === pid)
      if (!project) continue

      const projectStatuses = Object.values(allStatuses)
        .filter((s) => s.project_id === pid)
        .sort((a, b) => a.order_index - b.order_index)

      const projectTasks = filteredMyDayTasks.filter((t) => t.project_id === pid)

      groups.push({ project, statuses: projectStatuses, tasks: projectTasks })
    }

    return groups
  }, [filteredMyDayTasks, allProjects, allStatuses])

  // Flat task list for keyboard navigation
  const flatTasks = useMemo(() => {
    const result: Task[] = []
    for (const group of projectGroups) {
      const sortedStatuses = [...group.statuses].sort((a, b) => a.order_index - b.order_index)
      for (const status of sortedStatuses) {
        const statusTasks = group.tasks
          .filter((t) => t.status_id === status.id)
          .sort(prioritySortFn)
        result.push(...statusTasks)
      }
    }
    return result
  }, [projectGroups, prioritySortFn])

  const handleAddTask = useCallback(
    async (data: SmartTaskData) => {
      if (!currentUser || !addTaskProject) return
      const projectStatuses = Object.values(allStatuses)
        .filter((s) => s.project_id === addTaskProject.id)
        .sort((a, b) => a.order_index - b.order_index)
      const defaultStatus = projectStatuses.find((s) => s.is_default === 1) ?? projectStatuses[0]
      if (!defaultStatus) return

      const statusTasks = myDayTasks.filter((t) => t.status_id === defaultStatus.id && t.parent_id === null)
      const orderIndex = newTaskPosition === 'bottom'
        ? statusTasks.reduce((max, t) => Math.max(max, t.order_index), -1) + 1
        : statusTasks.reduce((min, t) => Math.min(min, t.order_index), 0) - 1
      const taskId = crypto.randomUUID()
      await createTask({
        id: taskId,
        project_id: addTaskProject.id,
        owner_id: currentUser.id,
        title: data.title,
        status_id: defaultStatus.id,
        order_index: orderIndex,
        is_in_my_day: 1,
        priority: data.priority,
        due_date: data.dueDate
      })
      for (const label of data.labels) {
        await addLabel(taskId, label.id)
      }
    },
    [currentUser, addTaskProject, allStatuses, myDayTasks, createTask, addLabel, newTaskPosition]
  )

  const handleStatusChange = useCallback(
    async (taskId: string, newStatusId: string) => {
      const newStatus = Object.values(allStatuses).find((s) => s.id === newStatusId)
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
    [allStatuses, updateTask]
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
          selectTask(taskId)
        }
      } else {
        selectTask(taskId)
      }
    },
    [flatTasks, lastSelectedTaskId, selectTask, toggleTaskInSelection, selectTaskRange]
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
      if (!addTaskProject) return
      await createLabelInStore({
        id: crypto.randomUUID(),
        project_id: addTaskProject.id,
        name,
        color
      })
    },
    [createLabelInStore, addTaskProject]
  )

  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleKeyDown = (e: KeyboardEvent): void => {
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

      // Escape clears selection
      if (e.key === 'Escape') {
        if (selectedTaskIds.size > 0) {
          e.preventDefault()
          clearSelection()
          return
        }
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
              const taskStatuses = Object.values(allStatuses)
                .filter((s) => s.project_id === task.project_id)
                .sort((a, b) => a.order_index - b.order_index)
              const idx = taskStatuses.findIndex((s) => s.id === task.status_id)
              const nextIdx = (idx + 1) % taskStatuses.length
              handleStatusChange(currentTaskId, taskStatuses[nextIdx].id)
            }
          }
          break
        }
        case 'Delete':
        case 'Backspace': {
          if (!(e.target instanceof HTMLInputElement)) {
            if (selectedTaskIds.size > 1) {
              e.preventDefault()
              useTaskStore.getState().setPendingBulkDeleteTasks([...selectedTaskIds])
            } else if (currentTaskId) {
              e.preventDefault()
              const nextIndex =
                currentIndex + 1 < flatTasks.length ? currentIndex + 1 : currentIndex - 1
              const nextTask = flatTasks[nextIndex]
              handleDeleteTask(currentTaskId)
              setCurrentTask(nextTask?.id ?? null)
            }
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
    selectedTaskIds,
    flatTasks,
    setCurrentTask,
    selectAllTasks,
    clearSelection,
    allTasks,
    allStatuses,
    handleStatusChange,
    handleDeleteTask,
    copySelectedTasks
  ])

  // For kanban view, use all statuses from the first project group (or merged)
  const kanbanStatuses = useMemo(() => {
    if (projectGroups.length === 0) return []
    // Use statuses from the first project for kanban layout
    return projectGroups[0].statuses
  }, [projectGroups])

  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden" tabIndex={-1}>
      <AddTaskInput
        ref={addInputRef}
        viewName="My Day"
        onSubmit={handleAddTask}
        labels={addTaskLabels}
        projectId={addTaskProjectId}
        projectSelector={
          <MyDayProjectSelector
            projects={allProjects}
            selectedProjectId={addTaskProjectId}
            onSelect={setAddTaskProjectId}
          />
        }
      />

      <LabelFilterBar labels={labelsInUse} />

      {layoutMode === 'kanban' ? (
        <KanbanView
          tasks={filteredMyDayTasks}
          statuses={kanbanStatuses}
          selectedTaskIds={selectedTaskIds}
          taskFilterOpacity={taskFilterOpacity}
          dropIndicator={dropIndicator}
          onSelectTask={handleSelectTask}
          onStatusChange={handleStatusChange}
          onDeleteTask={handleDeleteTask}
        />
      ) : (
        <div className="flex-1 overflow-y-auto" role="grid" aria-label="My Day tasks">
          {projectGroups.map((group) => {
            const sortedStatuses = [...group.statuses].sort(
              (a, b) => a.order_index - b.order_index
            )
            const groupLabels = allLabelsAcrossProjects.filter(
              (l) => l.project_id === group.project.id
            )

            return (
              <div key={group.project.id}>
                {/* Project header */}
                {projectGroups.length > 1 && (
                  <div className="flex items-center gap-2 px-6 pt-4 pb-1">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: group.project.color }}
                    />
                    <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
                      {group.project.name}
                    </span>
                  </div>
                )}

                {sortedStatuses.map((status) => {
                  const statusTasks = group.tasks
                    .filter((t) => t.status_id === status.id)
                    .sort(prioritySortFn)
                  return (
                    <StatusSection
                      key={status.id}
                      status={status}
                      tasks={statusTasks}
                      allStatuses={group.statuses}
                      allLabels={groupLabels}
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
                    />
                  )
                })}
              </div>
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

interface MyDayProjectSelectorProps {
  projects: Project[]
  selectedProjectId: string
  onSelect: (projectId: string) => void
}

function MyDayProjectSelector({
  projects,
  selectedProjectId,
  onSelect
}: MyDayProjectSelectorProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = projects.find((p) => p.id === selectedProjectId)

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('mousedown', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative flex-shrink-0 pl-4 pr-1 py-2.5">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 transition-colors hover:bg-foreground/6"
        title="Select project for new task"
      >
        <div
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: selected?.color ?? '#888' }}
        />
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted max-w-[80px] truncate">
          {selected?.name ?? 'Project'}
        </span>
        <ChevronDown size={10} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute left-4 top-full z-50 mt-1 min-w-[160px] overflow-hidden rounded-lg border border-border bg-surface shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in motion-safe:duration-100">
          <div className="max-h-48 overflow-y-auto py-1">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  onSelect(p.id)
                  setOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-foreground/6 ${
                  p.id === selectedProjectId ? 'bg-accent/12' : ''
                }`}
              >
                <div
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: p.color }}
                />
                <span className="text-[11px] font-light text-foreground truncate">
                  {p.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
