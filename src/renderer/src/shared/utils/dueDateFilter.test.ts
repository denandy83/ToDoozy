import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { matchesDueDateFilter, resolveDueDateRange, formatDueDateRange } from './dueDateFilter'
import type { DueDateRange } from '../stores/labelStore'

describe('matchesDueDateFilter', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns true when no filter is active', () => {
    expect(matchesDueDateFilter('2026-04-03', null, null)).toBe(true)
    expect(matchesDueDateFilter(null, null, null)).toBe(true)
  })

  describe('presets', () => {
    it('today preset matches tasks due today', () => {
      expect(matchesDueDateFilter('2026-04-03', 'today', null)).toBe(true)
      expect(matchesDueDateFilter('2026-04-04', 'today', null)).toBe(false)
      expect(matchesDueDateFilter(null, 'today', null)).toBe(false)
    })

    it('overdue preset matches tasks with past due dates', () => {
      expect(matchesDueDateFilter('2026-04-02', 'overdue', null)).toBe(true)
      expect(matchesDueDateFilter('2026-04-03', 'overdue', null)).toBe(false)
      expect(matchesDueDateFilter('2026-04-04', 'overdue', null)).toBe(false)
      expect(matchesDueDateFilter(null, 'overdue', null)).toBe(false)
    })

    it('no_date preset matches tasks without a due date', () => {
      expect(matchesDueDateFilter(null, 'no_date', null)).toBe(true)
      expect(matchesDueDateFilter('2026-04-03', 'no_date', null)).toBe(false)
    })

    it('this_week preset matches tasks due this week', () => {
      expect(matchesDueDateFilter('2026-04-03', 'this_week', null)).toBe(true)
      expect(matchesDueDateFilter('2026-04-05', 'this_week', null)).toBe(true)
      expect(matchesDueDateFilter('2026-04-01', 'this_week', null)).toBe(false) // past
      expect(matchesDueDateFilter(null, 'this_week', null)).toBe(false)
    })
  })

  describe('relative range', () => {
    it('matches tasks within relative range', () => {
      const range: DueDateRange = { mode: 'relative', fromOffset: -2, toOffset: 2 }
      expect(matchesDueDateFilter('2026-04-01', range.mode === 'relative' ? null : null, range)).toBe(true)
      expect(matchesDueDateFilter('2026-04-05', null, range)).toBe(true)
      expect(matchesDueDateFilter('2026-03-31', null, range)).toBe(false)
      expect(matchesDueDateFilter('2026-04-06', null, range)).toBe(false)
    })

    it('handles open-ended relative range (no toOffset)', () => {
      const range: DueDateRange = { mode: 'relative', fromOffset: -5 }
      expect(matchesDueDateFilter('2026-03-29', null, range)).toBe(true)
      expect(matchesDueDateFilter('2026-04-03', null, range)).toBe(true)
      expect(matchesDueDateFilter('2026-04-10', null, range)).toBe(true)
      expect(matchesDueDateFilter('2026-03-28', null, range)).toBe(false)
    })

    it('rejects null due dates', () => {
      const range: DueDateRange = { mode: 'relative', fromOffset: -5, toOffset: 5 }
      expect(matchesDueDateFilter(null, null, range)).toBe(false)
    })
  })

  describe('absolute range', () => {
    it('matches tasks within absolute range', () => {
      const range: DueDateRange = { mode: 'absolute', fromDate: '2026-04-01', toDate: '2026-04-07' }
      expect(matchesDueDateFilter('2026-04-01', null, range)).toBe(true)
      expect(matchesDueDateFilter('2026-04-05', null, range)).toBe(true)
      expect(matchesDueDateFilter('2026-04-07', null, range)).toBe(true)
      expect(matchesDueDateFilter('2026-03-31', null, range)).toBe(false)
      expect(matchesDueDateFilter('2026-04-08', null, range)).toBe(false)
    })

    it('handles open-ended absolute range (no toDate)', () => {
      const range: DueDateRange = { mode: 'absolute', fromDate: '2026-04-01' }
      expect(matchesDueDateFilter('2026-04-01', null, range)).toBe(true)
      expect(matchesDueDateFilter('2026-12-31', null, range)).toBe(true)
      expect(matchesDueDateFilter('2026-03-31', null, range)).toBe(false)
    })
  })
})

describe('resolveDueDateRange', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves relative range to absolute dates', () => {
    const result = resolveDueDateRange({ mode: 'relative', fromOffset: -5, toOffset: 5 })
    expect(result.from).toBe('2026-03-29')
    expect(result.to).toBe('2026-04-08')
  })

  it('resolves relative range without toOffset', () => {
    const result = resolveDueDateRange({ mode: 'relative', fromOffset: 0 })
    expect(result.from).toBe('2026-04-03')
    expect(result.to).toBeUndefined()
  })

  it('passes through absolute range', () => {
    const result = resolveDueDateRange({ mode: 'absolute', fromDate: '2026-01-01', toDate: '2026-12-31' })
    expect(result.from).toBe('2026-01-01')
    expect(result.to).toBe('2026-12-31')
  })
})

describe('formatDueDateRange', () => {
  it('formats relative range with both offsets', () => {
    expect(formatDueDateRange({ mode: 'relative', fromOffset: -5, toOffset: 5 })).toBe('-5d → +5d')
  })

  it('formats relative range with only from', () => {
    expect(formatDueDateRange({ mode: 'relative', fromOffset: -3 })).toBe('from -3d')
  })

  it('formats today offset as "today"', () => {
    expect(formatDueDateRange({ mode: 'relative', fromOffset: 0, toOffset: 7 })).toBe('today → +7d')
  })

  it('formats single day offsets', () => {
    expect(formatDueDateRange({ mode: 'relative', fromOffset: -1, toOffset: 1 })).toBe('-1d → +1d')
  })

  it('formats absolute range', () => {
    const result = formatDueDateRange({ mode: 'absolute', fromDate: '2026-04-01', toDate: '2026-04-07' })
    expect(result).toMatch(/Apr 1 → Apr 7/)
  })
})
