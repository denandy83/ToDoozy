import { afterEach, expect, it, vi } from 'vitest'
import { useStatusStore } from './statusStore'
import { useAuthStore } from './authStore'
import type { Status, User } from '../../../../shared/types'
afterEach(() => vi.unstubAllGlobals())
it('does not commit a previous account status read after an account switch', async () => {
  let resolve!: (rows: Status[]) => void
  vi.stubGlobal('window', { api: { statuses: { findByProjectId: () => new Promise<Status[]>((finish) => { resolve = finish }) } } })
  useAuthStore.setState({ currentUser: { id: 'a' } as User })
  const hydration = useStatusStore.getState().hydrateStatuses('project-a')
  useAuthStore.setState({ currentUser: { id: 'b' } as User })
  useStatusStore.setState({ statuses: { b: { id: 'b', project_id: 'project-b' } as Status }, loading: false })
  resolve([{ id: 'a', project_id: 'project-a' } as Status])
  await hydration
  expect(Object.keys(useStatusStore.getState().statuses)).toEqual(['b'])
})
