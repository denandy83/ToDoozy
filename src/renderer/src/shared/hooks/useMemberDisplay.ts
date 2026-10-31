import { hydrationContext, type HydrationOrigin } from '../stores/hydrationContext'
import { useAuthStore } from '../stores/authStore'
import { useEffect, useState } from 'react'
import { getAvatarColor, getAvatarInitials } from '../../../../shared/avatarUtils'

interface MemberDisplayData {
  color: string
  initials: string
  email: string
  display_name: string | null
}

// Global cache: projectId -> userId -> display data
const cache = new Map<string, { ownerId: string | undefined; current(id: string): boolean; members: Map<string, MemberDisplayData> }>()
const listeners = new Set<() => void>()
// Track pending reload requests — if a load is in progress and another is requested,
// the project ID is queued here so it reloads again after the current one finishes.
let pendingReload: { projectId: string; origin: HydrationOrigin } | null = null
let activeLoad: string | null = null

function notify(): void {
  for (const fn of listeners) fn()
}

async function loadProjectMembers(projectId: string, origin?: HydrationOrigin): Promise<void> {
  const context = hydrationContext(origin, projectId)
  const ownerId = useAuthStore.getState().currentUser?.id
  // If already loading this project, queue a reload instead of skipping
  if (activeLoad === projectId) {
    pendingReload = { projectId, origin: context }
    return
  }
  activeLoad = projectId
  try {
    if (!await context.isCurrent()) return
    context.assertCurrent()
    const members = await context.api.projects.getMembers(projectId)
    const memberMap = new Map<string, MemberDisplayData>()
    for (const m of members) {
      if (!await context.isCurrent()) return
      context.assertCurrent()
      const user = await context.api.users.findById(m.user_id)
      memberMap.set(m.user_id, {
        color: getAvatarColor(m.user_id, m.display_color),
        initials: getAvatarInitials(user?.display_name ?? null, user?.email ?? 'unknown', m.display_initials),
        email: user?.email ?? 'unknown',
        display_name: user?.display_name ?? null
      })
    }
    if (!await context.isCurrent()) return
    context.assertCurrent()
    cache.set(projectId, { ownerId, current: context.isProjectCurrent, members: memberMap })
    notify()
  } catch { return } finally {
    activeLoad = null
    // If a reload was requested while we were loading, do it now
    if (pendingReload?.projectId === projectId) {
      const pending = pendingReload
      pendingReload = null
      void loadProjectMembers(projectId, pending.origin)
    }
  }
}

/** Invalidate cache for a project — call after updating member display settings */
export function invalidateMemberDisplay(projectId: string, origin?: HydrationOrigin): void {
  cache.delete(projectId)
  void loadProjectMembers(projectId, origin)
}

/** Get cached display data for a member. Returns defaults if not yet loaded. */
export function getMemberDisplay(projectId: string, userId: string): MemberDisplayData | null {
  const entry = cache.get(projectId)
  const projectMap = entry?.ownerId === useAuthStore.getState().currentUser?.id && entry?.current(projectId) ? entry.members : null
  if (!projectMap) {
    loadProjectMembers(projectId)
    return null
  }
  return projectMap.get(userId) ?? null
}

/** Hook that subscribes to member display cache updates */
export function useMemberDisplay(projectId: string, userId: string): MemberDisplayData {
  const [, setTick] = useState(0)

  useEffect(() => {
    const fn = (): void => setTick((t) => t + 1)
    listeners.add(fn)
    if (!cache.has(projectId)) loadProjectMembers(projectId)
    return () => { listeners.delete(fn) }
  }, [projectId])

  const entry = cache.get(projectId)
  const data = entry?.ownerId === useAuthStore.getState().currentUser?.id && entry?.current(projectId) ? entry.members.get(userId) : undefined
  return data ?? {
    color: getAvatarColor(userId),
    initials: userId.slice(0, 2).toUpperCase(),
    email: 'unknown',
    display_name: null
  }
}

/** Hook that returns all members' display data for a project */
export function useProjectMemberDisplays(projectId: string): Map<string, MemberDisplayData> {
  const [, setTick] = useState(0)

  useEffect(() => {
    const fn = (): void => setTick((t) => t + 1)
    listeners.add(fn)
    if (!cache.has(projectId)) loadProjectMembers(projectId)
    return () => { listeners.delete(fn) }
  }, [projectId])

  const entry = cache.get(projectId)
  return entry?.ownerId === useAuthStore.getState().currentUser?.id && entry?.current(projectId) ? entry.members : new Map()
}
