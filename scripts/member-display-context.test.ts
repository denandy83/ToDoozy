import { createRequire } from 'node:module'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterAll, afterEach, expect, it, vi } from 'vitest'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' })
vi.stubGlobal('window', dom.window); vi.stubGlobal('document', dom.window.document)
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterAll(() => { dom.window.close(); vi.unstubAllGlobals() })
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
type Harness = Awaited<ReturnType<typeof makeHarness>>
const opened: Array<{ h: Harness; root: Root; host: HTMLDivElement }> = []
afterEach(async () => { for (const item of opened.splice(0)) { await act(async () => item.root.unmount()); item.host.remove(); await item.h.stop() } })
function gate() {
  let enter!: () => void, release!: () => void
  return { entered: new Promise<void>(resolve => { enter = resolve }), wait: new Promise<void>(resolve => { release = resolve }), enter: () => enter(), release: () => release() }
}
function profile(h: Harness, value: string) {
  h.repo.users.update('other', { email: value+'@example.invalid', display_name: value })
  for (const id of ['p0', 'p1']) h.repo.projects.updateMember(id, 'other', { display_color: value === 'PRIVATE-A' ? '#111111' : '#222222', display_initials: value === 'PRIVATE-A' ? 'AA' : 'BB' })
}
async function setup(mode = 'single') {
  const h = await makeHarness({ projectCount: 2, shared: 2, sharedHook: true, connected: false })
  profile(h, 'PRIVATE-A')
  h.stores.useProjectStore.setState({ currentProjectId: 'p1' })
  expect(h.services.getMemberDisplay('p0', 'other')).toBeNull()
  await h.untilIdle()
  expect(h.services.getMemberDisplay('p0', 'other').email).toBe('PRIVATE-A@example.invalid')
  const host = document.createElement('div'); document.body.append(host)
  const frames: string[] = [], root = createRoot(host)
  opened.push({ h, root, host })
  function Screen() {
    const value = mode === 'single' ? h.services.useMemberDisplay('p0', 'other') : Object.fromEntries(h.services.useProjectMemberDisplays('p0'))
    const text = JSON.stringify(value); frames.push(text)
    return createElement('div', null, text)
  }
  await act(async () => { root.render(createElement(Screen)); await h.untilIdle() })
  return { h, root, host, frames, Screen }
}
function hold(h: Harness, boundary: string, fail: boolean) {
  const pause = gate()
  if (boundary === 'probe') {
    const api = h.sandbox.window.api; let held = false
    h.sandbox.window.api = new Proxy(api, { get(target, namespace) {
      if (namespace !== 'sync') return target[namespace]
      return new Proxy(target.sync, { get(sync, method) {
        if (method !== 'captureContext') return sync[method]
        return async () => {
          const value = await sync.captureContext()
          if (!held) { held = true; pause.enter(); await pause.wait; if (fail) throw Error('PRIVATE OLD ERROR') }
          return value
        }
      } })
    } })
  } else {
    const namespace = boundary === 'members' ? 'projects' : 'users', method = boundary === 'members' ? 'getMembers' : 'findById'
    const original = h.repo[namespace][method].bind(h.repo[namespace]); let held = false
    h.repo[namespace][method] = async (...args: unknown[]) => {
      const value = original(...args)
      if (!held) { held = true; pause.enter(); await pause.wait; if (fail) throw Error('PRIVATE OLD ERROR') }
      return value
    }
  }
  return pause
}
function expectCurrent(f: Awaited<ReturnType<typeof setup>>) {
  expect(f.host.textContent).toContain('CURRENT-DATABASE')
  expect(f.host.textContent).not.toContain('PRIVATE-A')
  expect(f.h.services.getMemberDisplay('p0', 'other')).toMatchObject({ email: 'CURRENT-DATABASE@example.invalid', display_name: 'CURRENT-DATABASE', color: '#222222', initials: 'BB' })
  expect(f.h.fixtureErrors).toEqual([])
}

it.each(['single', 'many'].flatMap(mode => ['generation', 'account'].flatMap(change => [false, true].map(remount => ({ mode, change, remount })))))(
  'recovers a warm $mode cache after $change with remount=$remount before exposing fields', async ({ mode, change, remount }) => {
    const f = await setup(mode), owner = f.h.stores.useAuthStore.getState().currentUser, pause = hold(f.h, 'members', false)
    const offset = f.frames.length
    profile(f.h, 'CURRENT-DATABASE')
    await act(async () => {
      if (change === 'generation') f.h.replaceDatabase()
      else f.h.setAccount('other')
      if (remount) { f.root.unmount(); f.root = createRoot(f.host); opened[opened.length-1].root = f.root }
      f.root.render(createElement(f.Screen)); await new Promise(setImmediate)
    })
    await pause.entered
    expect(f.host.textContent).not.toContain('PRIVATE-A')
    expect(f.frames.slice(offset).every(frame => !frame.includes('PRIVATE-A'))).toBe(true)
    expect(f.h.services.getMemberDisplay('p0', 'other')).toBeNull()
    if (change === 'generation') expect(f.h.stores.useAuthStore.getState().currentUser).toBe(owner)
    await act(async () => { pause.release(); await f.h.untilIdle() })
    expectCurrent(f)
  })

