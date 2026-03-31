import type { RecurrenceConfig } from './types'

const WEEK_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
const WEEK_DAY_SET = new Set<string>(WEEK_DAYS)
const ORDINALS = ['1st', '2nd', '3rd', '4th', 'last'] as const
const ORDINAL_SET = new Set<string>(ORDINALS)
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/**
 * Parse a canonical recurrence rule string into a structured object.
 * Returns null if the rule is null/empty or cannot be parsed.
 */
export function parseRecurrence(rule: string | null): RecurrenceConfig | null {
  if (!rule) return null

  // Split off optional |until:YYYY-MM-DD suffix
  let untilDate: string | undefined
  let mainPart = rule
  const untilIdx = rule.indexOf('|until:')
  if (untilIdx !== -1) {
    untilDate = rule.slice(untilIdx + 7)
    mainPart = rule.slice(0, untilIdx)
  }

  const afterCompletion = mainPart.startsWith('every!:')
  const prefix = afterCompletion ? 'every!:' : 'every:'
  if (!mainPart.startsWith(prefix)) return null

  const rest = mainPart.slice(prefix.length)
  const parts = rest.split(':')
  if (parts.length < 2) return null

  const interval = parseInt(parts[0], 10)
  if (isNaN(interval) || interval < 1) return null

  const unit = parts[1] as RecurrenceConfig['unit']
  if (!['days', 'weeks', 'months', 'years'].includes(unit)) return null

  const config: RecurrenceConfig = { interval, unit, afterCompletion }
  if (untilDate) config.untilDate = untilDate

  if (unit === 'weeks' && parts.length >= 3) {
    const days = parts[2].split(',').filter((d) => WEEK_DAY_SET.has(d))
    if (days.length > 0) config.weekDays = days
  }

  if (unit === 'months' && parts.length >= 3) {
    // Check if it's ordinal format: every:1:months:3rd:tue
    if (parts.length >= 4 && ORDINAL_SET.has(parts[2])) {
      const nth = parts[2] as RecurrenceConfig['monthOrdinal'] extends { nth: infer N } ? N : never
      const day = parts[3]
      if (WEEK_DAY_SET.has(day)) {
        config.monthOrdinal = { nth, day }
      }
    } else {
      // Simple day number: every:1:months:15
      const day = parseInt(parts[2], 10)
      if (!isNaN(day) && day >= 1 && day <= 31) config.monthDay = day
    }
  }

  if (unit === 'years' && parts.length >= 4) {
    const month = parseInt(parts[2], 10)
    const day = parseInt(parts[3], 10)
    if (!isNaN(month) && month >= 1 && month <= 12) config.yearMonth = month
    if (!isNaN(day) && day >= 1 && day <= 31) config.yearDay = day
  }

  return config
}

/**
 * Serialize a RecurrenceConfig object to its canonical string representation.
 */
export function serializeRecurrence(config: RecurrenceConfig): string {
  const prefix = config.afterCompletion ? 'every!' : 'every'
  let result = `${prefix}:${config.interval}:${config.unit}`

  if (config.unit === 'weeks' && config.weekDays && config.weekDays.length > 0) {
    result += ':' + config.weekDays.join(',')
  }

  if (config.unit === 'months') {
    if (config.monthOrdinal) {
      result += `:${config.monthOrdinal.nth}:${config.monthOrdinal.day}`
    } else if (config.monthDay !== undefined) {
      result += `:${config.monthDay}`
    }
  }

  if (config.unit === 'years' && config.yearMonth !== undefined && config.yearDay !== undefined) {
    result += `:${config.yearMonth}:${config.yearDay}`
  }

  if (config.untilDate) {
    result += `|until:${config.untilDate}`
  }

  return result
}

/**
 * Generate a human-readable description of a recurrence rule.
 */
export function describeRecurrence(rule: string | null): string {
  const config = parseRecurrence(rule)
  if (!config) return 'No recurrence'

  const { interval, unit, weekDays, monthDay, monthOrdinal, yearMonth, yearDay, afterCompletion, untilDate } = config
  let desc = ''

  if (interval === 1) {
    const unitLabel = unit === 'days' ? 'day' : unit === 'weeks' ? 'week' : unit === 'months' ? 'month' : 'year'
    desc = `Every ${unitLabel}`
  } else {
    desc = `Every ${interval} ${unit}`
  }

  if (unit === 'weeks' && weekDays && weekDays.length > 0) {
    const dayLabels = weekDays.map((d) => DAY_LABELS[WEEK_DAYS.indexOf(d as typeof WEEK_DAYS[number])])
    desc += ` on ${dayLabels.join(', ')}`
  }

  if (unit === 'months') {
    if (monthOrdinal) {
      const dayLabel = DAY_LABELS[WEEK_DAYS.indexOf(monthOrdinal.day as typeof WEEK_DAYS[number])]
      desc += ` on the ${monthOrdinal.nth} ${dayLabel}`
    } else if (monthDay !== undefined) {
      desc += ` on day ${monthDay}`
    }
  }

  if (unit === 'years' && yearMonth !== undefined && yearDay !== undefined) {
    desc += ` on ${MONTH_NAMES[yearMonth - 1]} ${yearDay}`
  }

  if (afterCompletion) {
    desc += ' after completion'
  }

  if (untilDate) {
    desc += ` until ${untilDate}`
  }

  return desc
}

