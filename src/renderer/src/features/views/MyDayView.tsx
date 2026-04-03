import { useCallback, useMemo, useRef, useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useToast } from '../../shared/components/Toast'
import { useCopyTasks } from '../../shared/hooks/useCopyTasks'
import { useTaskStore } from '../../shared/stores'
import { useStatusStore } from '../../shared/stores'
import { useProjectStore, selectAllProjects } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores'
import {
  useLabelStore,
  selectActiveLabelFilters,
  selectHasActiveLabelFilters,
  selectFilterMode,
  selectPriorityFilters,
  selectHasPriorityFilters,
  selectStatusFilters,
  selectHasStatusFilters,
  selectDueDatePreset,
  selectKeyword,
  selectHasAnyFilter
} from '../../shared/stores'
import { useViewStore, selectLayoutMode } from '../../shared/stores/viewStore'
import { useSetting } from '../../shared/stores/settingsStore'
import { usePrioritySettings } from '../../shared/hooks/usePrioritySettings'
import { useCreateOrMatchLabel } from '../../shared/hooks/useCreateOrMatchLabel'
import { FilterBar } from '../../shared/components/FilterBar'
import { AddTaskInput, type AddTaskInputHandle, type SmartTaskData } from '../tasks/AddTaskInput'
import { StatusSection } from '../tasks/StatusSection'
import { KanbanView } from '../tasks/KanbanView'
import type { Task, Label, Project } from '../../../../shared/types'
import { shouldForceDelete } from '../../shared/utils/shiftDelete'
import type { DropIndicator } from '../tasks/useDragAndDrop'
import {
  MY_DAY_BUCKETS,
  getBucketForTask,
  getBucketForStatus,
  findProjectStatusForBucket,
  createBucketStatus,
  type BucketKey
} from './myDayBuckets'

interface MyDayViewProps {
  dropIndicator?: DropIndicator | null
}

