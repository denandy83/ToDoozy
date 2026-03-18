import { useCallback, useState } from 'react'
import ReactDatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { Clock, X } from 'lucide-react'

interface DatePickerProps {
  value: string | null
  onChange: (value: string | null) => void
}

export function DatePicker({ value, onChange }: DatePickerProps): React.JSX.Element {
  const hasTime = value ? value.includes('T') : false
  const [showTime, setShowTime] = useState(hasTime)

  // Parse stored value to Date object
  const dateObj = value ? new Date(value.includes('T') ? value : value + 'T00:00:00') : null

  const handleChange = useCallback(
    (date: Date | null) => {
      if (!date) {
        onChange(null)
        return
      }
      if (showTime) {
        const hh = String(date.getHours()).padStart(2, '0')
        const mm = String(date.getMinutes()).padStart(2, '0')
        const yyyy = date.getFullYear()
        const mo = String(date.getMonth() + 1).padStart(2, '0')
        const dd = String(date.getDate()).padStart(2, '0')
        onChange(`${yyyy}-${mo}-${dd}T${hh}:${mm}:00.000Z`)
      } else {
        const yyyy = date.getFullYear()
        const mo = String(date.getMonth() + 1).padStart(2, '0')
        const dd = String(date.getDate()).padStart(2, '0')
        onChange(`${yyyy}-${mo}-${dd}`)
      }
    },
    [showTime, onChange]
  )

  const handleClearDate = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onChange(null)
      setShowTime(false)
    },
    [onChange]
  )

  const handleClearTime = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (value && value.includes('T')) {
        onChange(value.split('T')[0])
      }
      setShowTime(false)
    },
    [value, onChange]
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
    }
  }, [showTime, value, onChange])

  return (
    <div className="flex items-center gap-2">
      <div className="datepicker-wrapper">
        <ReactDatePicker
          selected={dateObj}
          onChange={handleChange}
          showTimeSelect={showTime}
          timeFormat="HH:mm"
          timeIntervals={15}
          dateFormat={showTime ? 'dd/MM/yyyy HH:mm' : 'dd/MM/yyyy'}
          placeholderText={showTime ? 'DD/MM/YYYY HH:MM' : 'DD/MM/YYYY'}
          isClearable={false}
          className="w-full bg-transparent text-sm font-light text-foreground placeholder:text-muted/50 focus:outline-none"
          calendarClassName="todoozy-calendar"
          popperPlacement="bottom-start"
        />
      </div>
      {value && (
        <button
          onClick={handleToggleTime}
          className={`flex-shrink-0 rounded p-0.5 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground`}
          title={showTime ? 'Remove time' : 'Add time'}
          aria-label={showTime ? 'Remove time' : 'Add time'}
        >
          <Clock size={14} />
        </button>
      )}
      {value && (
        <button
          onClick={showTime ? handleClearTime : handleClearDate}
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
