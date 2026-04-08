import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { X, Plus, Search, Save, Minus, Calendar, ArrowUpDown, ChevronUp, ChevronDown, Trash2 } from 'lucide-react'
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
import type { Label, Project } from '../../../../shared/types'
import type { LabelFilterMode, DueDateRange } from '../stores'
import type { SortRule, SortField } from '../utils/sortTasks'
import { SORT_FIELD_LABELS } from '../utils/sortTasks'
import { useStatusesByProject } from '../stores/statusStore'
import { useProjectStore, selectAllProjects } from '../stores/projectStore'
import { useAuthStore } from '../stores/authStore'
import { useSavedViewStore } from '../stores/savedViewStore'
import { useToast } from './Toast'
import { shouldForceDelete } from '../utils/shiftDelete'
import { formatDueDateRange } from '../utils/dueDateFilter'

const PRIORITY_OPTIONS = [
  { value: 0, label: 'None', color: '#888' },
  { value: 1, label: 'Low', color: '#3b82f6' },
  { value: 2, label: 'Normal', color: '#f59e0b' },
  { value: 3, label: 'High', color: '#f97316' },
  { value: 4, label: 'Urgent', color: '#ef4444' }
] as const

const DUE_DATE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'this_week', label: 'This Week' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'no_date', label: 'No Date' }
] as const

type FilterType = 'priority' | 'due_date' | 'status' | 'keyword' | 'labels' | 'projects'

