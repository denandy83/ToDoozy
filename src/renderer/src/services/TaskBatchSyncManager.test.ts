import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Task } from '../../../shared/types'

// flush() dynamically imports the taskStore for the store snapshot and the
// syncIfShared routing — mock the whole module so no real store (or
// window.api) is ever constructed.
const { syncIfSharedMock, storeState } = vi.hoisted(() => ({
  syncIfSharedMock: vi.fn(),
  storeState: { tasks: {} as Record<string, Task> }
}))

vi.mock('../shared/stores/taskStore', () => ({
  useTaskStore: { getState: () => ({ tasks: storeState.tasks }) },
  syncIfShared: syncIfSharedMock
}))

function makeTask(id: string): Task {
  return {
    id,
    project_id: 'p1',
    owner_id: 'u1',
    assigned_to: null,
    title: `Task ${id}`,
    description: null,
    status_id: 's1',
    priority: 0,
    due_date: null,
    parent_id: null,
    order_index: 0,
    is_template: 0,
    is_archived: 0,
    completed_date: null,
    recurrence_rule: null,
    reference_url: null,
    created_at: '2026-06-10T00:00:00.000Z',
    updated_at: '2026-06-10T00:00:00.000Z',
    is_in_my_day: 0,
    my_day_dismissed_date: null
  } as Task
}

type Manager = typeof import('./TaskBatchSyncManager')

// Module-level pending state — re-import fresh per test so cases don't bleed.
async function freshManager(): Promise<Manager> {
  vi.resetModules()
  return import('./TaskBatchSyncManager')
}

beforeEach(() => {
  vi.useFakeTimers()
  syncIfSharedMock.mockReset().mockResolvedValue(undefined)
  storeState.tasks = { t1: makeTask('t1'), t2: makeTask('t2') }
})

afterEach(() => {
  vi.useRealTimers()
})

describe('markPending', () => {
  it('marks a task pending and is idempotent', async () => {
    const mgr = await freshManager()
    expect(mgr.isPending('t1')).toBe(false)
    mgr.markPending('t1')
    expect(mgr.isPending('t1')).toBe(true)
    expect(mgr.pendingCount()).toBe(1)
    mgr.markPending('t1')
    expect(mgr.pendingCount()).toBe(1)
    expect(syncIfSharedMock).not.toHaveBeenCalled()
  })

  it('flushes via the 30s safety timer', async () => {
    const mgr = await freshManager()
    mgr.markPending('t1')
    await vi.advanceTimersByTimeAsync(29_999)
    expect(syncIfSharedMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(syncIfSharedMock).toHaveBeenCalledTimes(1)
    expect(syncIfSharedMock).toHaveBeenCalledWith(storeState.tasks.t1, 'UPDATE')
    expect(mgr.isPending('t1')).toBe(false)
  })

  it('re-marking resets the safety timer', async () => {
    const mgr = await freshManager()
    mgr.markPending('t1')
    await vi.advanceTimersByTimeAsync(20_000)
    mgr.markPending('t1')
    // 15s after the re-mark (35s after the first mark): not yet flushed
    await vi.advanceTimersByTimeAsync(15_000)
    expect(syncIfSharedMock).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15_000)
    expect(syncIfSharedMock).toHaveBeenCalledTimes(1)
  })
})

describe('flush', () => {
  it('pushes the current task state and clears pending + timer', async () => {
    const mgr = await freshManager()
    mgr.markPending('t1')
    await mgr.flush('t1')
    expect(syncIfSharedMock).toHaveBeenCalledTimes(1)
    expect(syncIfSharedMock).toHaveBeenCalledWith(storeState.tasks.t1, 'UPDATE')
    expect(mgr.isPending('t1')).toBe(false)
    // Timer was cleared — advancing past the safety window pushes nothing more
    await vi.advanceTimersByTimeAsync(60_000)
    expect(syncIfSharedMock).toHaveBeenCalledTimes(1)
  })

  it('double-flush is a no-op', async () => {
    const mgr = await freshManager()
    mgr.markPending('t1')
    await mgr.flush('t1')
    await mgr.flush('t1')
    expect(syncIfSharedMock).toHaveBeenCalledTimes(1)
  })

  it('is a no-op for a task that was never marked', async () => {
    const mgr = await freshManager()
    await mgr.flush('t1')
    expect(syncIfSharedMock).not.toHaveBeenCalled()
  })

  it('skips a task deleted while pending (tombstone already pushed)', async () => {
    const mgr = await freshManager()
    mgr.markPending('t1')
    delete storeState.tasks.t1
    await mgr.flush('t1')
    expect(syncIfSharedMock).not.toHaveBeenCalled()
    expect(mgr.isPending('t1')).toBe(false)
  })
})

describe('flushAll', () => {
  it('drains every pending task', async () => {
    const mgr = await freshManager()
    mgr.markPending('t1')
    mgr.markPending('t2')
    await mgr.flushAll()
    expect(syncIfSharedMock).toHaveBeenCalledTimes(2)
    expect(syncIfSharedMock).toHaveBeenCalledWith(storeState.tasks.t1, 'UPDATE')
    expect(syncIfSharedMock).toHaveBeenCalledWith(storeState.tasks.t2, 'UPDATE')
    expect(mgr.pendingCount()).toBe(0)
  })

  it('is a no-op when nothing is pending', async () => {
    const mgr = await freshManager()
    await mgr.flushAll()
    expect(syncIfSharedMock).not.toHaveBeenCalled()
  })
})

describe('cancelPending', () => {
  it('drops the mark without pushing and disarms the timer', async () => {
    const mgr = await freshManager()
    mgr.markPending('t1')
    mgr.cancelPending('t1')
    expect(mgr.isPending('t1')).toBe(false)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(syncIfSharedMock).not.toHaveBeenCalled()
  })
})
