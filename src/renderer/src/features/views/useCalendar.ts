import { useMemo, useState, useCallback } from 'react'

export type CalendarLayout = 'month' | 'week'

export interface CalendarDay {
  date: string // YYYY-MM-DD
  dayOfMonth: number
  isToday: boolean
  isCurrentMonth: boolean
}

interface UseCalendarReturn {
  days: CalendarDay[]
  title: string
  goNext: () => void
  goPrev: () => void
  goToday: () => void
  anchorDate: Date
}

export function toYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function startOfWeek(d: Date): Date {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day // Monday is first day
  const result = new Date(d)
  result.setDate(d.getDate() + diff)
  return result
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const SHORT_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
]

export function getMonthDays(anchorDate: Date, todayStr: string): CalendarDay[] {
  const year = anchorDate.getFullYear()
  const month = anchorDate.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  const lastOfMonth = new Date(year, month + 1, 0)

  const gridStart = startOfWeek(firstOfMonth)

  const lastDay = lastOfMonth.getDay()
  const gridEnd = new Date(lastOfMonth)
  if (lastDay !== 0) {
    gridEnd.setDate(lastOfMonth.getDate() + (7 - lastDay))
  }

  const result: CalendarDay[] = []
  const cursor = new Date(gridStart)
  while (cursor <= gridEnd) {
    const dateStr = toYMD(cursor)
    result.push({
      date: dateStr,
      dayOfMonth: cursor.getDate(),
      isToday: dateStr === todayStr,
      isCurrentMonth: cursor.getMonth() === month
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  return result
}

export function getWeekDays(anchorDate: Date, todayStr: string): CalendarDay[] {
  const weekStart = startOfWeek(anchorDate)
  const result: CalendarDay[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    const dateStr = toYMD(d)
    result.push({
      date: dateStr,
      dayOfMonth: d.getDate(),
      isToday: dateStr === todayStr,
      isCurrentMonth: d.getMonth() === anchorDate.getMonth()
    })
  }
  return result
}

export function getCalendarTitle(anchorDate: Date, layout: CalendarLayout): string {
  if (layout === 'month') {
    return `${MONTHS[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`
  }
  const weekStart = startOfWeek(anchorDate)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  if (weekStart.getMonth() === weekEnd.getMonth()) {
    return `${weekStart.getDate()}\u2013${weekEnd.getDate()} ${SHORT_MONTHS[weekStart.getMonth()]} ${weekStart.getFullYear()}`
  }
  return `${weekStart.getDate()} ${SHORT_MONTHS[weekStart.getMonth()]} \u2013 ${weekEnd.getDate()} ${SHORT_MONTHS[weekEnd.getMonth()]} ${weekStart.getFullYear()}`
}

export function useCalendar(layout: CalendarLayout): UseCalendarReturn {
  const [anchorDate, setAnchorDate] = useState(() => new Date())
  const todayStr = useMemo(() => toYMD(new Date()), [])

  const goNext = useCallback(() => {
    setAnchorDate((prev) => {
      const next = new Date(prev)
      if (layout === 'month') {
        next.setMonth(next.getMonth() + 1)
      } else {
        next.setDate(next.getDate() + 7)
      }
      return next
    })
  }, [layout])

  const goPrev = useCallback(() => {
    setAnchorDate((prev) => {
      const next = new Date(prev)
      if (layout === 'month') {
        next.setMonth(next.getMonth() - 1)
      } else {
        next.setDate(next.getDate() - 7)
      }
      return next
    })
  }, [layout])

  const goToday = useCallback(() => {
    setAnchorDate(new Date())
  }, [])

  const days = useMemo(
    () => layout === 'month' ? getMonthDays(anchorDate, todayStr) : getWeekDays(anchorDate, todayStr),
    [anchorDate, layout, todayStr]
  )

  const title = useMemo(() => getCalendarTitle(anchorDate, layout), [anchorDate, layout])

  return { days, title, goNext, goPrev, goToday, anchorDate }
}