/**
 * Compute the next occurrence date from a given reference date.
 * For Fixed mode: fromDate is the task's current due date.
 * For After-completion mode: fromDate is the completion date (now).
 * Returns null if the end date has passed.
 */
export function getNextOccurrence(rule: string, fromDate: Date): Date | null {
  const config = parseRecurrence(rule)
  if (!config) return null

  const next = new Date(fromDate)

  switch (config.unit) {
    case 'days':
      next.setDate(next.getDate() + config.interval)
      break

    case 'weeks': {
      if (config.weekDays && config.weekDays.length > 0) {
        // Find the next matching weekday at least interval weeks away or later this week
        const targetDays = config.weekDays
          .map((d) => WEEK_DAYS.indexOf(d as typeof WEEK_DAYS[number]))
          .sort((a, b) => a - b)

        const currentDay = fromDate.getDay()
        // Find next day this week (after current day)
        const laterThisWeek = targetDays.find((d) => d > currentDay)
        if (laterThisWeek !== undefined && config.interval === 1) {
          next.setDate(next.getDate() + (laterThisWeek - currentDay))
        } else {
          // Jump to next occurrence: interval weeks ahead, first target day
          const daysUntilNextWeekStart = 7 - currentDay
          next.setDate(next.getDate() + daysUntilNextWeekStart + (config.interval - 1) * 7 + targetDays[0])
        }
      } else {
        next.setDate(next.getDate() + config.interval * 7)
      }
      break
    }

    case 'months': {
      if (config.monthOrdinal) {
        // Move to next applicable month
        next.setMonth(next.getMonth() + config.interval)
        // Find the nth weekday of that month
        const targetDay = WEEK_DAYS.indexOf(config.monthOrdinal.day as typeof WEEK_DAYS[number])
        if (config.monthOrdinal.nth === 'last') {
          // Start from last day of month, go backwards
          const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0)
          const dayDiff = (lastDay.getDay() - targetDay + 7) % 7
          lastDay.setDate(lastDay.getDate() - dayDiff)
          next.setDate(lastDay.getDate())
        } else {
          const nthMap: Record<string, number> = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 }
          const nth = nthMap[config.monthOrdinal.nth] ?? 1
          // First of the month
          next.setDate(1)
          const firstDayOfWeek = next.getDay()
          let offset = (targetDay - firstDayOfWeek + 7) % 7
          offset += (nth - 1) * 7
          next.setDate(1 + offset)
        }
      } else {
        // Set date to 1 first to avoid month overflow (e.g., Jan 31 + 1 month = Mar 3)
        const targetMonth = next.getMonth() + config.interval
        next.setDate(1)
        next.setMonth(targetMonth)
        if (config.monthDay !== undefined) {
          // Clamp to last day of month
          const lastDayOfMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
          next.setDate(Math.min(config.monthDay, lastDayOfMonth))
        }
      }
      break
    }

    case 'years': {
      next.setFullYear(next.getFullYear() + config.interval)
      if (config.yearMonth !== undefined && config.yearDay !== undefined) {
        next.setMonth(config.yearMonth - 1)
        const lastDay = new Date(next.getFullYear(), config.yearMonth, 0).getDate()
        next.setDate(Math.min(config.yearDay, lastDay))
      }
      break
    }
  }

  // Check until date
  if (config.untilDate) {
    const until = new Date(config.untilDate + 'T23:59:59')
    if (next > until) return null
  }

  return next
}

/**
 * Validate whether a string is a valid canonical recurrence rule.
 */
export function isValidRecurrence(rule: string | null): boolean {
  if (rule === null) return true
  return parseRecurrence(rule) !== null
}

/**
 * Get today's weekday as a 3-letter lowercase abbreviation.
 */
export function getTodayWeekDay(): string {
  return WEEK_DAYS[new Date().getDay()]
}

/**
 * Get today's day of month (1-31).
 */
export function getTodayDate(): number {
  return new Date().getDate()
}

/**
 * Get today's month (1-12).
 */
export function getTodayMonth(): number {
  return new Date().getMonth() + 1
}

/**
 * Format a date as a short string for preview (e.g., "Apr 14").
 */
export function formatShortDate(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`
}

export { WEEK_DAYS, MONTH_NAMES, DAY_LABELS, ORDINALS }
