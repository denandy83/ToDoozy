import { describe, it, expect } from 'vitest'
import {
  parseRecurrence,
  serializeRecurrence,
  describeRecurrence,
  getNextOccurrence,
  isValidRecurrence
} from './recurrenceUtils'
import type { RecurrenceConfig } from './types'

describe('parseRecurrence', () => {
  it('returns null for null input', () => {
    expect(parseRecurrence(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(parseRecurrence('')).toBeNull()
  })

  it('returns null for invalid format', () => {
    expect(parseRecurrence('daily')).toBeNull()
    expect(parseRecurrence('weekly')).toBeNull()
    expect(parseRecurrence('every:3 days')).toBeNull()
  })

  it('parses simple days', () => {
    const result = parseRecurrence('every:3:days')
    expect(result).toEqual({
      interval: 3,
      unit: 'days',
      afterCompletion: false
    })
  })

  it('parses weeks with days', () => {
    const result = parseRecurrence('every:2:weeks:mon,wed,fri')
    expect(result).toEqual({
      interval: 2,
      unit: 'weeks',
      weekDays: ['mon', 'wed', 'fri'],
      afterCompletion: false
    })
  })

  it('parses months with day number', () => {
    const result = parseRecurrence('every:1:months:15')
    expect(result).toEqual({
      interval: 1,
      unit: 'months',
      monthDay: 15,
      afterCompletion: false
    })
  })

  it('parses months with ordinal weekday', () => {
    const result = parseRecurrence('every:1:months:3rd:tue')
    expect(result).toEqual({
      interval: 1,
      unit: 'months',
      monthOrdinal: { nth: '3rd', day: 'tue' },
      afterCompletion: false
    })
  })

  it('parses months with last weekday', () => {
    const result = parseRecurrence('every:1:months:last:fri')
    expect(result).toEqual({
      interval: 1,
      unit: 'months',
      monthOrdinal: { nth: 'last', day: 'fri' },
      afterCompletion: false
    })
  })

  it('parses years', () => {
    const result = parseRecurrence('every:1:years:3:30')
    expect(result).toEqual({
      interval: 1,
      unit: 'years',
      yearMonth: 3,
      yearDay: 30,
      afterCompletion: false
    })
  })

  it('parses after-completion mode', () => {
    const result = parseRecurrence('every!:3:days')
    expect(result).toEqual({
      interval: 3,
      unit: 'days',
      afterCompletion: true
    })
  })

  it('parses with until date', () => {
    const result = parseRecurrence('every:2:weeks:mon,wed|until:2026-06-01')
    expect(result).toEqual({
      interval: 2,
      unit: 'weeks',
      weekDays: ['mon', 'wed'],
      afterCompletion: false,
      untilDate: '2026-06-01'
    })
  })

  it('parses after-completion with until date', () => {
    const result = parseRecurrence('every!:1:months:15|until:2026-12-31')
    expect(result).toEqual({
      interval: 1,
      unit: 'months',
      monthDay: 15,
      afterCompletion: true,
      untilDate: '2026-12-31'
    })
  })

  it('rejects interval of 0', () => {
    expect(parseRecurrence('every:0:days')).toBeNull()
  })

  it('rejects negative interval', () => {
    expect(parseRecurrence('every:-1:days')).toBeNull()
  })

  it('rejects invalid unit', () => {
    expect(parseRecurrence('every:1:hours')).toBeNull()
  })
})

describe('serializeRecurrence', () => {
  it('serializes simple days', () => {
    const config: RecurrenceConfig = { interval: 3, unit: 'days', afterCompletion: false }
    expect(serializeRecurrence(config)).toBe('every:3:days')
  })

  it('serializes weeks with days', () => {
    const config: RecurrenceConfig = { interval: 2, unit: 'weeks', weekDays: ['mon', 'wed'], afterCompletion: false }
    expect(serializeRecurrence(config)).toBe('every:2:weeks:mon,wed')
  })

  it('serializes months with day number', () => {
    const config: RecurrenceConfig = { interval: 1, unit: 'months', monthDay: 15, afterCompletion: false }
    expect(serializeRecurrence(config)).toBe('every:1:months:15')
  })

  it('serializes months with ordinal', () => {
    const config: RecurrenceConfig = { interval: 1, unit: 'months', monthOrdinal: { nth: '3rd', day: 'tue' }, afterCompletion: false }
    expect(serializeRecurrence(config)).toBe('every:1:months:3rd:tue')
  })

  it('serializes years', () => {
    const config: RecurrenceConfig = { interval: 1, unit: 'years', yearMonth: 12, yearDay: 25, afterCompletion: false }
    expect(serializeRecurrence(config)).toBe('every:1:years:12:25')
  })

  it('serializes after-completion mode', () => {
    const config: RecurrenceConfig = { interval: 5, unit: 'days', afterCompletion: true }
    expect(serializeRecurrence(config)).toBe('every!:5:days')
  })

  it('serializes with until date', () => {
    const config: RecurrenceConfig = { interval: 1, unit: 'weeks', weekDays: ['mon'], afterCompletion: false, untilDate: '2026-06-01' }
    expect(serializeRecurrence(config)).toBe('every:1:weeks:mon|until:2026-06-01')
  })

  it('roundtrips through parse', () => {
    const rules = [
      'every:3:days',
      'every:2:weeks:mon,wed,fri',
      'every:1:months:15',
      'every:1:months:3rd:tue',
      'every:1:years:3:30',
      'every!:3:days',
      'every:2:weeks:mon,wed|until:2026-06-01'
    ]
    for (const rule of rules) {
      const parsed = parseRecurrence(rule)
      expect(parsed).not.toBeNull()
      expect(serializeRecurrence(parsed!)).toBe(rule)
    }
  })
})

describe('describeRecurrence', () => {
  it('returns "No recurrence" for null', () => {
    expect(describeRecurrence(null)).toBe('No recurrence')
  })

  it('describes daily', () => {
    expect(describeRecurrence('every:1:days')).toBe('Every day')
  })

  it('describes every N days', () => {
    expect(describeRecurrence('every:3:days')).toBe('Every 3 days')
  })

  it('describes weekly with days', () => {
    expect(describeRecurrence('every:1:weeks:mon,wed')).toBe('Every week on Mon, Wed')
  })

  it('describes every N weeks', () => {
    expect(describeRecurrence('every:2:weeks:fri')).toBe('Every 2 weeks on Fri')
  })

  it('describes monthly on day', () => {
    expect(describeRecurrence('every:1:months:15')).toBe('Every month on day 15')
  })

  it('describes monthly on ordinal', () => {
    expect(describeRecurrence('every:1:months:3rd:tue')).toBe('Every month on the 3rd Tue')
  })

  it('describes yearly', () => {
    expect(describeRecurrence('every:1:years:12:25')).toBe('Every year on Dec 25')
  })

  it('includes after completion', () => {
    expect(describeRecurrence('every!:3:days')).toBe('Every 3 days after completion')
  })

  it('includes until date', () => {
    expect(describeRecurrence('every:1:days|until:2026-06-01')).toBe('Every day until 2026-06-01')
  })
})

describe('getNextOccurrence', () => {
  it('adds days', () => {
    const from = new Date('2026-03-15')
    const next = getNextOccurrence('every:3:days', from)
    expect(next).not.toBeNull()
    expect(next!.getFullYear()).toBe(2026)
    expect(next!.getMonth()).toBe(2) // March
    expect(next!.getDate()).toBe(18)
  })

  it('adds weeks', () => {
    const from = new Date('2026-03-15') // Sunday
    const next = getNextOccurrence('every:2:weeks:mon', from)
    expect(next).not.toBeNull()
    // Should be 2 weeks ahead starting from Monday
    expect(next!.getDate()).toBeGreaterThan(15)
  })

  it('adds months with day', () => {
    const from = new Date('2026-03-15')
    const next = getNextOccurrence('every:1:months:20', from)
    expect(next).not.toBeNull()
    expect(next!.getMonth()).toBe(3) // April
    expect(next!.getDate()).toBe(20)
  })

  it('clamps month day to last day', () => {
    const from = new Date('2026-01-31')
    const next = getNextOccurrence('every:1:months:31', from)
    expect(next).not.toBeNull()
    // Feb 2026 has 28 days
    expect(next!.getMonth()).toBe(1) // February
    expect(next!.getDate()).toBe(28)
  })

  it('adds years', () => {
    const from = new Date('2026-03-15')
    const next = getNextOccurrence('every:1:years:3:15', from)
    expect(next).not.toBeNull()
    expect(next!.getFullYear()).toBe(2027)
    expect(next!.getMonth()).toBe(2) // March
    expect(next!.getDate()).toBe(15)
  })

  it('returns null when past until date', () => {
    const from = new Date('2026-05-30')
    const next = getNextOccurrence('every:1:days|until:2026-05-30', from)
    // Next would be May 31, which is past May 30
    expect(next).toBeNull()
  })

  it('returns date when within until date', () => {
    const from = new Date('2026-05-28')
    const next = getNextOccurrence('every:1:days|until:2026-05-30', from)
    expect(next).not.toBeNull()
    expect(next!.getDate()).toBe(29)
  })

  it('returns null for invalid rule', () => {
    expect(getNextOccurrence('invalid', new Date())).toBeNull()
  })

  it('handles monthly ordinal - 1st Monday', () => {
    const from = new Date('2026-03-01')
    const next = getNextOccurrence('every:1:months:1st:mon', from)
    expect(next).not.toBeNull()
    // April 2026: first Monday is April 6
    expect(next!.getMonth()).toBe(3) // April
    expect(next!.getDay()).toBe(1) // Monday
  })

  it('handles monthly ordinal - last Friday', () => {
    const from = new Date('2026-03-01')
    const next = getNextOccurrence('every:1:months:last:fri', from)
    expect(next).not.toBeNull()
    expect(next!.getMonth()).toBe(3) // April
    expect(next!.getDay()).toBe(5) // Friday
  })
})

describe('isValidRecurrence', () => {
  it('accepts null', () => {
    expect(isValidRecurrence(null)).toBe(true)
  })

  it('accepts valid rules', () => {
    expect(isValidRecurrence('every:1:days')).toBe(true)
    expect(isValidRecurrence('every:2:weeks:mon,wed')).toBe(true)
    expect(isValidRecurrence('every:1:months:15')).toBe(true)
    expect(isValidRecurrence('every!:3:days')).toBe(true)
  })

  it('rejects invalid rules', () => {
    expect(isValidRecurrence('daily')).toBe(false)
    expect(isValidRecurrence('every:0:days')).toBe(false)
    expect(isValidRecurrence('every:1:hours')).toBe(false)
  })
})
