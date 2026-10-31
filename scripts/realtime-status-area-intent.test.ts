import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
const opened: Awaited<ReturnType<typeof makeHarness>>[] = []
afterEach(async () => { for (const h of opened.splice(0)) await h.stop() })
const families = ['shared', 'personal', 'user'] as const
async function setup(family: typeof families[number]) {
  const h = await makeHarness({ ref: process.env.REVIEW_BASE_REF, projectCount: 1, shared: family === 'shared' ? 1 : 0, connected: false }); opened.push(h)
  if (family === 'shared') await h.services.shared.subscribeToProject('p0')
  else if (family === 'personal') await h.services.personal.subscribeToPersonalProject('p0', () => {})
  else await h.services.user.subscribeToUserChannel('u')
  return h
}
function healthy(h: Awaited<ReturnType<typeof makeHarness>>) {
  h.stores.useSyncStore.setState({ status: 'synced', realtimeChannels: { current: true }, realtimeConnected: true, nextReconnectAt: 123456, connectionLost: false })
}
it.each(families.flatMap(family => ['account', 'database', 'cancelled'].map(change => ({ family, change }))))('ignores stale $family status after $change', async ({ family, change }) => {
  const h = await setup(family), channel = h.channels[0]
  if (change === 'account') h.setAccount('other')
  else if (change === 'database') h.replaceDatabase()
  else if (family === 'shared') await h.services.shared.unsubscribeFromProject('p0')
  else if (family === 'personal') await h.services.personal.unsubscribePersonalProject('p0')
  else await h.services.user.unsubscribeUserChannel()
  healthy(h)
  const before = h.stores.useSyncStore.getState(), timers = h.timers.size
  for (const status of ['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED', 'SUBSCRIBED']) {
    channel.status(status)
    expect(h.stores.useSyncStore.getState()).toEqual(before)
  }
  await h.untilIdle()
  expect(h.stores.useSyncStore.getState()).toEqual(before)
  expect(h.timers.size).toBe(timers)
  expect(h.stores.useAuthStore.getState().isOffline).toBe(false)
  expect(h.fixtureErrors).toEqual([])
})
it.each(families.flatMap(family => ['account', 'database'].map(change => ({ family, change }))))('keeps a stale $family timer from changing current reconnect state after $change', async ({ family, change }) => {
  const h = await setup(family)
  h.channels[0].status('CHANNEL_ERROR')
  expect(h.timers.size).toBe(1)
  if (change === 'account') h.setAccount('other'); else h.replaceDatabase()
  healthy(h)
  const before = h.stores.useSyncStore.getState()
  await h.runTimers()
  expect(h.stores.useSyncStore.getState()).toEqual(before)
  expect(h.channels).toHaveLength(1)
  expect(h.fixtureErrors).toEqual([])
})
it.each(families)('retains active %s errors and healthy resubscription', async family => {
  const h = await setup(family), channel = h.channels[0]
  channel.status('SUBSCRIBED'); await h.untilIdle()
  channel.status('CHANNEL_ERROR')
  expect(h.stores.useSyncStore.getState().realtimeConnected).toBe(false)
  expect(h.stores.useSyncStore.getState().nextReconnectAt).not.toBeNull()
  await h.runTimers()
  const fresh = h.channels.at(-1)
  fresh.status('SUBSCRIBED'); await h.untilIdle()
  for (const active of h.channels.filter((row: {closed: boolean}) => !row.closed)) active.status('SUBSCRIBED')
  await h.untilIdle()
  expect(h.stores.useSyncStore.getState().realtimeConnected).toBe(true)
  expect(h.stores.useAuthStore.getState().isOffline).toBe(false)
  expect(h.fixtureErrors).toEqual([])
})
it.each([2, 3])('preserves %i area clicks while the first committed reply is held', async count => {
  const h = await makeHarness({ ref: process.env.REVIEW_BASE_REF, projectCount: 0, connected: false }); opened.push(h)
  h.services.observeDatabaseScope()
  h.repo.projectAreas.create({ id: 'area', user_id: 'u', name: 'AREA' })
  await h.stores.useProjectAreaStore.getState().hydrate('u')
  const original = h.repo.projectAreas.update.bind(h.repo.projectAreas)
  let release!: () => void, enter!: () => void, first = true
  const entered = new Promise<void>(r => { enter = r }), held = new Promise<void>(r => { release = r })
  h.repo.projectAreas.update = async (...args: unknown[]) => {
    const result = original(...args)
    if (first) { first = false; enter(); await held }
    return result
  }
  const store = h.stores.useProjectAreaStore
  store.getState().toggleCollapsed('area'); await entered
  for (let n = 1; n < count; n++) { store.getState().toggleCollapsed('area'); await h.untilIdle() }
  expect(h.repo.projectAreas.findById('area').is_collapsed).toBe(count % 2)
  release(); await h.untilIdle()
  expect(store.getState().areas[0].is_collapsed).toBe(count % 2)
  expect(h.remote.user_project_areas[0].is_collapsed).toBe(count % 2)
  expect(h.fixtureErrors).toEqual([])
})
it.each(['account', 'database'])('fences a held area reply after %s changes', async change => {
  const h = await makeHarness({ ref: process.env.REVIEW_BASE_REF, projectCount: 0, connected: false }); opened.push(h)
  h.services.observeDatabaseScope()
  h.repo.projectAreas.create({ id: 'area', user_id: 'u', name: 'AREA' })
  await h.stores.useProjectAreaStore.getState().hydrate('u')
  const original = h.repo.projectAreas.update.bind(h.repo.projectAreas)
  let release!: () => void, enter!: () => void
  const entered = new Promise<void>(r => { enter = r }), held = new Promise<void>(r => { release = r })
  h.repo.projectAreas.update = async (...args: unknown[]) => { const row = original(...args); enter(); await held; return row }
  h.stores.useProjectAreaStore.getState().toggleCollapsed('area'); await entered
  if (change === 'account') h.setAccount('other'); else h.replaceDatabase()
  release(); await h.untilIdle()
  expect(h.stores.useProjectAreaStore.getState().areas).toEqual([])
  expect(h.remote.user_project_areas).toEqual([])
  expect(h.repo.projectAreas.findById('area').is_collapsed).toBe(1)
  expect(h.fixtureErrors).toEqual([])
})

it.each(families)('ignores late status from a replaced %s channel in the same scope', async family => {
  const h = await setup(family), previous = h.channels[0]
  previous.status('CHANNEL_ERROR')
  await h.runTimers()
  expect(h.channels).toHaveLength(2)
  healthy(h)
  const before = h.stores.useSyncStore.getState(), timers = h.timers.size
  for (const status of ['CHANNEL_ERROR', 'SUBSCRIBED', 'CLOSED']) {
    previous.status(status)
    expect(h.stores.useSyncStore.getState()).toEqual(before)
  }
  await h.untilIdle()
  expect(h.stores.useSyncStore.getState()).toEqual(before)
  expect(h.timers.size).toBe(timers)
  expect(h.fixtureErrors).toEqual([])
})
