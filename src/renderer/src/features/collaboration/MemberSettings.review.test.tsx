// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { MemberSettings } from './MemberSettings'
import { useAuthStore } from '../../shared/stores/authStore'
import { updateSharedMemberDisplay } from '../../services/SyncService'
import type { Project } from '../../../../shared/types'

vi.mock('../../services/SyncService', () => ({
  getSharedProjectMembers: vi.fn(async () => [{ user_id: 'peer', role: 'owner', email: 'peer@example.invalid', display_name: 'Peer' }]),
  updateSharedMemberDisplay: vi.fn(async () => {}),
  generateInviteLink: vi.fn(), removeSharedMember: vi.fn(), removeProjectFromSupabase: vi.fn(), unsubscribeFromProject: vi.fn()
}))
vi.mock('../../shared/hooks/useMemberDisplay', () => ({ invalidateMemberDisplay: vi.fn() }))
let host: HTMLDivElement, root: Root
const update = vi.fn(async () => {})
const project = { id: 'p', owner_id: 'peer', is_shared: 1 } as Project
beforeEach(() => {
  vi.clearAllMocks()
  useAuthStore.setState({ currentUser: { id: 'u' } as never })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('window', Object.assign(window, { api: {
    projects: { getMembers: async () => [] },
    sync: { captureContext: async () => ({ userId: 'u', generation: 1 }), invokeContext: async () => update() }
  } }))
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it.each([false, true])('reports peer appearance save honestly (cloud failure=%s)', async failure => {
  if (failure) vi.mocked(updateSharedMemberDisplay).mockRejectedValueOnce(new Error('No row updated'))
  const toast = vi.fn()
  await act(async () => root.render(createElement(MemberSettings, { project, onToast: toast })))
  await act(async () => (host.querySelector('[title="Click to customize"]') as HTMLButtonElement).click())
  const save = [...host.querySelectorAll('button')].find(button => button.textContent === 'Save')!
  await act(async () => save.click())
  expect(updateSharedMemberDisplay).toHaveBeenCalledWith('p', 'peer', null, null, expect.objectContaining({ userId: 'u' }))
  if (failure) {
    expect(update).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('Failed to update member appearance')
    expect(toast).not.toHaveBeenCalledWith('Member appearance updated')
    expect([...host.querySelectorAll('button')].some(button => button.textContent === 'Save')).toBe(true)
  } else {
    expect(update).toHaveBeenCalledOnce()
    expect(toast).toHaveBeenCalledWith('Member appearance updated')
  }
})
