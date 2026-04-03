import { useEffect, useRef, useCallback, useState, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Search, Archive, X, Calendar } from 'lucide-react'
import { useFocusTrap } from '../../shared/hooks/useFocusTrap'
import { useFocusRestore } from '../../shared/hooks/useFocusRestore'
import { useCommandPaletteStore } from '../../shared/stores/commandPaletteStore'
import { useCommandPaletteSearch, type ExternalFilters } from './useCommandPaletteSearch'
import { CommandPaletteResult } from './CommandPaletteResult'
import { useTaskStore } from '../../shared/stores/taskStore'
import { useViewStore } from '../../shared/stores/viewStore'
import { useProjectStore, selectAllProjects } from '../../shared/stores/projectStore'
import { useLabelStore, selectAllLabels } from '../../shared/stores/labelStore'
import {
  detectOperator,
  filterLabels,
  filterPriorities,
  filterProjects,
  filterDates,
  type ActiveOperator,
  type PriorityOption
} from '../../shared/hooks/smartInputParser'
import { InputSuggestionPopup, type SuggestionData } from '../../shared/components/InputSuggestionPopup'
import { useStatusStore } from '../../shared/stores/statusStore'
import { useSetting } from '../../shared/stores/settingsStore'
import type { Label, Project, Status } from '../../../../shared/types'

interface FilterChip {
  type: 'priority' | 'label' | 'project' | 'date' | 'status'
  id: string
  label: string
  color: string
  value: number | string // priority number, label/project/status id, or ISO date
}

