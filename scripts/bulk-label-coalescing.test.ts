import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
const opened: Awaited<ReturnType<typeof makeHarness>>[] = []
afterEach(async () => { for (const h of opened.splice(0)) await h.stop() })
function gate() {
  let enter!: () => void, release!: () => void
  return { entered: new Promise<void>(resolve => { enter = resolve }), wait: new Promise<void>(resolve => { release = resolve }), enter: () => enter(), release: () => release() }
}
async function setup(counts: number[]) {
  const h = await makeHarness({ projectCount: counts.length, connected: false }); opened.push(h)
  const ids: string[] = []
  for (const [n, count] of counts.entries()) for (let i = 0; i < count; i++) {
    const task = h.repo.tasks.create({ id: 't'+n+'-'+i, project_id: 'p'+n, owner_id: 'u', status_id: 's'+n, title: 'TASK '+n+' '+i })
    h.remote.tasks.push({ ...task }); ids.push(task.id)
  }
  h.repo.labels.create({ id: 'label', user_id: 'u', name: 'Own', color: '#123456' })
  await h.stores.useTaskStore.getState().hydrateAllForUser('u')
  return { h, ids }
}
function writeCount(h: Awaited<ReturnType<typeof makeHarness>>, table: string) {
  return h.requests.filter((row: { table: string; method: string }) => row.table === table && row.method === 'POST').length
}
function expectLabels(h: Awaited<ReturnType<typeof makeHarness>>, ids: string[], projects: number) {
  for (const id of ids) {
    expect(h.repo.labels.findByTaskId(id).map((row: { id: string }) => row.id)).toEqual(['label'])
    expect(h.stores.useTaskStore.getState().taskLabels[id]).toEqual([expect.objectContaining({ id: 'label', user_id: 'u', name: 'Own', color: '#123456' })])
    expect(h.remote.task_labels.some((row: { task_id: string; label_id: string; deleted_at: string | null }) => row.task_id === id && row.label_id === 'label' && !row.deleted_at)).toBe(true)
  }
  expect(writeCount(h, 'user_labels')).toBe(2 * projects)
  expect(writeCount(h, 'project_labels')).toBeGreaterThanOrEqual(projects)
  expect(writeCount(h, 'project_labels')).toBeLessThanOrEqual(2 * projects - 1)
  expect(h.fixtureErrors).toEqual([])
}
it.each([[1], [3], [1, 1], [3, 2]].flatMap(counts => [false, true].map(staggered => ({ counts, staggered }))))(
  'coalesces actual SDK label writes for $counts with staggered replies=$staggered', async ({ counts, staggered }) => {
    const { h, ids } = await setup(counts)
    const pauses = ids.map(() => gate())
    if (staggered) {
      const original = h.repo.tasks.addLabel.bind(h.repo.tasks)
      h.repo.tasks.addLabel = (id: string, label: string) => {
        if (h.services.db.isTransaction) return original(id, label)
        const result = original(id, label), pause = pauses[ids.indexOf(id)]
        return (async () => { pause.enter(); await pause.wait; return result })()
      }
    }
    const operation = h.stores.useTaskStore.getState().bulkAddLabel(ids, 'label')
    if (staggered) {
      await Promise.all(pauses.map(pause => pause.entered))
      for (const pause of pauses) { pause.release(); await h.untilIdle() }
    }
    await operation; await h.untilIdle()
    expectLabels(h, ids, counts.length)
  })

it.each([false, true])('keeps Q labeling and durable P intent after held P reply (failure=%s)', async fail => {
  const { h, ids } = await setup([3, 2]), pause = gate(), startQ = gate()
  const original = h.repo.tasks.addLabel.bind(h.repo.tasks)
  h.repo.tasks.addLabel = (id: string, label: string) => {
    if (h.services.db.isTransaction) return original(id, label)
    const result = original(id, label)
    return (async () => {
      if (id.startsWith('t1')) await startQ.wait
      if (id.startsWith('t0')) { pause.enter(); await pause.wait; if (fail) throw Error('PRIVATE P ERROR') }
      return result
    })()
  }
  const operation = h.stores.useTaskStore.getState().bulkAddLabel(ids, 'label')
  await pause.entered
  const project = { ...h.repo.projects.findById('p0'), owner_id: 'other', updated_at: '2035-01-01T00:00:00.000Z' }
  h.repo.projects.applyRemote(project)
  Object.assign(h.remote.projects[0], project)
  h.remote.project_members = h.remote.project_members.filter((row: { project_id: string; user_id: string }) => row.project_id !== 'p0' || row.user_id !== 'u')
  await h.services.shared.discoverRemoteMemberships('u', await h.context(), project)
  startQ.release(); await h.untilIdle()
  expect(h.stores.useTaskStore.getState().taskLabels['t1-0']).toHaveLength(1)
  pause.release(); await operation; await h.untilIdle()
  for (const id of ids.filter(id => id.startsWith('t0'))) {
    expect(h.stores.useTaskStore.getState().tasks[id]).toBeUndefined()
    expect(h.stores.useTaskStore.getState().taskLabels[id]).toBeUndefined()
    expect(h.repo.labels.findByTaskId(id)).toHaveLength(1)
    expect(h.remote.task_labels.some((row: { task_id: string }) => row.task_id === id)).toBe(false)
  }
  expect(h.repo.syncQueue.findAll().some((row: { table_name: string; payload: string }) => row.table_name === 'project_labels' && JSON.parse(row.payload).projectId === 'p0')).toBe(true)
  expectLabels(h, ids.filter(id => id.startsWith('t1')), 1)
  expect(h.stores.useTaskStore.getState().error).toBeNull()
})
