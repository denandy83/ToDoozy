import { useEffect, useState } from 'react'
import { getAvatarColor, getAvatarInitials } from '../../../../shared/avatarUtils'

interface MemberDisplayData {
  color: string
  initials: string
  email: string
  display_name: string | null
}

// Global cache: projectId -> userId -> display data
const cache = new Map<string, Map<string, MemberDisplayData>>()
const loadingProjects = new Set<string>()
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

async function loadProjectMembers(projectId: string): Promise<void> {
  if (loadingProjects.has(projectId)) return
  loadingProjects.add(projectId)
  try {
    const members = await window.api.projects.getMembers(projectId)
    const memberMap = new Map<string, MemberDisplayData>()
    for (const m of members) {
      const user = await window.api.users.findById(m.user_id)
      memberMap.set(m.user_id, {
        color: getAvatarColor(m.user_id, m.display_color),
        initials: getAvatarInitials(user?.display_name ?? null, user?.email ?? 'unknown', m.display_initials),
        email: user?.email ?? 'unknown',
        display_name: user?.display_name ?? null
      })
    }
    cache.set(projectId, memberMap)
    notify()
  } finally {
    loadingProjects.delete(projectId)
  }
}

/** Invalidate cache for a project — call after updating member display settings */
export function invalidateMemberDisplay(projectId: string): void {
  cache.delete(projectId)
  loadProjectMembers(projectId)
}

/** Get cached display data for a member. Returns defaults if not yet loaded. */
export function getMemberDisplay(projectId: string, userId: string): MemberDisplayData | null {
  const projectMap = cache.get(projectId)
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

  const data = cache.get(projectId)?.get(userId)
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

  return cache.get(projectId) ?? new Map()
}
