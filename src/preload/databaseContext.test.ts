import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TodoozyAPI } from './index.d'

const harness = vi.hoisted(() => ({ expose: vi.fn(), invoke: vi.fn(), events: new Map<string, (event: unknown, context: { generation: number; userId: string | null }) => void>() }))
vi.mock('electron', () => ({ contextBridge: { exposeInMainWorld: harness.expose }, ipcRenderer: { invoke: harness.invoke, on: (name: string, handler: (event: unknown, context: { generation: number; userId: string | null }) => void) => harness.events.set(name, handler) } }))
vi.mock('@electron-toolkit/preload', () => ({ electronAPI: {} }))
const originalContext = Object.getOwnPropertyDescriptor(process, 'contextIsolated')
const originalMain = Object.getOwnPropertyDescriptor(process, 'isMainFrame')
let api: TodoozyAPI
beforeEach(async () => {
  vi.resetModules(); harness.events.clear(); harness.expose.mockReset(); harness.invoke.mockReset()
  Object.defineProperty(process, 'contextIsolated', { value: true, configurable: true })
  Object.defineProperty(process, 'isMainFrame', { value: true, configurable: true })
  vi.stubGlobal('location', { href: pathToFileURL(join(__dirname, '../renderer/index.html')).href })
  const preload = './index'
  await import(preload)
  api = harness.expose.mock.calls.find(([name]) => name === 'api')![1]
})
afterEach(() => {
  vi.unstubAllGlobals()
  for (const [key, descriptor] of [['contextIsolated', originalContext], ['isMainFrame', originalMain]] as const) {
    if (descriptor) Object.defineProperty(process, key, descriptor)
    else delete (process as unknown as Record<string, unknown>)[key]
  }
})
it('seeds a synchronous scope from native capture and shares unchanged snapshots without notifications', async () => {
  const listener = vi.fn(), stop = api.sync.onContextChanged(listener)
  expect(api.sync.currentContext()).toBeNull()
  harness.invoke.mockResolvedValue({ generation: 1, userId: 'u' })
  await api.sync.captureContext(); await api.sync.captureContext()
  expect(api.sync.currentContext()).toBe('["u",1]')
  expect(listener).toHaveBeenCalledOnce()
  stop(); harness.events.get('sync:context-changed')!(null, { generation: 2, userId: 'u' })
  expect(api.sync.currentContext()).toBe('["u",2]')
  expect(listener).toHaveBeenCalledOnce()
})
it.each([false, true])('keeps a native scope announcement ahead of an older held capture (failure=%s)', async fail => {
  let resolve!: (value: unknown) => void, reject!: (error: Error) => void
  harness.invoke.mockReturnValue(new Promise((done, failed) => { resolve = done; reject = failed }))
  const pending = api.sync.captureContext().catch(error => error)
  const listener = vi.fn(); api.sync.onContextChanged(listener)
  harness.events.get('sync:context-changed')!(null, { generation: 2, userId: 'u' })
  expect(api.sync.currentContext()).toBe('["u",2]')
  if (fail) reject(Error('OLD PROBE ERROR'))
  else resolve({ generation: 1, userId: 'u' })
  await pending
  expect(api.sync.currentContext()).toBe('["u",2]')
  expect(listener).toHaveBeenCalledOnce()
  harness.events.get('sync:context-changed')!(null, { generation: 3, userId: null })
  expect(api.sync.currentContext()).toBe('[null,3]')
  expect(listener).toHaveBeenCalledTimes(2)
})

it('forwards optional project constraints and bulk task ownership through preload',async()=>{
  harness.invoke.mockResolvedValue([])
  await api.labels.getProjectLabelsForOwner('u','p')
  expect(harness.invoke).toHaveBeenLastCalledWith('labels:getProjectLabelsForOwner','u','p')
  await api.labels.getProjectLabelsForSharedProjects('p')
  expect(harness.invoke).toHaveBeenLastCalledWith('labels:getProjectLabelsForSharedProjects','p')
  await api.projects.getProjectsForUser('u','p')
  expect(harness.invoke).toHaveBeenLastCalledWith('projects:getProjectsForUser','u','p')
  await api.tasks.findByIds(['t','q'])
  expect(harness.invoke).toHaveBeenLastCalledWith('tasks:findByIds',['t','q'])
  await api.tasks.applyRemoteTaskLabels('t',['l'],[],'p')
  expect(harness.invoke).toHaveBeenLastCalledWith('tasks:applyRemoteTaskLabels','t',['l'],[],'p')
})
