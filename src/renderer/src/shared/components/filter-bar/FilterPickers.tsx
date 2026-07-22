import { useState, useRef, useEffect } from 'react'
import { Search, Minus, Plus, Calendar } from 'lucide-react'
import type { Label, Project } from '../../../../../shared/types'
import type { DueDateRange } from '../../stores'
import { useLabelStore, selectLabelFilterLogic } from '../../stores'
import { PRIORITY_OPTIONS, DUE_DATE_PRESETS, type FilterOperator, type LabelOperator } from './filterBarShared'
import { OperatorToggle, LabelOperatorToggle } from './OperatorToggles'

/* ── Priority Filter Picker ─────────────────────────────────────── */

interface PriorityFilterPickerProps {
  active: Set<number>
  excluded: Set<number>
  onToggle: (priority: number) => void
  onExcludeToggle: (priority: number) => void
  onClose: () => void
}

export function PriorityFilterPicker({ active, excluded, onToggle, onExcludeToggle, onClose }: PriorityFilterPickerProps): React.JSX.Element {
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

export function LabelFilterPicker({ labels, active, excluded, onToggle, onExcludeToggle, onClose }: LabelFilterPickerProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const labelFilterLogic = useLabelStore(selectLabelFilterLogic)
  const [operator, setOperator] = useState<LabelOperator>(
    labelFilterLogic === 'all' ? 'is_all' : 'is_any'
  )
  const searchRef = useRef<HTMLInputElement>(null)
  const currentActive = operator === 'is_not' ? excluded : active
  const filtered = (search
    ? labels.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()))
    : labels
  ).slice().sort((a, b) => {
    const aActive = currentActive.has(a.name.toLowerCase()) ? 0 : 1
    const bActive = currentActive.has(b.name.toLowerCase()) ? 0 : 1
    return aActive - bActive
  })
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
              checked={currentActive.has(label.name.toLowerCase())}
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

export function ProjectFilterPicker({ projects, active, excluded, onToggle, onExcludeToggle, onClose }: ProjectFilterPickerProps): React.JSX.Element {
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

export function StatusFilterPicker({ statuses, active, excluded, onToggle, onExcludeToggle, onClose }: StatusFilterPickerProps): React.JSX.Element {
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

export function DueDateFilterPicker({ activePreset, activeRange, onSelectPreset, onSelectRange, onClose }: DueDateFilterPickerProps): React.JSX.Element {
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

export function KeywordFilterInput({ initial, onSubmit, onClose, inputRef }: KeywordFilterInputProps): React.JSX.Element {
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
