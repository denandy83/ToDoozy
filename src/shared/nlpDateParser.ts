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
  /\b(every\s+(?:other\s+)?(?:day|week(?:day)?|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+\s+(?:days?|weeks?|months?|years?))(?:\s+on\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s*,\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))*)?)\b/i

/**
 * Parse natural language dates and recurring patterns from text.
 * Returns null if no date found. Recurring patterns checked first.
 */
// Written number → digit mapping (one through twelve)
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
}
const WORD_NUM_PATTERN = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s+(am|pm))?\b/gi

/**
 * Replace written numbers with digits so chrono can parse them.
 * "tomorrow at nine pm" → "tomorrow at 9 pm"
 */
function replaceWordNumbers(text: string): { text: string; replaced: boolean } {
  let replaced = false
  const result = text.replace(WORD_NUM_PATTERN, (match, word, ampm) => {
    const num = WORD_NUMBERS[word.toLowerCase()]
    if (num === undefined) return match
    replaced = true
    return ampm ? `${num} ${ampm}` : `${num}`
  })
  return { text: result, replaced }
}

/**
 * If chrono detected a time without am/pm, and the time has already passed
 * on the same day, shift to PM (add 12 hours). This makes "today at 8"
 * resolve to 8pm when it's currently 3pm.
 */
function forwardTimeIfNeeded(date: Date, ref: Date, chronoResult: chrono.ParsedResult): Date {
  // Only apply if: time is certain, no explicit am/pm, and date is today
  if (!chronoResult.start.isCertain('hour')) return date
  if (chronoResult.start.isCertain('meridiem')) return date // User specified am/pm

  const isSameDay = date.getFullYear() === ref.getFullYear()
    && date.getMonth() === ref.getMonth()
    && date.getDate() === ref.getDate()

  if (isSameDay && date.getTime() < ref.getTime() && date.getHours() < 12) {
    // Time has passed today and it's in AM — shift to PM
    const forwarded = new Date(date)
    forwarded.setHours(forwarded.getHours() + 12)
    return forwarded
  }

  return date
}

export function parseNlpDate(text: string, referenceDate?: Date): NlpDateResult | null {
  const ref = referenceDate ?? new Date()

  // Check for recurring patterns first
  const recurResult = parseRecurring(text, ref)
  if (recurResult) return recurResult

  // Normalize written numbers
  const { text: normalizedText, replaced } = replaceWordNumbers(text)

  // If text has word numbers, try normalized first (captures more)
  // Otherwise just try the original
  if (replaced) {
    const indexMap = buildIndexMap(text, normalizedText)

    // Try recurring on normalized
    const recurNorm = parseRecurring(normalizedText, ref)
    if (recurNorm) {
      const origStart = indexMap[recurNorm.index] ?? recurNorm.index
      const origEnd = indexMap[recurNorm.endIndex] ?? recurNorm.endIndex
      recurNorm.text = text.slice(origStart, origEnd)
      recurNorm.index = origStart
      recurNorm.endIndex = origEnd
      return recurNorm
    }

    // Try chrono on normalized (will catch "tomorrow at 9" from "tomorrow at nine")
    const normResults = chrono.parse(normalizedText, ref, { forwardDate: true })
    if (normResults.length > 0) {
      const r = normResults[0]
      const date = forwardTimeIfNeeded(r.start.date(), ref, r)
      const origStart = indexMap[r.index] ?? r.index
      const origEnd = indexMap[r.index + r.text.length] ?? (r.index + r.text.length)
      return {
        date,
        text: text.slice(origStart, origEnd),
        index: origStart,
        endIndex: origEnd,
        hasTime: r.start.isCertain('hour'),
        recurrenceRule: null
      }
    }
  }

  // Try chrono on original text
  const results = chrono.parse(text, ref, { forwardDate: true })
  if (results.length > 0) {
    const r = results[0]
    const date = forwardTimeIfNeeded(r.start.date(), ref, r)
    return {
      date,
      text: r.text,
      index: r.index,
      endIndex: r.index + r.text.length,
      hasTime: r.start.isCertain('hour'),
      recurrenceRule: null
    }
  }

  return null
}

/**
 * Build a mapping from normalized text indices to original text indices.
 * Handles the case where "nine" (4 chars) becomes "9" (1 char).
 */
function buildIndexMap(original: string, normalized: string): number[] {
  const map: number[] = []
  let oi = 0
  let ni = 0
  while (ni <= normalized.length && oi <= original.length) {
    map[ni] = oi
    if (ni >= normalized.length) break
    // If chars match, advance both
    if (normalized[ni] === original[oi]) {
      ni++
      oi++
    } else {
      // Mismatch: a word number was replaced. Find where they re-sync.
      // Skip the digit(s) in normalized, skip the word in original
      const normWord = normalized.slice(ni).match(/^\d+(?:\s*(?:am|pm)\b)?/i)
      const origWord = original.slice(oi).match(/^(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)(?:\s*(?:am|pm)\b)?/i)
      if (normWord && origWord) {
        // Map all positions in the normalized replacement to the original start
        for (let k = 0; k < normWord[0].length; k++) {
          map[ni + k] = oi
        }
        ni += normWord[0].length
        oi += origWord[0].length
      } else {
        // Fallback: advance both
        ni++
        oi++
      }
    }
  }
  // Ensure the end position is mapped
  map[normalized.length] = original.length
  return map
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
    const next = rr.after(ref, true) ?? ref

    // Check for trailing time component (e.g., "at 9am" after the recurrence pattern)
    const afterRecurrence = text.slice(idx + phrase.length)
    let hasTime = false
    const timeResults = chrono.parse(afterRecurrence, next, { forwardDate: true })
    if (timeResults.length > 0 && timeResults[0].start.isCertain('hour')) {
      const timeDate = timeResults[0].start.date()
      next.setHours(timeDate.getHours(), timeDate.getMinutes(), timeDate.getSeconds())
      hasTime = true
      // Extend the matched text to include the time portion
      const timeEndInOriginal = idx + phrase.length + timeResults[0].index + timeResults[0].text.length
      return {
        date: next,
        text: text.slice(idx, timeEndInOriginal),
        index: idx,
        endIndex: timeEndInOriginal,
        hasTime,
        recurrenceRule: rule
      }
    }

    return {
      date: next,
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
