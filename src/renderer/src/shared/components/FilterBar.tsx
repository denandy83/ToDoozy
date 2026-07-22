import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { X, Plus, Save } from 'lucide-react'
import {
  useLabelStore,
  selectActiveLabelFilters,
  selectFilterMode,
  selectPriorityFilters,
  selectStatusFilters,
  selectProjectFilters,
  selectExcludeLabelFilters,
  selectExcludeStatusFilters,
  selectExcludePriorityFilters,
  selectExcludeProjectFilters,
  selectDueDatePreset,
  selectDueDateRange,
  selectKeyword,
  selectHasAnyFilter,
  selectSortRules,
  selectLabelFilterLogic
} from '../stores'
import type { Label } from '../../../../shared/types'
import type { LabelFilterMode } from '../stores'
import { useStatusesByProject } from '../stores/statusStore'
import { useProjectStore, selectAllProjects } from '../stores/projectStore'
import { useAuthStore } from '../stores/authStore'
import { useSavedViewStore } from '../stores/savedViewStore'
import { useToast } from './Toast'
import { shouldForceDelete } from '../utils/shiftDelete'
import { SortDropdown } from './filter-bar/SortDropdown'
import { ActiveFilterChips } from './filter-bar/ActiveFilterChips'
import {
  PriorityFilterPicker,
  LabelFilterPicker,
  ProjectFilterPicker,
  StatusFilterPicker,
  DueDateFilterPicker,
  KeywordFilterInput
} from './filter-bar/FilterPickers'

type FilterType = 'priority' | 'due_date' | 'status' | 'keyword' | 'labels' | 'projects'

interface FilterBarProps {
  labels: Label[]
  projectId?: string
  /**
   * Saved-view mode (used by SavedViewListView). Keeps the bar always visible,
   * suppresses the "save as a new view" fallback button (the Save button updates
   * the current view via onSave instead), and hides the Blur/Hide toggle (saved
   * views always hide non-matching tasks, so the toggle would be a no-op).
   */
  isSavedView?: boolean
  /** When true, shows project filter in the +Filter menu (used in saved views) */
  showProjectFilter?: boolean
  /** Override the save button behavior (e.g., to update the current saved view instead of creating a new one) */
  onSave?: () => void
  /** Label for the save button override */
  saveLabel?: string
  /** When true, "Custom" sort option is available (project views only) */
  showCustomSort?: boolean
  /** When true, show sort UI (defaults to true) */
  showSort?: boolean
}

