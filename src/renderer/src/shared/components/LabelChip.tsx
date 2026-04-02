import { useCallback } from 'react'
import { X } from 'lucide-react'

interface LabelChipProps {
  name: string
  color: string
  onRemove?: () => void
  onClick?: () => void
}

export function LabelChip({ name, color, onRemove, onClick }: LabelChipProps): React.JSX.Element {
  const handleRemove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onRemove?.()
    },
    [onRemove]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onClick?.()
      }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        onRemove?.()
      }
    },
    [onClick, onRemove]
  )

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold tracking-wider cursor-default"
      style={{
        backgroundColor: `${color}20`,
        color: color,
        border: `1px solid ${color}30`
      }}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick || onRemove ? 0 : undefined}
    >
      {name}
      {onRemove && (
        <button
          onClick={handleRemove}
          className="ml-0.5 rounded-full p-0 hover:bg-accent-fg/20 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          aria-label={`Remove ${name}`}
        >
          <X size={10} />
        </button>
      )}
    </span>
  )
}
