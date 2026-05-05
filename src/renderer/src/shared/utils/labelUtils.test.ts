import { describe, it, expect } from 'vitest'
import { deduplicateLabelsByName } from './labelUtils'
import type { Label } from '../../../../shared/types'

function makeLabel(overrides: Partial<Label> & { id: string; name: string; user_id: string | null }): Label {
  return {
    id: overrides.id,
    user_id: overrides.user_id,
    name: overrides.name,
    color: overrides.color ?? '#000',
    order_index: overrides.order_index ?? 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null
  }
}

describe('deduplicateLabelsByName', () => {
  it('returns input as-is when no duplicates exist', () => {
    const labels = [
      makeLabel({ id: 'a', name: 'Bug', user_id: 'u1', order_index: 0 }),
      makeLabel({ id: 'b', name: 'Feature', user_id: 'u1', order_index: 1 })
    ]
    const out = deduplicateLabelsByName(labels, 'u1')
    expect(out.map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('prefers the current user\'s label when duplicates exist', () => {
    const labels = [
      makeLabel({ id: 'a', name: 'Bug', user_id: 'u2', order_index: 0 }),
      makeLabel({ id: 'b', name: 'Bug', user_id: 'u1', order_index: 1 })
    ]
    const out = deduplicateLabelsByName(labels, 'u1')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('b')
  })

  it('falls back to another user\'s label if the current user has none', () => {
    const labels = [
      makeLabel({ id: 'a', name: 'Bug', user_id: 'u2', order_index: 0 }),
      makeLabel({ id: 'b', name: 'Bug', user_id: 'u3', order_index: 1 })
    ]
    const out = deduplicateLabelsByName(labels, 'u1')
    expect(out).toHaveLength(1)
    // first matched non-current-user label wins
    expect(out[0].id).toBe('a')
  })

  it('treats names case-insensitively', () => {
    const labels = [
      makeLabel({ id: 'a', name: 'BUG', user_id: 'u1' }),
      makeLabel({ id: 'b', name: 'bug', user_id: 'u2' })
    ]
    const out = deduplicateLabelsByName(labels, 'u2')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('b')
  })

  it('sorts by order_index', () => {
    const labels = [
      makeLabel({ id: 'a', name: 'Zebra', user_id: 'u1', order_index: 5 }),
      makeLabel({ id: 'b', name: 'Apple', user_id: 'u1', order_index: 1 }),
      makeLabel({ id: 'c', name: 'Mango', user_id: 'u1', order_index: 3 })
    ]
    const out = deduplicateLabelsByName(labels, 'u1')
    expect(out.map((l) => l.id)).toEqual(['b', 'c', 'a'])
  })

  it('returns an empty array when input is empty', () => {
    expect(deduplicateLabelsByName([], 'u1')).toEqual([])
  })
})
