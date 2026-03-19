import { useCallback, useState } from 'react'
import ReactDatePicker, { registerLocale } from 'react-datepicker'
import { enGB } from 'date-fns/locale/en-GB'
import { parse, isValid } from 'date-fns'
import 'react-datepicker/dist/react-datepicker.css'
import { Clock, X } from 'lucide-react'

registerLocale('en-GB', enGB)

function maskDateInput(val: string): string {
  const digits = val.replace(/[^0-9]/g, '')
  let masked = ''
  for (let i = 0; i < digits.length && i < 8; i++) {
    if (i === 2 || i === 4) masked += '/'
    masked += digits[i]
  }
  return masked
}

function maskTimeInput(val: string): string {
  const digits = val.replace(/[^0-9]/g, '')
  let masked = ''
  for (let i = 0; i < digits.length && i < 4; i++) {
    if (i === 2) masked += ':'
    masked += digits[i]
  }
  return masked
}

interface DatePickerProps {
  value: string | null
  onChange: (value: string | null) => void
}

function isValidDate(d: Date): boolean {
  return d instanceof Date && !isNaN(d.getTime())
}

function toDate(val: string | null): Date | null {
  if (!val) return null
  const d = new Date(val.includes('T') ? val : val + 'T00:00:00')
  return isValidDate(d) ? d : null
}

function formatIso(date: Date, includeTime: boolean): string | null {
  if (!isValidDate(date)) return null
  const yyyy = date.getFullYear()
  const mo = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  if (!includeTime) return `${yyyy}-${mo}-${dd}`
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mo}-${dd}T${hh}:${mm}`
}

export function DatePicker({ value, onChange }: DatePickerProps): React.JSX.Element {
  const hasTime = value ? value.includes('T') : false
  const [showTime, setShowTime] = useState(hasTime)
  const dateObj = toDate(value)

  // Extract just the time portion as a Date for the time picker
  const timeObj = hasTime && dateObj ? dateObj : null

  const handleDateChange = useCallback(
    (date: Date | null) => {
      if (!date || !isValidDate(date)) {
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

  const handleChangeRaw = useCallback(
    (event?: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
      // Only intercept actual keyboard/input events, not programmatic changes from calendar picks
      if (!event || !('nativeEvent' in event) || !(event.nativeEvent instanceof InputEvent)) return
      const target = event.target as HTMLInputElement
      const raw = target.value

      // Apply mask: auto-insert slashes as user types
      const masked = maskDateInput(raw)
      if (masked !== raw) {
        target.value = masked
      }

      // Only parse when we have a complete date string (dd/MM/yyyy = 10 chars)
      if (masked.length === 10) {
        const parsed = parse(masked, 'dd/MM/yyyy', new Date())
        if (isValid(parsed)) {
          handleDateChange(parsed)
        }
      }
    },
    [handleDateChange]
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

  const handleTimeChangeRaw = useCallback(
    (event?: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>) => {
      if (!event || !('nativeEvent' in event) || !(event.nativeEvent instanceof InputEvent)) return
      const target = event.target as HTMLInputElement
      const raw = target.value

      const masked = maskTimeInput(raw)
      if (masked !== raw) {
        target.value = masked
      }

      // Parse when complete (HH:mm = 5 chars)
      if (masked.length === 5 && dateObj) {
        const [hh, mm] = masked.split(':').map(Number)
        if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
          const combined = new Date(dateObj)
          combined.setHours(hh, mm)
          onChange(formatIso(combined, true))
        }
      }
    },
    [dateObj, onChange]
  )

  const handleTimeFocus = useCallback((e: React.FocusEvent<HTMLInputElement>) => {
    e.target.select()
  }, [])

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
          onChangeRaw={handleChangeRaw}
          dateFormat="dd/MM/yyyy"
          locale="en-GB"
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
            onChangeRaw={handleTimeChangeRaw}
            onFocus={handleTimeFocus}
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
