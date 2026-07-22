import { describe, it, expect } from 'vitest'
import {
  loadMemberProjectIds,
  isProjectAccessible,
  filterAccessibleByProject,
  ProjectScope,
  type ScopeClient,
  type ScopeRowsResult
} from './scoping'

/**
 * A stub `project_members` client. Records every (table, column, value) filter
 * so tests can assert the query was scoped to the right user, and returns the
 * rows the test seeded. A `null` seed simulates a PostgREST error.
 */
function makeClient(
  rows: Array<{ project_id: string }> | null,
  errorMessage?: string
): { client: ScopeClient; calls: Array<{ table: string; eqs: Array<[string, string]> }> } {
  const calls: Array<{ table: string; eqs: Array<[string, string]> }> = []
  const client: ScopeClient = {
    from(table: string) {
      const call = { table, eqs: [] as Array<[string, string]> }
      calls.push(call)
      const builder = {
        select(_columns: string) {
          return this
        },
        eq(column: string, value: string) {
          call.eqs.push([column, value])
          return this
        },
        then<T>(resolve: (r: ScopeRowsResult) => T) {
          const result: ScopeRowsResult = errorMessage
            ? { data: null, error: { message: errorMessage } }
            : { data: rows, error: null }
          return Promise.resolve(resolve(result))
        }
      }
      return builder as unknown as ReturnType<ScopeClient['from']>
    }
  }
  return { client, calls }
}

describe('loadMemberProjectIds', () => {
  it('queries project_members filtered by the caller user id', async () => {
    const { client, calls } = makeClient([{ project_id: 'p1' }, { project_id: 'p2' }])
    const ids = await loadMemberProjectIds(client, 'user-1')
    expect(ids).toEqual(new Set(['p1', 'p2']))
    expect(calls).toHaveLength(1)
    expect(calls[0].table).toBe('project_members')
    expect(calls[0].eqs).toEqual([['user_id', 'user-1']])
  })

  it('returns an empty set when the user is a member of nothing', async () => {
    const { client } = makeClient([])
    expect(await loadMemberProjectIds(client, 'user-1')).toEqual(new Set())
  })

  it('treats a null data payload as no memberships', async () => {
    const { client } = makeClient(null)
    expect(await loadMemberProjectIds(client, 'user-1')).toEqual(new Set())
  })

  it('throws (never defaults to allow-all) when the query errors', async () => {
    const { client } = makeClient(null, 'connection refused')
    await expect(loadMemberProjectIds(client, 'user-1')).rejects.toThrow(
      /Failed to load project memberships: connection refused/
    )
  })
})

describe('isProjectAccessible', () => {
  const members = new Set(['p1', 'p2'])
  it('is true only for member projects', () => {
    expect(isProjectAccessible(members, 'p1')).toBe(true)
    expect(isProjectAccessible(members, 'p2')).toBe(true)
  })
  it('is false for a foreign project id', () => {
    expect(isProjectAccessible(members, 'p3')).toBe(false)
  })
  it('defaults deny for null/undefined/empty project ids', () => {
    expect(isProjectAccessible(members, null)).toBe(false)
    expect(isProjectAccessible(members, undefined)).toBe(false)
    expect(isProjectAccessible(members, '')).toBe(false)
  })
  it('denies everything for an empty member set', () => {
    expect(isProjectAccessible(new Set(), 'p1')).toBe(false)
  })
})

describe('filterAccessibleByProject', () => {
  it('keeps only rows in member projects and drops the rest', () => {
    const members = new Set(['p1'])
    const rows = [
      { id: 'a', project_id: 'p1' },
      { id: 'b', project_id: 'p2' },
      { id: 'c', project_id: null },
      { id: 'd', project_id: 'p1' }
    ]
    expect(filterAccessibleByProject(rows, members).map((r) => r.id)).toEqual(['a', 'd'])
  })

  it('returns nothing when the member set is empty', () => {
    const rows = [{ id: 'a', project_id: 'p1' }]
    expect(filterAccessibleByProject(rows, new Set())).toEqual([])
  })
})

describe('ProjectScope', () => {
  it('loads membership once and caches it across calls', async () => {
    const { client, calls } = makeClient([{ project_id: 'p1' }, { project_id: 'p2' }])
    const scope = new ProjectScope(client, 'user-1')
    expect(await scope.isMember('p1')).toBe(true)
    expect(await scope.isMember('p2')).toBe(true)
    expect(await scope.isMember('p3')).toBe(false)
    expect(await scope.idArray()).toEqual(['p1', 'p2'])
    // Exactly one project_members round-trip despite four membership questions.
    expect(calls).toHaveLength(1)
  })

  it('denies membership for null/foreign ids', async () => {
    const { client } = makeClient([{ project_id: 'p1' }])
    const scope = new ProjectScope(client, 'user-1')
    expect(await scope.isMember(null)).toBe(false)
    expect(await scope.isMember('nope')).toBe(false)
  })

  it('caches an empty membership set (no allow-all fallback)', async () => {
    const { client, calls } = makeClient([])
    const scope = new ProjectScope(client, 'user-1')
    expect(await scope.isMember('p1')).toBe(false)
    expect(await scope.idArray()).toEqual([])
    expect(calls).toHaveLength(1)
  })
})
