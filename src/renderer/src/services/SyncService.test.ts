import { describe, it, expect } from 'vitest'
import { countMembersByProject } from './SyncService'

describe('countMembersByProject', () => {
  it('returns an empty map for no rows', () => {
    expect(countMembersByProject([]).size).toBe(0)
  })

  it('counts rows grouped by project_id', () => {
    const counts = countMembersByProject([
      { project_id: 'a' },
      { project_id: 'a' },
      { project_id: 'b' },
      { project_id: 'a' },
      { project_id: 'c' },
      { project_id: 'b' }
    ])
    expect(counts.get('a')).toBe(3)
    expect(counts.get('b')).toBe(2)
    expect(counts.get('c')).toBe(1)
    expect(counts.size).toBe(3)
  })

  it('reports a count of 1 for a solo (personal) project', () => {
    const counts = countMembersByProject([{ project_id: 'solo' }])
    expect(counts.get('solo')).toBe(1)
    // Downstream shared-project branching keys on count > 1, so a solo project
    // must never appear shared.
    expect((counts.get('solo') ?? 0) > 1).toBe(false)
  })

  it('flags a project with more than one member as shared (> 1)', () => {
    const counts = countMembersByProject([
      { project_id: 'shared' },
      { project_id: 'shared' }
    ])
    expect((counts.get('shared') ?? 0) > 1).toBe(true)
  })

  it('returns 0 (via nullish default) for a project id with no rows', () => {
    const counts = countMembersByProject([{ project_id: 'a' }])
    expect(counts.get('missing')).toBeUndefined()
    expect(counts.get('missing') ?? 0).toBe(0)
  })
})
