import { describe, it, expect } from 'vitest'
import { toYMD, startOfWeek, getMonthDays, getWeekDays, getCalendarTitle } from './useCalendar'

describe('toYMD', () => {
  it('formats a date as YYYY-MM-DD', () => {
    expect(toYMD(new Date(2026, 2, 15))).toBe('2026-03-15')
  })

  it('zero-pads single-digit months and days', () => {
    expect(toYMD(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('handles December correctly', () => {
    expect(toYMD(new Date(2026, 11, 31))).toBe('2026-12-31')
  })
})

describe('startOfWeek', () => {
  it('returns Monday for a Wednesday', () => {
    // March 18, 2026 is a Wednesday
    const wed = new Date(2026, 2, 18)
    const mon = startOfWeek(wed)
    expect(toYMD(mon)).toBe('2026-03-16')
  })

  it('returns same day for a Monday', () => {
    // March 16, 2026 is a Monday
    const mon = new Date(2026, 2, 16)
    expect(toYMD(startOfWeek(mon))).toBe('2026-03-16')
  })

  it('returns previous Monday for a Sunday', () => {
    // March 15, 2026 is a Sunday
    const sun = new Date(2026, 2, 15)
    expect(toYMD(startOfWeek(sun))).toBe('2026-03-09')
  })

  it('returns Sunday for a Wednesday when weekStartsOn=0', () => {
    // March 18, 2026 is a Wednesday
    const wed = new Date(2026, 2, 18)
    expect(toYMD(startOfWeek(wed, 0))).toBe('2026-03-15')
  })

  it('returns same day for a Sunday when weekStartsOn=0', () => {
    // March 15, 2026 is a Sunday
    const sun = new Date(2026, 2, 15)
    expect(toYMD(startOfWeek(sun, 0))).toBe('2026-03-15')
  })
})

describe('getMonthDays', () => {
  const todayStr = '2026-03-15'

  it('returns days divisible by 7', () => {
    const days = getMonthDays(new Date(2026, 2, 15), todayStr)
    expect(days.length % 7).toBe(0)
  })

  it('includes all days of the month', () => {
    const days = getMonthDays(new Date(2026, 2, 15), todayStr)
    const marchDays = days.filter((d) => d.isCurrentMonth)
    expect(marchDays).toHaveLength(31) // March has 31 days
  })

  it('marks today correctly', () => {
    const days = getMonthDays(new Date(2026, 2, 15), todayStr)
    const todayDay = days.find((d) => d.isToday)
    expect(todayDay).toBeDefined()
    expect(todayDay!.date).toBe('2026-03-15')
    expect(todayDay!.dayOfMonth).toBe(15)
  })

  it('includes padding days from adjacent months', () => {
    const days = getMonthDays(new Date(2026, 2, 15), todayStr)
    const nonCurrentMonth = days.filter((d) => !d.isCurrentMonth)
    expect(nonCurrentMonth.length).toBeGreaterThan(0)
  })

  it('first day is always a Monday', () => {
    for (let m = 0; m < 12; m++) {
      const days = getMonthDays(new Date(2026, m, 1), todayStr)
      const firstDate = new Date(days[0].date + 'T00:00:00')
      expect(firstDate.getDay()).toBe(1) // Monday
    }
  })

  it('first day is always a Sunday when weekStartsOn=0', () => {
    for (let m = 0; m < 12; m++) {
      const days = getMonthDays(new Date(2026, m, 1), todayStr, 0)
      const firstDate = new Date(days[0].date + 'T00:00:00')
      expect(firstDate.getDay()).toBe(0) // Sunday
    }
  })

  it('handles February in a non-leap year', () => {
    const days = getMonthDays(new Date(2026, 1, 1), todayStr)
    const febDays = days.filter((d) => d.isCurrentMonth)
    expect(febDays).toHaveLength(28)
  })

  it('handles February in a leap year', () => {
    const days = getMonthDays(new Date(2028, 1, 1), todayStr)
    const febDays = days.filter((d) => d.isCurrentMonth)
    expect(febDays).toHaveLength(29)
  })
})

describe('getWeekDays', () => {
  const todayStr = '2026-03-15'

  it('returns exactly 7 days', () => {
    const days = getWeekDays(new Date(2026, 2, 15), todayStr)
    expect(days).toHaveLength(7)
  })

  it('starts on Monday', () => {
    // March 15, 2026 is Sunday; week starts March 9 (Monday)
    const days = getWeekDays(new Date(2026, 2, 15), todayStr)
    expect(days[0].date).toBe('2026-03-09')
  })

  it('ends on Sunday', () => {
    const days = getWeekDays(new Date(2026, 2, 15), todayStr)
    expect(days[6].date).toBe('2026-03-15')
  })

  it('starts on Sunday when weekStartsOn=0', () => {
    // March 18, 2026 is Wednesday; week starts March 15 (Sunday)
    const days = getWeekDays(new Date(2026, 2, 18), todayStr, 0)
    expect(days[0].date).toBe('2026-03-15')
    expect(days[6].date).toBe('2026-03-21')
  })

  it('marks today correctly', () => {
    const days = getWeekDays(new Date(2026, 2, 15), todayStr)
    const todayDay = days.find((d) => d.isToday)
    expect(todayDay).toBeDefined()
    expect(todayDay!.date).toBe('2026-03-15')
  })

  it('days are consecutive', () => {
    const days = getWeekDays(new Date(2026, 2, 18), todayStr)
    for (let i = 1; i < days.length; i++) {
      const prev = new Date(days[i - 1].date + 'T00:00:00')
      const curr = new Date(days[i].date + 'T00:00:00')
      const diff = curr.getTime() - prev.getTime()
      expect(diff).toBe(24 * 60 * 60 * 1000)
    }
  })

  it('handles week spanning two months', () => {
    // March 30 is a Monday, so week is March 30 – April 5
    const days = getWeekDays(new Date(2026, 2, 31), todayStr)
    const marchDays = days.filter((d) => d.isCurrentMonth)
    const nonMarchDays = days.filter((d) => !d.isCurrentMonth)
    expect(marchDays.length).toBeGreaterThan(0)
    expect(nonMarchDays.length).toBeGreaterThan(0)
  })
})

describe('getCalendarTitle', () => {
  it('returns month and year for month layout', () => {
    expect(getCalendarTitle(new Date(2026, 2, 15), 'month')).toBe('March 2026')
  })

  it('returns date range for week layout (same month)', () => {
    // March 18, 2026 is Wednesday. Week: March 16–22
    const title = getCalendarTitle(new Date(2026, 2, 18), 'week')
    expect(title).toContain('16')
    expect(title).toContain('22')
    expect(title).toContain('Mar')
  })

  it('returns date range for week layout (cross-month)', () => {
    // March 30, 2026 is Monday. Week: March 30 – April 5
    const title = getCalendarTitle(new Date(2026, 2, 31), 'week')
    expect(title).toContain('Mar')
    expect(title).toContain('Apr')
  })

  it('returns January 2026 for Jan anchor', () => {
    expect(getCalendarTitle(new Date(2026, 0, 1), 'month')).toBe('January 2026')
  })

  it('returns December 2026 for Dec anchor', () => {
    expect(getCalendarTitle(new Date(2026, 11, 1), 'month')).toBe('December 2026')
  })
})
