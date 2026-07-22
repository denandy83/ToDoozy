import type { FilterOperator, LabelOperator } from './filterBarShared'

/* ── Operator Toggle (is / is not) ─────────────────────────────── */

interface OperatorToggleProps {
  value: FilterOperator
  onChange: (op: FilterOperator) => void
}

export function OperatorToggle({ value, onChange }: OperatorToggleProps): React.JSX.Element {
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

export function LabelOperatorToggle({ value, onChange }: { value: LabelOperator; onChange: (op: LabelOperator) => void }): React.JSX.Element {
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
