import { useCallback, useState, useRef, useEffect, useMemo } from 'react'
import { X, Plus, Search, Save } from 'lucide-react'
import {
  useLabelStore,
  selectActiveLabelFilters,
  selectFilterMode,
  selectPriorityFilters,
  selectStatusFilters,
  selectDueDatePreset,
  selectKeyword,
  selectHasAnyFilter
} from '../stores'
import type { Label } from '../../../../shared/types'
import type { LabelFilterMode } from '../stores'
import { useStatusesByProject } from '../stores/statusStore'
import { useAuthStore } from '../stores/authStore'
import { useSavedViewStore } from '../stores/savedViewStore'

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

type FilterType = 'priority' | 'due_date' | 'status' | 'keyword'

interface FilterBarProps {
  labels: Label[]
  projectId?: string
}

export function FilterBar({ labels, projectId }: FilterBarProps): React.JSX.Element | null {
  const activeLabelFilters = useLabelStore(selectActiveLabelFilters)
  const filterMode = useLabelStore(selectFilterMode)
  const priorityFilters = useLabelStore(selectPriorityFilters)
  const statusFilters = useLabelStore(selectStatusFilters)
  const dueDatePreset = useLabelStore(selectDueDatePreset)
  const keyword = useLabelStore(selectKeyword)
  const hasAnyFilter = useLabelStore(selectHasAnyFilter)
  const {
    toggleLabelFilter, clearLabelFilters, setFilterMode,
    togglePriorityFilter, toggleStatusFilter, setDueDatePreset, setKeyword
  } = useLabelStore()
  const userId = useAuthStore((s) => s.currentUser)?.id ?? ''
  const { createView } = useSavedViewStore()
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [activeFilterType, setActiveFilterType] = useState<FilterType | null>(null)
  const [savingView, setSavingView] = useState(false)
  const [saveViewName, setSaveViewName] = useState('')
  const saveViewInputRef = useRef<HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const keywordInputRef = useRef<HTMLInputElement>(null)

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
    if (state.dueDatePreset) config.dueDatePreset = state.dueDatePreset
    if (state.keyword) config.keyword = state.keyword
    config.filterMode = state.filterMode
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
    types.push('priority') // always available (multi-select)
    types.push('due_date') // always available (can change)
    if (projectId) types.push('status') // only in project views
    types.push('keyword') // always available
    return types
  }, [projectId])

  const hasLabels = labels.length > 0
  if (!hasLabels && !hasAnyFilter) return null

  return (
    <div className="flex flex-wrap items-center gap-2 px-4 py-2">
      {/* Label section */}
      {hasLabels && (
        <>
          <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Labels</span>
          <div className="flex flex-wrap items-center gap-1">
            {labels.map((label) => {
              const isActive = activeLabelFilters.has(label.id)
              return (
                <button
                  key={label.id}
                  onClick={() => toggleLabelFilter(label.id)}
                  className="rounded-full py-0.5 px-2 text-[9px] font-bold tracking-wider transition-all cursor-pointer"
                  style={{
                    backgroundColor: isActive ? `${label.color}30` : `${label.color}15`,
                    color: label.color,
                    border: `1px solid ${isActive ? label.color : `${label.color}30`}`,
                    boxShadow: isActive ? `0 0 0 2px ${label.color}40` : 'none'
                  }}
                  aria-pressed={isActive}
                  aria-label={`Filter by ${label.name}`}
                >
                  {label.name}
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* Active filter chips */}
      <ActiveFilterChips
        priorityFilters={priorityFilters}
        statusFilters={statusFilters}
        dueDatePreset={dueDatePreset}
        keyword={keyword}
        projectStatuses={projectStatuses}
        onRemovePriority={togglePriorityFilter}
        onRemoveStatus={toggleStatusFilter}
        onRemoveDueDate={() => setDueDatePreset(null)}
        onRemoveKeyword={() => setKeyword('')}
      />

      {/* + Filter button and dropdown */}
      <div className="relative" ref={dropdownRef}>
        <button
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
                {type === 'due_date' ? 'Due Date' : type === 'keyword' ? 'Keyword' : type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
        )}

        {/* Filter picker popups */}
        {activeFilterType === 'priority' && (
          <PriorityFilterPicker
            active={priorityFilters}
            onToggle={togglePriorityFilter}
            onClose={() => setActiveFilterType(null)}
          />
        )}
        {activeFilterType === 'status' && projectId && (
          <StatusFilterPicker
            statuses={projectStatuses}
            active={statusFilters}
            onToggle={toggleStatusFilter}
            onClose={() => setActiveFilterType(null)}
          />
        )}
        {activeFilterType === 'due_date' && (
          <DueDateFilterPicker
            active={dueDatePreset}
            onSelect={(v) => { setDueDatePreset(v); setActiveFilterType(null) }}
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
      </div>

      {/* Save as View + Filter mode + clear */}
      {hasAnyFilter && (
        <div className="ml-auto flex items-center gap-1.5">
          {savingView ? (
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
          ) : (
            <button
              onClick={() => setSavingView(true)}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
              title="Save current filters as a view"
            >
              <Save size={10} />
              Save View
            </button>
          )}
          <button
            onClick={handleToggleMode}
            className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            title={`Filter mode: ${filterMode}. Click to toggle.`}
          >
            {filterMode === 'hide' ? 'Hide' : 'Blur'}
          </button>
          <button
            onClick={clearLabelFilters}
            className="rounded p-0.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
            aria-label="Clear all filters"
            title="Clear all filters"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}

/* ── Active Filter Chips ────────────────────────────────────────── */

interface ActiveFilterChipsProps {
  priorityFilters: Set<number>
  statusFilters: Set<string>
  dueDatePreset: string | null
  keyword: string
  projectStatuses: Array<{ id: string; name: string; color: string }>
  onRemovePriority: (p: number) => void
  onRemoveStatus: (id: string) => void
  onRemoveDueDate: () => void
  onRemoveKeyword: () => void
}

function ActiveFilterChips({
  priorityFilters, statusFilters, dueDatePreset, keyword,
  projectStatuses, onRemovePriority, onRemoveStatus, onRemoveDueDate, onRemoveKeyword
}: ActiveFilterChipsProps): React.JSX.Element | null {
  const chips: React.JSX.Element[] = []

  for (const p of priorityFilters) {
    const opt = PRIORITY_OPTIONS.find((o) => o.value === p)
    if (!opt) continue
    chips.push(
      <FilterChip key={`p-${p}`} label={opt.label} color={opt.color} prefix="Priority" onRemove={() => onRemovePriority(p)} />
    )
  }

  for (const sid of statusFilters) {
    const status = projectStatuses.find((s) => s.id === sid)
    if (!status) continue
    chips.push(
      <FilterChip key={`s-${sid}`} label={status.name} color={status.color} prefix="Status" onRemove={() => onRemoveStatus(sid)} />
    )
  }

  if (dueDatePreset) {
    const preset = DUE_DATE_PRESETS.find((d) => d.value === dueDatePreset)
    chips.push(
      <FilterChip key="due" label={preset?.label ?? dueDatePreset} color="#6366f1" prefix="Due" onRemove={onRemoveDueDate} />
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
      className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
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

/* ── Priority Filter Picker ─────────────────────────────────────── */

interface PriorityFilterPickerProps {
  active: Set<number>
  onToggle: (priority: number) => void
  onClose: () => void
}

function PriorityFilterPicker({ active, onToggle, onClose }: PriorityFilterPickerProps): React.JSX.Element {
  return (
    <div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-surface p-1 shadow-lg">
      <div className="mb-1 px-2 pt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Priority</div>
      {PRIORITY_OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-foreground/6"
        >
          <input
            type="checkbox"
            checked={active.has(opt.value)}
            onChange={() => onToggle(opt.value)}
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

/* ── Status Filter Picker ───────────────────────────────────────── */

interface StatusFilterPickerProps {
  statuses: Array<{ id: string; name: string; color: string }>
  active: Set<string>
  onToggle: (statusId: string) => void
  onClose: () => void
}

function StatusFilterPicker({ statuses, active, onToggle, onClose }: StatusFilterPickerProps): React.JSX.Element {
  return (
    <div className="absolute left-0 top-full z-50 mt-1 min-w-[160px] rounded-lg border border-border bg-surface p-1 shadow-lg">
      <div className="mb-1 px-2 pt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Status</div>
      {statuses.map((s) => (
        <label
          key={s.id}
          className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 transition-colors hover:bg-foreground/6"
        >
          <input
            type="checkbox"
            checked={active.has(s.id)}
            onChange={() => onToggle(s.id)}
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
  active: string | null
  onSelect: (preset: string | null) => void
  onClose: () => void
}

function DueDateFilterPicker({ active, onSelect, onClose }: DueDateFilterPickerProps): React.JSX.Element {
  return (
    <div className="absolute left-0 top-full z-50 mt-1 min-w-[140px] rounded-lg border border-border bg-surface p-1 shadow-lg">
      <div className="mb-1 px-2 pt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Due Date</div>
      {DUE_DATE_PRESETS.map((preset) => (
        <button
          key={preset.value}
          onClick={() => onSelect(active === preset.value ? null : preset.value)}
          className={`block w-full rounded px-2 py-1 text-left text-[11px] font-bold uppercase tracking-widest transition-colors hover:bg-foreground/6 ${
            active === preset.value ? 'text-accent' : 'text-foreground'
          }`}
        >
          {preset.label}
        </button>
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
    <div className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-border bg-surface p-2 shadow-lg">
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
