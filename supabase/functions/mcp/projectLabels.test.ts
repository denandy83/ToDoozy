import { describe, it, expect, vi } from 'vitest'
import {
  upsertProjectLabel,
  fetchProjectLabels,
  type ProjectLabelClient,
  type ProjectLabelFilterBuilder,
  type PostgrestMutationResult,
  type PostgrestRowsResult
} from './projectLabels'

/** Build a chainable-and-awaitable PostgREST filter builder mock. */
function makeFilterBuilder(result: PostgrestRowsResult): {
  builder: ProjectLabelFilterBuilder
  eq: ReturnType<typeof vi.fn>
  is: ReturnType<typeof vi.fn>
  inFn: ReturnType<typeof vi.fn>
} {
  const eq = vi.fn(() => builder)
  const is = vi.fn(() => builder)
  const inFn = vi.fn(() => builder)
  const builder = {
    eq,
    is,
    in: inFn,
    then: (onfulfilled?: (value: PostgrestRowsResult) => unknown) =>
      Promise.resolve(result).then(onfulfilled)
  } as unknown as ProjectLabelFilterBuilder
  return { builder, eq, is, inFn }
}

function makeClient(opts: {
  upsertResult?: PostgrestMutationResult
  junctionResult?: PostgrestRowsResult
  labelsResult?: PostgrestRowsResult
}): {
  client: ProjectLabelClient
  from: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  junction: ReturnType<typeof makeFilterBuilder>
  labels: ReturnType<typeof makeFilterBuilder>
} {
  const upsert = vi.fn(() => Promise.resolve(opts.upsertResult ?? { error: null }))
  const junction = makeFilterBuilder(opts.junctionResult ?? { data: [], error: null })
  const labels = makeFilterBuilder(opts.labelsResult ?? { data: [], error: null })
  const from = vi.fn((table: string) => ({
    upsert,
    select: vi.fn(() => (table === 'project_labels' ? junction.builder : labels.builder))
  }))
  return { client: { from } as unknown as ProjectLabelClient, from, upsert, junction, labels }
}

describe('upsertProjectLabel', () => {
  it('resolves without throwing when the upsert succeeds', async () => {
    const { client } = makeClient({ upsertResult: { error: null } })
    await expect(upsertProjectLabel(client, 'proj-1', 'label-1')).resolves.toBeUndefined()
  })

  it('throws when the upsert returns an error (FK violation / RLS reject)', async () => {
    const { client } = makeClient({ upsertResult: { error: { message: 'FK violation' } } })
    await expect(upsertProjectLabel(client, 'proj-1', 'label-1')).rejects.toThrow(
      'Failed to link label to project: FK violation'
    )
  })

  it('targets project_labels — not the legacy projects.label_data column', async () => {
    const { client, from } = makeClient({})
    await upsertProjectLabel(client, 'proj-9', 'label-9')
    expect(from).toHaveBeenCalledWith('project_labels')
    expect(from).not.toHaveBeenCalledWith('projects')
  })

  it('upserts with deleted_at: null (revives tombstones) and the composite onConflict key', async () => {
    const { client, upsert } = makeClient({})
    await upsertProjectLabel(client, 'proj-9', 'label-9')
    expect(upsert).toHaveBeenCalledWith(
      {
        project_id: 'proj-9',
        label_id: 'label-9',
        created_at: expect.any(String),
        deleted_at: null
      },
      { onConflict: 'project_id,label_id' }
    )
  })
})

describe('fetchProjectLabels', () => {
  it('returns [] when the project has no junction rows', async () => {
    const { client } = makeClient({ junctionResult: { data: [], error: null } })
    await expect(fetchProjectLabels(client, 'proj-1')).resolves.toEqual([])
  })

  it('returns [] when the junction select resolves with null data', async () => {
    const { client } = makeClient({ junctionResult: { data: null, error: null } })
    await expect(fetchProjectLabels(client, 'proj-1')).resolves.toEqual([])
  })

  it('filters the junction by project_id and excludes tombstoned links', async () => {
    const { client, junction } = makeClient({})
    await fetchProjectLabels(client, 'proj-3')
    expect(junction.eq).toHaveBeenCalledWith('project_id', 'proj-3')
    expect(junction.is).toHaveBeenCalledWith('deleted_at', null)
  })

  it('resolves label rows from user_labels in one batched .in() query', async () => {
    const rows = [
      { id: 'label-1', name: 'Bug', color: '#ef4444' },
      { id: 'label-2', name: 'Feature', color: '#22c55e' }
    ]
    const { client, labels } = makeClient({
      junctionResult: { data: [{ label_id: 'label-1' }, { label_id: 'label-2' }], error: null },
      labelsResult: { data: rows, error: null }
    })
    await expect(fetchProjectLabels(client, 'proj-3')).resolves.toEqual(rows)
    expect(labels.inFn).toHaveBeenCalledWith('id', ['label-1', 'label-2'])
  })

  it('throws when the junction select errors', async () => {
    const { client } = makeClient({
      junctionResult: { data: null, error: { message: 'permission denied' } }
    })
    await expect(fetchProjectLabels(client, 'proj-1')).rejects.toThrow(
      'Failed to read project labels: permission denied'
    )
  })

  it('throws when the user_labels select errors', async () => {
    const { client } = makeClient({
      junctionResult: { data: [{ label_id: 'label-1' }], error: null },
      labelsResult: { data: null, error: { message: 'timeout' } }
    })
    await expect(fetchProjectLabels(client, 'proj-1')).rejects.toThrow(
      'Failed to read labels: timeout'
    )
  })
})
