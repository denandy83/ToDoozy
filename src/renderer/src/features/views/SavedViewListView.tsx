import { useEffect, useMemo, useCallback, useRef } from 'react'
import { Filter } from 'lucide-react'
import { useViewStore, selectSelectedSavedViewId } from '../../shared/stores/viewStore'
import { useSavedViewStore, selectSavedViews } from '../../shared/stores/savedViewStore'
import {
  useLabelStore, selectHasAnyFilter, selectAllLabels,
  selectExcludeLabelFilters, selectHasExcludeLabelFilters,
  selectExcludeStatusFilters, selectHasExcludeStatusFilters,
  selectExcludePriorityFilters, selectHasExcludePriorityFilters,
  selectExcludeProjectFilters, selectHasExcludeProjectFilters,
  selectSortRules, selectLabelFilterLogic
} from '../../shared/stores'
import type { DueDateRange } from '../../shared/stores'
import { useTaskStore } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores/authStore'
import { useStatusStore } from '../../shared/stores/statusStore'
import { useProjectStore } from '../../shared/stores/projectStore'
import { useSetting } from '../../shared/stores/settingsStore'
import { useCreateOrMatchLabel } from '../../shared/hooks/useCreateOrMatchLabel'
import { FilterBar } from '../../shared/components/FilterBar'
import { matchesDueDateFilter } from '../../shared/utils/dueDateFilter'
import { TaskRow } from '../tasks/TaskRow'
import type { Status } from '../../../../shared/types'
import type { SortRule } from '../../shared/utils/sortTasks'
import { createSortComparator, DEFAULT_SAVED_VIEW_SORT } from '../../shared/utils/sortTasks'

interface FilterConfig {
  labelIds?: string[]
  assigneeIds?: string[]
  priorities?: number[]
  statusIds?: string[]
  projectIds?: string[]
  excludeLabelIds?: string[]
  excludeStatusIds?: string[]
  excludePriorities?: number[]
  excludeAssigneeIds?: string[]
  excludeProjectIds?: string[]
  dueDatePreset?: string
  dueDateRange?: DueDateRange
  keyword?: string
  filterMode?: 'hide' | 'blur'
  sortRules?: SortRule[]
  labelLogic?: 'any' | 'all'
}