export function MyDayView({ dropIndicator }: MyDayViewProps): React.JSX.Element {
  const allProjects = useProjectStore(selectAllProjects)
  const currentUser = useAuthStore((s) => s.currentUser)
  const { createTask, updateTask, deleteTask, setCurrentTask, navigateTask, selectTask, toggleTaskInSelection, selectTaskRange, selectAllTasks, clearSelection, addLabel, removeLabel, hydrateAllTaskLabels, setPendingDeleteTask, toggleExpanded, setExpanded } =
    useTaskStore()
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
  const lastSelectedTaskId = useTaskStore((s) => s.lastSelectedTaskId)
  const allTasks = useTaskStore((s) => s.tasks)
  const taskLabels = useTaskStore((s) => s.taskLabels)
  const allStatuses = useStatusStore((s) => s.statuses)
  const { addToast } = useToast()
  const layoutMode = useViewStore(selectLayoutMode)
  const newTaskPosition = useSetting('new_task_position') ?? 'top'
  const addInputRef = useRef<AddTaskInputHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Project selector for add-task input — uses setting, falls back to is_default project
  const myDayDefaultProjectSetting = useSetting('myday_default_project')
  const defaultProject = useMemo(() => {
    if (myDayDefaultProjectSetting) {
      const found = allProjects.find((p) => p.id === myDayDefaultProjectSetting)
      if (found) return found
    }
    return allProjects.find((p) => p.is_default === 1) ?? allProjects[0]
  }, [allProjects, myDayDefaultProjectSetting])
  const [addTaskProjectId, setAddTaskProjectId] = useState<string>('')
  const [hiddenProjectIds, setHiddenProjectIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (defaultProject) {
      setAddTaskProjectId(defaultProject.id)
    }
  }, [defaultProject?.id])

  const addTaskProject = allProjects.find((p) => p.id === addTaskProjectId) ?? defaultProject

  // Filter state
  const activeLabelFilters = useLabelStore(selectActiveLabelFilters)
  const hasActiveFilters = useLabelStore(selectHasActiveLabelFilters)
  const filterMode = useLabelStore(selectFilterMode)
  const priorityFilters = useLabelStore(selectPriorityFilters)
  const hasPriorityFilters = useLabelStore(selectHasPriorityFilters)
  const statusFilters = useLabelStore(selectStatusFilters)
  const hasStatusFilters = useLabelStore(selectHasStatusFilters)
  const dueDatePreset = useLabelStore(selectDueDatePreset)
  const keywordFilter = useLabelStore(selectKeyword)
  const hasAnyFilterGlobal = useLabelStore(selectHasAnyFilter)
  const createOrMatchLabel = useCreateOrMatchLabel(addTaskProjectId)
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
        t.parent_id === null &&
        (t.is_in_my_day === 1 || (t.due_date && t.due_date.startsWith(today)))
      ) {
        ids.add(t.project_id)
      }
    }
    return [...ids]
  }, [allTasks])

  const hydrateStatuses = useStatusStore((s) => s.hydrateStatuses)
  const hydrateLabels = useLabelStore((s) => s.hydrateLabels)

  useEffect(() => {
    for (const pid of myDayProjectIds) {
      hydrateAllTaskLabels(pid)
      hydrateStatuses(pid)
      hydrateLabels(pid)
    }
  }, [myDayProjectIds, hydrateAllTaskLabels, hydrateStatuses, hydrateLabels])

  // My Day tasks — only top-level tasks (no subtasks), consistent with sidebar count
  // Also include archived tasks completed today so My Day shows the full day's work
  const myDayTasks = useMemo(() => {
    const today = new Date().toISOString().split('T')[0]
    return Object.values(allTasks).filter(
      (t) =>
        t.is_template === 0 &&
        t.parent_id === null &&
        (
          (t.is_archived === 0 && (t.is_in_my_day === 1 || (t.due_date && t.due_date.startsWith(today)))) ||
          (t.is_archived === 1 && t.completed_date && t.completed_date.startsWith(today))
        )
    )
  }, [allTasks])

  // Aggregate labels from ALL projects with My Day tasks
  const allLabelsAcrossProjects = useMemo(() => {
    const labelState = useLabelStore.getState()
    const labels: Label[] = []
    const seen = new Set<string>()
    for (const pid of myDayProjectIds) {
      const projectLabelIds = labelState.projectLabels[pid] ?? new Set()
      for (const id of projectLabelIds) {
        if (!seen.has(id)) {
          seen.add(id)
          const l = labelState.labels[id]
          if (l) labels.push(l)
        }
      }
    }
    return labels
  }, [myDayProjectIds])

  // Labels for the add-task input (current add-task project)
  const addTaskLabels = useMemo(() => {
    const labelState = useLabelStore.getState()
    const projectLabelIds = labelState.projectLabels[addTaskProjectId] ?? new Set()
    return Array.from(projectLabelIds)
      .map((id) => labelState.labels[id])
      .filter((l): l is Label => l !== undefined)
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

  // Shared filter match for My Day
  const taskMatchesFilters = useCallback((task: Task): boolean => {
    if (!hasAnyFilterGlobal) return true
    if (hasActiveFilters) {
      const labels = taskLabels[task.id] ?? []
      const labelIds = new Set(labels.map((l) => l.id))
      if (![...activeLabelFilters].some((fid) => labelIds.has(fid))) return false
    }
    if (hasPriorityFilters && !priorityFilters.has(task.priority)) return false
    if (hasStatusFilters && !statusFilters.has(task.status_id)) return false
    if (dueDatePreset) {
      const now = new Date()
      const todayStr = now.toISOString().slice(0, 10)
      if (dueDatePreset === 'no_date') { if (task.due_date) return false }
      else if (dueDatePreset === 'overdue') { if (!task.due_date || task.due_date >= todayStr) return false }
      else if (dueDatePreset === 'today') { if (!task.due_date || task.due_date.slice(0, 10) !== todayStr) return false }
      else if (dueDatePreset === 'this_week') {
        if (!task.due_date) return false
        const endOfWeek = new Date(now); endOfWeek.setDate(now.getDate() + (7 - now.getDay()))
        if (task.due_date.slice(0, 10) > endOfWeek.toISOString().slice(0, 10) || task.due_date.slice(0, 10) < todayStr) return false
      }
    }
    if (keywordFilter) {
      const kw = keywordFilter.toLowerCase()
      if (!task.title.toLowerCase().includes(kw) && !(task.description ?? '').toLowerCase().includes(kw)) return false
    }
    return true
  }, [hasAnyFilterGlobal, hasActiveFilters, activeLabelFilters, taskLabels, hasPriorityFilters, priorityFilters, hasStatusFilters, statusFilters, dueDatePreset, keywordFilter])

  // Filter tasks by all active filters
  const labelFilteredTasks = useMemo(() => {
    if (!hasAnyFilterGlobal || filterMode !== 'hide') return myDayTasks
    return myDayTasks.filter(taskMatchesFilters)
  }, [myDayTasks, hasAnyFilterGlobal, filterMode, taskMatchesFilters])

  // Filter tasks by project visibility
  const filteredMyDayTasks = useMemo(() => {
    if (hiddenProjectIds.size === 0) return labelFilteredTasks
    return labelFilteredTasks.filter((t) => !hiddenProjectIds.has(t.project_id))
  }, [labelFilteredTasks, hiddenProjectIds])

  // Projects that have My Day tasks (for project filter bar)
  const myDayProjects = useMemo(() => {
    const projectIds = [...new Set(myDayTasks.map((t) => t.project_id))]
    return allProjects
      .filter((p) => projectIds.includes(p.id))
      .sort((a, b) => (a.sidebar_order ?? 0) - (b.sidebar_order ?? 0))
  }, [myDayTasks, allProjects])

  const toggleProjectFilter = useCallback((projectId: string) => {
    setHiddenProjectIds((prev) => {
      const next = new Set(prev)
      if (next.has(projectId)) {
        next.delete(projectId)
      } else {
        next.add(projectId)
      }
      return next
    })
  }, [])

  // Blur opacity map
  const blurOpacityStr = useSetting('label_blur_opacity')
  const blurOpacity = (blurOpacityStr ? parseInt(blurOpacityStr, 10) : 8) / 100

  const taskFilterOpacity = useMemo(() => {
    if (!hasAnyFilterGlobal || filterMode !== 'blur') return undefined
    const map: Record<string, number> = {}
    for (const task of myDayTasks) {
      map[task.id] = taskMatchesFilters(task) ? 1 : blurOpacity
    }
    return map
  }, [myDayTasks, hasAnyFilterGlobal, filterMode, blurOpacity, taskMatchesFilters])

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

  // Group tasks into 3 universal buckets based on status flags
  const bucketGroups = useMemo(() => {
    return MY_DAY_BUCKETS.map((bucket) => ({
      bucket,
      tasks: filteredMyDayTasks.filter(
        (t) => getBucketForTask(t, allStatuses) === bucket.key
      )
    }))
  }, [filteredMyDayTasks, allStatuses])

  // Map a real status ID to a bucket status ID
  const mapStatusToBucketId = useCallback(
    (statusId: string): string => {
      const status = allStatuses[statusId]
      const bucket = getBucketForStatus(status)
      return `__bucket_${bucket}`
    },
    [allStatuses]
  )

  // Synthetic statuses for kanban columns
  const bucketStatuses = useMemo(
    () => MY_DAY_BUCKETS.map(createBucketStatus),
    []
  )

  // Pre-grouped tasks for kanban (keyed by synthetic bucket status ID)
  const kanbanPreGrouped = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const group of bucketGroups) {
      map[`__bucket_${group.bucket.key}`] = [...group.tasks].sort(prioritySortFn)
    }
    return map
  }, [bucketGroups, prioritySortFn])

  // Build a project lookup for task indicators
  const projectMap = useMemo(() => {
    const map: Record<string, Project> = {}
    for (const p of allProjects) map[p.id] = p
    return map
  }, [allProjects])

  const expandedTaskIds = useTaskStore((s) => s.expandedTaskIds)

  // Flat task list for keyboard navigation — includes subtasks of expanded parents
  const flatTasks = useMemo(() => {
    const result: Task[] = []
    for (const group of bucketGroups) {
      for (const task of [...group.tasks].sort(prioritySortFn)) {
        result.push(task)
        if (expandedTaskIds.has(task.id)) {
          const subtasks = Object.values(allTasks)
            .filter((t) => t.parent_id === task.id && t.is_archived === 0)
            .sort((a, b) => a.order_index - b.order_index)
          result.push(...subtasks)
        }
      }
    }
    return result
  }, [bucketGroups, prioritySortFn, expandedTaskIds, allTasks])

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
      const update: { status_id: string; completed_date?: string | null; order_index?: number } = {
        status_id: newStatusId
      }
      if (newStatus?.is_done === 1) {
        update.completed_date = new Date().toISOString()
      } else {
        update.completed_date = null
      }
      // Position task at top or bottom of target bucket based on setting
      // In My Day, tasks from different projects share buckets, so match by bucket not status_id
      const targetBucket = getBucketForStatus(newStatus)
      const currentMyDayTasks = myDayTasks.filter(
        (t) => t.id !== taskId && getBucketForTask(t, allStatuses) === targetBucket
      )
      if (currentMyDayTasks.length > 0) {
        update.order_index = newTaskPosition === 'bottom'
          ? Math.max(...currentMyDayTasks.map((t) => t.order_index)) + 1
          : Math.min(...currentMyDayTasks.map((t) => t.order_index)) - 1
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
    [allStatuses, updateTask, newTaskPosition, myDayTasks]
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
      if (!addTaskProject) return
      await createOrMatchLabel(name, color)
    },
    [createOrMatchLabel, addTaskProject]
  )

  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scrollTaskIntoView = (taskId: string): void => {
      requestAnimationFrame(() => {
        const el = container.querySelector(`[data-task-id="${taskId}"]`)
        el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      })
    }

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

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault()
          const nextIndex = Math.min(currentIndex + 1, flatTasks.length - 1)
          if (flatTasks[nextIndex]) {
            const id = flatTasks[nextIndex].id
            setCurrentTask(id)
            scrollTaskIntoView(id)
          }
          break
        }
        case 'ArrowUp': {
          e.preventDefault()
          if (currentIndex <= 0) {
            setCurrentTask(null)
            addInputRef.current?.focus()
          } else {
            const id = flatTasks[currentIndex - 1].id
            setCurrentTask(id)
            scrollTaskIntoView(id)
          }
          break
        }
        case 'Enter': {
          e.preventDefault()
          if (currentTaskId) {
            setCurrentTask(currentTaskId)
            requestAnimationFrame(() => {
              const titleEl = document.querySelector<HTMLElement>('[data-detail-title]')
              titleEl?.focus()
            })
          } else {
            addInputRef.current?.focus()
          }
          break
        }
        case ' ': {
          if (!(e.target instanceof HTMLInputElement)) {
            e.preventDefault()
            const tasksToUpdate = selectedTaskIds.size > 0 ? [...selectedTaskIds] : currentTaskId ? [currentTaskId] : []
            if (tasksToUpdate.length > 0) {
              const anchorId = currentTaskId ?? tasksToUpdate[0]
              for (const taskId of tasksToUpdate) {
                const task = allTasks[taskId]
                if (task) {
                  const taskStatuses = Object.values(allStatuses)
                    .filter((s) => s.project_id === task.project_id)
                    .sort((a, b) => {
                      if (a.is_default === 1 && b.is_default !== 1) return -1
                      if (b.is_default === 1 && a.is_default !== 1) return 1
                      if (a.is_done === 1 && b.is_done !== 1) return 1
                      if (b.is_done === 1 && a.is_done !== 1) return -1
                      return a.order_index - b.order_index
                    })
                  const idx = taskStatuses.findIndex((s) => s.id === task.status_id)
                  const nextStatus = taskStatuses[(idx + 1) % taskStatuses.length]
                  if (nextStatus) handleStatusChange(taskId, nextStatus.id)
                }
              }
              // Re-focus container and scroll anchor task into view after DOM update
              requestAnimationFrame(() => {
                containerRef.current?.focus()
                if (anchorId) scrollTaskIntoView(anchorId)
              })
            }
          }
          break
        }
        case 'ArrowRight': {
          if (currentTaskId) {
            e.preventDefault()
            const hasSubtasks = Object.values(allTasks).some((t) => t.parent_id === currentTaskId)
            if (hasSubtasks) setExpanded(currentTaskId, true)
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
              navigateTask(task.parent_id)
            }
          }
          break
        }
        case 'Delete':
        case 'Backspace': {
          if (!(e.target instanceof HTMLInputElement)) {
            if (shouldForceDelete(e)) {
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
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [
    selectedTaskIds,
    flatTasks,
    setCurrentTask,
    navigateTask,
    selectAllTasks,
    clearSelection,
    allTasks,
    allStatuses,
    handleStatusChange,
    handleDeleteTask,
    copySelectedTasks,
    toggleExpanded,
    setExpanded,
    expandedTaskIds
  ])

  // Auto-select first task (without opening detail panel) when My Day mounts or selection is cleared
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
      containerRef.current?.focus()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSelection])

  // Tab navigation: intercept Tab globally when My Day is the active view.
  // Skips text inputs and rich-text editors; everything else (header buttons, project
  // filter chips, sidebar items) should not consume Tab — tasks should.
  useEffect(() => {
    const handleTab = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const container = containerRef.current
      if (!container) return
      // Only handle when focus is inside this container (not on body, detail panel, or popups)
      if (!container.contains(document.activeElement)) return
      // Let Tab work normally inside text inputs and textareas
      if (document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement) return
      // If no tasks, nothing to cycle — let browser handle it
      const tasks = flatTasks
      if (tasks.length === 0) return
      e.preventDefault()
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

  // Handle status changes in My Day — map bucket IDs or cross-project statuses to correct project status
  const handleMyDayStatusChange = useCallback(
    async (taskId: string, newStatusId: string) => {
      const task = allTasks[taskId]
      if (!task) return

      // Handle synthetic bucket status IDs (from StatusButton cycling through buckets)
      if (newStatusId.startsWith('__bucket_')) {
        const bucketKey = newStatusId.replace('__bucket_', '') as BucketKey
        const bucketOrder: BucketKey[] = ['not_started', 'in_progress', 'done']
        // Find the first valid bucket starting from the requested one, wrapping around
        const startIdx = bucketOrder.indexOf(bucketKey)
        let correctStatus: ReturnType<typeof findProjectStatusForBucket> = undefined
        for (let i = 0; i < bucketOrder.length; i++) {
          const tryBucket = bucketOrder[(startIdx + i) % bucketOrder.length]
          correctStatus = findProjectStatusForBucket(task.project_id, tryBucket, allStatuses)
          if (correctStatus && correctStatus.id !== task.status_id) break
          if (correctStatus && correctStatus.id === task.status_id) { correctStatus = undefined; continue }
        }
        if (correctStatus && correctStatus.id !== task.status_id) {
          await handleStatusChange(taskId, correctStatus.id)
        }
        return
      }

      const newStatus = allStatuses[newStatusId]
      if (!newStatus) return

      if (newStatus.project_id !== task.project_id) {
        const bucket = getBucketForStatus(newStatus)
        const correctStatus = findProjectStatusForBucket(task.project_id, bucket, allStatuses)
        if (correctStatus) {
          await handleStatusChange(taskId, correctStatus.id)
        }
        return
      }
      await handleStatusChange(taskId, newStatusId)
    },
    [allTasks, allStatuses, handleStatusChange, addToast]
  )


  return (
    <div ref={containerRef} className="flex flex-1 flex-col overflow-hidden" tabIndex={-1}>
      <AddTaskInput
        ref={addInputRef}
        viewName="My Day"
        onSubmit={handleAddTask}
        labels={addTaskLabels}
        projectId={addTaskProjectId}
        projects={allProjects}
        onProjectChange={setAddTaskProjectId}
        projectSelector={
          <MyDayProjectSelector
            projects={allProjects}
            selectedProjectId={addTaskProjectId}
            onSelect={setAddTaskProjectId}
          />
        }
      />

      <FilterBar labels={labelsInUse} />

      {/* Project filter bar — only show when multiple projects have My Day tasks */}
      {myDayProjects.length > 1 && (
        <div className="flex items-center gap-2 px-4 py-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Projects</span>
          <div className="flex items-center gap-1">
            {myDayProjects.map((p) => {
              const isHidden = hiddenProjectIds.has(p.id)
              return (
                <button
                  key={p.id}
                  onClick={() => toggleProjectFilter(p.id)}
                  className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
                    isHidden
                      ? 'text-muted/40 hover:text-muted'
                      : 'text-foreground'
                  }`}
                  style={{
                    backgroundColor: isHidden ? 'transparent' : `${p.color}20`,
                    border: `1px solid ${isHidden ? 'transparent' : `${p.color}30`}`
                  }}
                >
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: isHidden ? 'var(--color-muted)' : p.color, opacity: isHidden ? 0.3 : 1 }}
                  />
                  {p.name}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {(labelsInUse.length > 0 || myDayProjects.length > 1) && (
        <div className="border-b border-border" />
      )}

      {layoutMode === 'kanban' ? (
        <KanbanView
          tasks={filteredMyDayTasks}
          statuses={bucketStatuses}
          selectedTaskIds={selectedTaskIds}
          taskFilterOpacity={taskFilterOpacity}
          dropIndicator={dropIndicator}
          onSelectTask={handleSelectTask}
          onStatusChange={handleMyDayStatusChange}
          onDeleteTask={handleDeleteTask}
          preGroupedTasks={kanbanPreGrouped}
        />
      ) : (
        <div className="flex-1 overflow-y-auto" role="grid" aria-label="My Day tasks">
          {bucketGroups.map((group) => {
            const sortedTasks = [...group.tasks].sort(prioritySortFn)
            const bucketStatus = createBucketStatus(group.bucket)
            return (
              <StatusSection
                key={group.bucket.key}
                status={bucketStatus}
                tasks={sortedTasks}
                allStatuses={bucketStatuses}
                allLabels={allLabelsAcrossProjects}
                selectedTaskIds={selectedTaskIds}
                taskFilterOpacity={taskFilterOpacity}
                dropIndicator={dropIndicator}
                onSelectTask={handleSelectTask}
                onStatusChange={handleMyDayStatusChange}
                onTitleChange={handleTitleChange}
                onDeleteTask={handleDeleteTask}
                onAddLabel={handleAddLabel}
                onRemoveLabel={handleRemoveLabel}
                onCreateLabel={handleCreateLabel}
                onOpenDetail={clickOpensDetail === 'false' ? handleOpenDetail : undefined}
                projectMap={projectMap}
                bucketName={group.bucket.name}
                bucketColor={group.bucket.color}
                mapStatusId={mapStatusToBucketId}
                hideAssignee
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