interface FilterBarProps {
  labels: Label[]
  projectId?: string
  /** When true, labels appear in the +Filter menu instead of always being visible (used in saved views) */
  labelsInFilterMenu?: boolean
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

export function FilterBar({ labels, projectId, labelsInFilterMenu, showProjectFilter, onSave, saveLabel, showCustomSort, showSort = true }: FilterBarProps): React.JSX.Element | null {
  const activeLabelFilters = useLabelStore(selectActiveLabelFilters)
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
  }, [projectId, labelsInFilterMenu, labels.length, showProjectFilter])

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
  const showLabelsInline = hasLabels && !labelsInFilterMenu
  const alwaysShow = labelsInFilterMenu || showProjectFilter
  if (!alwaysShow && !showLabelsInline && !hasAnyFilter && sortRules.length === 0) return null

  return (
    <div className="flex flex-col px-4 py-2 gap-1.5">
      {/* Row 1: Label chips (inline) */}
      {showLabelsInline && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mr-1">Labels</span>
          {labels.map((label) => {
            const isActive = activeLabelFilters.has(label.id)
            return (
              <span
                key={label.id}
                className="group/chip inline-flex items-center gap-0.5 rounded-full py-0.5 pl-2 pr-1 text-[9px] font-bold tracking-wider transition-all cursor-pointer"
                style={{
                  backgroundColor: isActive ? `${label.color}30` : `${label.color}15`,
                  color: label.color,
                  border: `1px solid ${isActive ? label.color : `${label.color}30`}`,
                  boxShadow: isActive ? `0 0 0 2px ${label.color}40` : 'none'
                }}
              >
                <button
                  onClick={() => toggleLabelFilter(label.id)}
                  aria-pressed={isActive}
                  aria-label={`Filter by ${label.name}`}
                >
                  {label.name}
                </button>
                {projectId && (
                  <button
                    onClick={(e) => handleRemoveLabel(label, e)}
                    className="rounded-full p-0.5 transition-colors hover:bg-black/10"
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
        ) : labelsInFilterMenu ? null : savingView ? (
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
        {!labelsInFilterMenu && hasAnyFilter && (
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

/* ── Sort Dropdown ─────────────────────────────────────────────── */

const ALL_SORT_FIELDS: SortField[] = ['priority', 'due_date', 'status', 'created_at', 'updated_at', 'title', 'project', 'custom']

interface SortDropdownProps {
  rules: SortRule[]
  onChange: (rules: SortRule[]) => void
  showCustom?: boolean
  isOpen: boolean
  onToggle: () => void
  dropdownRef: React.RefObject<HTMLDivElement | null>
}

function SortDropdown({ rules, onChange, showCustom, isOpen, onToggle, dropdownRef }: SortDropdownProps): React.JSX.Element {
  const availableFields = useMemo(() => {
    const used = new Set(rules.map((r) => r.field))
    return ALL_SORT_FIELDS.filter((f) => {
      if (f === 'custom' && !showCustom) return false
      return !used.has(f)
    })
  }, [rules, showCustom])

  const handleAddRule = useCallback((field: SortField) => {
    const direction = field === 'priority' ? 'desc' : 'asc'
    onChange([...rules, { field, direction }])
  }, [rules, onChange])

  const handleRemoveRule = useCallback((index: number) => {
    onChange(rules.filter((_, i) => i !== index))
  }, [rules, onChange])

  const handleToggleDirection = useCallback((index: number) => {
    onChange(rules.map((r, i) => i === index ? { ...r, direction: r.direction === 'asc' ? 'desc' : 'asc' } : r))
  }, [rules, onChange])

  const handleChangeField = useCallback((index: number, field: SortField) => {
    onChange(rules.map((r, i) => i === index ? { ...r, field } : r))
  }, [rules, onChange])

  const primaryLabel = rules.length > 0
    ? rules.map((r) => `${SORT_FIELD_LABELS[r.field]} ${r.direction === 'asc' ? '↑' : '↓'}`).join(', ')
    : null

  return (
    <div className="relative flex items-center gap-0.5" ref={dropdownRef}>
      <button
        onClick={onToggle}
        className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
          rules.length > 0
            ? 'text-accent hover:bg-accent/12'
            : 'text-muted hover:bg-foreground/6 hover:text-foreground'
        }`}
      >
        <ArrowUpDown size={10} />
        {primaryLabel ?? 'Sort'}
      </button>
      {rules.length > 0 && (
        <button
          onClick={() => onChange([])}
          className="rounded p-0.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          title="Clear sort"
          aria-label="Clear sort"
        >
          <X size={10} />
        </button>
      )}

      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[220px] rounded-lg border border-border bg-surface p-2 shadow-lg">
          {/* Existing rules */}
          {rules.map((rule, idx) => (
            <div key={idx} className="flex items-center gap-1.5 py-1">
              <select
                value={rule.field}
                onChange={(e) => handleChangeField(idx, e.target.value as SortField)}
                className="flex-1 rounded border border-border bg-background px-1.5 py-0.5 text-[11px] font-light text-foreground focus:outline-none focus:border-accent"
              >
                <option value={rule.field}>{SORT_FIELD_LABELS[rule.field]}</option>
                {availableFields.map((f) => (
                  <option key={f} value={f}>{SORT_FIELD_LABELS[f]}</option>
                ))}
              </select>
              <button
                onClick={() => handleToggleDirection(idx)}
                className="rounded p-0.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
                title={rule.direction === 'asc' ? 'Ascending' : 'Descending'}
              >
                {rule.direction === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </button>
              <button
                onClick={() => handleRemoveRule(idx)}
                className="rounded p-0.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-500"
                title="Remove sort"
              >
                <Trash2 size={10} />
              </button>
            </div>
          ))}

          {/* Add sort rule */}
          {availableFields.length > 0 && (
            <div className="border-t border-border pt-1.5 mt-1">
              <div className="text-[9px] font-bold uppercase tracking-[0.3em] text-muted mb-1">Add Sort</div>
              {availableFields.map((f) => (
                <button
                  key={f}
                  onClick={() => handleAddRule(f)}
                  className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] font-light text-foreground transition-colors hover:bg-foreground/6"
                >
                  <Plus size={10} className="text-muted" />
                  {SORT_FIELD_LABELS[f]}
                </button>
              ))}
            </div>
          )}

          {/* Done + Clear sort */}
          <div className="flex items-center gap-1 border-t border-border pt-1.5 mt-1">
            <button
              onClick={onToggle}
              className="rounded px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/12"
            >
              Done
            </button>
            {rules.length > 0 && (
              <button
                onClick={() => onChange([])}
                className="ml-auto rounded px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-red-500 transition-colors hover:bg-red-500/10"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Active Filter Chips ────────────────────────────────────────── */

interface ActiveFilterChipsProps {
  priorityFilters: Set<number>
  statusFilters: Set<string>
  excludePriorityFilters: Set<number>
  excludeStatusFilters: Set<string>
  dueDatePreset: string | null
  dueDateRange: DueDateRange | null
  keyword: string
  projectStatuses: Array<{ id: string; name: string; color: string }>
  onRemovePriority: (p: number) => void
  onRemoveStatus: (id: string) => void
  onRemoveExcludePriority: (p: number) => void
  onRemoveExcludeStatus: (id: string) => void
  onRemoveDueDate: () => void
  onRemoveKeyword: () => void
  labelChips?: { labels: Label[]; activeIds: Set<string>; onRemove: (id: string) => void }
  excludeLabelChips?: { labels: Label[]; activeIds: Set<string>; onRemove: (id: string) => void }
  projectChips?: { projects: Project[]; activeIds: Set<string>; onRemove: (id: string) => void }
  excludeProjectChips?: { projects: Project[]; activeIds: Set<string>; onRemove: (id: string) => void }
}

function ActiveFilterChips({
  priorityFilters, statusFilters, excludePriorityFilters, excludeStatusFilters,
  dueDatePreset, dueDateRange, keyword,
  projectStatuses, onRemovePriority, onRemoveStatus, onRemoveExcludePriority, onRemoveExcludeStatus,
  onRemoveDueDate, onRemoveKeyword, labelChips, excludeLabelChips, projectChips, excludeProjectChips
}: ActiveFilterChipsProps): React.JSX.Element | null {
  const chips: React.JSX.Element[] = []

  // Label chips (when labels are in filter menu mode)
  if (labelChips) {
    const logic = useLabelStore.getState().labelFilterLogic
    const prefix = labelChips.activeIds.size > 1
      ? (logic === 'all' ? 'Label is all of' : 'Label is any of')
      : 'Label'
    for (const id of labelChips.activeIds) {
      const label = labelChips.labels.find((l) => l.id === id)
      if (!label) continue
      chips.push(
        <FilterChip key={`l-${id}`} label={label.name} color={label.color} prefix={prefix} onRemove={() => labelChips.onRemove(id)} />
      )
    }
  }

  // Exclude label chips
  if (excludeLabelChips) {
    for (const id of excludeLabelChips.activeIds) {
      const label = excludeLabelChips.labels.find((l) => l.id === id)
      if (!label) continue
      chips.push(
        <ExcludeFilterChip key={`xl-${id}`} label={label.name} color={label.color} prefix="Label" onRemove={() => excludeLabelChips.onRemove(id)} />
      )
    }
  }

  // Project chips (when project filter is enabled)
  if (projectChips) {
    for (const id of projectChips.activeIds) {
      const project = projectChips.projects.find((p) => p.id === id)
      if (!project) continue
      chips.push(
        <FilterChip key={`proj-${id}`} label={project.name} color={project.color ?? '#6366f1'} prefix="Project" onRemove={() => projectChips.onRemove(id)} />
      )
    }
  }

  // Exclude project chips
  if (excludeProjectChips) {
    for (const id of excludeProjectChips.activeIds) {
      const project = excludeProjectChips.projects.find((p) => p.id === id)
      if (!project) continue
      chips.push(
        <ExcludeFilterChip key={`xproj-${id}`} label={project.name} color={project.color ?? '#6366f1'} prefix="Project" onRemove={() => excludeProjectChips.onRemove(id)} />
      )
    }
  }

  for (const p of priorityFilters) {
    const opt = PRIORITY_OPTIONS.find((o) => o.value === p)
    if (!opt) continue
    chips.push(
      <FilterChip key={`p-${p}`} label={opt.label} color={opt.color} prefix="Priority" onRemove={() => onRemovePriority(p)} />
    )
  }

  for (const p of excludePriorityFilters) {
    const opt = PRIORITY_OPTIONS.find((o) => o.value === p)
    if (!opt) continue
    chips.push(
      <ExcludeFilterChip key={`xp-${p}`} label={opt.label} color={opt.color} prefix="Priority" onRemove={() => onRemoveExcludePriority(p)} />
    )
  }

  for (const sid of statusFilters) {
    const status = projectStatuses.find((s) => s.id === sid)
    if (!status) continue
    chips.push(
      <FilterChip key={`s-${sid}`} label={status.name} color={status.color} prefix="Status" onRemove={() => onRemoveStatus(sid)} />
    )
  }

  for (const sid of excludeStatusFilters) {
    const status = projectStatuses.find((s) => s.id === sid)
    if (!status) continue
    chips.push(
      <ExcludeFilterChip key={`xs-${sid}`} label={status.name} color={status.color} prefix="Status" onRemove={() => onRemoveExcludeStatus(sid)} />
    )
  }

  if (dueDatePreset) {
    const preset = DUE_DATE_PRESETS.find((d) => d.value === dueDatePreset)
    chips.push(
      <FilterChip key="due" label={preset?.label ?? dueDatePreset} color="#6366f1" prefix="Due" onRemove={onRemoveDueDate} />
    )
  } else if (dueDateRange) {
    chips.push(
      <FilterChip key="due" label={formatDueDateRange(dueDateRange)} color="#6366f1" prefix="Due" onRemove={onRemoveDueDate} />
    )
  }

  if (keyword) {
    chips.push(
      <FilterChip key="kw" label={keyword} color="#6366f1" prefix="Keyword" onRemove={onRemoveKeyword} />
    )
  }

  if (chips.length === 0) return null
  return <>{chips}</>
}

interface FilterChipProps {
  label: string
  color: string
  prefix: string
  onRemove: () => void
}

function FilterChip({ label, color, prefix, onRemove }: FilterChipProps): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider whitespace-nowrap"
      style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}30` }}
    >
      <span className="opacity-60">{prefix}:</span>
      {label}
      <button onClick={onRemove} className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-foreground/10">
        <X size={8} />
      </button>
    </span>
  )
}

function ExcludeFilterChip({ label, color, prefix, onRemove }: FilterChipProps): React.JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider whitespace-nowrap"
      style={{ backgroundColor: `${color}20`, color, border: `1px solid ${color}30` }}
    >
      <span className="text-red-400/80">{prefix} is not:</span>
      {label}
      <button onClick={onRemove} className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-foreground/10">
        <X size={8} />
      </button>
    </span>
  )
}

/* ── Operator Toggle (is / is not) ─────────────────────────────── */

type FilterOperator = 'is' | 'is_not'

interface OperatorToggleProps {
  value: FilterOperator
  onChange: (op: FilterOperator) => void
}

function OperatorToggle({ value, onChange }: OperatorToggleProps): React.JSX.Element {
  return (
    <div className="mb-1 flex overflow-hidden rounded border border-border">
      <button
        onClick={() => onChange('is')}
        className={`flex-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
          value === 'is' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
        }`}
      >
        is
      </button>
      <button
        onClick={() => onChange('is_not')}
        className={`flex-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
          value === 'is_not' ? 'bg-red-500/12 text-red-400' : 'text-muted hover:bg-foreground/6'
        }`}
      >
        is not
      </button>
    </div>
  )
}

/* ── Label Operator Toggle (is any of / is all of / is not) ────── */

type LabelOperator = 'is_any' | 'is_all' | 'is_not'

function LabelOperatorToggle({ value, onChange }: { value: LabelOperator; onChange: (op: LabelOperator) => void }): React.JSX.Element {
  return (
    <div className="mb-1 flex overflow-hidden rounded border border-border">
      <button
        onClick={() => onChange('is_any')}
        className={`flex-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
          value === 'is_any' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
        }`}
      >
        is any of
      </button>
      <button
        onClick={() => onChange('is_all')}
        className={`flex-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
          value === 'is_all' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
        }`}
      >
        is all of
      </button>
      <button
        onClick={() => onChange('is_not')}
        className={`flex-1 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
          value === 'is_not' ? 'bg-red-500/12 text-red-400' : 'text-muted hover:bg-foreground/6'
        }`}
      >
        is not
      </button>
    </div>
  )
}

/* ── Priority Filter Picker ─────────────────────────────────────── */

interface PriorityFilterPickerProps {
  active: Set<number>
  excluded: Set<number>
  onToggle: (priority: number) => void
  onExcludeToggle: (priority: number) => void
  onClose: () => void
}

function PriorityFilterPicker({ active, excluded, onToggle, onExcludeToggle, onClose }: PriorityFilterPickerProps): React.JSX.Element {
  const [operator, setOperator] = useState<FilterOperator>('is')
  const currentActive = operator === 'is' ? active : excluded
  const currentToggle = operator === 'is' ? onToggle : onExcludeToggle

  return (
    <div className="min-w-[160px] rounded-lg border border-border bg-surface p-1 shadow-lg">
      <div className="mb-1 px-2 pt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Priority</div>
      <div className="px-1 pb-1">
        <OperatorToggle value={operator} onChange={setOperator} />
      </div>
      {PRIORITY_OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-foreground/6"
        >
          <input
            type="checkbox"
            checked={currentActive.has(opt.value)}
            onChange={() => currentToggle(opt.value)}
            className="accent-accent h-3 w-3"
          />
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: opt.color }}>
            {opt.label}
          </span>
        </label>
      ))}
      <button
        onClick={onClose}
        className="mt-1 w-full rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6"
      >
        Done
      </button>
    </div>
  )
}

/* ── Label Filter Picker (for saved views) ─────────────────────── */

interface LabelFilterPickerProps {
  labels: Label[]
  active: Set<string>
  excluded: Set<string>
  onToggle: (labelId: string) => void
  onExcludeToggle: (labelId: string) => void
  onClose: () => void
}

function LabelFilterPicker({ labels, active, excluded, onToggle, onExcludeToggle, onClose }: LabelFilterPickerProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const labelFilterLogic = useLabelStore(selectLabelFilterLogic)
  const [operator, setOperator] = useState<LabelOperator>(
    labelFilterLogic === 'all' ? 'is_all' : 'is_any'
  )
  const searchRef = useRef<HTMLInputElement>(null)
  const filtered = search
    ? labels.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()))
    : labels
  const currentActive = operator === 'is_not' ? excluded : active
  const currentToggle = operator === 'is_not' ? onExcludeToggle : onToggle

  const handleOperatorChange = (op: LabelOperator): void => {
    setOperator(op)
    if (op === 'is_any') {
      useLabelStore.getState().setLabelFilterLogic('any')
    } else if (op === 'is_all') {
      useLabelStore.getState().setLabelFilterLogic('all')
    }
  }

  useEffect(() => {
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault()
      currentToggle(filtered[0].id)
      setSearch('')
    }
    if (e.key === 'Escape') {
      if (search) { setSearch(''); e.stopPropagation() }
      else { onClose(); e.stopPropagation() }
    }
  }

  return (
    <div className="min-w-[200px] rounded-lg border border-border bg-surface p-1 shadow-lg">
      <div className="mb-1 px-2 pt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Labels</div>
      <div className="px-1 pb-1">
        <LabelOperatorToggle value={operator} onChange={handleOperatorChange} />
        <div className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 focus-within:border-accent">
          <Search size={10} className="text-muted" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search labels..."
            className="flex-1 bg-transparent text-[11px] font-light text-foreground placeholder:text-muted/50 focus:outline-none"
            autoComplete="off"
          />
        </div>
      </div>
      <div className="max-h-[220px] overflow-y-auto">
        {filtered.map((label) => (
          <label
            key={label.id}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-foreground/6"
          >
            <input
              type="checkbox"
              checked={currentActive.has(label.id)}
              onChange={() => currentToggle(label.id)}
              className="accent-accent h-3 w-3"
            />
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: label.color }}
            />
            <span className="text-[11px] font-light tracking-tight text-foreground">
              {label.name}
            </span>
          </label>
        ))}
        {filtered.length === 0 && (
          <div className="px-2 py-2 text-[10px] font-light text-muted">No labels found</div>
        )}
      </div>
      <button
        onClick={onClose}
        className="mt-1 w-full rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6"
      >
        Done
      </button>
    </div>
  )
}

