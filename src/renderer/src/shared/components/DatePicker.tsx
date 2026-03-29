import { useCallback, useEffect, useRef, useState } from 'react'
import ReactDatePicker, { registerLocale } from 'react-datepicker'
import { enGB } from 'date-fns/locale/en-GB'
import { enUS } from 'date-fns/locale/en-US'
import { parse, isValid } from 'date-fns'
import 'react-datepicker/dist/react-datepicker.css'
import { Clock, X } from 'lucide-react'
import { useDateFormat, type DateFormatType } from '../utils/dateFormat'
import { pushPopup } from '../utils/popupStack'

registerLocale('en-GB', enGB)
registerLocale('en-US', enUS)

const FORMAT_CONFIG: Record<DateFormatType, { dateFnsFormat: string; locale: string; maskSlashPositions: number[]; separator: string }> = {
  'dd/mm/yyyy': { dateFnsFormat: 'dd/MM/yyyy', locale: 'en-GB', maskSlashPositions: [2, 4], separator: '/' },
  'mm/dd/yyyy': { dateFnsFormat: 'MM/dd/yyyy', locale: 'en-US', maskSlashPositions: [2, 4], separator: '/' },
  'yyyy/mm/dd': { dateFnsFormat: 'yyyy/MM/dd', locale: 'en-GB', maskSlashPositions: [4, 6], separator: '/' }
}

function maskDateInput(val: string, fmt: DateFormatType = 'dd/mm/yyyy'): string {
  const config = FORMAT_CONFIG[fmt]
  const digits = val.replace(/[^0-9]/g, '')
  let masked = ''
  for (let i = 0; i < digits.length && i < 8; i++) {
    if (config.maskSlashPositions.includes(i)) masked += config.separator
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
  const dateFormat = useDateFormat()
  const fmtConfig = FORMAT_CONFIG[dateFormat]
  const hasTime = value ? value.includes('T') : false
  const [showTime, setShowTime] = useState(hasTime)

  const datePickerRef = useRef<InstanceType<typeof ReactDatePicker>>(null)
  const timePickerRef = useRef<InstanceType<typeof ReactDatePicker>>(null)
  const dateUnsubRef = useRef<(() => void) | null>(null)
  const timeUnsubRef = useRef<(() => void) | null>(null)

  const handleDateCalendarOpen = useCallback(() => {
    dateUnsubRef.current = pushPopup(() => datePickerRef.current?.setOpen(false))
  }, [])
  const handleDateCalendarClose = useCallback(() => {
    dateUnsubRef.current?.()
    dateUnsubRef.current = null
  }, [])
  const handleTimeCalendarOpen = useCallback(() => {
    timeUnsubRef.current = pushPopup(() => timePickerRef.current?.setOpen(false))
  }, [])
  const handleTimeCalendarClose = useCallback(() => {
    timeUnsubRef.current?.()
    timeUnsubRef.current = null
  }, [])

  // Sync showTime when an external update adds or removes a time component (e.g. snooze)
  useEffect(() => {
    setShowTime(value ? value.includes('T') : false)
  }, [value])
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
      const masked = maskDateInput(raw, dateFormat)
      if (masked !== raw) {
        target.value = masked
      }

      // Only parse when we have a complete date string (10 chars)
      if (masked.length === 10) {
        const parsed = parse(masked, fmtConfig.dateFnsFormat, new Date())
        if (isValid(parsed)) {
          handleDateChange(parsed)
        }
      }
    },
    [handleDateChange, dateFormat, fmtConfig]
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
      // Default to 3 hours from now (consistent with snooze "Later Today")
      if (dateObj) {
        const threeHoursFromNow = new Date(Date.now() + 3 * 60 * 60 * 1000)
        const combined = new Date(dateObj)
        combined.setHours(threeHoursFromNow.getHours(), threeHoursFromNow.getMinutes())
        onChange(formatIso(combined, true))
      }
      // Focus the time input once it renders
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>('.datepicker-wrapper-time input')?.focus()
      })
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
          ref={datePickerRef}
          selected={dateObj}
          onChange={handleDateChange}
          onChangeRaw={handleChangeRaw}
          onCalendarOpen={handleDateCalendarOpen}
          onCalendarClose={handleDateCalendarClose}
          dateFormat={fmtConfig.dateFnsFormat}
          locale={fmtConfig.locale}
          placeholderText={dateFormat.toUpperCase()}
          isClearable={false}
          className="w-full bg-transparent text-sm font-light text-foreground placeholder:text-muted/50 focus:outline-none"
          calendarClassName="todoozy-calendar"
          popperPlacement="bottom-start"
        />
      </div>

      {/* Time picker — only visible when toggled on */}
      {showTime && value && (
        <div className="datepicker-wrapper-time" data-detail-subfield="1">
          <ReactDatePicker
            ref={timePickerRef}
            selected={timeObj}
            onChange={handleTimeChange}
            onChangeRaw={handleTimeChangeRaw}
            onFocus={handleTimeFocus}
            onCalendarOpen={handleTimeCalendarOpen}
            onCalendarClose={handleTimeCalendarClose}
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

      {/* Clock toggle — only shown when no time is set; use X to remove an existing time */}
      {value && !showTime && (
        <button
          data-detail-subfield="2"
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
          data-detail-subfield="3"
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