export function FilterBar({ labels, projectId, isSavedView, showProjectFilter, onSave, saveLabel, showCustomSort, showSort = true }: FilterBarProps): React.JSX.Element | null {
  const activeLabelFilters = useLabelStore(selectActiveLabelFilters)
  const labelFilterLogic = useLabelStore(selectLabelFilterLogic)
  const filterMode = useLabelStore(selectFilterMode)
  const priorityFilters = useLabelStore(selectPriorityFilters)
  const statusFilters = useLabelStore(selectStatusFilters)
  const projectFilters = useLabelStore(selectProjectFilters)
  const excludeLabelFilters = useLabelStore(selectExcludeLabelFilters)
  const excludeStatusFilters = useLabelStore(selectExcludeStatusFilters)
  const excludePriorityFilters = useLabelStore(selectExcludePriorityFilters)
  const excludeProjectFilters = useLabelStore(selectExcludeProjectFilters)
  const dueDatePreset = useLabelStore(selectDueDatePreset)
  const dueDateRange = useLabelStore(selectDueDateRange)
  const keyword = useLabelStore(selectKeyword)
  const hasAnyFilter = useLabelStore(selectHasAnyFilter)
  const sortRules = useLabelStore(selectSortRules)
  const { setSortRules } = useLabelStore()
  const {
    toggleLabelFilter, clearLabelFilters, setFilterMode,
    togglePriorityFilter, toggleStatusFilter, toggleProjectFilter, setDueDatePreset, setDueDateRange, setKeyword,
    toggleExcludeLabelFilter, toggleExcludePriorityFilter, toggleExcludeStatusFilter, toggleExcludeProjectFilter
  } = useLabelStore()
  const allProjects = useProjectStore(selectAllProjects)
  const userId = useAuthStore((s) => s.currentUser)?.id ?? ''
  const { createView } = useSavedViewStore()
  const { addToast: filterBarToast } = useToast()
  const { removeFromProject } = useLabelStore()

  const handleRemoveLabel = useCallback(async (label: Label, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!projectId) return
    if (shouldForceDelete(e)) { await removeFromProject(projectId, label.id); return }
    const projects = await window.api.labels.findProjectsUsingLabel(userId, label.id)
    const info = projects.find((p: { project_id: string; task_count: number }) => p.project_id === projectId)
    const count = info?.task_count ?? 0
    const taskMsg = count > 0 ? `${count} task${count === 1 ? '' : 's'} will lose this label.` : 'No tasks use this label.'
    filterBarToast({
      message: `Delete "${label.name}" from this project? ${taskMsg}`,
      persistent: true,
      actions: [
        { label: 'Delete', variant: 'danger', onClick: async () => { await removeFromProject(projectId, label.id) } },
        { label: 'Cancel', variant: 'muted', onClick: () => {} }
      ]
    })
  }, [projectId, userId, removeFromProject, filterBarToast])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [activeFilterType, setActiveFilterType] = useState<FilterType | null>(null)
  const [savingView, setSavingView] = useState(false)
  const [saveViewName, setSaveViewName] = useState('')
  const saveViewInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const filterButtonRef = useRef<HTMLButtonElement>(null)
  const keywordInputRef = useRef<HTMLInputElement>(null)
  const [pickerPos, setPickerPos] = useState<{ left: number; top: number } | null>(null)

  const projectStatuses = useStatusesByProject(projectId ?? '')

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdownOpen && !activeFilterType) return
    const handler = (e: MouseEvent): void => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false)
        setActiveFilterType(null)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropdownOpen, activeFilterType])

  // Focus keyword input when opening
  useEffect(() => {
    if (activeFilterType === 'keyword') {
      requestAnimationFrame(() => keywordInputRef.current?.focus())
    }
  }, [activeFilterType])

  const handleToggleMode = useCallback(() => {
    const next: LabelFilterMode = filterMode === 'hide' ? 'blur' : 'hide'
    setFilterMode(next)
  }, [filterMode, setFilterMode])

  const handleAddFilter = useCallback((type: FilterType) => {
    setDropdownOpen(false)
    // Capture button position before setting active type so picker stays fixed
    if (filterButtonRef.current) {
      const rect = filterButtonRef.current.getBoundingClientRect()
      setPickerPos({ left: rect.left, top: rect.bottom + 4 })
    }
    setActiveFilterType(type)
  }, [])

  const handleKeywordSubmit = useCallback((value: string) => {
    setKeyword(value)
    setActiveFilterType(null)
  }, [setKeyword])

  const handleSaveAsView = useCallback(async () => {
    const name = saveViewName.trim()
    if (!name || !userId) return
    const state = useLabelStore.getState()
    const config: Record<string, unknown> = {}
    if (state.activeLabelFilters.size > 0) config.labelIds = [...state.activeLabelFilters]
    if (state.assigneeFilters.size > 0) config.assigneeIds = [...state.assigneeFilters]
    if (state.priorityFilters.size > 0) config.priorities = [...state.priorityFilters]
    if (state.statusFilters.size > 0) config.statusIds = [...state.statusFilters]
    if (state.projectFilters.size > 0) config.projectIds = [...state.projectFilters]
    if (state.excludeLabelFilters.size > 0) config.excludeLabelIds = [...state.excludeLabelFilters]
    if (state.excludeStatusFilters.size > 0) config.excludeStatusIds = [...state.excludeStatusFilters]
    if (state.excludePriorityFilters.size > 0) config.excludePriorities = [...state.excludePriorityFilters]
    if (state.excludeAssigneeFilters.size > 0) config.excludeAssigneeIds = [...state.excludeAssigneeFilters]
    if (state.excludeProjectFilters.size > 0) config.excludeProjectIds = [...state.excludeProjectFilters]
    if (state.dueDatePreset) config.dueDatePreset = state.dueDatePreset
    if (state.dueDateRange) config.dueDateRange = state.dueDateRange
    if (state.keyword) config.keyword = state.keyword
    config.filterMode = state.filterMode
    if (state.sortRules.length > 0) config.sortRules = state.sortRules
    await createView(userId, name, JSON.stringify(config))
    setSavingView(false)
    setSaveViewName('')
  }, [saveViewName, userId, createView])

  // Focus save view input
  useEffect(() => {
    if (savingView) requestAnimationFrame(() => saveViewInputRef.current?.focus())
  }, [savingView])

  // Compute which additional filter types are available (not yet active)
  const availableFilterTypes = useMemo<FilterType[]>(() => {
    const types: FilterType[] = []
    if (labels.length > 0) types.push('labels')
    if (showProjectFilter) types.push('projects')
    types.push('priority') // always available (multi-select)
    types.push('due_date') // always available (can change)
    if (projectId) types.push('status') // only in project views
    types.push('keyword') // always available
    return types
  }, [projectId, labels.length, showProjectFilter])

  const [sortDropdownOpen, setSortDropdownOpen] = useState(false)
  const sortDropdownRef = useRef<HTMLDivElement>(null)

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!sortDropdownOpen) return
    const handler = (e: MouseEvent): void => {
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(e.target as Node)) {
        setSortDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [sortDropdownOpen])

  const hasLabels = labels.length > 0
  const showLabelsInline = hasLabels
  const alwaysShow = isSavedView || showProjectFilter
  if (!alwaysShow && !showLabelsInline && !hasAnyFilter && sortRules.length === 0) return null

  return (
    <div className="flex flex-col px-4 py-2 gap-1.5">
      {/* Row 1: Label chips (inline) */}
      {showLabelsInline && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mr-1">Labels</span>
          {labels.map((label) => {
            const isActive = activeLabelFilters.has(label.name.toLowerCase())
            return (
              <span
                key={label.id}
                className="group/chip inline-flex items-center rounded-full text-[9px] font-bold tracking-wider transition-all"
                style={{
                  backgroundColor: isActive ? `${label.color}30` : `${label.color}15`,
                  color: label.color,
                  border: `1px solid ${isActive ? label.color : `${label.color}30`}`,
                  boxShadow: isActive ? `0 0 0 2px ${label.color}40` : 'none'
                }}
              >
                {/* Toggle target carries the padding + cursor so the whole
                    visible pill is clickable — not just the text glyphs. */}
                <button
                  onClick={() => toggleLabelFilter(label.id)}
                  aria-pressed={isActive}
                  aria-label={`Filter by ${label.name}`}
                  className={`cursor-pointer rounded-full py-0.5 pl-2 ${projectId ? 'pr-0.5' : 'pr-2'}`}
                >
                  {label.name}
                </button>
                {projectId && (
                  <button
                    onClick={(e) => handleRemoveLabel(label, e)}
                    className="mr-1 cursor-pointer rounded-full p-0.5 transition-colors hover:bg-black/10"
                    aria-label={`Delete ${label.name} from project`}
                    title="Delete from project"
                  >
                    <X size={10} />
                  </button>
                )}
              </span>
            )
          })}
        </div>
      )}

      {/* Row 2: Toolbar — +Filter, Sort, Save, Blur, Clear */}
      <div className="flex items-center gap-2">
        {/* + Filter button and dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            ref={filterButtonRef}
            onClick={() => {
              setDropdownOpen(!dropdownOpen)
              setActiveFilterType(null)
            }}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          >
            <Plus size={10} />
            Filter
          </button>

          {dropdownOpen && (
            <div className="absolute left-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-border bg-surface shadow-lg">
              {availableFilterTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => handleAddFilter(type)}
                  className="block w-full px-3 py-1.5 text-left text-[11px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-foreground/6 first:rounded-t-lg last:rounded-b-lg"
                >
                  {{ due_date: 'Due Date', keyword: 'Keyword', labels: 'Labels', projects: 'Projects', priority: 'Priority', status: 'Status' }[type]}
                </button>
              ))}
            </div>
          )}

          {/* Filter picker popups */}
          {activeFilterType && pickerPos && (
            <div ref={dropdownRef} style={{ position: 'fixed', left: pickerPos.left, top: pickerPos.top, zIndex: 50 }}>
              {activeFilterType === 'priority' && (
                <PriorityFilterPicker
                  active={priorityFilters}
                  excluded={excludePriorityFilters}
                  onToggle={togglePriorityFilter}
                  onExcludeToggle={toggleExcludePriorityFilter}
                  onClose={() => setActiveFilterType(null)}
                />
              )}
              {activeFilterType === 'status' && projectId && (
                <StatusFilterPicker
                  statuses={projectStatuses}
                  active={statusFilters}
                  excluded={excludeStatusFilters}
                  onToggle={toggleStatusFilter}
                  onExcludeToggle={toggleExcludeStatusFilter}
                  onClose={() => setActiveFilterType(null)}
                />
              )}
              {activeFilterType === 'due_date' && (
                <DueDateFilterPicker
                  activePreset={dueDatePreset}
                  activeRange={dueDateRange}
                  onSelectPreset={(v) => { setDueDatePreset(v); setActiveFilterType(null) }}
                  onSelectRange={(r) => { setDueDateRange(r); setActiveFilterType(null) }}
                  onClose={() => setActiveFilterType(null)}
                />
              )}
              {activeFilterType === 'keyword' && (
                <KeywordFilterInput
                  initial={keyword}
                  onSubmit={handleKeywordSubmit}
                  onClose={() => setActiveFilterType(null)}
                  inputRef={keywordInputRef}
                />
              )}
              {activeFilterType === 'labels' && (
                <LabelFilterPicker
                  labels={labels}
                  active={activeLabelFilters}
                  excluded={excludeLabelFilters}
                  onToggle={toggleLabelFilter}
                  onExcludeToggle={toggleExcludeLabelFilter}
                  onClose={() => setActiveFilterType(null)}
                />
              )}
              {activeFilterType === 'projects' && showProjectFilter && (
                <ProjectFilterPicker
                  projects={allProjects}
                  active={projectFilters}
                  excluded={excludeProjectFilters}
                  onToggle={toggleProjectFilter}
                  onExcludeToggle={toggleExcludeProjectFilter}
                  onClose={() => setActiveFilterType(null)}
                />
              )}
            </div>
          )}
        </div>

        {/* Sort */}
        {showSort && (
          <SortDropdown
            rules={sortRules}
            onChange={setSortRules}
            showCustom={showCustomSort}
            isOpen={sortDropdownOpen}
            onToggle={() => setSortDropdownOpen(!sortDropdownOpen)}
            dropdownRef={sortDropdownRef}
          />
        )}

        {/* Save */}
        {onSave ? (
          <button
            onClick={onSave}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent transition-colors hover:bg-accent/12"
            title={saveLabel ?? 'Save'}
          >
            <Save size={10} />
            {saveLabel ?? 'Save'}
          </button>
        ) : isSavedView ? null : savingView ? (
          <div className="flex items-center gap-1">
            <input
              ref={saveViewInputRef}
              type="text"
              value={saveViewName}
              onChange={(e) => setSaveViewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && saveViewName.trim()) handleSaveAsView()
                if (e.key === 'Escape') { setSavingView(false); setSaveViewName(''); e.stopPropagation() }
              }}
              placeholder="View name..."
              className="w-24 rounded border border-border bg-transparent px-1.5 py-0.5 text-[11px] font-light text-foreground placeholder:text-muted focus:outline-none focus:border-accent"
            />
            <button
              onClick={handleSaveAsView}
              className="rounded bg-accent/12 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent transition-colors hover:bg-accent/20"
            >
              Save
            </button>
          </div>
        ) : hasAnyFilter ? (
          <button
            onClick={() => setSavingView(true)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            title="Save current filters as a view"
          >
            <Save size={10} />
            Save
          </button>
        ) : null}

        {/* Blur/Hide */}
        {!isSavedView && hasAnyFilter && (
          <button
            onClick={handleToggleMode}
            className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            title={`Filter mode: ${filterMode}. Click to toggle.`}
          >
            {filterMode === 'hide' ? 'Hide' : 'Blur'}
          </button>
        )}

        {/* Clear — only clears filters, not sort */}
        {hasAnyFilter && (
          <button
            onClick={clearLabelFilters}
            className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            aria-label="Clear all filters"
            title="Clear all filters"
          >
            Clear
          </button>
        )}
      </div>

      {/* Row 3: Active filter chips */}
      {hasAnyFilter && (
        <div className="flex flex-wrap items-center gap-1.5">
          <ActiveFilterChips
            labelFilterLogic={labelFilterLogic}
            priorityFilters={priorityFilters}
            statusFilters={statusFilters}
            excludePriorityFilters={excludePriorityFilters}
            excludeStatusFilters={excludeStatusFilters}
            dueDatePreset={dueDatePreset}
            dueDateRange={dueDateRange}
            keyword={keyword}
            projectStatuses={projectStatuses}
            onRemovePriority={togglePriorityFilter}
            onRemoveStatus={toggleStatusFilter}
            onRemoveExcludePriority={toggleExcludePriorityFilter}
            onRemoveExcludeStatus={toggleExcludeStatusFilter}
            onRemoveDueDate={() => { setDueDatePreset(null); setDueDateRange(null) }}
            onRemoveKeyword={() => setKeyword('')}
            labelChips={{ labels, activeIds: activeLabelFilters, onRemove: toggleLabelFilter }}
            excludeLabelChips={{ labels, activeIds: excludeLabelFilters, onRemove: toggleExcludeLabelFilter }}
            projectChips={showProjectFilter ? { projects: allProjects, activeIds: projectFilters, onRemove: toggleProjectFilter } : undefined}
            excludeProjectChips={showProjectFilter ? { projects: allProjects, activeIds: excludeProjectFilters, onRemove: toggleExcludeProjectFilter } : undefined}
          />
        </div>
      )}
    </div>
  )
}
