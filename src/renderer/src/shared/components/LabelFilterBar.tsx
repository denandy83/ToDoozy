import { useCallback } from 'react'
import { X } from 'lucide-react'
import {
  useLabelStore,
  selectActiveLabelFilters,
  selectHasActiveLabelFilters,
  selectFilterMode
} from '../stores'
import type { Label } from '../../../../shared/types'
import type { LabelFilterMode } from '../stores'

interface LabelFilterBarProps {
  labels: Label[]
}

export function LabelFilterBar({ labels }: LabelFilterBarProps): React.JSX.Element | null {
  const activeLabelFilters = useLabelStore(selectActiveLabelFilters)
  const hasActiveFilters = useLabelStore(selectHasActiveLabelFilters)
  const filterMode = useLabelStore(selectFilterMode)
  const { toggleLabelFilter, clearLabelFilters, setFilterMode } = useLabelStore()

  const handleToggleMode = useCallback(() => {
    const next: LabelFilterMode = filterMode === 'hide' ? 'blur' : 'hide'
    setFilterMode(next)
  }, [filterMode, setFilterMode])

  if (labels.length === 0) return null

  return (
    <div className="flex items-center gap-2 border-b border-border px-4 py-2">
      <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        Labels
      </span>

      <div className="flex flex-1 flex-wrap items-center gap-1">
        {labels.map((label) => {
          const isActive = activeLabelFilters.has(label.id)
          return (
            <button
              key={label.id}
              onClick={() => toggleLabelFilter(label.id)}
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
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

      {hasActiveFilters && (
        <div className="flex items-center gap-1.5">
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
            aria-label="Clear label filters"
            title="Clear filters"
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