export function SavedViewListView(): React.JSX.Element {
  const selectedViewId = useViewStore(selectSelectedSavedViewId)
  const savedViews = useSavedViewStore(selectSavedViews)
  const currentView = savedViews.find((v) => v.id === selectedViewId)
  const { updateView } = useSavedViewStore()
  const userId = useAuthStore((s) => s.currentUser)?.id ?? ''
  const allTasks = useTaskStore((s) => s.tasks)
  const taskLabels = useTaskStore((s) => s.taskLabels)
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
  const expandedTaskIds = useTaskStore((s) => s.expandedTaskIds)
  const hasAnyFilter = useLabelStore(selectHasAnyFilter)
  const allLabels = useLabelStore(selectAllLabels)
  const sortRules = useLabelStore(selectSortRules)
  const { selectTask, toggleTaskInSelection, selectTaskRange, updateTask, setPendingDeleteTask, addLabel, removeLabel, toggleExpanded, selectAllTasks } = useTaskStore()
  const clickOpensDetail = useSetting('click_opens_detail') ?? 'true'
  const containerRef = useRef<HTMLDivElement>(null)

  // Get all statuses and projects for TaskRow
  const allStatusesRecord = useStatusStore((s) => s.statuses)
  const allProjects = useProjectStore((s) => s.projects)

  // Build per-project status arrays and flat statuses
  const { statusesByProject, flatStatuses } = useMemo(() => {
    const byProject: Record<string, Status[]> = {}
    const flat: Status[] = []
    for (const s of Object.values(allStatusesRecord)) {
      flat.push(s)
      if (!byProject[s.project_id]) byProject[s.project_id] = []
      byProject[s.project_id].push(s)
    }
    return { statusesByProject: byProject, flatStatuses: flat }
  }, [allStatusesRecord])

  const projectMap = allProjects

  // Build status order map for sort
  const statusOrderMap = useMemo((): Map<string, number> => {
    const m = new Map<string, number>()
    for (const s of Object.values(allStatusesRecord)) {
      const order = s.is_default === 1 ? -1000 : s.is_done === 1 ? 1000 : s.order_index
      m.set(s.id, order)
    }
    return m
  }, [allStatusesRecord])

  // Hydrate all labels for cross-project label filtering
  useEffect(() => {
    useLabelStore.getState().hydrateAllLabels()
  }, [])

  // Parse stored filter config and apply to filter store on mount
  useEffect(() => {
    if (!currentView) return
    try {
      const config = JSON.parse(currentView.filter_config) as FilterConfig
      const store = useLabelStore.getState()
      // Apply all stored filters
      store.clearLabelFilters() // Clear first (includes exclusions and sort)
      if (config.labelIds) {
        for (const id of config.labelIds) store.toggleLabelFilter(id)
      }
      if (config.priorities) {
        for (const p of config.priorities) store.togglePriorityFilter(p)
      }
      if (config.statusIds) {
        for (const id of config.statusIds) store.toggleStatusFilter(id)
      }
      if (config.projectIds) {
        for (const id of config.projectIds) store.toggleProjectFilter(id)
      }
      // Exclusion filters
      if (config.excludeLabelIds) {
        for (const id of config.excludeLabelIds) store.toggleExcludeLabelFilter(id)
      }
      if (config.excludeStatusIds) {
        for (const id of config.excludeStatusIds) store.toggleExcludeStatusFilter(id)
      }
      if (config.excludePriorities) {
        for (const p of config.excludePriorities) store.toggleExcludePriorityFilter(p)
      }
      if (config.excludeAssigneeIds) {
        for (const id of config.excludeAssigneeIds) store.toggleExcludeAssigneeFilter(id)
      }
      if (config.excludeProjectIds) {
        for (const id of config.excludeProjectIds) store.toggleExcludeProjectFilter(id)
      }
      if (config.dueDatePreset) {
        store.setDueDatePreset(config.dueDatePreset)
      } else if (config.dueDateRange) {
        store.setDueDateRange(config.dueDateRange)
      }
      if (config.keyword) {
        store.setKeyword(config.keyword)
      }
      if (config.filterMode) {
        store.setFilterMode(config.filterMode)
      }
      // Sort rules
      if (config.sortRules && config.sortRules.length > 0) {
        store.setSortRules(config.sortRules)
      }
      if (config.labelLogic) {
        store.setLabelFilterLogic(config.labelLogic)
      }
      // Track the stored config for dirty-state detection — rebuild from applied state
      // so the serialization matches exactly what currentFilterConfig produces
      requestAnimationFrame(() => {
        const s = useLabelStore.getState()
        const applied: Record<string, unknown> = {}
        if (s.activeLabelFilters.size > 0) applied.labelIds = [...s.activeLabelFilters]
        if (s.assigneeFilters.size > 0) applied.assigneeIds = [...s.assigneeFilters]
        if (s.priorityFilters.size > 0) applied.priorities = [...s.priorityFilters]
        if (s.statusFilters.size > 0) applied.statusIds = [...s.statusFilters]
        if (s.projectFilters.size > 0) applied.projectIds = [...s.projectFilters]
        if (s.excludeLabelFilters.size > 0) applied.excludeLabelIds = [...s.excludeLabelFilters]
        if (s.excludeStatusFilters.size > 0) applied.excludeStatusIds = [...s.excludeStatusFilters]
        if (s.excludePriorityFilters.size > 0) applied.excludePriorities = [...s.excludePriorityFilters]
        if (s.excludeAssigneeFilters.size > 0) applied.excludeAssigneeIds = [...s.excludeAssigneeFilters]
        if (s.excludeProjectFilters.size > 0) applied.excludeProjectIds = [...s.excludeProjectFilters]
        if (s.dueDatePreset) applied.dueDatePreset = s.dueDatePreset
        if (s.dueDateRange) applied.dueDateRange = s.dueDateRange
        if (s.keyword) applied.keyword = s.keyword
        applied.filterMode = s.filterMode
        if (s.sortRules.length > 0) applied.sortRules = s.sortRules
        if (s.labelFilterLogic !== 'any') applied.labelLogic = s.labelFilterLogic
        useSavedViewStore.getState().setActiveViewFilterConfig(JSON.stringify(applied))
      })
    } catch { /* ignore invalid config */ }
    return () => {
      useSavedViewStore.getState().setActiveViewFilterConfig(null)
      // Revert sidebar counts to saved filter values
      useSavedViewStore.getState().hydrateCounts(userId)
    }
  }, [currentView?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Get current filter config (including sort) for comparison with stored
  const currentFilterConfig = useLabelStore((s) => {
    const config: FilterConfig = {}
    if (s.activeLabelFilters.size > 0) config.labelIds = [...s.activeLabelFilters]
    if (s.assigneeFilters.size > 0) config.assigneeIds = [...s.assigneeFilters]
    if (s.priorityFilters.size > 0) config.priorities = [...s.priorityFilters]
    if (s.statusFilters.size > 0) config.statusIds = [...s.statusFilters]
    if (s.projectFilters.size > 0) config.projectIds = [...s.projectFilters]
    if (s.excludeLabelFilters.size > 0) config.excludeLabelIds = [...s.excludeLabelFilters]
    if (s.excludeStatusFilters.size > 0) config.excludeStatusIds = [...s.excludeStatusFilters]
    if (s.excludePriorityFilters.size > 0) config.excludePriorities = [...s.excludePriorityFilters]
    if (s.excludeAssigneeFilters.size > 0) config.excludeAssigneeIds = [...s.excludeAssigneeFilters]
    if (s.excludeProjectFilters.size > 0) config.excludeProjectIds = [...s.excludeProjectFilters]
    if (s.dueDatePreset) config.dueDatePreset = s.dueDatePreset
    if (s.dueDateRange) config.dueDateRange = s.dueDateRange
    if (s.keyword) config.keyword = s.keyword
    config.filterMode = s.filterMode
    if (s.sortRules.length > 0) config.sortRules = s.sortRules
    if (s.labelFilterLogic !== 'any') config.labelLogic = s.labelFilterLogic
    return JSON.stringify(config)
  })

  const filtersChanged = currentView ? currentFilterConfig !== currentView.filter_config : false

  const handleUpdateView = useCallback(async () => {
    if (!currentView) return
    await updateView(currentView.id, { filter_config: currentFilterConfig })
    useSavedViewStore.getState().setActiveViewFilterConfig(currentFilterConfig)
    useSavedViewStore.getState().hydrateCounts(userId)
  }, [currentView, currentFilterConfig, updateView, userId])

  // Filter tasks that match (using the active filter store state applied from saved view)
  const activeLabelFilters = useLabelStore((s) => s.activeLabelFilters)
  const hasActiveFilters = useLabelStore((s) => s.activeLabelFilters.size > 0)
  const labelFilterLogic = useLabelStore(selectLabelFilterLogic)
  const priorityFilters = useLabelStore((s) => s.priorityFilters)
  const hasPriorityFilters = useLabelStore((s) => s.priorityFilters.size > 0)
  const statusFilters = useLabelStore((s) => s.statusFilters)
  const hasStatusFilters = useLabelStore((s) => s.statusFilters.size > 0)
  const projectFilters = useLabelStore((s) => s.projectFilters)
  const hasProjectFilters = useLabelStore((s) => s.projectFilters.size > 0)
  const excludeLabelFilters = useLabelStore(selectExcludeLabelFilters)
  const hasExcludeLabelFilters = useLabelStore(selectHasExcludeLabelFilters)
  const excludeStatusFilters = useLabelStore(selectExcludeStatusFilters)
  const hasExcludeStatusFilters = useLabelStore(selectHasExcludeStatusFilters)
  const excludePriorityFilters = useLabelStore(selectExcludePriorityFilters)
  const hasExcludePriorityFilters = useLabelStore(selectHasExcludePriorityFilters)
  const excludeProjectFilters = useLabelStore(selectExcludeProjectFilters)
  const hasExcludeProjectFilters = useLabelStore(selectHasExcludeProjectFilters)
  const dueDatePreset = useLabelStore((s) => s.dueDatePreset)
  const dueDateRange = useLabelStore((s) => s.dueDateRange)
  const keywordFilter = useLabelStore((s) => s.keyword)

  const matchingTasks = useMemo(() => {
    const doneStatusIds = new Set(Object.values(allStatusesRecord).filter((s) => s.is_done === 1).map((s) => s.id))
    const all = Object.values(allTasks).filter((t) => !t.is_archived && !t.is_template && !t.parent_id && !doneStatusIds.has(t.status_id))
    const filtered = !hasAnyFilter ? all : all.filter((task) => {
      const labels = taskLabels[task.id] ?? []
      const labelIds = new Set(labels.map((l) => l.id))
      // Include filters
      if (hasActiveFilters) {
        if (labelFilterLogic === 'all') {
          if (![...activeLabelFilters].every((fid) => labelIds.has(fid))) return false
        } else {
          if (![...activeLabelFilters].some((fid) => labelIds.has(fid))) return false
        }
      }
      if (hasPriorityFilters && !priorityFilters.has(task.priority)) return false
      if (hasStatusFilters && !statusFilters.has(task.status_id)) return false
      if (hasProjectFilters && !projectFilters.has(task.project_id)) return false
      // Exclusion filters
      if (hasExcludeLabelFilters) {
        if ([...excludeLabelFilters].some((fid) => labelIds.has(fid))) return false
      }
      if (hasExcludePriorityFilters && excludePriorityFilters.has(task.priority)) return false
      if (hasExcludeStatusFilters && excludeStatusFilters.has(task.status_id)) return false
      if (hasExcludeProjectFilters && excludeProjectFilters.has(task.project_id)) return false
      if ((dueDatePreset || dueDateRange) && !matchesDueDateFilter(task.due_date, dueDatePreset, dueDateRange)) return false
      if (keywordFilter) {
        const kw = keywordFilter.toLowerCase()
        if (!task.title.toLowerCase().includes(kw) && !(task.description ?? '').toLowerCase().includes(kw)) return false
      }
      return true
    })

    // Apply sort
    const effectiveRules = sortRules.length > 0 ? sortRules : DEFAULT_SAVED_VIEW_SORT
    const comparator = createSortComparator(effectiveRules, statusOrderMap)
    return [...filtered].sort(comparator)
  }, [allTasks, allStatusesRecord, taskLabels, hasAnyFilter, hasActiveFilters, activeLabelFilters, labelFilterLogic, hasPriorityFilters, priorityFilters, hasStatusFilters, statusFilters, hasProjectFilters, projectFilters, hasExcludeLabelFilters, excludeLabelFilters, hasExcludePriorityFilters, excludePriorityFilters, hasExcludeStatusFilters, excludeStatusFilters, hasExcludeProjectFilters, excludeProjectFilters, dueDatePreset, dueDateRange, keywordFilter, sortRules, statusOrderMap])

  // Keep sidebar count in sync with actual matching tasks
  useEffect(() => {
    if (currentView) {
      useSavedViewStore.getState().setViewCount(currentView.id, matchingTasks.length)
    }
  }, [currentView, matchingTasks.length])

  // TaskRow callbacks
  const handleSelectTask = useCallback((taskId: string, e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey) {
      toggleTaskInSelection(taskId)
    } else if (e.shiftKey) {
      const lastId = useTaskStore.getState().lastSelectedTaskId
      if (lastId) {
        const startIdx = matchingTasks.findIndex((t) => t.id === lastId)
        const endIdx = matchingTasks.findIndex((t) => t.id === taskId)
        if (startIdx !== -1 && endIdx !== -1) {
          const lo = Math.min(startIdx, endIdx)
          const hi = Math.max(startIdx, endIdx)
          selectTaskRange(matchingTasks.slice(lo, hi + 1).map((t) => t.id))
          return
        }
      }
      selectTask(taskId, { openPanel: clickOpensDetail === 'true' })
    } else {
      selectTask(taskId, { openPanel: clickOpensDetail === 'true' })
    }
  }, [matchingTasks, selectTask, toggleTaskInSelection, selectTaskRange, clickOpensDetail])

  const handleStatusChange = useCallback(async (taskId: string, newStatusId: string) => {
    const task = allTasks[taskId]
    if (!task) return
    const projectStatuses = statusesByProject[task.project_id] ?? []
    const newStatus = projectStatuses.find((s) => s.id === newStatusId)
    await updateTask(taskId, {
      status_id: newStatusId,
      completed_date: newStatus?.is_done === 1 ? new Date().toISOString() : null
    })
  }, [allTasks, statusesByProject, updateTask])

  const handleTitleChange = useCallback(async (taskId: string, newTitle: string) => {
    await updateTask(taskId, { title: newTitle })
  }, [updateTask])

  const handleDeleteTask = useCallback((taskId: string) => {
    setPendingDeleteTask(taskId)
  }, [setPendingDeleteTask])

  const handleOpenDetail = useCallback((taskId: string) => {
    selectTask(taskId, { openPanel: true })
  }, [selectTask])

  const handleAddLabel = useCallback(async (taskId: string, labelId: string) => {
    await addLabel(taskId, labelId)
  }, [addLabel])

  const handleRemoveLabel = useCallback(async (taskId: string, labelId: string) => {
    await removeLabel(taskId, labelId)
  }, [removeLabel])

  // Use first project's createOrMatchLabel as fallback (labels are global)
  const firstProjectId = Object.keys(allProjects)[0] ?? ''
  const createOrMatchLabel = useCreateOrMatchLabel(firstProjectId)
  const handleCreateLabel = useCallback(async (name: string, color: string) => {
    await createOrMatchLabel(name, color)
  }, [createOrMatchLabel])

  const handleToggleExpanded = useCallback((taskId: string) => {
    toggleExpanded(taskId)
  }, [toggleExpanded])

  // Keyboard navigation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const currentTaskId = selectedTaskIds.size === 1 ? [...selectedTaskIds][0] : null
      const currentIndex = currentTaskId ? matchingTasks.findIndex((t) => t.id === currentTaskId) : -1

      if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
        e.preventDefault()
        selectAllTasks(matchingTasks.map((t) => t.id))
        return
      }

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault()
        const next = currentIndex < matchingTasks.length - 1 ? currentIndex + 1 : 0
        selectTask(matchingTasks[next].id, { openPanel: false })
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault()
        const prev = currentIndex > 0 ? currentIndex - 1 : matchingTasks.length - 1
        selectTask(matchingTasks[prev].id, { openPanel: false })
      } else if (e.key === 'Enter' && currentTaskId) {
        e.preventDefault()
        selectTask(currentTaskId, { openPanel: true })
      }
    }

    container.addEventListener('keydown', handleKeyDown)
    return () => container.removeEventListener('keydown', handleKeyDown)
  }, [matchingTasks, selectedTaskIds, selectTask, selectAllTasks])

  if (!currentView) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <p className="text-sm font-light">Select a saved view from the sidebar</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Filter bar (editable) — save updates the current view */}
      <FilterBar
        labels={allLabels}
        labelsInFilterMenu
        showProjectFilter
        showSort
        onSave={filtersChanged ? handleUpdateView : undefined}
        saveLabel={filtersChanged ? 'Save' : undefined}
      />

      {/* Task list */}
      <div ref={containerRef} tabIndex={-1} className="flex-1 overflow-y-auto px-6 py-2 focus:outline-none">
        {matchingTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Filter size={32} className="mb-3 text-muted/40" />
            <p className="text-sm font-light text-muted">No tasks match the current filters</p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {matchingTasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                statuses={statusesByProject[task.project_id] ?? flatStatuses}
                allLabels={allLabels}
                isSelected={selectedTaskIds.has(task.id)}
                depth={0}
                isExpanded={expandedTaskIds.has(task.id)}
                onSelect={handleSelectTask}
                onStatusChange={handleStatusChange}
                onTitleChange={handleTitleChange}
                onDelete={handleDeleteTask}
                onToggleExpanded={handleToggleExpanded}
                onAddLabel={handleAddLabel}
                onRemoveLabel={handleRemoveLabel}
                onCreateLabel={handleCreateLabel}
                onOpenDetail={handleOpenDetail}
                project={projectMap[task.project_id]}
                disableDrag
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

