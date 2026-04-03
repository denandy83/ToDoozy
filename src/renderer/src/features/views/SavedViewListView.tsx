import { useEffect, useMemo, useCallback } from 'react'
import { Filter } from 'lucide-react'
import { useViewStore, selectSelectedSavedViewId } from '../../shared/stores/viewStore'
import { useSavedViewStore, selectSavedViews } from '../../shared/stores/savedViewStore'
import { useLabelStore, selectHasAnyFilter } from '../../shared/stores'
import { useTaskStore } from '../../shared/stores'
import { FilterBar } from '../../shared/components/FilterBar'
import type { Task } from '../../../../shared/types'

interface FilterConfig {
  labelIds?: string[]
  assigneeIds?: string[]
  priorities?: number[]
  statusIds?: string[]
  dueDatePreset?: string
  keyword?: string
  filterMode?: 'hide' | 'blur'
}

export function SavedViewListView(): React.JSX.Element {
  const selectedViewId = useViewStore(selectSelectedSavedViewId)
  const savedViews = useSavedViewStore(selectSavedViews)
  const currentView = savedViews.find((v) => v.id === selectedViewId)
  const { updateView } = useSavedViewStore()
  const allTasks = useTaskStore((s) => s.tasks)
  const taskLabels = useTaskStore((s) => s.taskLabels)
  const hasAnyFilter = useLabelStore(selectHasAnyFilter)

  // Parse stored filter config and apply to filter store on mount
  useEffect(() => {
    if (!currentView) return
    try {
      const config = JSON.parse(currentView.filter_config) as FilterConfig
      const store = useLabelStore.getState()
      // Apply all stored filters
      store.clearLabelFilters() // Clear first
      if (config.labelIds) {
        for (const id of config.labelIds) store.toggleLabelFilter(id)
      }
      if (config.priorities) {
        for (const p of config.priorities) store.togglePriorityFilter(p)
      }
      if (config.statusIds) {
        for (const id of config.statusIds) store.toggleStatusFilter(id)
      }
      if (config.dueDatePreset) {
        store.setDueDatePreset(config.dueDatePreset)
      }
      if (config.keyword) {
        store.setKeyword(config.keyword)
      }
      if (config.filterMode) {
        store.setFilterMode(config.filterMode)
      }
    } catch { /* ignore invalid config */ }
  }, [currentView?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Get current filter state for comparison with stored
  const currentFilterConfig = useLabelStore((s) => {
    const config: FilterConfig = {}
    if (s.activeLabelFilters.size > 0) config.labelIds = [...s.activeLabelFilters]
    if (s.assigneeFilters.size > 0) config.assigneeIds = [...s.assigneeFilters]
    if (s.priorityFilters.size > 0) config.priorities = [...s.priorityFilters]
    if (s.statusFilters.size > 0) config.statusIds = [...s.statusFilters]
    if (s.dueDatePreset) config.dueDatePreset = s.dueDatePreset
    if (s.keyword) config.keyword = s.keyword
    config.filterMode = s.filterMode
    return JSON.stringify(config)
  })

  const filtersChanged = currentView ? currentFilterConfig !== currentView.filter_config : false

  const handleUpdateView = useCallback(async () => {
    if (!currentView) return
    await updateView(currentView.id, { filter_config: currentFilterConfig })
  }, [currentView, currentFilterConfig, updateView])

  // Filter tasks that match (using the active filter store state applied from saved view)
  const activeLabelFilters = useLabelStore((s) => s.activeLabelFilters)
  const hasActiveFilters = useLabelStore((s) => s.activeLabelFilters.size > 0)
  const priorityFilters = useLabelStore((s) => s.priorityFilters)
  const hasPriorityFilters = useLabelStore((s) => s.priorityFilters.size > 0)
  const statusFilters = useLabelStore((s) => s.statusFilters)
  const hasStatusFilters = useLabelStore((s) => s.statusFilters.size > 0)
  const dueDatePreset = useLabelStore((s) => s.dueDatePreset)
  const keywordFilter = useLabelStore((s) => s.keyword)

  const matchingTasks = useMemo(() => {
    if (!hasAnyFilter) return Object.values(allTasks).filter((t) => !t.is_archived && !t.is_template && !t.parent_id)
    return Object.values(allTasks).filter((task) => {
      if (task.is_archived || task.is_template || task.parent_id) return false
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
    })
  }, [allTasks, taskLabels, hasAnyFilter, hasActiveFilters, activeLabelFilters, hasPriorityFilters, priorityFilters, hasStatusFilters, statusFilters, dueDatePreset, keywordFilter])

  if (!currentView) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <p className="text-sm font-light">Select a saved view from the sidebar</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 pb-2 pt-4">
        <Filter size={16} className="text-accent" />
        <h1 className="text-3xl font-light uppercase tracking-[0.15em] text-foreground">
          {currentView.name}
        </h1>
        <span className="rounded-full bg-foreground/8 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">
          {matchingTasks.length}
        </span>
      </div>

      {/* Filter bar (editable) */}
      <FilterBar labels={[]} />

      {/* Update View button when filters differ */}
      {filtersChanged && (
        <div className="px-6 py-1">
          <button
            onClick={handleUpdateView}
            className="rounded bg-accent/12 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/20"
          >
            Update View
          </button>
        </div>
      )}

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

interface SavedViewTaskRowProps {
  task: Task
}

function SavedViewTaskRow({ task }: SavedViewTaskRowProps): React.JSX.Element {
  const { setCurrentTask, selectTask } = useTaskStore()

  const handleClick = useCallback(() => {
    selectTask(task.id)
    setCurrentTask(task.id)
  }, [task.id, selectTask, setCurrentTask])

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