it.each(['generation', 'account'])('automatically reloads the direct getter across %s with no selected-project refresh', async change => {
  const f = await setup(), pause = hold(f.h, 'members', false)
  await act(async () => f.root.unmount())
  f.root = createRoot(f.host); opened[opened.length-1].root = f.root
  profile(f.h, 'CURRENT-DATABASE')
  await act(async () => {
    if (change === 'generation') f.h.replaceDatabase()
    else f.h.setAccount('other')
    expect(f.h.services.getMemberDisplay('p0', 'other')).toBeNull()
    await new Promise(setImmediate)
  })
  await pause.entered
  await act(async () => { pause.release(); await f.h.untilIdle() })
  expect(f.h.services.getMemberDisplay('p0', 'other')).toMatchObject({ email: 'CURRENT-DATABASE@example.invalid', color: '#222222', initials: 'BB' })
  expect(f.h.fixtureErrors).toEqual([])
})

it.each(['members', 'profile', 'probe'].flatMap(boundary => ['generation', 'account', 'eviction', 'cancel'].flatMap(change => [false, true].map(fail => ({ boundary, change, fail })))))(
  'retains fresh cache after stale $boundary completion across $change (failure=$fail)', async ({ boundary, change, fail }) => {
    const f = await setup('many'), parent = f.h.services.memberHydrationContext(f.h.producer(), 'p0'), pause = hold(f.h, boundary, fail)
    let active = true
    const origin = { ...parent, isCurrent: async () => active && await parent.isCurrent(), assertCurrent: () => { parent.assertCurrent(); if (!active) throw Error('CANCELED ORIGIN') } }
    await act(async () => { f.h.services.invalidateMemberDisplay('p0', origin); await new Promise(setImmediate) })
    await pause.entered
    await act(async () => {
      profile(f.h, 'CURRENT-DATABASE')
      if (change === 'generation') f.h.replaceDatabase()
      else if (change === 'account') f.h.setAccount('other')
      else if (change === 'eviction') f.h.services.evictProjectData('p0')
      else active = false
      f.h.services.invalidateMemberDisplay('p0')
      await f.h.untilIdle()
    })
    expectCurrent(f)
    const calls = f.h.nativeCalls.length, frames = f.frames.length
    await act(async () => { pause.release(); await f.h.untilIdle() })
    expectCurrent(f)
    expect(f.h.nativeCalls.slice(calls)).toEqual([])
    expect(f.frames.slice(frames).every(frame => !frame.includes('PRIVATE-A'))).toBe(true)
    await act(async () => { f.h.services.invalidateMemberDisplay('p0', origin); await f.h.untilIdle() })
    expectCurrent(f)
  })

it('shares one current native load between both hooks and preserves warm data across valid user-object replacement', async () => {
  const f = await setup('many')
  function Pair() {
    const one = f.h.services.useMemberDisplay('p1', 'other')
    const two = f.h.services.useProjectMemberDisplays('p1')
    const three = f.h.services.useMemberDisplay('p1', 'u')
    return createElement('div', null, JSON.stringify([one, Object.fromEntries(two), three]))
  }
  const offset = f.h.nativeCalls.length
  await act(async () => { f.root.render(createElement(Pair)); await f.h.untilIdle() })
  const loads = f.h.nativeCalls.slice(offset).filter((call: { namespace: string; method: string; args: unknown[] }) => call.namespace === 'projects' && call.method === 'getMembers' && call.args[0] === 'p1')
  expect(loads).toHaveLength(1)
  const count = f.h.nativeCalls.length
  await act(async () => {
    f.h.stores.useAuthStore.setState({ currentUser: { ...f.h.stores.useAuthStore.getState().currentUser } })
    f.root.render(createElement(Pair)); await f.h.untilIdle()
  })
  expect(f.h.nativeCalls.length).toBe(count)
  expect(f.h.services.getMemberDisplay('p1', 'other').email).toBe('PRIVATE-A@example.invalid')
})

it('does not let a held P load suppress Q or overwrite a newer P refresh', async () => {
  const f = await setup(), pause = hold(f.h, 'members', false)
  await act(async () => { f.h.services.invalidateMemberDisplay('p0'); await new Promise(setImmediate) })
  await pause.entered
  profile(f.h, 'CURRENT-DATABASE')
  expect(f.h.services.getMemberDisplay('p1', 'other')).toBeNull()
  await act(async () => { f.h.services.invalidateMemberDisplay('p0'); await f.h.untilIdle() })
  expect(f.h.services.getMemberDisplay('p1', 'other').email).toBe('CURRENT-DATABASE@example.invalid')
  expectCurrent(f)
  await act(async () => { pause.release(); await f.h.untilIdle() })
  expectCurrent(f)
})

it('keeps a current load failure at the default state without a reload loop and retries on remount', async () => {
  const f = await setup(), original = f.h.repo.projects.getMembers.bind(f.h.repo.projects)
  let reads = 0
  f.h.repo.projects.getMembers = () => { reads++; throw Error('CURRENT LOAD ERROR') }
  await act(async () => { profile(f.h, 'CURRENT-DATABASE'); f.h.replaceDatabase(); await f.h.untilIdle() })
  expect(f.host.textContent).not.toContain('PRIVATE-A')
  expect(f.host.textContent).toContain('unknown')
  const failedReads = reads
  await act(async () => { f.root.render(createElement(f.Screen)); await f.h.untilIdle() })
  expect(reads).toBe(failedReads)
  f.h.repo.projects.getMembers = original
  await act(async () => {
    f.root.unmount(); f.root = createRoot(f.host); opened[opened.length-1].root = f.root
    f.root.render(createElement(f.Screen)); await f.h.untilIdle()
  })
  expectCurrent(f)
})
