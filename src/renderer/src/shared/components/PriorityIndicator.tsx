import { useSemanticColor } from '../hooks/useSemanticColor'
import { useCallback } from 'react'

import { PRIORITY_LEVELS } from '../../../../shared/taskPriorities'

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
  const appearance = useSemanticColor(level.color)
  const handleClick = useCallback(() => {
    onSelect(level.value)
  }, [level.value, onSelect])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopPropagation()
        const btn = e.currentTarget as HTMLElement
        const parent = btn.parentElement
        if (!parent) return
        const buttons = Array.from(parent.querySelectorAll<HTMLElement>('button[role="radio"]'))
        const idx = buttons.indexOf(btn)
        const nextIdx = e.key === 'ArrowLeft'
          ? (idx - 1 + buttons.length) % buttons.length
          : (idx + 1) % buttons.length
        const nextBtn = buttons[nextIdx]
        nextBtn.focus()
        nextBtn.click()
      }
    },
    [level.value, onSelect]
  )

  return (
    <button
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`rounded px-2 py-1 ui-metadata transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
        isActive
          ? 'text-accent-fg'
          : 'text-muted hover:bg-foreground/6'
      }`}
      style={isActive ? { backgroundColor: level.color, color: appearance.onFill } : undefined}
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
