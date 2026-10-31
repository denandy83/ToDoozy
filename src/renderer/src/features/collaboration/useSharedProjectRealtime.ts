import { useState, useCallback, useEffect, useRef } from 'react'
import { subscribeToProject, setRealtimeCallback, getSharedProjectMembers, unsubscribeFromProject } from '../../services/SyncService'
import { captureProjectProducer, syncContextFromProducer, type SyncContext } from '../../services/syncContext'
import { hydrationContext } from '../../shared/stores/hydrationContext'
import { invalidateMemberDisplay } from '../../shared/hooks/useMemberDisplay'
import { useTaskStore } from '../../shared/stores'
import { isPlaceholderEmail } from '../../../../shared/placeholderUser'
import type { Project, User } from '../../../../shared/types'

export interface SharedProjectMember {
  user_id: string
  email: string
  display_name: string | null
  role: string
}
export interface RemovedFromProject { id: string; name: string }
interface Session { ownerId: string; projectId: string; active: boolean }
interface SharedState { session: Session | null; members: SharedProjectMember[]; removed: RemovedFromProject | null }
interface UseSharedProjectRealtimeResult {
  projectMembers: SharedProjectMember[]
  removedFromProject: RemovedFromProject | null
  setRemovedFromProject: React.Dispatch<React.SetStateAction<RemovedFromProject | null>>
}

export function useSharedProjectRealtime(selectedProject: Project | null, currentUser: User | null): UseSharedProjectRealtimeResult {
  const [state, setState] = useState<SharedState>({ session: null, members: [], removed: null })
  const sessionRef = useRef<Session | null>(null)
  const projectId = selectedProject?.id
  const projectName = selectedProject?.name ?? ''
  const shared = selectedProject?.is_shared === 1
  const userId = currentUser?.id
  useEffect(() => {
    if (!userId || !projectId || !shared) return
    const project = { id: projectId, name: projectName }
    const session: Session = { ownerId: userId, projectId: project.id, active: true }
    sessionRef.current = session
    const producer = captureProjectProducer(project.id)
    const current = async (origin: SyncContext): Promise<boolean> => await origin.isCurrent() && session.active && sessionRef.current === session
    const assert = (origin: SyncContext): void => {
      origin.assertCurrent()
      if (!session.active || sessionRef.current !== session) throw new Error('Shared project view changed')
    }
    const loadMembers = async (origin: SyncContext): Promise<void> => {
      if (!await current(origin)) return
      assert(origin)
      const members = await getSharedProjectMembers(project.id, origin)
      if (!await current(origin)) return
      assert(origin)
      for (const member of members) {
        if (!await current(origin)) return
        assert(origin)
        const user = await origin.api.users.findById(member.user_id)
        if (!await current(origin)) return
        assert(origin)
        if (!user) await origin.api.users.create({ id: member.user_id, email: member.email, display_name: member.display_name, avatar_url: null })
        else if (isPlaceholderEmail(user.email) && !isPlaceholderEmail(member.email)) await origin.api.users.update(member.user_id, { email: member.email, display_name: member.display_name })
        if (!await current(origin)) return
        assert(origin)
        await origin.api.projects.updateMember(project.id, member.user_id, { display_color: member.display_color, display_initials: member.display_initials })
      }
      if (!await current(origin)) return
      assert(origin)
      setState(previous => previous.session === session ? { ...previous, members } : previous)
      invalidateMemberDisplay(project.id, origin)
    }
    setState({ session, members: [], removed: null })
    let removed = false
    const stopCallback = setRealtimeCallback(async (table, event, payload, channelOrigin) => {
      const view = hydrationContext(channelOrigin, project.id)
      const origin: SyncContext = {
        ...channelOrigin, ...view,
        isCurrent: async () => await view.isCurrent() && session.active,
        assertCurrent: () => { view.assertCurrent(); if (!session.active) throw new Error('Shared project view changed') }
      }
      try {
      if (!await current(origin) || removed || (payload.project_id && payload.project_id !== project.id)) return
      assert(origin)
      if (table === 'member') {
        if (event === 'DELETE' && payload.user_id === session.ownerId && payload.project_id === project.id) {
          removed = true
          setState(previous => previous.session === session ? { ...previous, removed: { id: project.id, name: project.name } } : previous)
          await unsubscribeFromProject(project.id)
        } else await loadMembers(origin)
      }
      if (table === 'activity' && event === 'INSERT' && typeof payload.id === 'string' && typeof payload.task_id === 'string') {
        const result = await origin.api.activityLog.applyRemote({
          id: payload.id, task_id: payload.task_id, user_id: typeof payload.user_id === 'string' ? payload.user_id : '',
          action: typeof payload.action === 'string' ? payload.action : '', old_value: payload.old_value as string | null ?? null,
          new_value: payload.new_value as string | null ?? null, created_at: payload.created_at as string ?? new Date().toISOString()
        })
        if (!await current(origin)) return
        assert(origin)
        if (result === 'applied') useTaskStore.getState().bumpActivityRefresh(payload.task_id)
      }
      } catch (error) { if (await current(origin)) throw error }
    })
    void (async () => {
      const parent = await syncContextFromProducer(producer)
      const origin: SyncContext = {
        ...parent,
        isCurrent: async () => await parent.isCurrent() && session.active,
        assertCurrent: () => { parent.assertCurrent(); if (!session.active) throw new Error('Shared project view changed') }
      }
      if (!await current(origin)) return
      assert(origin)
      await loadMembers(origin)
      if (!await current(origin)) return
      assert(origin)
      await subscribeToProject(project.id, parent)
    })().catch(() => {})
    return () => {
      session.active = false
      stopCallback()
      if (sessionRef.current === session) sessionRef.current = null
    }
  }, [projectId, projectName, shared, userId])
  const visible = state.session?.active && state.session.ownerId === currentUser?.id && state.session.projectId === selectedProject?.id
  const setRemovedFromProject = useCallback<React.Dispatch<React.SetStateAction<RemovedFromProject | null>>>((value) => {
    setState(previous => ({ ...previous, removed: typeof value === 'function' ? value(previous.removed) : value }))
  }, [])
  return { projectMembers: visible ? state.members : [], removedFromProject: visible ? state.removed : null, setRemovedFromProject }
}
