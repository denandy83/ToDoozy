import { membershipSnapshot } from '../../services/membershipSnapshot'
import { useDatabaseScope } from '../../shared/hooks/useDatabaseScope'
import { logEvent } from '../../shared/stores/logStore'
import { useProjectStore } from '../../shared/stores/projectStore'
import { useState, useCallback, useEffect, useRef } from 'react'
import { subscribeToProject, setRealtimeCallback, getSharedProjectMembers, unsubscribeFromProject } from '../../services/SyncService'
import { captureProjectProducer, syncContextFromProducer, type SyncContext } from '../../services/syncContext'
import { hydrationContext } from '../../shared/stores/hydrationContext'
import { invalidateMemberDisplay } from '../../shared/hooks/useMemberDisplay'
import { useTaskStore } from '../../shared/stores'
import { isPlaceholderEmail } from '../../../../shared/placeholderUser'
import type { Project, ProjectMember, User } from '../../../../shared/types'

export interface SharedProjectMember {
  user_id: string
  email: string
  display_name: string | null
  role: string
}
export interface RemovedFromProject { id: string; name: string }
interface Session { scope: string | null; ownerId: string; projectId: string; active: boolean }
interface SharedState { session: Session | null; members: SharedProjectMember[]; removed: RemovedFromProject | null }
interface UseSharedProjectRealtimeResult {
  projectMembers: SharedProjectMember[]
  removedFromProject: RemovedFromProject | null
  setRemovedFromProject: React.Dispatch<React.SetStateAction<RemovedFromProject | null>>
}

export function useSharedProjectRealtime(selectedProject: Project | null, currentUser: User | null): UseSharedProjectRealtimeResult {
  const scope = useDatabaseScope()
  const [state, setState] = useState<SharedState>({ session: null, members: [], removed: null })
  const sessionRef = useRef<Session | null>(null)
  const projectId = selectedProject?.id
  const projectName = selectedProject?.name ?? ''
  const shared = selectedProject?.is_shared === 1
  const userId = currentUser?.id
  useEffect(() => {
    if (!userId || !projectId || !shared) return
    const project = { id: projectId, name: projectName }
    const session: Session = { scope, ownerId: userId, projectId: project.id, active: true }
    sessionRef.current = session
    const producer = captureProjectProducer(project.id)
    let publishingMembers: ProjectMember[] | null = null
    const current = async (origin: SyncContext): Promise<boolean> => await origin.isCurrent() && window.api.sync.currentContext() === scope && session.active && sessionRef.current === session
    const assert = (origin: SyncContext): void => {
      origin.assertCurrent()
      if (window.api.sync.currentContext() !== scope || !session.active || sessionRef.current !== session) throw new Error('Shared project view changed')
    }
    const loadMembers = async (origin: SyncContext): Promise<void> => {
      origin = await membershipSnapshot()(project.id, origin)
      try {
      if (!await current(origin)) return
      assert(origin)
      const members = await getSharedProjectMembers(project.id, origin)
      if (!await current(origin)) return
      assert(origin)
      const localMembers = await origin.api.projects.getMembers(project.id)
      const localMemberIds = new Set(localMembers.map(member => member.user_id))
      for (const member of localMembers) {
        if (members.some(remote => remote.user_id === member.user_id)) continue
        if (!await current(origin)) return
        assert(origin)
        await origin.api.projects.removeMember(project.id, member.user_id)
      }
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
        if (!localMemberIds.has(member.user_id)) {
          await origin.api.projects.addMember(project.id, member.user_id, member.role, undefined, member.joined_at)
          if (!await current(origin)) return
          assert(origin)
        }
        await origin.api.projects.updateMember(project.id, member.user_id, { display_color: member.display_color, display_initials: member.display_initials })
      }
      const nativeMembers = await origin.api.projects.getMembers(project.id)
      if (!await current(origin)) return
      assert(origin)
      publishingMembers = nativeMembers
      try {
        useProjectStore.setState(previous => ({ members: { ...previous.members, [project.id]: nativeMembers } }))
      } finally { publishingMembers = null }
      setState(previous => previous.session === session ? { ...previous, members } : previous)
      invalidateMemberDisplay(project.id, origin)
      } catch (error) { if (await current(origin)) throw error }
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
    const parentContext = syncContextFromProducer(producer)
    const offMembers = useProjectStore.subscribe((next, previous) => {
      if (next.members[project.id] !== previous.members[project.id] && next.members[project.id] !== publishingMembers) void parentContext.then(loadMembers).catch(async error => { if (await producer.isCurrent()) logEvent('error', 'sync', 'Member refresh failed', String(error)) })
    })
    void (async () => {
      const parent = await parentContext
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
      offMembers()
      if (sessionRef.current === session) sessionRef.current = null
    }
  }, [projectId, projectName, shared, userId, scope])
  const visible = state.session?.scope === scope && state.session?.active && state.session.ownerId === currentUser?.id && state.session.projectId === selectedProject?.id
  const setRemovedFromProject = useCallback<React.Dispatch<React.SetStateAction<RemovedFromProject | null>>>((value) => {
    setState(previous => ({ ...previous, removed: typeof value === 'function' ? value(previous.removed) : value }))
  }, [])
  return { projectMembers: visible ? state.members : [], removedFromProject: visible ? state.removed : null, setRemovedFromProject }
}
