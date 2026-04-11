import * as chrono from 'chrono-node'
import { RRule } from 'rrule'
import { serializeRecurrence } from './recurrenceUtils'
import type { RecurrenceConfig } from './types'

export interface NlpDateResult {
  date: Date
  text: string
  index: number
  endIndex: number
  hasTime: boolean
  recurrenceRule: string | null
}

const RRULE_WEEKDAY_MAP: Record<number, string> = {
  0: 'mon',
  1: 'tue',
  2: 'wed',
  3: 'thu',
  4: 'fri',
  5: 'sat',
  6: 'sun'
}

const RECURRING_PATTERN =
  /\b(every\s+(?:other\s+)?(?:day|week(?:day)?|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+\s+(?:days?|weeks?|months?|years?))(?:\s+(?:on|at)\s+[\w,\s]+)?)\b/i

/**
 * Parse natural language dates and recurring patterns from text.
 * Returns null if no date found. Recurring patterns checked first.
 */
export function parseNlpDate(text: string, referenceDate?: Date): NlpDateResult | null {
  const ref = referenceDate ?? new Date()

  // 1. Check for recurring patterns first
  const recurResult = parseRecurring(text, ref)
  if (recurResult) return recurResult

  // 2. Try chrono-node for one-time dates
  const results = chrono.parse(text, ref, { forwardDate: true })
  if (results.length === 0) return null

  const r = results[0]
  return {
    date: r.start.date(),
    text: r.text,
    index: r.index,
    endIndex: r.index + r.text.length,
    hasTime: r.start.isCertain('hour'),
    recurrenceRule: null
  }
}

function parseRecurring(text: string, ref: Date): NlpDateResult | null {
  const match = text.match(RECURRING_PATTERN)
  if (!match) return null

  const phrase = match[0]
  const idx = match.index!

  try {
    const rruleOpts = RRule.parseText(phrase)
    if (!rruleOpts) return null

    // Normalize byweekday to Array<{weekday: number}> for our canonical converter
    const byweekday = Array.isArray(rruleOpts.byweekday)
      ? rruleOpts.byweekday.map((d) => typeof d === 'number' ? { weekday: d } : d as { weekday: number })
      : rruleOpts.byweekday && typeof rruleOpts.byweekday === 'object' && 'weekday' in rruleOpts.byweekday
        ? [rruleOpts.byweekday as { weekday: number }]
        : null
    const config = rruleOptsToCanonical({ freq: rruleOpts.freq, interval: rruleOpts.interval, byweekday })
    if (!config) return null

    const rule = serializeRecurrence(config)

    // Get next occurrence as initial due date
    const rr = new RRule({ ...rruleOpts, dtstart: ref })
    const next = rr.after(ref, true)

    return {
      date: next ?? ref,
      text: phrase,
      index: idx,
      endIndex: idx + phrase.length,
      hasTime: false,
      recurrenceRule: rule
    }
  } catch {
    return null
  }
}

/**
 * Convert rrule.js parsed options to our canonical RecurrenceConfig.
 * Exported for use in Telegram bot and MCP handler.
 */
export function rruleOptsToCanonical(
  opts: Partial<{ freq: number; interval: number; byweekday: Array<{ weekday: number }> | null }>
): RecurrenceConfig | null {
  if (!opts || opts.freq === undefined) return null

  const freq = opts.freq
  const interval = opts.interval ?? 1

  if (freq === RRule.DAILY) {
    return { interval, unit: 'days', afterCompletion: false }
  }
  if (freq === RRule.WEEKLY) {
    const bywd = Array.isArray(opts.byweekday) ? opts.byweekday : null
    const days = bywd?.map((d) => RRULE_WEEKDAY_MAP[d.weekday]).filter(Boolean)
    const config: RecurrenceConfig = { interval, unit: 'weeks', afterCompletion: false }
    if (days && days.length > 0) config.weekDays = days
    return config
  }
  if (freq === RRule.MONTHLY) {
    return { interval, unit: 'months', afterCompletion: false }
  }
  if (freq === RRule.YEARLY) {
    return { interval, unit: 'years', afterCompletion: false }
  }
  return null
}

/**
 * Strip the detected date text from the task title, cleaning up whitespace.
 */
export function stripDateFromTitle(title: string, result: NlpDateResult): string {
  const before = title.slice(0, result.index)
  const after = title.slice(result.endIndex)
  return (before + ' ' + after).replace(/\s+/g, ' ').trim()
}

/**
 * Format a date as ISO date string (YYYY-MM-DD) or full ISO string if time is present.
 */
export function formatNlpDate(result: NlpDateResult): string {
  if (result.hasTime) {
    return result.date.toISOString()
  }
  const y = result.date.getFullYear()
  const m = String(result.date.getMonth() + 1).padStart(2, '0')
  const d = String(result.date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
