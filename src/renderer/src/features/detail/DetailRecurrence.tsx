import { useCallback, useState } from 'react'

const RECURRENCE_OPTIONS = [
  { value: null, label: 'None' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' }
] as const

interface DetailRecurrenceProps {
  recurrenceRule: string | null
  onRecurrenceChange: (rule: string | null) => void
}

export function DetailRecurrence({
  recurrenceRule,
  onRecurrenceChange
}: DetailRecurrenceProps): React.JSX.Element {
  const [showCustom, setShowCustom] = useState(
    recurrenceRule !== null && !['daily', 'weekly', 'monthly'].includes(recurrenceRule)
  )
  const [customInterval, setCustomInterval] = useState(() => {
    if (recurrenceRule && recurrenceRule.startsWith('every:')) {
      return recurrenceRule.replace('every:', '')
    }
    return ''
  })

  const isPreset = (val: string | null): boolean =>
    val === null || val === 'daily' || val === 'weekly' || val === 'monthly'

  const handlePresetClick = useCallback(
    (value: string | null) => {
      setShowCustom(false)
      onRecurrenceChange(value)
    },
    [onRecurrenceChange]
  )

  const handleCustomClick = useCallback(() => {
    setShowCustom(true)
  }, [])

  const handleCustomChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setCustomInterval(val)
      if (val.trim()) {
        onRecurrenceChange(`every:${val.trim()}`)
      }
    },
    [onRecurrenceChange]
  )

  const handleCustomKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (customInterval.trim()) {
          onRecurrenceChange(`every:${customInterval.trim()}`)
        }
      }
      if (e.key === 'Escape') {
        e.stopPropagation()
        setShowCustom(false)
        if (!customInterval.trim()) {
          onRecurrenceChange(null)
        }
      }
    },
    [customInterval, onRecurrenceChange]
  )

  return (
    <div className="flex flex-wrap items-center gap-1">
      {RECURRENCE_OPTIONS.map((opt) => (
        <button
          key={opt.label}
          onClick={() => handlePresetClick(opt.value)}
          className={`rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
            !showCustom && recurrenceRule === opt.value
              ? 'bg-accent text-accent-fg'
              : 'text-muted hover:bg-foreground/6'
          }`}
        >
          {opt.label}
        </button>
      ))}
      <button
        onClick={handleCustomClick}
        className={`rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
          showCustom || (!isPreset(recurrenceRule) && recurrenceRule !== null)
            ? 'bg-accent text-accent-fg'
            : 'text-muted hover:bg-foreground/6'
        }`}
      >
        Custom
      </button>
      {showCustom && (
        <input
          type="text"
          value={customInterval}
          onChange={handleCustomChange}
          onKeyDown={handleCustomKeyDown}
          placeholder="e.g. 3 days"
          className="ml-1 w-24 rounded border border-border bg-transparent px-2 py-1 text-sm font-light text-foreground focus:outline-none focus:border-accent"
          autoFocus
        />
      )}
    </div>
  )
}