/* ── Project Filter Picker (for saved views) ───────────────────── */

interface ProjectFilterPickerProps {
  projects: Project[]
  active: Set<string>
  excluded: Set<string>
  onToggle: (projectId: string) => void
  onExcludeToggle: (projectId: string) => void
  onClose: () => void
}

function ProjectFilterPicker({ projects, active, excluded, onToggle, onExcludeToggle, onClose }: ProjectFilterPickerProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [operator, setOperator] = useState<FilterOperator>('is')
  const searchRef = useRef<HTMLInputElement>(null)
  const filtered = search
    ? projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
    : projects
  const currentActive = operator === 'is' ? active : excluded
  const currentToggle = operator === 'is' ? onToggle : onExcludeToggle

  useEffect(() => {
    requestAnimationFrame(() => searchRef.current?.focus())
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault()
      currentToggle(filtered[0].id)
      setSearch('')
    }
    if (e.key === 'Escape') {
      if (search) { setSearch(''); e.stopPropagation() }
      else { onClose(); e.stopPropagation() }
    }
  }

  return (
    <div className="min-w-[200px] rounded-lg border border-border bg-surface p-1 shadow-lg">
      <div className="mb-1 px-2 pt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Projects</div>
      <div className="px-1 pb-1">
        <OperatorToggle value={operator} onChange={setOperator} />
        <div className="flex items-center gap-1 rounded border border-border px-1.5 py-0.5 focus-within:border-accent">
          <Search size={10} className="text-muted" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search projects..."
            className="flex-1 bg-transparent text-[11px] font-light text-foreground placeholder:text-muted/50 focus:outline-none"
            autoComplete="off"
          />
        </div>
      </div>
      <div className="max-h-[220px] overflow-y-auto">
        {filtered.map((project) => (
          <label
            key={project.id}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-foreground/6"
          >
            <input
              type="checkbox"
              checked={currentActive.has(project.id)}
              onChange={() => currentToggle(project.id)}
              className="accent-accent h-3 w-3"
            />
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: project.color ?? '#6366f1' }}
            />
            <span className="text-[11px] font-light tracking-tight text-foreground">
              {project.name}
            </span>
          </label>
        ))}
        {filtered.length === 0 && (
          <div className="px-2 py-2 text-[10px] font-light text-muted">No projects found</div>
        )}
      </div>
      <button
        onClick={onClose}
        className="mt-1 w-full rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6"
      >
        Done
      </button>
    </div>
  )
}

