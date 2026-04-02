import { useCallback } from 'react'
import { getSnoozePresets } from '../../shared/utils/snooze'

interface DetailSnoozeProps {
  currentDueDate?: string | null
  onSnooze: (date: string) => void
}

export function DetailSnooze({ currentDueDate, onSnooze }: DetailSnoozeProps): React.JSX.Element {
  const presets = getSnoozePresets(currentDueDate)

  // Arrow keys move focus between buttons
  const handleContainerKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    const container = e.currentTarget as HTMLDivElement
    const buttons = Array.from(container.querySelectorAll<HTMLElement>('button'))
    if (buttons.length === 0) return
    const idx = buttons.indexOf(document.activeElement as HTMLElement)
    if (idx === -1) return
    e.preventDefault()
    if (e.key === 'ArrowRight') {
      buttons[(idx + 1) % buttons.length].focus()
    } else {
      buttons[(idx - 1 + buttons.length) % buttons.length].focus()
    }
  }, [])

  return (
    <div className="flex flex-wrap items-center gap-1" onKeyDown={handleContainerKeyDown}>
      {presets.map((preset) => (
        <button
          key={preset.label}
          onClick={() => {
            onSnooze(preset.getDate())
            // After "Later Today", the time field becomes visible — focus it so the user can adjust
            if (preset.label === 'Later Today') {
              setTimeout(() => {
                const timeInput = document.querySelector<HTMLElement>('.datepicker-wrapper-time input')
                timeInput?.focus()
              }, 50)
            }
          }}
          className="rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
        >
          {preset.label}
        </button>
      ))}
    </div>
  )
}
