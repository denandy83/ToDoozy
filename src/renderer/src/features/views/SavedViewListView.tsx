import { useEffect, useMemo, useCallback, useState, useRef } from 'react'
import { Filter, Trash2, Copy } from 'lucide-react'
import { useViewStore, selectSelectedSavedViewId } from '../../shared/stores/viewStore'
import { useSavedViewStore, selectSavedViews } from '../../shared/stores/savedViewStore'
import {
  useLabelStore, selectHasAnyFilter, selectAllLabels,
  selectExcludeLabelFilters, selectHasExcludeLabelFilters,
  selectExcludeStatusFilters, selectHasExcludeStatusFilters,
  selectExcludePriorityFilters, selectHasExcludePriorityFilters,
  selectExcludeProjectFilters, selectHasExcludeProjectFilters
} from '../../shared/stores'
import type { DueDateRange } from '../../shared/stores'
import { useTaskStore } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores/authStore'
import { useSetting } from '../../shared/stores/settingsStore'
import { FilterBar } from '../../shared/components/FilterBar'
import { matchesDueDateFilter } from '../../shared/utils/dueDateFilter'
import type { Task } from '../../../../shared/types'

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
}

export function SavedViewListView(): React.JSX.Element {
  const selectedViewId = useViewStore(selectSelectedSavedViewId)
  const savedViews = useSavedViewStore(selectSavedViews)
  const currentView = savedViews.find((v) => v.id === selectedViewId)
  const { updateView, deleteView, createView } = useSavedViewStore()
  const setView = useViewStore((s) => s.setView)
  const setSelectedSavedView = useViewStore((s) => s.setSelectedSavedView)
  const userId = useAuthStore((s) => s.currentUser)?.id ?? ''
  const allTasks = useTaskStore((s) => s.tasks)
  const taskLabels = useTaskStore((s) => s.taskLabels)
  const hasAnyFilter = useLabelStore(selectHasAnyFilter)
  const allLabels = useLabelStore(selectAllLabels)

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
      store.clearLabelFilters() // Clear first (includes exclusions)
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
      // Track the stored config for dirty-state detection
      useSavedViewStore.getState().setActiveViewFilterConfig(currentView.filter_config)
    } catch { /* ignore invalid config */ }
    return () => { useSavedViewStore.getState().setActiveViewFilterConfig(null) }
  }, [currentView?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Get current filter state for comparison with stored
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
    return JSON.stringify(config)
  })

  const filtersChanged = currentView ? currentFilterConfig !== currentView.filter_config : false

  const handleUpdateView = useCallback(async () => {
    if (!currentView) return
    await updateView(currentView.id, { filter_config: currentFilterConfig })
    useSavedViewStore.getState().setActiveViewFilterConfig(currentFilterConfig)
  }, [currentView, currentFilterConfig, updateView])

  // Filter tasks that match (using the active filter store state applied from saved view)
  const activeLabelFilters = useLabelStore((s) => s.activeLabelFilters)
  const hasActiveFilters = useLabelStore((s) => s.activeLabelFilters.size > 0)
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
    if (!hasAnyFilter) return Object.values(allTasks).filter((t) => !t.is_archived && !t.is_template && !t.parent_id)
    return Object.values(allTasks).filter((task) => {
      if (task.is_archived || task.is_template || task.parent_id) return false
      const labels = taskLabels[task.id] ?? []
      const labelIds = new Set(labels.map((l) => l.id))
      // Include filters
      if (hasActiveFilters) {
        if (![...activeLabelFilters].some((fid) => labelIds.has(fid))) return false
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
  }, [allTasks, taskLabels, hasAnyFilter, hasActiveFilters, activeLabelFilters, hasPriorityFilters, priorityFilters, hasStatusFilters, statusFilters, hasProjectFilters, projectFilters, hasExcludeLabelFilters, excludeLabelFilters, hasExcludePriorityFilters, excludePriorityFilters, hasExcludeStatusFilters, excludeStatusFilters, hasExcludeProjectFilters, excludeProjectFilters, dueDatePreset, dueDateRange, keywordFilter])

  if (!currentView) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <p className="text-sm font-light">Select a saved view from the sidebar</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header with editable title */}
      <SavedViewHeader
        name={currentView.name}
        onRename={(name) => updateView(currentView.id, { name })}
        onClone={async () => {
          const clone = await createView(userId, `${currentView.name} (copy)`, currentView.filter_config)
          useLabelStore.getState().clearLabelFilters()
          setSelectedSavedView(clone.id)
        }}
        onDelete={async () => { await deleteView(currentView.id); setView('my-day') }}
      />

      {/* Filter bar (editable) — save updates the current view */}
      <FilterBar
        labels={allLabels}
        labelsInFilterMenu
        showProjectFilter
        onSave={filtersChanged ? handleUpdateView : undefined}
        saveLabel={filtersChanged ? 'Save' : undefined}
      />

      {/* Task list */}
      <div className="flex-1 overflow-y-auto px-6 py-2">
        {matchingTasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16">
            <Filter size={32} className="mb-3 text-muted/40" />
            <p className="text-sm font-light text-muted">No tasks match the current filters</p>
          </div>
        ) : (
          <div className="space-y-1">
            {matchingTasks.map((task) => (
              <SavedViewTaskRow key={task.id} task={task} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

interface SavedViewHeaderProps {
  name: string
  onRename: (name: string) => void
  onClone: () => void
  onDelete: () => void
}

function SavedViewHeader({ name, onRename, onClone, onDelete }: SavedViewHeaderProps): React.JSX.Element {
  const [editing, setEditing] = useState(name === 'New View')
  const [editValue, setEditValue] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
        inputRef.current?.select()
      })
    }
  }, [editing])

  const handleSubmit = (): void => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== name) {
      onRename(trimmed)
    } else {
      setEditValue(name)
    }
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-3 px-6 pb-2 pt-4">
      <Filter size={16} className="text-accent" />
      {editing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSubmit()
            if (e.key === 'Escape') { setEditValue(name); setEditing(false) }
          }}
          className="flex-1 bg-transparent text-3xl font-light uppercase tracking-[0.15em] text-foreground focus:outline-none"
        />
      ) : (
        <h1
          className="cursor-pointer text-3xl font-light uppercase tracking-[0.15em] text-foreground"
          onDoubleClick={() => { setEditValue(name); setEditing(true) }}
        >
          {name}
        </h1>
      )}
      <button
        onClick={onClone}
        className="ml-2 rounded p-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
        title="Duplicate view"
      >
        <Copy size={14} />
      </button>
      <button
        onClick={onDelete}
        className="rounded p-1 text-muted transition-colors hover:bg-red-500/10 hover:text-red-500"
        title="Delete view"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}

interface SavedViewTaskRowProps {
  task: Task
}

function SavedViewTaskRow({ task }: SavedViewTaskRowProps): React.JSX.Element {
  const { selectTask } = useTaskStore()
  const clickOpensDetail = useSetting('click_opens_detail') ?? 'true'

  const handleClick = useCallback(() => {
    selectTask(task.id, { openPanel: clickOpensDetail === 'true' })
  }, [task.id, selectTask, clickOpensDetail])

  return (
    <div
      onClick={handleClick}
      className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-foreground/6"
    >
      <div
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: task.priority > 2 ? '#ef4444' : task.priority > 0 ? '#f59e0b' : '#888' }}
      />
      <span className="flex-1 truncate text-[15px] font-light tracking-tight text-foreground">
        {task.title}
      </span>
      {task.due_date && (
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
          {task.due_date.slice(0, 10)}
        </span>
      )}
    </div>
  )
}