/* ── Status Filter Picker ───────────────────────────────────────── */

interface StatusFilterPickerProps {
  statuses: Array<{ id: string; name: string; color: string }>
  active: Set<string>
  excluded: Set<string>
  onToggle: (statusId: string) => void
  onExcludeToggle: (statusId: string) => void
  onClose: () => void
}

function StatusFilterPicker({ statuses, active, excluded, onToggle, onExcludeToggle, onClose }: StatusFilterPickerProps): React.JSX.Element {
  const [operator, setOperator] = useState<FilterOperator>('is')
  const currentActive = operator === 'is' ? active : excluded
  const currentToggle = operator === 'is' ? onToggle : onExcludeToggle

  return (
    <div className="min-w-[160px] rounded-lg border border-border bg-surface p-1 shadow-lg">
      <div className="mb-1 px-2 pt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Status</div>
      <div className="px-1 pb-1">
        <OperatorToggle value={operator} onChange={setOperator} />
      </div>
      {statuses.map((s) => (
        <label
          key={s.id}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-foreground/6"
        >
          <input
            type="checkbox"
            checked={currentActive.has(s.id)}
            onChange={() => currentToggle(s.id)}
            className="accent-accent h-3 w-3"
          />
          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.name}
          </span>
        </label>
      ))}
      <button
        onClick={onClose}
        className="mt-1 w-full rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6"
      >
        Done
      </button>
    </div>
  )
}

