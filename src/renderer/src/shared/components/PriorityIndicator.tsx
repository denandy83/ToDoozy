import { useCallback } from 'react'

const PRIORITY_LEVELS = [
  { value: 0, label: 'None', color: '#888888' },
  { value: 1, label: 'Low', color: '#22c55e' },
  { value: 2, label: 'Normal', color: '#3b82f6' },
  { value: 3, label: 'High', color: '#f59e0b' },
  { value: 4, label: 'Urgent', color: '#ef4444' }
] as const

interface PriorityIndicatorProps {
  currentPriority: number
  onPriorityChange: (priority: number) => void
}

export function PriorityIndicator({
  currentPriority,
  onPriorityChange
}: PriorityIndicatorProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Priority">
      {PRIORITY_LEVELS.map((level) => (
        <PriorityButton
          key={level.value}
          level={level}
          isActive={currentPriority === level.value}
          onSelect={onPriorityChange}
        />
      ))}
    </div>
  )
}

interface PriorityButtonProps {
  level: (typeof PRIORITY_LEVELS)[number]
  isActive: boolean
  onSelect: (value: number) => void
}

function PriorityButton({ level, isActive, onSelect }: PriorityButtonProps): React.JSX.Element {
  const handleClick = useCallback(() => {
    onSelect(level.value)
  }, [level.value, onSelect])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(level.value)
      }
    },
    [level.value, onSelect]
  )

  return (
    <button
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
        isActive
          ? 'text-white'
          : 'text-muted hover:bg-foreground/6'
      }`}
      style={isActive ? { backgroundColor: level.color } : undefined}
      role="radio"
      aria-checked={isActive}
      aria-label={level.label}
      title={level.label}
    >
      {level.label}
    </button>
  )
}

export { PRIORITY_LEVELS }
