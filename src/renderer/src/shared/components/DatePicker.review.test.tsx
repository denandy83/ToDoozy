// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DatePicker } from './DatePicker'
import { formatDate, formatTime } from '../utils/dateFormat'
import { isDueDateOverdue } from '../utils/dueDateFilter'
import { getSnoozePresets } from '../utils/snooze'

vi.mock('react-datepicker', () => ({
  registerLocale: vi.fn(),
  default: ({ selected, onChange, showTimeSelectOnly }: { selected: Date | null; onChange(value: Date | null): void; showTimeSelectOnly?: boolean }) => createElement('button', {
    'data-picker': showTimeSelectOnly ? 'time' : 'date',
    onClick: () => {
      const next = new Date(selected!)
      if (showTimeSelectOnly) next.setHours(4, 45)
      else { next.setDate(next.getDate() + 1); next.setHours(0, 0, 0, 0) }
      onChange(next)
    }
  }, selected ? `${selected.getFullYear()}-${String(selected.getMonth() + 1).padStart(2, '0')}-${String(selected.getDate()).padStart(2, '0')} ${String(selected.getHours()).padStart(2, '0')}:${String(selected.getMinutes()).padStart(2, '0')}` : '')
}))
let root: Root
let host: HTMLDivElement
const originalZone = process.env.TZ
beforeEach(() => {
  process.env.TZ = 'Europe/Brussels'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-17T12:00:00+01:00'))
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
  vi.useRealTimers()
  if (originalZone === undefined) delete process.env.TZ
  else process.env.TZ = originalZone
})

it.each([
  { value: '2026-01-16T23:30:00Z', day: '2026-01-17', next: '2026-01-18', time: '00:30' },
  { value: '2026-01-17T00:30', day: '2026-01-17', next: '2026-01-18', time: '00:30' },
  { value: '2026-01-17T00:30:00+05:00', day: '2026-01-16', next: '2026-01-17', time: '20:30' },
  { value: '2026-01-16T23:30:00-05:00', day: '2026-01-17', next: '2026-01-18', time: '05:30' },
  { value: '2026-03-29T00:30:00Z', day: '2026-03-29', next: '2026-03-30', time: '01:30' },
  { value: '2026-10-25T01:30:00Z', day: '2026-10-25', next: '2026-10-26', time: '02:30' }
])('uses the viewer clock for picker selection, edits, day changes and time removal: $value', async ({ value, day, next, time }) => {
  const onChange = vi.fn()
  await act(async () => root.render(createElement(DatePicker, { value, onChange })))
  expect(host.querySelector('[data-picker="date"]')?.textContent).toBe(`${day} ${time}`)
  expect(host.querySelector('[data-picker="time"]')?.textContent).toBe(`${day} ${time}`)
  expect(formatDate(value, 'yyyy/mm/dd')).toBe(day.replaceAll('-', '/'))
  expect(formatTime(value)).toBe(time)
  expect(isDueDateOverdue(value)).toBe(day < '2026-01-17')
  await act(async () => (host.querySelector('[data-picker="date"]') as HTMLButtonElement).click())
  expect(onChange).toHaveBeenLastCalledWith(`${next}T${time}`)
  await act(async () => (host.querySelector('[data-picker="time"]') as HTMLButtonElement).click())
  expect(onChange).toHaveBeenLastCalledWith(`${day}T04:45`)
  await act(async () => (host.querySelector('[aria-label="Remove time"]') as HTMLButtonElement).click())
  expect(onChange).toHaveBeenLastCalledWith(day)
})

it('keeps a civil date civil and emits a civil next-day value', async () => {
  const onChange = vi.fn()
  await act(async () => root.render(createElement(DatePicker, { value: '2026-01-17', onChange })))
  expect(host.querySelector('[data-picker="date"]')?.textContent).toBe('2026-01-17 00:00')
  expect(host.querySelector('[data-picker="time"]')).toBeNull()
  await act(async () => (host.querySelector('[data-picker="date"]') as HTMLButtonElement).click())
  expect(onChange).toHaveBeenLastCalledWith('2026-01-18')
  await act(async () => (host.querySelector('[aria-label="Clear date"]') as HTMLButtonElement).click())
  expect(onChange).toHaveBeenLastCalledWith(null)
})

it.each([[1, '2026-01-17'], [2, '2026-01-19'], [3, '2026-01-23']] as const)('preserves midnight clock semantics through snooze preset %s and actual removal', async (index, day) => {
  vi.setSystemTime(new Date('2026-01-16T12:00:00+01:00'))
  const value = getSnoozePresets('2026-01-16T00:30')[index].getDate()
  expect(formatDate(value, 'yyyy/mm/dd')).toBe(day.replaceAll('-', '/'))
  expect(formatTime(value)).toBe('00:30')
  const onChange = vi.fn()
  await act(async () => root.render(createElement(DatePicker, { value, onChange })))
  await act(async () => (host.querySelector('[aria-label="Remove time"]') as HTMLButtonElement).click())
  expect(onChange).toHaveBeenLastCalledWith(day)
})
