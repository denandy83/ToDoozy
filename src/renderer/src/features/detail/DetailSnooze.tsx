import { useCallback, useState } from 'react'
import { Bell } from 'lucide-react'
import { getSnoozePresets } from '../../shared/utils/snooze'

interface DetailSnoozeProps {
  currentDueDate?: string | null
  onSnooze: (date: string) => void
}

export function DetailSnooze({ currentDueDate, onSnooze }: DetailSnoozeProps): React.JSX.Element {
  const [showDatePicker, setShowDatePicker] = useState(false)
  const presets = getSnoozePresets(currentDueDate)

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
      {presets.map((preset) => (
        <button
          key={preset.label}
          onClick={() => onSnooze(preset.getDate())}
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
