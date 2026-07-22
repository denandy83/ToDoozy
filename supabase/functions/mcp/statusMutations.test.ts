import { describe, it, expect } from 'vitest'
import {
  DEFAULT_STATUS_COLOR,
  DEFAULT_STATUS_ICON,
  toFlag,
  computeNextOrderIndex,
  buildStatusRecord
} from './statusMutations'

describe('toFlag', () => {
  it('maps truthy boolean/number to 1', () => {
    expect(toFlag(true)).toBe(1)
    expect(toFlag(1)).toBe(1)
  })
  it('maps false/0/null/undefined to 0 (default deny)', () => {
    expect(toFlag(false)).toBe(0)
    expect(toFlag(0)).toBe(0)
    expect(toFlag(null)).toBe(0)
    expect(toFlag(undefined)).toBe(0)
  })
})

describe('computeNextOrderIndex', () => {
  it('returns 0 for an empty project (no statuses yet)', () => {
    expect(computeNextOrderIndex([])).toBe(0)
  })
  it('returns max + 1 so the new status sorts last', () => {
    expect(computeNextOrderIndex([{ order_index: 0 }, { order_index: 1 }, { order_index: 2 }])).toBe(3)
  })
  it('uses the true maximum regardless of array order', () => {
    expect(computeNextOrderIndex([{ order_index: 5 }, { order_index: 2 }, { order_index: 9 }])).toBe(10)
  })
  it('ignores non-numeric/nullish order_index values', () => {
    expect(computeNextOrderIndex([{ order_index: null }, { order_index: 3 }, {}])).toBe(4)
  })
  it('falls back to 0 when no row carries a numeric order_index', () => {
    expect(computeNextOrderIndex([{ order_index: null }, {}])).toBe(0)
  })
  it('handles a single status at index 0', () => {
    expect(computeNextOrderIndex([{ order_index: 0 }])).toBe(1)
  })
})

describe('buildStatusRecord', () => {
  const now = '2026-07-22T10:00:00.000Z'

  it('applies all defaults when only id/project_id/name are supplied', () => {
    const record = buildStatusRecord({ id: 'st-1', project_id: 'p-1', name: 'Testing' }, now)
    expect(record).toEqual({
      id: 'st-1',
      project_id: 'p-1',
      name: 'Testing',
      color: DEFAULT_STATUS_COLOR,
      icon: DEFAULT_STATUS_ICON,
      order_index: 0,
      is_done: 0,
      is_default: 0,
      created_at: now,
      updated_at: now
    })
  })

  it('defaults color to #888888 and icon to circle', () => {
    const record = buildStatusRecord({ id: 'st-2', project_id: 'p-1', name: 'X' }, now)
    expect(record.color).toBe('#888888')
    expect(record.icon).toBe('circle')
  })

  it('honors explicit color, icon, order_index and is_done', () => {
    const record = buildStatusRecord(
      { id: 'st-3', project_id: 'p-1', name: 'Done', color: '#22c55e', icon: 'check', order_index: 7, is_done: true },
      now
    )
    expect(record.color).toBe('#22c55e')
    expect(record.icon).toBe('check')
    expect(record.order_index).toBe(7)
    expect(record.is_done).toBe(1)
    expect(record.is_default).toBe(0)
  })

  it('coerces numeric is_done/is_default flags (create_project reuse path)', () => {
    const record = buildStatusRecord(
      { id: 'st-4', project_id: 'p-1', name: 'Not Started', order_index: 0, is_default: 1 },
      now
    )
    expect(record.is_default).toBe(1)
    expect(record.is_done).toBe(0)
  })

  it('sets created_at and updated_at to the injected now', () => {
    const record = buildStatusRecord({ id: 'st-5', project_id: 'p-1', name: 'X' }, now)
    expect(record.created_at).toBe(now)
    expect(record.updated_at).toBe(now)
  })
})
