import { describe, it, expect } from 'vitest'
import { countMembersByProject, buildTaskLabelData } from './SyncService'

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

describe('buildTaskLabelData', () => {
  const labelById = new Map<string, { name: string; color: string }>([
    ['l1', { name: 'Bug', color: '#f00' }],
    ['l2', { name: 'Feature', color: '#0f0' }],
    ['l3', { name: 'Chore', color: '#00f' }]
  ])

  it('returns an empty array for no label ids', () => {
    expect(buildTaskLabelData([], labelById)).toEqual([])
  })

  it('resolves ids to {name, color} in the given order', () => {
    expect(buildTaskLabelData(['l2', 'l1'], labelById)).toEqual([
      { name: 'Feature', color: '#0f0' },
      { name: 'Bug', color: '#f00' }
    ])
  })

  it('skips ids missing from the map (mirrors the per-label if(label) guard)', () => {
    expect(buildTaskLabelData(['l1', 'missing', 'l3'], labelById)).toEqual([
      { name: 'Bug', color: '#f00' },
      { name: 'Chore', color: '#00f' }
    ])
  })

  it('returns empty when no id resolves', () => {
    expect(buildTaskLabelData(['x', 'y'], labelById)).toEqual([])
  })

  it('preserves duplicate ids (one output row per input id)', () => {
    expect(buildTaskLabelData(['l1', 'l1'], labelById)).toEqual([
      { name: 'Bug', color: '#f00' },
      { name: 'Bug', color: '#f00' }
    ])
  })
})
