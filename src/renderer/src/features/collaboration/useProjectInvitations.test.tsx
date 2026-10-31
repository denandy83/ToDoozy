// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { User } from '../../../../shared/types'
import { useProjectInvitations } from './useProjectInvitations'
import { InviteDialog } from './InviteDialog'
import { observeDatabaseScope, useAuthStore } from '../../shared/stores/authStore'
import { useProjectStore } from '../../shared/stores/projectStore'
import { useViewStore } from '../../shared/stores/viewStore'
import * as service from '../../services/SyncService'

vi.mock('../../services/SyncService', () => ({
  acceptInvite: vi.fn(), declineInvite: vi.fn(), checkPendingInvites: vi.fn(),
  subscribeToInvites: vi.fn(), subscribeToProject: vi.fn(), validateInviteToken: vi.fn()
}))
vi.mock('../../services/syncContext', async original => {
  const actual = await original<typeof import('../../services/syncContext')>()
  return { ...actual, syncContextFromProducer: async (origin: import('../../services/syncContext').SyncProducer) => {
    await actual.requireProducerCurrent(origin)
    return { api: origin.api, assertCurrent: origin.assertCurrent, isCurrent: origin.isCurrent, scope: await origin.scope(), client: {} }
  } }
})
const user = (id: string): User => ({ id, email: id + '@example.invalid', display_name: null, avatar_url: null, created_at: '', updated_at: '' })
const alice = user('a'), bob = user('b')
const pending = (token: string): Awaited<ReturnType<typeof service.checkPendingInvites>>[number] => ({ token, projectId: token, projectName: token, ownerEmail: 'owner-' + token, expiresAt: '2099-01-01' })
const detail = (token: string): NonNullable<Awaited<ReturnType<typeof service.validateInviteToken>>> => ({ inviteId: token, projectId: token, projectName: token, ownerName: 'owner-' + token, valid: true, expired: false })
function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void } {
  let resolve!: (value: T) => void, reject!: (error: Error) => void
  const promise = new Promise<T>((yes,no) => { resolve=yes; reject=no })
  return { promise, resolve, reject }
}
let host: HTMLDivElement, root: Root, generation: number
let deepLink: ((token: string) => void | Promise<void>) | undefined
const hydrate = vi.fn(async () => {})
const originalHydrate = useProjectStore.getState().hydrateProjects
function Screen(): React.JSX.Element {
  const controller = useProjectInvitations()
  return createElement('div', null, controller.invite && createElement(InviteDialog, {
    ...controller.invite, busy: controller.busy, error: controller.error,
    onAccept: controller.accept, onDecline: controller.decline
  }))
}
async function mount(): Promise<void> { await act(async () => root.render(createElement(Screen))) }
async function open(token: string): Promise<void> { await act(async () => { await deepLink?.(token) }) }
function button(label: string): HTMLButtonElement { return [...host.querySelectorAll('button')].find(button => button.textContent === label)! }
async function click(label: string): Promise<void> { await act(async () => { button(label).click() }) }
beforeEach(() => {
  vi.clearAllMocks(); generation=1; deepLink=undefined
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  useAuthStore.setState({ currentUser: alice, isAuthenticated: true, isOffline: false })
  useProjectStore.setState({ hydrateProjects: hydrate })
  useViewStore.setState({ currentView: 'project', selectedProjectId: 'current-project' })
  vi.mocked(service.checkPendingInvites).mockResolvedValue([])
  vi.mocked(service.validateInviteToken).mockImplementation(async token => detail(token))
  vi.mocked(service.subscribeToInvites).mockResolvedValue(vi.fn())
  vi.mocked(service.subscribeToProject).mockResolvedValue(undefined)
  vi.mocked(service.acceptInvite).mockResolvedValue('accepted-project')
  vi.mocked(service.declineInvite).mockResolvedValue(undefined)
  vi.stubGlobal('window', Object.assign(window, { api: {
    onInviteReceived: (callback: typeof deepLink) => { deepLink=callback; return () => { if (deepLink === callback) deepLink=undefined } },
    sync: { currentContext: () => JSON.stringify([useAuthStore.getState().currentUser?.id ?? null, generation]), onContextChanged: () => () => {}, captureContext: async () => ({ userId: useAuthStore.getState().currentUser?.id, generation }) }
  } }))
  observeDatabaseScope()
  useProjectStore.setState({ hydrateProjects: hydrate })
  useViewStore.setState({ currentView: 'project', selectedProjectId: 'current-project' })
  host=document.createElement('div'); document.body.append(host); root=createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove()
  useProjectStore.setState({ hydrateProjects: originalHydrate }); vi.unstubAllGlobals()
})
it('accepts and declines current-account queued invites without losing the next one', async () => {
  vi.mocked(service.checkPendingInvites).mockResolvedValue([pending('first'),pending('second')])
  await mount(); expect(host.textContent).toContain('first')
  await click('Accept')
  expect(hydrate).toHaveBeenCalledWith('a',expect.objectContaining({ userId:'a' }))
  expect(useViewStore.getState().selectedProjectId).toBe('accepted-project')
  expect(host.textContent).toContain('second')
  await click('Decline'); expect(host.querySelector('button')).toBeNull()
})
it.each(['Accept','Decline'])('keeps %s failure visible and retryable', async action => {
  const method = action === 'Accept' ? vi.mocked(service.acceptInvite) : vi.mocked(service.declineInvite)
  method.mockRejectedValueOnce(new Error('Backend unavailable'))
  await mount(); await open('retryable'); await click(action)
  expect(host.textContent).toContain('retryable')
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('Backend unavailable')
  expect(button(action).disabled).toBe(false)
  await click(action); expect(host.querySelector('button')).toBeNull()
})
it('closes an expired invitation locally without a failed backend mutation', async () => {
  vi.mocked(service.validateInviteToken).mockResolvedValue(null)
  await mount(); await open('expired'); expect(host.textContent).toContain('Invite Expired')
  await click('OK'); expect(service.declineInvite).not.toHaveBeenCalled(); expect(host.querySelector('button')).toBeNull()
})
it('hides the loaded old-account modal and discards its queue on account change', async () => {
  vi.mocked(service.checkPendingInvites).mockResolvedValueOnce([pending('A PRIVATE ONE'),pending('A PRIVATE TWO')])
  await mount(); expect(host.textContent).toContain('A PRIVATE ONE')
  await act(async () => useAuthStore.setState({ currentUser:bob }))
  expect(host.textContent).not.toContain('A PRIVATE')
  await open('B visible'); await click('Decline'); expect(host.textContent).not.toContain('A PRIVATE')
})
it.each(['account','generation'])('discards a late pending response after %s changes', async kind => {
  const held=deferred<Awaited<ReturnType<typeof service.checkPendingInvites>>>()
  vi.mocked(service.checkPendingInvites).mockReturnValueOnce(held.promise)
  await mount()
  await act(async () => { if (kind === 'account') useAuthStore.setState({ currentUser:bob }); else generation++ })
  await act(async () => held.resolve([pending('A PRIVATE')]))
  expect(host.textContent).not.toContain('A PRIVATE')
})
it.each(['account','generation'])('discards a late deep-link response after %s changes', async kind => {
  const held=deferred<Awaited<ReturnType<typeof service.validateInviteToken>>>()
  vi.mocked(service.validateInviteToken).mockReturnValueOnce(held.promise)
  await mount(); let operation: void | Promise<void>
  await act(async () => { operation=deepLink?.('old') })
  await act(async () => { if (kind === 'account') useAuthStore.setState({ currentUser:bob }); else generation++ })
  await act(async () => { held.resolve(detail('A PRIVATE')); await operation })
  expect(host.textContent).not.toContain('A PRIVATE')
})
it('keeps the newer deep link when earlier validation or pending discovery finishes last', async () => {
  const validation=deferred<Awaited<ReturnType<typeof service.validateInviteToken>>>()
  const discovery=deferred<Awaited<ReturnType<typeof service.checkPendingInvites>>>()
  vi.mocked(service.validateInviteToken).mockReturnValueOnce(validation.promise)
  vi.mocked(service.checkPendingInvites).mockReturnValueOnce(discovery.promise)
  await mount(); let old: void | Promise<void>
  await act(async () => { old=deepLink?.('old-link') })
  await open('new-link')
  await act(async () => { validation.resolve(detail('old-link')); discovery.resolve([pending('inbox-item')]); await old })
  expect(host.textContent).toContain('new-link'); expect(host.textContent).not.toContain('old-link')
  await click('Decline'); expect(host.textContent).toContain('inbox-item')
})
it.each(['Accept','Decline'].flatMap(action => [false,true].map(failure => ({action,failure}))))('preserves a newer token after old $action settles (failure=$failure)', async ({action,failure}) => {
  const held=deferred<string | void>()
  if (action === 'Accept') vi.mocked(service.acceptInvite).mockImplementationOnce(async () => String(await held.promise))
  else vi.mocked(service.declineInvite).mockImplementationOnce(async () => { await held.promise })
  await mount(); await open('old-token'); await click(action); await open('new-token')
  await act(async () => { if (failure) held.reject(new Error('Old private error')); else held.resolve('old-project') })
  expect(host.textContent).toContain('new-token'); expect(host.textContent).not.toContain('Old private error')
  expect(hydrate).not.toHaveBeenCalled(); expect(useViewStore.getState().selectedProjectId).toBe('current-project')
})
it.each(['Accept','Decline'].flatMap(action => ['account','generation'].flatMap(kind => [false,true].map(failure => ({action,kind,failure})))) )('blocks stale $action after $kind replacement (failure=$failure)', async ({action,kind,failure}) => {
  const held=deferred<string | void>()
  if (action === 'Accept') vi.mocked(service.acceptInvite).mockImplementationOnce(async () => String(await held.promise))
  else vi.mocked(service.declineInvite).mockImplementationOnce(async () => { await held.promise })
  vi.mocked(service.checkPendingInvites).mockResolvedValueOnce([pending('A PRIVATE ONE'),pending('A PRIVATE TWO')])
  await mount(); await click(action)
  await act(async () => {
    if (kind === 'account') useAuthStore.setState({ currentUser:bob }); else generation++
    observeDatabaseScope()
    // The normal account reset clears A's selection; seed B's own state before releasing A.
    useViewStore.setState({ currentView:'project', selectedProjectId:'current-project' })
  })
  await act(async () => { if (failure) held.reject(new Error('A private error')); else held.resolve('A-project') })
  expect(host.textContent).not.toContain('A PRIVATE TWO'); expect(host.textContent).not.toContain('A private error')
  if (kind === 'account') expect(host.textContent).not.toContain('A PRIVATE ONE')
  expect(hydrate).not.toHaveBeenCalled(); expect(service.subscribeToProject).not.toHaveBeenCalled()
  expect(useViewStore.getState().selectedProjectId).toBe('current-project')
})
it('immediately invokes an unsubscriber that arrives after account cleanup', async () => {
  const held=deferred<() => void>(), oldStop=vi.fn(), currentStop=vi.fn()
  vi.mocked(service.subscribeToInvites).mockReturnValueOnce(held.promise).mockResolvedValue(currentStop)
  await mount(); await act(async () => useAuthStore.setState({ currentUser:bob }))
  await act(async () => held.resolve(oldStop))
  expect(oldStop).toHaveBeenCalledOnce(); expect(currentStop).not.toHaveBeenCalled()
})

it('rebinds after a known same-account database replacement instead of leaving a busy dialog stuck', async () => {
  const held=deferred<void>()
  vi.mocked(service.declineInvite).mockReturnValueOnce(held.promise)
  await mount(); await open('old-database'); await click('Decline')
  expect(button('Decline').disabled).toBe(true)
  generation++
  await act(async () => held.resolve())
  expect(host.querySelector('button')).toBeNull()
  await open('new-database')
  expect(host.textContent).toContain('new-database')
  expect(button('Decline').disabled).toBe(false)
  await click('Decline'); expect(host.querySelector('button')).toBeNull()
})
