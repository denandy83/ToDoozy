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

/** @param weekStartsOn 0 = Sunday, 1 = Monday (default) */
export function startOfWeek(d: Date, weekStartsOn = 1): Date {
  const day = d.getDay()
  const diff = (day - weekStartsOn + 7) % 7
  const result = new Date(d)
  result.setDate(d.getDate() - diff)
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

export function getMonthDays(anchorDate: Date, todayStr: string, weekStartsOn = 1): CalendarDay[] {
  const year = anchorDate.getFullYear()
  const month = anchorDate.getMonth()
  const firstOfMonth = new Date(year, month, 1)
  const lastOfMonth = new Date(year, month + 1, 0)

  const gridStart = startOfWeek(firstOfMonth, weekStartsOn)

  const lastDay = lastOfMonth.getDay()
  const weekEndDay = (weekStartsOn + 6) % 7
  const gridEnd = new Date(lastOfMonth)
  if (lastDay !== weekEndDay) {
    const daysToAdd = (weekEndDay - lastDay + 7) % 7
    gridEnd.setDate(lastOfMonth.getDate() + daysToAdd)
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

export function getWeekDays(anchorDate: Date, todayStr: string, weekStartsOn = 1): CalendarDay[] {
  const weekStart = startOfWeek(anchorDate, weekStartsOn)
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

export function getCalendarTitle(anchorDate: Date, layout: CalendarLayout, weekStartsOn = 1): string {
  if (layout === 'month') {
    return `${MONTHS[anchorDate.getMonth()]} ${anchorDate.getFullYear()}`
  }
  const weekStart = startOfWeek(anchorDate, weekStartsOn)
  const weekEnd = new Date(weekStart)
  weekEnd.setDate(weekStart.getDate() + 6)
  if (weekStart.getMonth() === weekEnd.getMonth()) {
    return `${weekStart.getDate()}\u2013${weekEnd.getDate()} ${SHORT_MONTHS[weekStart.getMonth()]} ${weekStart.getFullYear()}`
  }
  return `${weekStart.getDate()} ${SHORT_MONTHS[weekStart.getMonth()]} \u2013 ${weekEnd.getDate()} ${SHORT_MONTHS[weekEnd.getMonth()]} ${weekStart.getFullYear()}`
}

export function useCalendar(layout: CalendarLayout, weekStartsOn = 1): UseCalendarReturn {
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
    () => layout === 'month' ? getMonthDays(anchorDate, todayStr, weekStartsOn) : getWeekDays(anchorDate, todayStr, weekStartsOn),
    [anchorDate, layout, todayStr, weekStartsOn]
  )

  const title = useMemo(() => getCalendarTitle(anchorDate, layout, weekStartsOn), [anchorDate, layout, weekStartsOn])

  return { days, title, goNext, goPrev, goToday, anchorDate }
}
