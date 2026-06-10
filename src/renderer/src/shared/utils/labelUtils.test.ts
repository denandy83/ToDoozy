import { describe, it, expect } from 'vitest'
import { deduplicateLabelsByName, getLabelsInUse } from './labelUtils'
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

describe('getLabelsInUse', () => {
  const bug = makeLabel({ id: 'bug', name: 'Bug', user_id: 'u1', order_index: 0 })
  const feature = makeLabel({ id: 'feat', name: 'Feature', user_id: 'u1', order_index: 1 })
  const chore = makeLabel({ id: 'chore', name: 'Chore', user_id: 'u1', order_index: 2 })
  const allLabels = [bug, feature, chore]

  it('returns only labels present on the given tasks', () => {
    const taskLabels: Record<string, Label[]> = {
      t1: [bug],
      t2: [feature],
      t3: [] // task with no labels
    }
    const out = getLabelsInUse(['t1', 't2', 't3'], taskLabels, allLabels, 'u1')
    expect(out.map((l) => l.id)).toEqual(['bug', 'feat'])
  })

  it('returns an empty array when no visible task has labels', () => {
    const taskLabels: Record<string, Label[]> = { t1: [], t2: [] }
    expect(getLabelsInUse(['t1', 't2'], taskLabels, allLabels, 'u1')).toEqual([])
  })

  it('returns an empty array when there are no visible tasks', () => {
    expect(getLabelsInUse([], { t1: [bug] }, allLabels, 'u1')).toEqual([])
  })

  it('deduplicates same-name labels across projects, preferring the current user', () => {
    // Two distinct "Urgent" label rows (different projects/owners), both in use.
    const myUrgent = makeLabel({ id: 'urgent-mine', name: 'Urgent', user_id: 'u1', order_index: 0 })
    const theirUrgent = makeLabel({ id: 'urgent-theirs', name: 'urgent', user_id: 'u2', order_index: 5 })
    const taskLabels: Record<string, Label[]> = {
      t1: [theirUrgent], // a shared task tagged with the other user's row
      t2: [myUrgent]
    }
    const out = getLabelsInUse(['t1', 't2'], taskLabels, [myUrgent, theirUrgent], 'u1')
    expect(out).toHaveLength(1)
    expect(out[0].id).toBe('urgent-mine')
  })

  it('surfaces a label even when only the non-canonical row is on a task', () => {
    // Regression for cross-project dedup: filtering must run against the RAW
    // label set, not a pre-deduplicated one, or the chip would vanish.
    const myUrgent = makeLabel({ id: 'urgent-mine', name: 'Urgent', user_id: 'u1', order_index: 0 })
    const theirUrgent = makeLabel({ id: 'urgent-theirs', name: 'urgent', user_id: 'u2', order_index: 5 })
    const taskLabels: Record<string, Label[]> = { t1: [theirUrgent] }
    const out = getLabelsInUse(['t1'], taskLabels, [myUrgent, theirUrgent], 'u1')
    expect(out).toHaveLength(1)
    expect(out[0].name.toLowerCase()).toBe('urgent')
  })

  it('ignores task ids missing from the taskLabels map', () => {
    const taskLabels: Record<string, Label[]> = { t1: [bug] }
    const out = getLabelsInUse(['t1', 'missing'], taskLabels, allLabels, 'u1')
    expect(out.map((l) => l.id)).toEqual(['bug'])
  })

  it('orders the result by order_index', () => {
    const taskLabels: Record<string, Label[]> = { t1: [chore, bug, feature] }
    const out = getLabelsInUse(['t1'], taskLabels, allLabels, 'u1')
    expect(out.map((l) => l.id)).toEqual(['bug', 'feat', 'chore'])
  })
})
