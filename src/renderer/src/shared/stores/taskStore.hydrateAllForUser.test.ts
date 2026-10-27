import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Task, TaskLabelMapping } from '../../../../shared/types'

function makeTask(id: string, projectId: string): Task {
  return {
    id,
    project_id: projectId,
    owner_id: 'u1',
    assigned_to: null,
    title: `Task ${id}`,
    description: null,
    status_id: 'st',
    priority: 0,
    due_date: null,
    parent_id: null,
    order_index: 0,
    is_in_my_day: 0,
    is_template: 0,
    is_archived: 0,
    completed_date: null,
    recurrence_rule: null,
    reference_url: null,
    my_day_dismissed_date: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null
  }
}

function mapping(taskId: string, labelId: string, name: string): TaskLabelMapping {
  return {
    task_id: taskId,
    id: labelId,
    user_id: 'u1',
    name,
    color: '#abc',
    order_index: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null
  }
}

describe('taskStore.hydrateAllForUser', () => {
  beforeEach(async () => {
    const { useAuthStore } = await import('./authStore')
    useAuthStore.setState({ currentUser: { id: 'u1' } as never })
    const getProjectsForUser = vi.fn().mockResolvedValue([{ id: 'pA' }, { id: 'pB' }])
    const findAllByProject = vi.fn(async (pid: string) =>
      pid === 'pA' ? [makeTask('a1', 'pA'), makeTask('a2', 'pA')] : [makeTask('b1', 'pB')]
    )
    const findTaskLabelsByProject = vi.fn(async (pid: string) =>
      pid === 'pA' ? [mapping('a1', 'lbug', 'Bug'), mapping('a1', 'lfeat', 'Feature')] : [mapping('b1', 'lbug', 'Bug')]
    )
    vi.stubGlobal('window', {
      ...globalThis.window,
      api: {
        sync: {
          captureContext: async () => ({ userId: 'u1', generation: 1 }),
          invokeContext: async (_context: unknown, channel: string, args: unknown[]) => {
            const [ns, method] = channel.split(':')
            return (window.api as unknown as Record<string, Record<string, (...args: unknown[]) => unknown>>)[ns][method](...args)
          }
        },
        projects: { getProjectsForUser },
        tasks: { findAllByProject },
        labels: { findTaskLabelsByProject }
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('merges tasks and grouped label mappings from every project', async () => {
    const { useTaskStore } = await import('./taskStore')
    // Pre-seed with an unrelated task that must be preserved (merge, not reset)
    useTaskStore.setState({ tasks: { existing: makeTask('existing', 'pZ') }, taskLabels: {} })

    await useTaskStore.getState().hydrateAllForUser('u1')

    const { tasks, taskLabels } = useTaskStore.getState()
    expect(Object.keys(tasks).sort()).toEqual(['a1', 'a2', 'b1', 'existing'])
    expect(taskLabels['a1'].map((l) => l.name).sort()).toEqual(['Bug', 'Feature'])
    expect(taskLabels['b1'].map((l) => l.name)).toEqual(['Bug'])
    // a2 has no labels — not present in the map
    expect(taskLabels['a2']).toBeUndefined()
  })

  it('does not toggle loading (no full-reload flash)', async () => {
    const { useTaskStore } = await import('./taskStore')
    useTaskStore.setState({ loading: false })
    await useTaskStore.getState().hydrateAllForUser('u1')
    expect(useTaskStore.getState().loading).toBe(false)
  })
  it('removes deleted task rows and stale label mappings from refreshed projects', async () => {
    const { useTaskStore } = await import('./taskStore')
    useTaskStore.setState({ tasks: { deleted: makeTask('deleted', 'pA'), a2: makeTask('a2', 'pA') }, taskLabels: { a2: [mapping('a2', 'stale', 'Old')] } })
    await useTaskStore.getState().hydrateAllForUser('u1')
    expect(useTaskStore.getState().tasks.deleted).toBeUndefined()
    expect(useTaskStore.getState().taskLabels.a2).toBeUndefined()
  })

  it('preserves local edits made while the cross-project read is in flight', async () => {
    const { useTaskStore } = await import('./taskStore')
    const original = makeTask('a1', 'pA')
    useTaskStore.setState({ tasks: { a1: original }, taskLabels: {} })
    let finish!: (tasks: Task[]) => void
    let entered!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    vi.mocked(window.api.tasks.findAllByProject).mockImplementation((pid) => pid === 'pA' ? new Promise((resolve) => { finish = resolve; entered() }) : Promise.resolve([]))
    const hydration = useTaskStore.getState().hydrateAllForUser('u1')
    await started
    const edited = { ...original, title: 'Typing while remote refresh runs' }
    useTaskStore.setState({ tasks: { a1: edited } })
    finish([original])
    await hydration
    expect(useTaskStore.getState().tasks.a1.title).toBe(edited.title)
  })

})
