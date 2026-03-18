import { useCallback, useState, useRef, useEffect } from 'react'
import { Calendar, Clock, X } from 'lucide-react'

interface DatePickerProps {
  value: string | null
  onChange: (value: string | null) => void
  showTime?: boolean
}

export function DatePicker({ value, onChange, showTime: initialShowTime }: DatePickerProps): React.JSX.Element {
  const [showTime, setShowTime] = useState(initialShowTime ?? (value ? value.includes('T') : false))
  const dateRef = useRef<HTMLInputElement>(null)
  const timeRef = useRef<HTMLInputElement>(null)

  const dateValue = value ? value.split('T')[0] : ''
  const timeValue = value && value.includes('T') ? value.split('T')[1]?.substring(0, 5) ?? '' : ''

  useEffect(() => {
    if (!showTime && value && value.includes('T')) {
      // Strip time when toggling off
      onChange(value.split('T')[0])
    }
  }, [showTime, value, onChange])

  const handleDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const date = e.target.value
      if (!date) {
        onChange(null)
        return
      }
      if (showTime && timeValue) {
        onChange(`${date}T${timeValue}:00.000Z`)
      } else {
        onChange(date)
      }
    },
    [showTime, timeValue, onChange]
  )

  const handleTimeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const time = e.target.value
      if (dateValue) {
        onChange(`${dateValue}T${time}:00.000Z`)
      }
    },
    [dateValue, onChange]
  )

  const handleClear = useCallback(() => {
    onChange(null)
  }, [onChange])

  const handleToggleTime = useCallback(() => {
    setShowTime((prev) => !prev)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        dateRef.current?.blur()
        timeRef.current?.blur()
      }
    },
    []
  )

  return (
    <div className="flex items-center gap-2" onKeyDown={handleKeyDown}>
      <Calendar size={14} className="flex-shrink-0 text-muted" />
      <input
        ref={dateRef}
        type="date"
        value={dateValue}
        onChange={handleDateChange}
        className="bg-transparent text-sm font-light text-foreground focus:outline-none [&::-webkit-calendar-picker-indicator]:invert"
      />
      {showTime && dateValue && (
        <input
          ref={timeRef}
          type="time"
          value={timeValue}
          onChange={handleTimeChange}
          className="bg-transparent text-sm font-light text-foreground focus:outline-none [&::-webkit-calendar-picker-indicator]:invert"
        />
      )}
      <button
        onClick={handleToggleTime}
        className={`rounded p-1 transition-colors hover:bg-foreground/6 ${showTime ? 'text-accent' : 'text-muted'}`}
        title={showTime ? 'Hide time' : 'Add time'}
        aria-label={showTime ? 'Hide time' : 'Add time'}
      >
        <Clock size={14} />
      </button>
      {value && (
        <button
          onClick={handleClear}
          className="rounded p-1 text-muted transition-colors hover:bg-foreground/6 hover:text-danger"
          title="Clear date"
          aria-label="Clear date"
        >
          <X size={14} />
        </button>
      )}
    </div>
  )
}
