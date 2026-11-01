import { describe, it, expect, vi, afterEach } from 'vitest'
import { addDaysPreservingTime, getLaterToday, getSnoozePresets } from './snooze'

const originalTimezone = process.env.TZ
describe('addDaysPreservingTime', () => {
  afterEach(() => {
    vi.useRealTimers()
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  })

  it('adds days to today and returns date-only when no base due date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T10:00:00.000Z'))

    const result = addDaysPreservingTime(null, 1)
    expect(result).toBe('2026-03-16')
  })

  it('adds days to today and returns date-only for undefined base', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T10:00:00.000Z'))

    const result = addDaysPreservingTime(undefined, 3)
    expect(result).toBe('2026-03-18')
  })

  it('adds days to today and returns date-only for date-only base', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T10:00:00.000Z'))

    const result = addDaysPreservingTime('2026-03-10', 7)
    expect(result).toBe('2026-03-22')
  })

  it('preserves time portion from base due date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T10:00:00.000Z'))

    const result = addDaysPreservingTime('2026-03-10T14:30:00.000Z', 1)
    expect(result).toBe('2026-03-16T14:30:00.000Z')
  })

  it.each([
    {zone:'UTC',now:'2026-01-01T00:00:00.000Z',base:'2026-01-01T23:59:59.999Z',days:7,expected:'2026-01-08T23:59:59.999Z',target:[2026,0,8],clock:[23,59,59,999]},
    {zone:'Europe/Brussels',now:'2026-01-01T00:00:00.000Z',base:'2026-01-01T23:59:59.999Z',days:7,expected:'2026-01-07T23:59:59.999Z',target:[2026,0,8],clock:[0,59,59,999]},
    {zone:'Europe/Brussels',now:'2026-03-28T12:00:00.000Z',base:'2026-03-28T08:00:00.000Z',days:1,expected:'2026-03-29T07:00:00.000Z',target:[2026,2,29],clock:[9,0,0,0]},
    {zone:'Europe/Brussels',now:'2026-10-24T12:00:00.000Z',base:'2026-10-24T07:00:00.000Z',days:1,expected:'2026-10-25T08:00:00.000Z',target:[2026,9,25],clock:[9,0,0,0]}
  ])('preserves local clock on the requested local day in $zone from $now', ({zone,now,base,days,expected,target,clock}) => {
    process.env.TZ = zone
    vi.useFakeTimers()
    vi.setSystemTime(new Date(now))

    const result = addDaysPreservingTime(base, days)
    expect(result).toBe(expected)
    const local = new Date(result)
    expect([local.getFullYear(),local.getMonth(),local.getDate()]).toEqual(target)
    expect([local.getHours(),local.getMinutes(),local.getSeconds(),local.getMilliseconds()]).toEqual(clock)
  })

  it('handles zero days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))

    const result = addDaysPreservingTime(null, 0)
    expect(result).toBe('2026-06-15')
  })
})

describe('getLaterToday', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns ISO string 3 hours from now', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T10:00:00.000Z'))

    const result = getLaterToday()
    expect(result).toBe(new Date('2026-03-15T13:00:00.000Z').toISOString())
  })
})

describe('getSnoozePresets', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns four presets with correct labels', () => {
    const presets = getSnoozePresets(null)
    expect(presets).toHaveLength(4)
    expect(presets.map((p) => p.label)).toEqual([
      'Later Today',
      'Tomorrow',
      'In 3 Days',
      'Next Week'
    ])
  })

  it('Tomorrow preset adds 1 day', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T10:00:00.000Z'))

    const presets = getSnoozePresets(null)
    const tomorrow = presets.find((p) => p.label === 'Tomorrow')!
    expect(tomorrow.getDate()).toBe('2026-03-16')
  })

  it('In 3 Days preset adds 3 days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T10:00:00.000Z'))

    const presets = getSnoozePresets(null)
    const in3Days = presets.find((p) => p.label === 'In 3 Days')!
    expect(in3Days.getDate()).toBe('2026-03-18')
  })

  it('Next Week preset adds 7 days', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T10:00:00.000Z'))

    const presets = getSnoozePresets(null)
    const nextWeek = presets.find((p) => p.label === 'Next Week')!
    expect(nextWeek.getDate()).toBe('2026-03-22')
  })

  it('preserves time from current due date in presets', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-15T10:00:00.000Z'))

    const presets = getSnoozePresets('2026-03-15T09:30:00.000Z')
    const tomorrow = presets.find((p) => p.label === 'Tomorrow')!
    expect(tomorrow.getDate()).toBe('2026-03-16T09:30:00.000Z')
  })
})
