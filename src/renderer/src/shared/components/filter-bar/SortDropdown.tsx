import { useCallback, useMemo } from 'react'
import { X, Plus, ArrowUpDown, Trash2 } from 'lucide-react'
import type { SortRule, SortField } from '../../utils/sortTasks'
import { SORT_FIELD_LABELS } from '../../utils/sortTasks'

/* ── Sort Dropdown ─────────────────────────────────────────────── */

// 'completed_date' is intentionally omitted: every list view groups by status, so it
// is a no-op for open tasks, and Done sections always sort by completion date anyway.
const ALL_SORT_FIELDS: SortField[] = ['priority', 'due_date', 'status', 'created_at', 'updated_at', 'title', 'project', 'custom']

interface SortDropdownProps {
  rules: SortRule[]
  onChange: (rules: SortRule[]) => void
  showCustom?: boolean
  isOpen: boolean
  onToggle: () => void
  dropdownRef: React.RefObject<HTMLDivElement | null>
}

export function SortDropdown({ rules, onChange, showCustom, isOpen, onToggle, dropdownRef }: SortDropdownProps): React.JSX.Element {
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
    ? rules.map((r) => `${SORT_FIELD_LABELS[r.field]} - ${r.direction === 'asc' ? 'ASC' : 'DESC'}`).join(', ')
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
                className="rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
                title={rule.direction === 'asc' ? 'Ascending' : 'Descending'}
              >
                {rule.direction === 'asc' ? 'ASC' : 'DESC'}
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
