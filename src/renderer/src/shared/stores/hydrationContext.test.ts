import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useAuthStore } from './authStore'
import { useProjectStore } from './projectStore'
import { useLabelStore } from './labelStore'
import { useStatusStore } from './statusStore'
import { useTaskStore } from './taskStore'

let generation: number
let finish: (value: unknown) => void
let entered: () => void
let started: Promise<void>
beforeEach(() => {
  generation = 1
  useAuthStore.setState({ currentUser: { id: 'a' } as never })
  useProjectStore.setState({ projects: {}, members: {}, currentProjectId: null, error: null })
  useLabelStore.setState({ labels: {}, projectLabels: {}, error: null })
  useStatusStore.setState({ statuses: {}, error: null })
  useTaskStore.setState({ tasks: {}, taskLabels: {}, error: null })
  started = new Promise((resolve) => { entered = resolve })
  const pending = new Promise((resolve) => { finish = resolve })
  vi.stubGlobal('window', { api: { sync: {
    captureContext: async () => ({ generation, userId: useAuthStore.getState().currentUser?.id }),
    invokeContext: async (origin: { generation: number }) => {
      if (origin.generation !== generation) throw new Error('Sync database changed')
      entered(); return pending
    }
  } } })
})
afterEach(() => vi.unstubAllGlobals())

const hydrations = [
  () => useProjectStore.getState().hydrateProjects('a'),
  () => useProjectStore.getState().hydrateMembers('p'),
  () => useLabelStore.getState().hydrateLabels('p'),
  () => useLabelStore.getState().hydrateAllLabels(),
  () => useStatusStore.getState().hydrateStatuses('p'),
  () => useTaskStore.getState().hydrateTasks('p'),
  () => useTaskStore.getState().hydrateArchived('p'),
  () => useTaskStore.getState().hydrateTemplates('p'),
  () => useTaskStore.getState().hydrateTaskLabels('t'),
  () => useTaskStore.getState().hydrateAllTaskLabels('p'),
  () => useTaskStore.getState().hydrateAllForProject('p'),
  () => useTaskStore.getState().hydrateAllForUser('a')
]

it.each(hydrations.flatMap((hydrate, index) => ['account', 'database'].map((change) => ({ hydrate, index, change }))))(
  'rejects stale $change publication from hydration $index', async ({ hydrate, change }) => {
    const operation = hydrate()
    await started
    if (change === 'account') useAuthStore.setState({ currentUser: { id: 'b' } as never })
    else generation++
    finish([{ id: 'secret-a', task_id: 't', name: 'Private A', project_id: 'p' }])
    await operation
    expect(useProjectStore.getState().projects).toEqual({})
    expect(useProjectStore.getState().members).toEqual({})
    expect(useProjectStore.getState().currentProjectId).toBeNull()
    expect(useLabelStore.getState().labels).toEqual({})
    expect(useLabelStore.getState().projectLabels).toEqual({})
    expect(useStatusStore.getState().statuses).toEqual({})
    expect(useTaskStore.getState().tasks).toEqual({})
    expect(useTaskStore.getState().taskLabels).toEqual({})
  }
)

it('publishes ordinary current-account label hydration', async () => {
  const operation = useLabelStore.getState().hydrateLabels('p')
  await started
  finish([{ id: 'l', name: 'Label' }])
  await operation
  expect(useLabelStore.getState().labels.l.name).toBe('Label')
  expect(useLabelStore.getState().projectLabels.p).toEqual(new Set(['l']))
})