export function CommandPalette(): React.JSX.Element | null {
  const { isOpen, query, selectedIndex, includeArchived, close, setQuery, setSelectedIndex, setIncludeArchived } =
    useCommandPaletteStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Filter chip state
  const [chips, setChips] = useState<FilterChip[]>([])
  const [activeOp, setActiveOp] = useState<ActiveOperator | null>(null)
  const suppressedRef = useRef<Set<number>>(new Set())

  // Data sources for popups
  const allProjects = useProjectStore(selectAllProjects)
  const allLabels = useLabelStore(selectAllLabels)
  const allStatusesMap = useStatusStore((s) => s.statuses)
  const dateFormat = useSetting('date_format') ?? 'dd/mm/yyyy'

  // Deduplicated statuses across all projects (by name)
  const uniqueStatuses = useMemo(() => {
    const seen = new Map<string, Status>()
    for (const status of Object.values(allStatusesMap)) {
      const key = status.name.toLowerCase()
      if (!seen.has(key)) seen.set(key, status)
    }
    return [...seen.values()]
  }, [allStatusesMap])

  // Build external filters from chips
  const externalFilters = useMemo<ExternalFilters>(() => {
    const f: ExternalFilters = {}
    for (const chip of chips) {
      switch (chip.type) {
        case 'priority':
          f.priorityValues = [...(f.priorityValues ?? []), chip.value as number]
          break
        case 'label':
          f.labelIds = [...(f.labelIds ?? []), chip.value as string]
          break
        case 'project':
          f.projectIds = [...(f.projectIds ?? []), chip.value as string]
          break
        case 'date':
          f.dueDates = [...(f.dueDates ?? []), chip.value as string]
          break
        case 'status':
          f.statusIds = [...(f.statusIds ?? []), chip.value as string]
          break
      }
    }
    return f
  }, [chips])

  const results = useCommandPaletteSearch(query, includeArchived, externalFilters)

  useFocusRestore()
  useFocusTrap(containerRef, isOpen)
  const allTasks = useTaskStore((s) => s.tasks)
  const setCurrentTask = useTaskStore((s) => s.setCurrentTask)
  const selectTask = useTaskStore((s) => s.selectTask)
  const setSelectedProject = useViewStore((s) => s.setSelectedProject)
  const setView = useViewStore((s) => s.setView)

  // Reset state when opened/closed
  useEffect(() => {
    if (isOpen) {
      setChips([])
      setActiveOp(null)
      suppressedRef.current = new Set()
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [isOpen])

  // Detect operator on query change (skip r: — not useful for search)
  useEffect(() => {
    if (!inputRef.current) return
    const cursorPos = inputRef.current.selectionStart ?? query.length
    const op = detectOperator(query, cursorPos, suppressedRef.current)
    setActiveOp(op && op.type !== 'r:' ? op : null)
  }, [query])

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return
    const selected = listRef.current.children[selectedIndex] as HTMLElement | undefined
    selected?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleSelect = useCallback(
    (taskId: string) => {
      const task = allTasks[taskId]
      if (task) {
        // Clear label/assignee filters so the target task is visible after navigation
        useLabelStore.getState().clearLabelFilters()
        if (task.is_archived === 1) {
          setSelectedProject(task.project_id)
          setView('archive')
        } else {
          setSelectedProject(task.project_id)
        }
        selectTask(taskId)
        setCurrentTask(taskId)
        requestAnimationFrame(() => {
          document.querySelector<HTMLElement>(`[data-task-id="${taskId}"]`)?.scrollIntoView({ block: 'nearest' })
        })
      }
      close()
    },
    [allTasks, setSelectedProject, setView, selectTask, setCurrentTask, close]
  )

  const removeOperatorFromQuery = useCallback(
    (op: ActiveOperator) => {
      const before = query.slice(0, op.startIndex)
      const after = query.slice(op.endIndex)
      const newQuery = (before + after).replace(/  +/g, ' ').trim()
      setQuery(newQuery)
    },
    [query, setQuery]
  )

  const handlePopupSelect = useCallback(
    (data: SuggestionData) => {
      if (!activeOp) return

      let chip: FilterChip | null = null

      if (data.type === 'label') {
        chip = { type: 'label', id: `l-${data.label.id}`, label: data.label.name, color: data.label.color, value: data.label.id }
      } else if (data.type === 'priority') {
        // Replace existing priority chip
        setChips((prev) => prev.filter((c) => c.type !== 'priority'))
        chip = { type: 'priority', id: `p-${data.option.value}`, label: data.option.label, color: data.option.color, value: data.option.value }
      } else if (data.type === 'project') {
        chip = { type: 'project', id: `proj-${data.project.id}`, label: data.project.name, color: data.project.color, value: data.project.id }
      } else if (data.type === 'date') {
        // Replace existing date chip
        setChips((prev) => prev.filter((c) => c.type !== 'date'))
        chip = { type: 'date', id: `d-${data.option.date}`, label: data.option.label, color: '#6366f1', value: data.option.date }
      } else if (data.type === 'status') {
        chip = { type: 'status', id: `s-${data.status.id}`, label: data.status.name, color: data.status.color, value: data.status.id }
      }

      if (chip) {
        // Don't add duplicate
        setChips((prev) => {
          if (prev.some((c) => c.id === chip!.id)) return prev
          return [...prev, chip!]
        })
      }

      removeOperatorFromQuery(activeOp)
      setActiveOp(null)
      suppressedRef.current = new Set()
      requestAnimationFrame(() => inputRef.current?.focus())
    },
    [activeOp, removeOperatorFromQuery]
  )

  const handleDismissPopup = useCallback(() => {
    if (activeOp) {
      suppressedRef.current = new Set([...suppressedRef.current, activeOp.startIndex])
    }
    setActiveOp(null)
  }, [activeOp])

  const removeChip = useCallback((chipId: string) => {
    setChips((prev) => prev.filter((c) => c.id !== chipId))
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Let popup handle keys when active
      if (activeOp && popupItems.length > 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(Math.min(selectedIndex + 1, results.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(Math.max(selectedIndex - 1, 0))
          break
        case 'Enter':
          e.preventDefault()
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex].id)
          }
          break
        case 'Escape':
          e.preventDefault()
          e.stopPropagation()
          close()
          break
        case 'Backspace':
          if (query === '' && chips.length > 0) {
            // Remove last chip on backspace in empty input
            setChips((prev) => prev.slice(0, -1))
          }
          break
      }
    },
    [selectedIndex, results, setSelectedIndex, handleSelect, close, query, chips]
  )

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        close()
      }
    },
    [close]
  )

  // Build popup items based on active operator
  const popupItems = useMemo(() => {
    if (!activeOp) return []

    if (activeOp.type === 'p:') {
      return filterPriorities(activeOp.query).map((p: PriorityOption) => ({
        id: `p-${p.value}`,
        label: p.label,
        color: p.color,
        data: { type: 'priority' as const, option: p }
      }))
    }

    if (activeOp.type === '@') {
      return filterLabels(allLabels, activeOp.query).map((l: Label) => ({
        id: `l-${l.id}`,
        label: l.name,
        color: l.color,
        data: { type: 'label' as const, label: l }
      }))
    }

    if (activeOp.type === '/') {
      return filterProjects(allProjects, activeOp.query).map((p: Project) => ({
        id: `proj-${p.id}`,
        label: p.name,
        color: p.color,
        data: { type: 'project' as const, project: p }
      }))
    }

    if (activeOp.type === 'd:') {
      return filterDates(activeOp.query, dateFormat).map((d) => ({
        id: `d-${d.date}`,
        label: d.label,
        icon: 'calendar' as const,
        secondaryText: d.formatted,
        data: { type: 'date' as const, option: d }
      }))
    }

    if (activeOp.type === 's:') {
      const q = activeOp.query.toLowerCase()
      const filtered = q
        ? uniqueStatuses.filter((s: Status) => s.name.toLowerCase().includes(q))
        : uniqueStatuses
      return filtered.slice(0, 8).map((s: Status) => ({
        id: `s-${s.id}`,
        label: s.name,
        color: s.color,
        data: { type: 'status' as const, status: s }
      }))
    }

    return []
  }, [activeOp, allLabels, allProjects, uniqueStatuses, dateFormat])

  // Compute popup position relative to input
  const popupPosition = useMemo(() => {
    if (!inputRef.current || !activeOp) return { top: 0, left: 0 }
    const rect = inputRef.current.getBoundingClientRect()
    const charWidth = 7.5 // approximate monospace char width
    const offsetX = Math.min(activeOp.startIndex * charWidth, rect.width - 40)
    return { top: rect.bottom + 4, left: rect.left + offsetX }
  }, [activeOp])

  if (!isOpen) return null

  const hasActiveQuery = query.trim() !== '' || chips.length > 0

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh] backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150"
      onClick={handleBackdropClick}
    >
      <div
        ref={containerRef}
        className="w-full max-w-xl rounded-xl border border-border bg-surface shadow-2xl motion-safe:animate-in motion-safe:slide-in-from-top-2 motion-safe:duration-150"
        onKeyDown={handleKeyDown}
      >
        {/* Search input + chips */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <Search size={16} className="shrink-0 text-muted" />

          {/* Filter chips */}
          {chips.map((chip) => (
            <span
              key={chip.id}
              className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
              style={{
                backgroundColor: `${chip.color}20`,
                color: chip.color,
                border: `1px solid ${chip.color}30`
              }}
            >
              {chip.type === 'date' && <Calendar size={9} />}
              {chip.label}
              <button
                onClick={() => removeChip(chip.id)}
                className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-foreground/10"
              >
                <X size={8} />
              </button>
            </span>
          ))}

          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={chips.length > 0 ? 'Type to search...' : 'Search tasks... (p: @ / d: or type text)'}
            className="min-w-[120px] flex-1 bg-transparent text-sm font-light text-foreground placeholder:text-muted focus:outline-none"
            aria-label="Search tasks"
            autoComplete="off"
            spellCheck={false}
          />
          <label
            className="flex shrink-0 cursor-pointer items-center gap-1.5 select-none"
            title="Include archived tasks in search"
          >
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => setIncludeArchived(e.target.checked)}
              className="accent-accent h-3 w-3 cursor-pointer"
            />
            <Archive size={12} className={includeArchived ? 'text-accent' : 'text-muted'} />
            <span className={`text-[10px] font-bold uppercase tracking-wider ${includeArchived ? 'text-accent' : 'text-muted'}`}>
              Archived
            </span>
          </label>
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">
            Esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className={`max-h-[400px] overflow-y-auto ${results.length > 0 || hasActiveQuery ? 'p-2' : ''}`} role="listbox">
          {hasActiveQuery && results.length === 0 && (
            <div className="flex flex-col items-center justify-center py-8">
              <p className="text-sm font-light text-muted">No results found</p>
              <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.3em] text-muted/60">
                Try a different search
              </p>
            </div>
          )}
          {results.map((task, index) => (
            <CommandPaletteResult
              key={task.id}
              task={task}
              isSelected={index === selectedIndex}
              onSelect={handleSelect}
              onHover={() => setSelectedIndex(index)}
            />
          ))}
        </div>

        {/* Footer hints */}
        {!hasActiveQuery && (
          <div className="border-t border-border px-4 py-2.5">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <OperatorHint prefix="p:" example="priority" />
              <OperatorHint prefix="@" example="label" />
              <OperatorHint prefix="/" example="project" />
              <OperatorHint prefix="d:" example="date" />
              <OperatorHint prefix="s:" example="status" />
              <OperatorHint prefix="has:" example="subtasks" />
            </div>
          </div>
        )}
      </div>

      {/* Operator suggestion popup */}
      {activeOp && popupItems.length > 0 && (
        <InputSuggestionPopup
          items={popupItems}
          position={popupPosition}
          onSelect={handlePopupSelect}
          onDismiss={handleDismissPopup}
        />
      )}
    </div>,
    document.body
  )
}

interface OperatorHintProps {
  prefix: string
  example: string
}

function OperatorHint({ prefix, example }: OperatorHintProps): React.JSX.Element {
  return (
    <span className="text-[10px] text-muted">
      <span className="font-bold text-accent">{prefix}</span>
      <span className="font-light">{example}</span>
    </span>
  )
}
