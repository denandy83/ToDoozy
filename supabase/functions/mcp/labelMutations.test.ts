import { describe, it, expect, vi } from 'vitest'
import {
  upsertTaskLabel,
  deleteTaskLabel,
  type TaskLabelMutationClient,
  type TaskLabelFilterBuilder,
  type PostgrestMutationResult
} from './labelMutations'

/** Build a chainable-and-awaitable PostgREST filter builder mock. */
function makeFilterBuilder(result: PostgrestMutationResult): {
  builder: TaskLabelFilterBuilder
  eq: ReturnType<typeof vi.fn>
} {
  const eq = vi.fn(() => builder)
  const builder = {
    eq,
    then: (onfulfilled?: (value: PostgrestMutationResult) => unknown) =>
      Promise.resolve(result).then(onfulfilled)
  } as unknown as TaskLabelFilterBuilder
  return { builder, eq }
}

function makeClient(opts: {
  upsertResult?: PostgrestMutationResult
  deleteResult?: PostgrestMutationResult
}): {
  client: TaskLabelMutationClient
  from: ReturnType<typeof vi.fn>
  upsert: ReturnType<typeof vi.fn>
  del: ReturnType<typeof vi.fn>
  deleteEq: ReturnType<typeof vi.fn>
} {
  const upsert = vi.fn(() => Promise.resolve(opts.upsertResult ?? { error: null }))
  const { builder, eq: deleteEq } = makeFilterBuilder(opts.deleteResult ?? { error: null })
  const del = vi.fn(() => builder)
  const from = vi.fn(() => ({ upsert, delete: del }))
  return { client: { from } as TaskLabelMutationClient, from, upsert, del, deleteEq }
}

describe('upsertTaskLabel', () => {
  it('resolves without throwing when the upsert succeeds', async () => {
    const { client } = makeClient({ upsertResult: { error: null } })
    await expect(upsertTaskLabel(client, 'task-1', 'label-1')).resolves.toBeUndefined()
  })

  it('throws when the upsert returns an error (FK violation / RLS reject)', async () => {
    const { client } = makeClient({ upsertResult: { error: { message: 'FK violation' } } })
    await expect(upsertTaskLabel(client, 'task-1', 'label-1')).rejects.toThrow(
      'Failed to assign label: FK violation'
    )
  })

  it('targets task_labels with the correct values and onConflict', async () => {
    const { client, from, upsert } = makeClient({})
    await upsertTaskLabel(client, 'task-9', 'label-9')
    expect(from).toHaveBeenCalledWith('task_labels')
    expect(upsert).toHaveBeenCalledWith(
      { task_id: 'task-9', label_id: 'label-9' },
      { onConflict: 'task_id,label_id' }
    )
  })
})

describe('deleteTaskLabel', () => {
  it('resolves without throwing when the delete succeeds', async () => {
    const { client } = makeClient({ deleteResult: { error: null } })
    await expect(deleteTaskLabel(client, 'task-1', 'label-1')).resolves.toBeUndefined()
  })

  it('throws when the delete returns an error', async () => {
    const { client } = makeClient({ deleteResult: { error: { message: 'permission denied' } } })
    await expect(deleteTaskLabel(client, 'task-1', 'label-1')).rejects.toThrow(
      'Failed to remove label: permission denied'
    )
  })

  it('filters by both task_id and label_id', async () => {
    const { client, from, del, deleteEq } = makeClient({})
    await deleteTaskLabel(client, 'task-7', 'label-7')
    expect(from).toHaveBeenCalledWith('task_labels')
    expect(del).toHaveBeenCalled()
    expect(deleteEq).toHaveBeenNthCalledWith(1, 'task_id', 'task-7')
    expect(deleteEq).toHaveBeenNthCalledWith(2, 'label_id', 'label-7')
  })
})
