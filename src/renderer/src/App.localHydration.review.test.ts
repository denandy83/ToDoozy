import { createRequire } from 'node:module'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { CalendarView } from './features/views/CalendarView'
import { useTaskStore, useProjectStore } from './shared/stores'
import { selectTopLevelTasks } from './shared/stores/taskStore'
import type { createRepositories } from '../../main/repositories'

vi.mock('./shared/stores', async importOriginal => {
  const original = await importOriginal<typeof import('./shared/stores')>()
  const task = (selector?: (state: ReturnType<typeof original.useTaskStore.getState>) => unknown): unknown => selector ? selector(original.useTaskStore.getState()) : original.useTaskStore.getState()
  const project = (selector?: (state: ReturnType<typeof original.useProjectStore.getState>) => unknown): unknown => selector ? selector(original.useProjectStore.getState()) : original.useProjectStore.getState()
  return { ...original, useTaskStore: Object.assign(task, original.useTaskStore), useProjectStore: Object.assign(project, original.useProjectStore) }
})
vi.mock('./features/views/useCalendar', async importOriginal => {
  const original = await importOriginal<typeof import('./features/views/useCalendar')>()
  return { ...original, useCalendar: () => ({ days: Array.from({ length: 35 }, (_, index) => { const day = new Date(2026, 0, 15 + index); return { date: original.toYMD(day), dayOfMonth: day.getDate(), isToday: index === 1, isCurrentMonth: true } }), title: 'Synthetic calendar', goNext: () => {}, goPrev: () => {}, goToday: () => {} }) }
})
interface Harness {
  repo: ReturnType<typeof createRepositories>
  stores: { useTaskStore: typeof useTaskStore; useProjectStore: typeof useProjectStore; useAuthStore: typeof import('./shared/stores/authStore').useAuthStore; useViewStore: typeof import('./shared/stores/viewStore').useViewStore }
  requests: unknown[]
  runLocalBootstrap(): void
  runLocalChanges(): () => void
  emitLocalChange(): void
  untilIdle(): Promise<void>
  stop(): Promise<void>
}
const require = createRequire(import.meta.url)
const fixture = require('../../../scripts/benchmark-sync.cjs') as { makeHarness(options: { projectCount: number }): Promise<Harness> }
afterEach(() => vi.useRealTimers())
it('hydrates unvisited future tasks offline at bootstrap and after an unscoped native notification', async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-01-16T12:00:00Z'))
  const h = await fixture.makeHarness({ projectCount: 2 })
  let cleanup: (() => void) | undefined
  try {
    h.stores.useAuthStore.setState({ isOffline: true })
    h.repo.tasks.create({ id: 'future-p1', owner_id: 'u', project_id: 'p1', status_id: 's1', title: 'Unvisited future task', due_date: '2026-01-20', is_in_my_day: 0 })
    expect(h.stores.useProjectStore.getState().currentProjectId).toBe('p0')
    h.runLocalBootstrap(); await h.untilIdle()
    const render = (): string => {
      useTaskStore.setState({ tasks: h.stores.useTaskStore.getState().tasks, taskLabels: h.stores.useTaskStore.getState().taskLabels })
      useProjectStore.setState({ projects: h.stores.useProjectStore.getState().projects })
      return renderToStaticMarkup(createElement(CalendarView))
    }
    expect(render()).toContain('Unvisited future task')
    expect(selectTopLevelTasks('p1')(useTaskStore.getState())).toHaveLength(1)
    h.stores.useViewStore.setState({ currentView: 'calendar' })
    cleanup = h.runLocalChanges()
    h.repo.tasks.update('future-p1', { title: 'Updated by local IPC' })
    h.repo.tasks.create({ id: 'another-p1', owner_id: 'u', project_id: 'p1', status_id: 's1', title: 'Another future IPC task', due_date: '2026-01-21', is_in_my_day: 0 })
    h.emitLocalChange(); await h.untilIdle()
    expect(render()).toContain('Updated by local IPC')
    expect(render()).toContain('Another future IPC task')
    expect(selectTopLevelTasks('p1')(useTaskStore.getState())).toHaveLength(2)
    expect(h.stores.useProjectStore.getState().currentProjectId).toBe('p0')
    expect(h.requests).toEqual([])
  } finally { cleanup?.(); await h.stop() }
})
