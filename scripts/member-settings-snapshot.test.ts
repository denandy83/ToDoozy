import { createRequire } from 'node:module'
import { act, createElement, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { JSDOM } from 'jsdom'
import { afterAll, expect, it, vi } from 'vitest'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://127.0.0.1/' })
vi.stubGlobal('window', dom.window)
vi.stubGlobal('document', dom.window.document)
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterAll(() => { dom.window.close(); vi.unstubAllGlobals() })
const require = createRequire(import.meta.url)
const { makeHarness } = require('./benchmark-sync.cjs')
const tick = (): Promise<void> => new Promise(setImmediate)
async function settle(): Promise<void> { for (let i = 0; i < 30; i++) await tick() }
async function bounded<T>(work: PromiseLike<T>, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), 5000) })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
function gate(): { entered: Promise<void>; wait: Promise<void>; enter(): void; release(): void } {
  let enter!: () => void, release!: () => void
  return {
    entered: new Promise(resolve => { enter = resolve }),
    wait: new Promise(resolve => { release = resolve }),
    enter: () => enter(), release: () => release()
  }
}

it.each(['normal', 'held-hook', 'held-discovery', 'warm-hook', 'during-writer'])(
  'keeps actual Member Settings current without superseding a writer (%s)',
  async mode => {
    const h = await makeHarness({ projectCount: 1, shared: 1, sharedHook: true, connected: false })
    const pause = gate(), host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    let settings = false, held = false
    try {
      h.repo.users.create({ id: 'settings-x', email: 'removed-x@example.invalid', display_name: 'REMOVED PRIVATE X', avatar_url: null })
      h.repo.projects.addMember('p0', 'settings-x', 'member')
      h.remote.project_members.push({ ...h.repo.projects.getMembers('p0').find((row: { user_id: string }) => row.user_id === 'settings-x') })
      h.stores.useProjectStore.getState().setCurrentProject('p0')
      const project = h.repo.projects.findById('p0')
      function Shared(): null {
        const selected = h.stores.useProjectStore((state: { currentProjectId: string }) => state.currentProjectId)
        const projects = h.stores.useProjectStore((state: { projects: Record<string, unknown> }) => state.projects)
        const user = h.stores.useAuthStore((state: { currentUser: unknown }) => state.currentUser)
        h.services.useSharedProjectRealtime(selected ? projects[selected] : null, user)
        return null
      }
      const screen = (): ReactElement => createElement('div', null, createElement(Shared), settings
        ? createElement('section', { id: 'settings' }, createElement(h.services.MemberSettings, { project, onToast: () => {} }))
        : null)
      const settingsNode = (): HTMLElement => host.querySelector('#settings')!
      // Bound cold startup as well as the held paths. A writer must not keep
      // scheduling itself after publishing the same authoritative roster.
      let coldRequests = 0, coldBudgetExceeded = false
      const observeColdRequest = (): void => {
        coldRequests += 1
        if (coldRequests > 80) {
          coldBudgetExceeded = true
          throw new Error('Cold shared roster exceeded 80 SDK requests')
        }
        h.beforeRequest(observeColdRequest)
      }
      h.beforeRequest(observeColdRequest)
      await bounded(act(async () => { root.render(screen()); await settle() }), 'cold shared roster')
      await bounded(act(async () => { await h.untilIdle() }), 'cold shared roster idle')
      h.beforeRequest(null)
      expect(coldBudgetExceeded, `cold shared roster made ${coldRequests} requests`).toBe(false)
      const channel = h.channels.find((row: { closed: boolean; topic: string }) => !row.closed && row.topic === 'project:p0')
      expect(channel).toBeTruthy()
      const hold = mode.startsWith('held') || mode === 'during-writer'
      const holdProfileRequest = async (row: { table: string }): Promise<void> => {
        if (held) return
        // beforeRequest is one-shot; membership pagination precedes the RPC.
        if (row.table !== 'get_user_profiles') {
          h.beforeRequest(holdProfileRequest)
          return
        }
        held = true
        pause.enter()
        await pause.wait
      }
      if (hold) h.beforeRequest(holdProfileRequest)
      const removeRemote = (): void => {
        h.remote.project_members = h.remote.project_members.filter((row: { user_id: string }) => row.user_id !== 'settings-x')
      }
      if (mode === 'during-writer') {
        removeRemote()
        await act(async () => { channel.emit('project_members', 'DELETE', { project_id: 'p0', user_id: 'settings-x' }); await settle() })
        await bounded(pause.entered, 'held writer profile request')
      }
      settings = true
      await act(async () => { root.render(screen()); await settle() })
      if (mode.startsWith('held')) await bounded(pause.entered, 'held settings profile request')
      else if (!hold) await bounded(act(async () => { await h.untilIdle() }), 'settings load')
      if (mode === 'warm-hook' || mode === 'normal') expect(settingsNode().textContent).toContain('REMOVED PRIVATE X')
      if (mode !== 'normal' && mode !== 'during-writer') {
        removeRemote()
        await act(async () => {
          if (mode === 'held-discovery') await h.services.shared.discoverRemoteMemberships('u', await h.context(), project)
          else channel.emit('project_members', 'DELETE', { project_id: 'p0', user_id: 'settings-x' })
          await settle()
        })
        expect(h.repo.projects.getMembers('p0').some((row: { user_id: string }) => row.user_id === 'settings-x')).toBe(false)
        expect(settingsNode().textContent).not.toContain('REMOVED PRIVATE X')
      }
      await bounded(act(async () => { pause.release(); await h.untilIdle() }), 'released profile completion')
      expect(settingsNode().querySelector('.animate-spin')).toBeNull()
      expect(settingsNode().textContent).toContain('Members')
      if (mode !== 'normal') {
        expect(settingsNode().textContent).not.toContain('REMOVED PRIVATE X')
        expect(settingsNode().textContent).not.toContain('removed-x@example.invalid')
        expect(h.repo.projects.getMembers('p0').some((row: { user_id: string }) => row.user_id === 'settings-x')).toBe(false)
      }
      expect(h.fixtureErrors).toEqual([])
      const count = h.requests.length
      await bounded(act(async () => { root.render(screen()); await h.untilIdle() }), 'stable settings rerender')
      expect(h.requests.length).toBe(count)
    } finally {
      pause.release()
      await bounded(act(async () => root.unmount()), 'settings unmount')
      host.remove()
      await bounded(h.stop(), 'harness stop')
    }
  }, 20000
)
