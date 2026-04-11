import { describe, it, expect } from 'vitest'
import { parseNlpDate, stripDateFromTitle, formatNlpDate, rruleOptsToCanonical } from './nlpDateParser'

describe('parseNlpDate', () => {
  const ref = new Date('2026-04-11T12:00:00')

  it('parses "tomorrow at 2pm"', () => {
    const result = parseNlpDate('buy groceries tomorrow at 2pm', ref)
    expect(result).not.toBeNull()
    expect(result!.text).toBe('tomorrow at 2pm')
    expect(result!.hasTime).toBe(true)
    expect(result!.date.getDate()).toBe(12) // April 12
    expect(result!.date.getHours()).toBe(14)
    expect(result!.recurrenceRule).toBeNull()
  })

  it('parses "next friday"', () => {
    const result = parseNlpDate('meeting next friday', ref)
    expect(result).not.toBeNull()
    expect(result!.text).toBe('next friday')
    expect(result!.hasTime).toBe(false)
    expect(result!.recurrenceRule).toBeNull()
    // April 11 2026 is Saturday, so next Friday = April 17
    expect(result!.date.getDate()).toBe(17)
  })

  it('parses "every monday" as recurring', () => {
    const result = parseNlpDate('standup every monday', ref)
    expect(result).not.toBeNull()
    expect(result!.text).toBe('every monday')
    expect(result!.recurrenceRule).toBe('every:1:weeks:mon')
  })

  it('parses "every 2 weeks" as recurring', () => {
    const result = parseNlpDate('review every 2 weeks', ref)
    expect(result).not.toBeNull()
    expect(result!.recurrenceRule).toBe('every:2:weeks')
  })

  it('parses "every day" as recurring', () => {
    const result = parseNlpDate('exercise every day', ref)
    expect(result).not.toBeNull()
    expect(result!.recurrenceRule).toBe('every:1:days')
  })

  it('parses "every weekday" as recurring with mon-fri', () => {
    const result = parseNlpDate('standup every weekday', ref)
    expect(result).not.toBeNull()
    expect(result!.recurrenceRule).toBe('every:1:weeks:mon,tue,wed,thu,fri')
  })

  it('returns null for plain text', () => {
    const result = parseNlpDate('buy groceries', ref)
    expect(result).toBeNull()
  })

  it('does not produce false positive for "Call May"', () => {
    const result = parseNlpDate('Call May', ref)
    // chrono-node should not match this, or if it does the 80% filter would catch it
    expect(result).toBeNull()
  })

  it('returns index and endIndex for stripping', () => {
    const result = parseNlpDate('buy groceries tomorrow at 2pm', ref)
    expect(result).not.toBeNull()
    expect(result!.index).toBe(14)
    expect(result!.endIndex).toBe(29)
  })
})

describe('stripDateFromTitle', () => {
  it('strips date text from middle of title', () => {
    const result = parseNlpDate('buy groceries tomorrow at 2pm', new Date('2026-04-11T12:00:00'))
    expect(result).not.toBeNull()
    const stripped = stripDateFromTitle('buy groceries tomorrow at 2pm', result!)
    expect(stripped).toBe('buy groceries')
  })

  it('strips date text from end of title', () => {
    const result = parseNlpDate('meeting tomorrow', new Date('2026-04-11T12:00:00'))
    expect(result).not.toBeNull()
    const stripped = stripDateFromTitle('meeting tomorrow', result!)
    expect(stripped).toBe('meeting')
  })

  it('strips recurring pattern from title', () => {
    const result = parseNlpDate('standup every monday', new Date('2026-04-11T12:00:00'))
    expect(result).not.toBeNull()
    const stripped = stripDateFromTitle('standup every monday', result!)
    expect(stripped).toBe('standup')
  })
})

describe('formatNlpDate', () => {
  it('formats date-only as YYYY-MM-DD', () => {
    const result = parseNlpDate('meeting tomorrow', new Date('2026-04-11T12:00:00'))
    expect(result).not.toBeNull()
    const formatted = formatNlpDate(result!)
    expect(formatted).toBe('2026-04-12')
  })

  it('formats date with time as full ISO string', () => {
    const result = parseNlpDate('meeting tomorrow at 2pm', new Date('2026-04-11T12:00:00'))
    expect(result).not.toBeNull()
    const formatted = formatNlpDate(result!)
    expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })
})

describe('rruleOptsToCanonical', () => {
  it('converts daily frequency', () => {
    const config = rruleOptsToCanonical({ freq: 3, interval: 1, byweekday: null })
    expect(config).toEqual({ interval: 1, unit: 'days', afterCompletion: false })
  })

  it('converts weekly with specific days', () => {
    const config = rruleOptsToCanonical({
      freq: 2,
      interval: 1,
      byweekday: [{ weekday: 0 }, { weekday: 2 }, { weekday: 4 }]
    })
    expect(config).toEqual({
      interval: 1,
      unit: 'weeks',
      afterCompletion: false,
      weekDays: ['mon', 'wed', 'fri']
    })
  })

  it('converts monthly frequency', () => {
    const config = rruleOptsToCanonical({ freq: 1, interval: 2, byweekday: null })
    expect(config).toEqual({ interval: 2, unit: 'months', afterCompletion: false })
  })

  it('converts yearly frequency', () => {
    const config = rruleOptsToCanonical({ freq: 0, interval: 1, byweekday: null })
    expect(config).toEqual({ interval: 1, unit: 'years', afterCompletion: false })
  })

  it('returns null for undefined freq', () => {
    expect(rruleOptsToCanonical({ byweekday: null })).toBeNull()
  })
})
