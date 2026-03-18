import { useCallback, useState } from 'react'
import { Bell } from 'lucide-react'

interface DetailSnoozeProps {
  onSnooze: (date: string) => void
}

function addDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function getLaterToday(): string {
  const d = new Date()
  d.setHours(d.getHours() + 3)
  return d.toISOString()
}

const SNOOZE_PRESETS = [
  { label: 'Later Today', getDate: getLaterToday },
  { label: 'Tomorrow', getDate: () => addDays(1) },
  { label: 'In 3 Days', getDate: () => addDays(3) },
  { label: 'Next Week', getDate: () => addDays(7) }
] as const

export function DetailSnooze({ onSnooze }: DetailSnoozeProps): React.JSX.Element {
  const [showDatePicker, setShowDatePicker] = useState(false)

  const handlePreset = useCallback(
    (getDate: () => string) => {
      onSnooze(getDate())
    },
    [onSnooze]
  )

  const handlePickDate = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.value) {
        onSnooze(e.target.value)
        setShowDatePicker(false)
      }
    },
    [onSnooze]
  )

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Bell size={14} className="mr-1 text-muted" />
      {SNOOZE_PRESETS.map((preset) => (
        <button
          key={preset.label}
          onClick={() => handlePreset(preset.getDate)}
          className="rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
        >
          {preset.label}
        </button>
      ))}
      {showDatePicker ? (
        <input
          type="date"
          onChange={handlePickDate}
          className="bg-transparent text-sm font-light text-foreground focus:outline-none [&::-webkit-calendar-picker-indicator]:invert"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation()
              setShowDatePicker(false)
            }
          }}
        />
      ) : (
        <button
          onClick={() => setShowDatePicker(true)}
          className="rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
        >
          Pick Date...
        </button>
      )}
    </div>
  )
}
