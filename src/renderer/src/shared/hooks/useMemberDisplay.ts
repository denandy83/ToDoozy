import { hydrationContext, type HydrationOrigin } from '../stores/hydrationContext'
import { captureProjectProducer } from '../../services/syncContext'
import { useAuthStore } from '../stores/authStore'
import { useEffect, useState } from 'react'
import { useDatabaseScope } from './useDatabaseScope'
import { getAvatarColor, getAvatarInitials } from '../../../../shared/avatarUtils'

interface MemberDisplayData {
  color: string
  initials: string
  email: string
  display_name: string | null
}

type MemberContext = ReturnType<typeof hydrationContext>
interface MemberCache {
  ownerId: string | undefined
  scope: string
  context: MemberContext
  members: Map<string, MemberDisplayData>
}
const cache = new Map<string, MemberCache>()
const listeners = new Map<string, Set<() => void>>()
const activeLoads = new Map<string, { scope: string; context: MemberContext; done: Promise<void> }>()

function notify(projectId: string): void {
  for (const listener of listeners.get(projectId) ?? []) listener()
}

function currentMembers(projectId: string): Map<string, MemberDisplayData> | null {
  const entry = cache.get(projectId)
  if (!entry || entry.ownerId !== useAuthStore.getState().currentUser?.id || entry.scope !== window.api.sync.currentContext()) return null
  try { entry.context.assertCurrent() } catch { return null }
  return entry.members
}

async function loadProjectMembers(projectId: string, origin?: HydrationOrigin, refresh = false): Promise<void> {
  const context = hydrationContext(origin ?? captureProjectProducer(projectId), projectId)
  const database = window.api.sync.captureContext()
  const ownerId = useAuthStore.getState().currentUser?.id
  try {
    const initial = await database
    const scope = JSON.stringify([initial.userId, initial.generation])
    const current = async (): Promise<boolean> => await context.isCurrent() && window.api.sync.currentContext() === scope
    if (initial.userId !== ownerId || !await current()) return
    let pending = activeLoads.get(projectId)
    try { pending?.context.assertCurrent() } catch { pending = undefined }
    if (!refresh && pending?.scope === scope) {
      await pending.done
      if (currentMembers(projectId) || await pending.context.isCurrent() || !await current()) return
    }
    const job = { scope, context, done: Promise.resolve() }
    activeLoads.set(projectId, job)
    job.done = (async () => {
      try {
        if (refresh) { cache.delete(projectId); notify(projectId) }
        const members = await context.api.projects.getMembers(projectId)
        const memberMap = new Map<string, MemberDisplayData>()
        for (const member of members) {
          if (!await current() || activeLoads.get(projectId) !== job) return
          context.assertCurrent()
          const user = await context.api.users.findById(member.user_id)
          memberMap.set(member.user_id, {
            color: getAvatarColor(member.user_id, member.display_color),
            initials: getAvatarInitials(user?.display_name ?? null, user?.email ?? 'unknown', member.display_initials),
            email: user?.email ?? 'unknown',
            display_name: user?.display_name ?? null
          })
        }
        if (!await current() || activeLoads.get(projectId) !== job) return
        context.assertCurrent()
        cache.set(projectId, { ownerId, scope, context, members: memberMap })
        notify(projectId)
      } catch { return } finally {
        if (activeLoads.get(projectId) === job) activeLoads.delete(projectId)
      }
    })()
    await job.done
  } catch { return }
}

export function invalidateMemberDisplay(projectId: string, origin?: HydrationOrigin): void {
  void loadProjectMembers(projectId, origin, true)
}

export function getMemberDisplay(projectId: string, userId: string): MemberDisplayData | null {
  const members = currentMembers(projectId)
  if (!members) {
    void loadProjectMembers(projectId)
    return null
  }
  return members.get(userId) ?? null
}

function useMemberMap(projectId: string): Map<string, MemberDisplayData> | null {
  const ownerId = useAuthStore(state => state.currentUser?.id)
  const scope = useDatabaseScope()
  const [, setTick] = useState(0)
  const members = currentMembers(projectId)
  useEffect(() => {
    const listener = (): void => setTick(t => t + 1)
    const subscriptions = listeners.get(projectId) ?? new Set<() => void>()
    subscriptions.add(listener)
    listeners.set(projectId, subscriptions)
    return () => {
      subscriptions.delete(listener)
      if (!subscriptions.size) listeners.delete(projectId)
    }
  }, [projectId])
  useEffect(() => { if (!members) void loadProjectMembers(projectId) }, [projectId, ownerId, scope, members])
  return members
}

export function useMemberDisplay(projectId: string, userId: string): MemberDisplayData {
  return useMemberMap(projectId)?.get(userId) ?? {
    color: getAvatarColor(userId),
    initials: userId.slice(0, 2).toUpperCase(),
    email: 'unknown',
    display_name: null
  }
}

export function useProjectMemberDisplays(projectId: string): Map<string, MemberDisplayData> {
  return useMemberMap(projectId) ?? new Map()
}
