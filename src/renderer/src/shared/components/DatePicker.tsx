import { useCallback, useState } from 'react'
import ReactDatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { Clock, X } from 'lucide-react'

interface DatePickerProps {
  value: string | null
  onChange: (value: string | null) => void
}

function toDate(val: string | null): Date | null {
  if (!val) return null
  return new Date(val.includes('T') ? val : val + 'T00:00:00')
}

function formatIso(date: Date, includeTime: boolean): string {
  const yyyy = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  if (!includeTime) return `${yyyy}-${mo}-${dd}`
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mo}-${dd}T${hh}:${mm}:00.000Z`
}

export function DatePicker({ value, onChange }: DatePickerProps): React.JSX.Element {
  const hasTime = value ? value.includes('T') : false
  const [showTime, setShowTime] = useState(hasTime)
  const dateObj = toDate(value)

  // Extract just the time portion as a Date for the time picker
  const timeObj = hasTime && dateObj ? dateObj : null

  const handleDateChange = useCallback(
    (date: Date | null) => {
      if (!date) {
        onChange(null)
        return
      }
      // Keep existing time if showTime is on
      if (showTime && timeObj) {
        date.setHours(timeObj.getHours(), timeObj.getMinutes())
        onChange(formatIso(date, true))
      } else if (showTime) {
        onChange(formatIso(date, true))
      } else {
        onChange(formatIso(date, false))
      }
    },
    [showTime, timeObj, onChange]
  )

  const handleTimeChange = useCallback(
    (date: Date | null) => {
      if (!date || !dateObj) return
      const combined = new Date(dateObj)
      combined.setHours(date.getHours(), date.getMinutes())
      onChange(formatIso(combined, true))
    },
    [dateObj, onChange]
  )

  const handleToggleTime = useCallback(() => {
    if (showTime) {
      // Remove time
      if (value && value.includes('T')) {
        onChange(value.split('T')[0])
      }
      setShowTime(false)
    } else {
      setShowTime(true)
      // Add default time (current hour) if date exists
      if (dateObj) {
        const now = new Date()
        const combined = new Date(dateObj)
        combined.setHours(now.getHours(), 0)
        onChange(formatIso(combined, true))
      }
    }
  }, [showTime, value, dateObj, onChange])

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (showTime) {
        // Remove time only
        if (value && value.includes('T')) {
          onChange(value.split('T')[0])
        }
        setShowTime(false)
      } else {
        // Remove date entirely
        onChange(null)
        setShowTime(false)
      }
    },
    [showTime, value, onChange]
  )

  return (
    <div className="flex items-center gap-3">
      {/* Date picker */}
      <div className="datepicker-wrapper">
        <ReactDatePicker
          selected={dateObj}
          onChange={handleDateChange}
          dateFormat="dd/MM/yyyy"
          placeholderText="DD/MM/YYYY"
          isClearable={false}
          className="w-full bg-transparent text-sm font-light text-foreground placeholder:text-muted/50 focus:outline-none"
          calendarClassName="todoozy-calendar"
          popperPlacement="bottom-start"
        />
      </div>

      {/* Time picker — only visible when toggled on */}
      {showTime && value && (
        <div className="datepicker-wrapper-time">
          <ReactDatePicker
            selected={timeObj}
            onChange={handleTimeChange}
            showTimeSelect
            showTimeSelectOnly
            timeIntervals={15}
            timeFormat="HH:mm"
            dateFormat="HH:mm"
            placeholderText="HH:MM"
            isClearable={false}
            className="w-full bg-transparent text-sm font-light text-foreground placeholder:text-muted/50 focus:outline-none"
            calendarClassName="todoozy-calendar"
            popperPlacement="bottom-start"
          />
        </div>
      )}

      {/* Clock toggle */}
      {value && (
        <button
          onClick={handleToggleTime}
          className={`flex-shrink-0 rounded p-0.5 transition-colors hover:bg-foreground/6 hover:text-foreground ${
            showTime ? 'text-accent' : 'text-muted'
          }`}
          title={showTime ? 'Remove time' : 'Add time'}
          aria-label={showTime ? 'Remove time' : 'Add time'}
        >
          <Clock size={14} />
        </button>
      )}

      {/* Clear */}
      {value && (
        <button
          onClick={handleClear}
          className="flex-shrink-0 rounded p-0.5 text-muted transition-colors hover:bg-foreground/6 hover:text-danger"
          title={showTime ? 'Remove time' : 'Clear date'}
          aria-label={showTime ? 'Remove time' : 'Clear date'}
        >
          <X size={12} />
        </button>
      )}
    </div>
  )
}