/* ── Due Date Filter Picker ─────────────────────────────────────── */

interface DueDateFilterPickerProps {
  activePreset: string | null
  activeRange: DueDateRange | null
  onSelectPreset: (preset: string | null) => void
  onSelectRange: (range: DueDateRange | null) => void
  onClose: () => void
}

function DueDateFilterPicker({ activePreset, activeRange, onSelectPreset, onSelectRange, onClose }: DueDateFilterPickerProps): React.JSX.Element {
  const [showCustom, setShowCustom] = useState(activeRange !== null)
  const [mode, setMode] = useState<'relative' | 'absolute'>(activeRange?.mode ?? 'relative')
  const [fromOffset, setFromOffset] = useState(activeRange?.mode === 'relative' ? activeRange.fromOffset ?? 0 : 0)
  const [toOffset, setToOffset] = useState<number | ''>(activeRange?.mode === 'relative' && activeRange.toOffset !== undefined ? activeRange.toOffset : '')
  const [fromDate, setFromDate] = useState(activeRange?.mode === 'absolute' ? activeRange.fromDate ?? '' : '')
  const [toDate, setToDate] = useState(activeRange?.mode === 'absolute' ? activeRange.toDate ?? '' : '')

  const handleApplyCustom = (): void => {
    if (mode === 'relative') {
      onSelectRange({
        mode: 'relative',
        fromOffset,
        ...(toOffset !== '' ? { toOffset: toOffset as number } : {})
      })
    } else {
      if (!fromDate) return
      onSelectRange({
        mode: 'absolute',
        fromDate,
        ...(toDate ? { toDate } : {})
      })
    }
  }

  return (
    <div className="min-w-[200px] rounded-lg border border-border bg-surface p-1 shadow-lg">
      <div className="mb-1 px-2 pt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Due Date</div>
      {DUE_DATE_PRESETS.map((preset) => (
        <button
          key={preset.value}
          onClick={() => { onSelectPreset(activePreset === preset.value ? null : preset.value) }}
          className={`block w-full rounded px-2 py-1 text-left text-[11px] font-bold uppercase tracking-widest transition-colors hover:bg-foreground/6 ${
            activePreset === preset.value ? 'text-accent' : 'text-foreground'
          }`}
        >
          {preset.label}
        </button>
      ))}

      {/* Custom range section */}
      <div className="mt-1 border-t border-border pt-1">
        <button
          onClick={() => setShowCustom(!showCustom)}
          className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] font-bold uppercase tracking-widest transition-colors hover:bg-foreground/6 ${
            showCustom || activeRange ? 'text-accent' : 'text-foreground'
          }`}
        >
          <Calendar size={10} />
          Custom Range
        </button>

        {showCustom && (
          <div className="mt-1 space-y-2 px-2 pb-1">
            {/* Mode toggle */}
            <div className="flex overflow-hidden rounded-lg border border-border">
              <button
                onClick={() => setMode('relative')}
                className={`flex-1 px-3 py-1 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                  mode === 'relative' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
                }`}
              >
                Relative
              </button>
              <button
                onClick={() => setMode('absolute')}
                className={`flex-1 px-3 py-1 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                  mode === 'absolute' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
                }`}
              >
                Fixed
              </button>
            </div>

            {mode === 'relative' ? (
              <div className="space-y-1.5">
                <OffsetInput
                  label="From"
                  value={fromOffset}
                  onChange={(v) => {
                    const n = v === '' ? 0 : v
                    setFromOffset(n)
                    if (toOffset !== '' && n > toOffset) setToOffset(n)
                  }}
                />
                <OffsetInput
                  label="To"
                  value={toOffset}
                  onChange={(v) => {
                    if (v === '') { setToOffset(''); return }
                    setToOffset(v < fromOffset ? fromOffset : v)
                  }}
                  optional
                />
                <DueDatePreview mode="relative" fromOffset={fromOffset} toOffset={toOffset} />
              </div>
            ) : (
              <div className="space-y-1.5">
                <DateInput
                  label="From"
                  value={fromDate}
                  onChange={(v) => {
                    setFromDate(v)
                    if (toDate && v > toDate) setToDate(v)
                  }}
                />
                <DateInput
                  label="To"
                  value={toDate}
                  onChange={(v) => setToDate(v && v < fromDate ? fromDate : v)}
                  optional
                  min={fromDate || undefined}
                />
              </div>
            )}

            <button
              onClick={handleApplyCustom}
              className="w-full rounded bg-accent/12 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-accent transition-colors hover:bg-accent/20"
            >
              Apply
            </button>
          </div>
        )}
      </div>

      <button
        onClick={onClose}
        className="mt-1 w-full rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6"
      >
        Done
      </button>
    </div>
  )
}

/* ── Offset Input (for relative date range) ────────────────────── */

interface OffsetInputProps {
  label: string
  value: number | ''
  onChange: (v: number | '') => void
  optional?: boolean
}

function OffsetInput({ label, value, onChange, optional }: OffsetInputProps): React.JSX.Element {
  const numValue = value === '' ? 0 : value
  const isEmpty = optional && value === ''

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowUp') { e.preventDefault(); onChange(numValue + 1) }
    if (e.key === 'ArrowDown') { e.preventDefault(); onChange(numValue - 1) }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="w-8 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">{label}</span>
      <div className="flex flex-1 items-center gap-0.5">
        <button
          onClick={() => onChange(numValue - 1)}
          className="rounded p-0.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          aria-label={`Decrease ${label}`}
        >
          <Minus size={10} />
        </button>
        <input
          type="text"
          inputMode="numeric"
          value={isEmpty ? '' : numValue}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^0-9-]/g, '')
            if (optional && raw === '') { onChange(''); return }
            if (raw === '-' || raw === '') return
            onChange(parseInt(raw) || 0)
          }}
          onKeyDown={handleKeyDown}
          placeholder={optional ? '—' : '0'}
          className="w-12 rounded border border-border bg-transparent px-1.5 py-0.5 text-center text-[11px] font-light text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
        />
        <button
          onClick={() => onChange(numValue + 1)}
          className="rounded p-0.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          aria-label={`Increase ${label}`}
        >
          <Plus size={10} />
        </button>
      </div>
      <span className="min-w-[60px] text-[9px] font-light text-muted">
        {isEmpty ? '(open)' : offsetHint(numValue)}
      </span>
    </div>
  )
}

function offsetHint(offset: number): string {
  if (offset === 0) return 'today'
  const abs = Math.abs(offset)
  const unit = abs === 1 ? 'day' : 'days'
  return offset > 0 ? `in ${abs} ${unit}` : `${abs} ${unit} ago`
}

/* ── Date Input (for absolute date range) ──────────────────────── */

interface DateInputProps {
  label: string
  value: string
  onChange: (v: string) => void
  optional?: boolean
  min?: string
}

function DateInput({ label, value, onChange, optional, min }: DateInputProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        onChange={(e) => onChange(e.target.value)}
        className="flex-1 rounded border border-border bg-transparent px-1.5 py-0.5 text-[11px] font-light text-foreground focus:border-accent focus:outline-none"
        required={!optional}
      />
    </div>
  )
}

/* ── Due Date Preview (resolved dates) ─────────────────────────── */

interface DueDatePreviewProps {
  mode: 'relative'
  fromOffset: number
  toOffset: number | ''
}

function DueDatePreview({ fromOffset, toOffset }: DueDatePreviewProps): React.JSX.Element {
  const today = new Date()
  const from = new Date(today)
  from.setDate(today.getDate() + fromOffset)
  const fromStr = from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  let toStr = ''
  if (toOffset !== '') {
    const to = new Date(today)
    to.setDate(today.getDate() + (toOffset as number))
    toStr = to.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  return (
    <div className="text-[9px] font-light text-muted/70">
      {toStr ? `${fromStr} → ${toStr}` : `from ${fromStr}`}
    </div>
  )
}

/* ── Keyword Filter Input ───────────────────────────────────────── */

interface KeywordFilterInputProps {
  initial: string
  onSubmit: (value: string) => void
  onClose: () => void
  inputRef: React.RefObject<HTMLInputElement | null>
}

function KeywordFilterInput({ initial, onSubmit, onClose, inputRef }: KeywordFilterInputProps): React.JSX.Element {
  const [value, setValue] = useState(initial)
  return (
    <div className="min-w-[200px] rounded-lg border border-border bg-surface p-2 shadow-lg">
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Keyword</div>
      <div className="flex items-center gap-1">
        <Search size={12} className="text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { onSubmit(value); e.preventDefault() }
            if (e.key === 'Escape') { onClose(); e.preventDefault(); e.stopPropagation() }
          }}
          placeholder="Search title & description..."
          className="flex-1 bg-transparent text-sm font-light text-foreground placeholder:text-muted focus:outline-none"
          autoComplete="off"
        />
      </div>
      <div className="mt-1.5 flex justify-end gap-1">
        <button
          onClick={onClose}
          className="rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6"
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit(value)}
          className="rounded bg-accent/12 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent transition-colors hover:bg-accent/20"
        >
          Apply
        </button>
      </div>
    </div>
  )
}
