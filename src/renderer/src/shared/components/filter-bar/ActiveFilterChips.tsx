import { useState, useRef, useEffect } from 'react'
import { X, ChevronDown } from 'lucide-react'
import type { Label, Project } from '../../../../../shared/types'
import type { DueDateRange } from '../../stores'
import { useLabelStore } from '../../stores'
import { PRIORITY_OPTIONS, DUE_DATE_PRESETS } from './filterBarShared'
import { formatDueDateRange } from '../../utils/dueDateFilter'

/* ── Active Filter Chips ────────────────────────────────────────── */

interface ActiveFilterChipsProps {
  labelFilterLogic: 'any' | 'all'
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

export function ActiveFilterChips({
  labelFilterLogic, priorityFilters, statusFilters, excludePriorityFilters, excludeStatusFilters,
  dueDatePreset, dueDateRange, keyword,
  projectStatuses, onRemovePriority, onRemoveStatus, onRemoveExcludePriority, onRemoveExcludeStatus,
  onRemoveDueDate, onRemoveKeyword, labelChips, excludeLabelChips, projectChips, excludeProjectChips
}: ActiveFilterChipsProps): React.JSX.Element | null {
  const chips: React.JSX.Element[] = []
  const setLabelGroupOperator = useLabelStore((s) => s.setLabelGroupOperator)

  // Label chips — consolidated into a single chip with a clickable operator
  if (labelChips && labelChips.activeIds.size > 0) {
    const ids = [...labelChips.activeIds]
    const names = ids
      .map((nameKey) => labelChips.labels.find((l) => l.name.toLowerCase() === nameKey)?.name ?? nameKey)
      .filter(Boolean)
      .join(', ')
    if (names) {
      chips.push(
        <GroupFilterChip
          key="labels"
          count={ids.length}
          operator={labelFilterLogic}
          names={names}
          ids={ids}
          onRemove={labelChips.onRemove}
          onSetOperator={(op) => setLabelGroupOperator(ids, op)}
        />
      )
    }
  }

  // Exclude label chips — consolidated, also operator-switchable ("is not")
  if (excludeLabelChips && excludeLabelChips.activeIds.size > 0) {
    const ids = [...excludeLabelChips.activeIds]
    const names = ids
      .map((nameKey) => excludeLabelChips.labels.find((l) => l.name.toLowerCase() === nameKey)?.name ?? nameKey)
      .filter(Boolean)
      .join(', ')
    if (names) {
      chips.push(
        <GroupFilterChip
          key="exclude-labels"
          count={ids.length}
          operator="is_not"
          names={names}
          ids={ids}
          onRemove={excludeLabelChips.onRemove}
          onSetOperator={(op) => setLabelGroupOperator(ids, op)}
          exclude
        />
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

type LabelGroupOperator = 'any' | 'all' | 'is_not'

function GroupFilterChip({ count, operator, names, ids, onRemove, onSetOperator, exclude }: {
  count: number
  operator: LabelGroupOperator
  names: string
  ids: string[]
  onRemove: (id: string) => void
  onSetOperator: (op: LabelGroupOperator) => void
  exclude?: boolean
}): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  // With a single label, "any of"/"all of" are equivalent — collapse to "is".
  const operatorLabel = (op: LabelGroupOperator): string =>
    count <= 1
      ? (op === 'is_not' ? 'is not' : 'is')
      : (op === 'is_not' ? 'is not' : op === 'all' ? 'is all of' : 'is any of')
  const options: LabelGroupOperator[] = count <= 1 ? ['any', 'is_not'] : ['any', 'all', 'is_not']
  const current: LabelGroupOperator = count <= 1 && operator !== 'is_not' ? 'any' : operator

  return (
    <span
      ref={ref}
      className={`relative inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider whitespace-nowrap ${
        exclude ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-accent/10 text-accent border border-accent/20'
      }`}
    >
      <span className="opacity-60">Label</span>
      <button
        onClick={() => setMenuOpen((o) => !o)}
        className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 underline decoration-dotted underline-offset-2 transition-colors hover:bg-foreground/10"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="Change label operator"
      >
        {operatorLabel(current)}
        <ChevronDown size={8} />
      </button>
      <span className="opacity-60">:</span>
      {names}
      <button
        onClick={() => ids.forEach((id) => onRemove(id))}
        className="ml-0.5 rounded-full p-0.5 transition-colors hover:bg-foreground/10"
        title="Clear all"
        aria-label="Clear label filter"
      >
        <X size={8} />
      </button>

      {menuOpen && (
        <div
          className="absolute left-0 top-full z-50 mt-1 min-w-[110px] rounded-lg border border-border bg-surface p-1 shadow-lg"
          role="menu"
        >
          {options.map((op) => (
            <button
              key={op}
              role="menuitemradio"
              aria-checked={op === current}
              onClick={() => { onSetOperator(op); setMenuOpen(false) }}
              className={`block w-full rounded px-2 py-1 text-left text-[9px] font-bold uppercase tracking-wider transition-colors hover:bg-foreground/6 ${
                op === current
                  ? (op === 'is_not' ? 'text-red-400' : 'text-accent')
                  : 'text-foreground'
              }`}
            >
              {operatorLabel(op)}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
