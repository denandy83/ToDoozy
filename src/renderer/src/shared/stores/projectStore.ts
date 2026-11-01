import { invalidateMembershipSnapshots } from '../../services/membershipSnapshot'
import { captureSyncProducer, captureProjectProducer, requireProducerCurrent, type SyncProducer, type ProjectProducer } from '../../services/syncContext'
import { useAuthStore } from './authStore'
import { hydrationContext } from './hydrationContext'
import { evictProjectData } from './projectCache'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type {
  Project,
  ProjectMember,
  CreateProjectInput,
  UpdateProjectInput
} from '../../../../shared/types'

interface ProjectState {
  projects: Record<string, Project>
  members: Record<string, ProjectMember[]>
  removal: { id: string; name: string; ownerId: string; scope: string | null } | null
  currentProjectId: string | null
  loading: boolean
  error: string | null
}

interface ProjectActions {
  hydrateProjects(userId: string, origin?: SyncProducer): Promise<void>
  hydrateMembers(projectId: string, origin?: Pick<SyncProducer, 'api' | 'isCurrent'>): Promise<void>
  createProject(input: CreateProjectInput, producer?: ProjectProducer): Promise<Project>
  updateProject(id: string, input: UpdateProjectInput, producer?: ProjectProducer): Promise<Project | null>
  deleteProject(id: string): Promise<boolean>
  archiveProject(id: string): Promise<Project | null>
  unarchiveProject(id: string): Promise<Project | null>
  setCurrentProject(id: string | null): void
  addMember(projectId: string, userId: string, role: string, invitedBy?: string): Promise<void>
  removeMember(projectId: string, userId: string): Promise<boolean>
  clearError(): void
}

export type ProjectStore = ProjectState & ProjectActions

export const useProjectStore = createWithEqualityFn<ProjectStore>((set, get) => ({
  projects: {},
  members: {},
  currentProjectId: null,
  removal: null,
  loading: false,
  error: null,

  async hydrateProjects(userId: string, origin?: SyncProducer): Promise<void> {
    if (useAuthStore.getState().currentUser?.id !== userId || (origin && origin.userId !== userId)) return
    const { api, isCurrent, assertCurrent, isProjectCurrent } = hydrationContext(origin, undefined, userId)
    const initial = get()
    try {
      if (!await isCurrent()) return
      assertCurrent()
      set({ loading: true, error: null })
      const projects = await api.projects.getProjectsForUser(userId)
      if (!await isCurrent()) return
      assertCurrent()
      const snapshotIds = new Set(projects.map(project => project.id))
      for (const [id, project] of Object.entries(initial.projects)) {
        if (!snapshotIds.has(id) && isProjectCurrent(id) && get().projects[id] === project) evictProjectData(id)
      }
      set((state) => {
        const projectMap = Object.fromEntries(projects.filter(project => isProjectCurrent(project.id)).map(project => [project.id, project]))
        for (const [id, project] of Object.entries(state.projects)) {
          if (project !== initial.projects[id]) projectMap[id] = project
        }
        for (const id of Object.keys(initial.projects)) if (!state.projects[id]) delete projectMap[id]
        const currentId = state.currentProjectId
        const available = Object.values(projectMap)
        const defaultProject = available.find(project => project.is_default === 1) ?? available[0]
        return { projects: projectMap, currentProjectId: currentId && projectMap[currentId] ? currentId : defaultProject?.id ?? null, loading: false }
      })
      const membersMap: Record<string, ProjectMember[]> = {}
      for (const project of projects) {
        if (!isProjectCurrent(project.id)) continue
        try { membersMap[project.id] = await api.projects.getMembers(project.id) } catch { /* ignore */ }
      }
      if (!await isCurrent()) return
      assertCurrent()
      set((state) => {
        const members = { ...state.members }
        for (const id of Object.keys(initial.members)) {
          if (!state.projects[id] && state.members[id] === initial.members[id]) delete members[id]
        }
        for (const [id, snapshot] of Object.entries(membersMap)) {
          if (isProjectCurrent(id) && state.projects[id] && state.members[id] === initial.members[id]) members[id] = snapshot
        }
        return { members }
      })
    } catch (err) {
      if (!await isCurrent()) return
      assertCurrent()
      const message = err instanceof Error ? err.message : 'Failed to load projects'
      set({ error: message, loading: false })
    }
  },

  async hydrateMembers(projectId: string, origin?: Pick<SyncProducer, 'api' | 'isCurrent'>): Promise<void> {
    const { api, isCurrent, assertCurrent } = hydrationContext(origin, projectId, useAuthStore.getState().currentUser?.id ?? '')
    const initial = get().members[projectId]
    try {
      if (!await isCurrent()) return
      assertCurrent()
      const members = await api.projects.getMembers(projectId)
      if (!await isCurrent()) return
      assertCurrent()
      set((state) => state.members[projectId] === initial ? { members: { ...state.members, [projectId]: members } } : {})
    } catch (err) {
      if (!await isCurrent()) return
      assertCurrent()
      const message = err instanceof Error ? err.message : 'Failed to load project members'
      set({ error: message })
    }
  },

  async createProject(input: CreateProjectInput, producer?: ProjectProducer): Promise<Project> {
    const origin = producer ?? captureProjectProducer(input.id)
    try {
      const project = await origin.api.projects.create(input)
      origin.includeProject(project.id)
      await requireProducerCurrent(origin)
      set((state) => ({
        projects: { ...state.projects, [project.id]: project }
      }))
      // Sync to Supabase
      import('../../services/PersonalSyncService').then(async ({ pushProject }) => {
        if (!await origin.isCurrent()) return
        pushProject(project, origin).catch(async (err) => {
          if (!await origin.isCurrent()) return
          console.error('[ProjectStore] pushProject failed after create:', err)
        })
      })
      await requireProducerCurrent(origin)
      return project
    } catch (err) {
      await requireProducerCurrent(origin)
      const message = err instanceof Error ? err.message : 'Failed to create project'
      set({ error: message })
      throw err
    }
  },

  async updateProject(id: string, input: UpdateProjectInput, producer?: ProjectProducer): Promise<Project | null> {
    const origin = producer ?? captureProjectProducer(id)
    try {
      origin.includeProject(id)
      const context = hydrationContext(origin, id, origin.userId)
      const project = await context.api.projects.update(id, input)
      await requireProducerCurrent(origin)
      if (project) {
        set((state) => ({
          projects: { ...state.projects, [project.id]: project }
        }))
        // Sync to Supabase
        import('../../services/PersonalSyncService').then(async ({ pushProject }) => {
          if (!await origin.isCurrent()) return
          pushProject(project, origin).catch(async (err) => {
          if (!await origin.isCurrent()) return
            console.error('[ProjectStore] pushProject failed after update:', err)
          })
        })
      }
      await requireProducerCurrent(origin)
      return project
    } catch (err) {
      if (producer && !await origin.isCurrent()) return null
      await requireProducerCurrent(origin)
      const message = err instanceof Error ? err.message : 'Failed to update project'
      set({ error: message })
      throw err
    }
  },

  async deleteProject(id: string): Promise<boolean> {
    const origin = captureProjectProducer(id)
    const deletionOrigin = captureSyncProducer()
    try {
      const result = await origin.api.projects.delete(id)
      await requireProducerCurrent(origin)
      if (result) {
        evictProjectData(id)
        set((state) => {
          const { [id]: _, ...remaining } = state.projects
          const { [id]: __, ...remainingMembers } = state.members
          const newCurrentId =
            state.currentProjectId === id
              ? Object.keys(remaining)[0] ?? null
              : state.currentProjectId
          return {
            projects: remaining,
            members: remainingMembers,
            currentProjectId: newCurrentId
          }
        })
        // Sync deletion to Supabase
        import('../../services/PersonalSyncService').then(async ({ deleteProjectFromSupabase }) => {
          if (!await deletionOrigin.isCurrent()) return
          deleteProjectFromSupabase(id, deletionOrigin).catch(async (err) => {
            if (!await deletionOrigin.isCurrent()) return
            console.error('[ProjectStore] deleteProjectFromSupabase failed:', err)
          })
        })
      }
      await requireProducerCurrent(deletionOrigin)
      return result
    } catch (err) {
      await requireProducerCurrent(origin)
      const message = err instanceof Error ? err.message : 'Failed to delete project'
      set({ error: message })
      throw err
    }
  },

  async archiveProject(id: string): Promise<Project | null> {
    const origin = captureProjectProducer(id)
    try {
      const current = get().projects[id] ?? await origin.api.projects.findById(id)
      await requireProducerCurrent(origin)
      if (!current || current.owner_id !== origin.userId) {
        throw new Error('Only the project owner can archive or restore this project')
      }
      const project = await origin.api.projects.archiveWithTasks(id)
      if (project && await origin.isCurrent()) {
        set((state) => ({ projects: { ...state.projects, [project.id]: project } }))
        const { useTaskStore } = await import('./taskStore')
        if (!await origin.isCurrent()) return null
        await useTaskStore.getState().hydrateAllForProject(id, origin)
        const { pushProjectArchive } = await import('../../services/PersonalSyncService')
        if (!await origin.isCurrent()) return null
        await pushProjectArchive(origin)
      }
      if (!await origin.isCurrent()) return null
      return project ?? null
    } catch (err) {
      if (!await origin.isCurrent()) return null
      set({ error: err instanceof Error ? err.message : 'Failed to archive project' })
      throw err
    }
  },

  async unarchiveProject(id: string): Promise<Project | null> {
    const origin = captureProjectProducer(id)
    try {
      const current = get().projects[id] ?? await origin.api.projects.findById(id)
      await requireProducerCurrent(origin)
      if (!current || current.owner_id !== origin.userId) {
        throw new Error('Only the project owner can archive or restore this project')
      }
      const project = await origin.api.projects.unarchiveWithTasks(id)
      if (project && await origin.isCurrent()) {
        set((state) => ({ projects: { ...state.projects, [project.id]: project } }))
        const { useTaskStore } = await import('./taskStore')
        if (!await origin.isCurrent()) return null
        await useTaskStore.getState().hydrateAllForProject(id, origin)
        const { pushProjectArchive } = await import('../../services/PersonalSyncService')
        if (!await origin.isCurrent()) return null
        await pushProjectArchive(origin)
      }
      if (!await origin.isCurrent()) return null
      return project ?? null
    } catch (err) {
      if (!await origin.isCurrent()) return null
      set({ error: err instanceof Error ? err.message : 'Failed to unarchive project' })
      throw err
    }
  },

  setCurrentProject(id: string | null): void {
    set({ currentProjectId: id })
  },

  async addMember(
    projectId: string,
    userId: string,
    role: string,
    invitedBy?: string
  ): Promise<void> {
    const origin = captureProjectProducer(projectId)
    try {
      await invalidateMembershipSnapshots(projectId, origin)
      await origin.api.projects.addMember(projectId, userId, role, invitedBy)
      await invalidateMembershipSnapshots(projectId, origin)
      await requireProducerCurrent(origin)
      await get().hydrateMembers(projectId, origin)
      await requireProducerCurrent(origin)
    } catch (err) {
      await requireProducerCurrent(origin)
      const message = err instanceof Error ? err.message : 'Failed to add member'
      set({ error: message })
      throw err
    }
  },

  async removeMember(projectId: string, userId: string): Promise<boolean> {
    const origin = captureProjectProducer(projectId)
    try {
      await invalidateMembershipSnapshots(projectId, origin)
      const result = await origin.api.projects.removeMember(projectId, userId)
      await invalidateMembershipSnapshots(projectId, origin)
      await requireProducerCurrent(origin)
      await get().hydrateMembers(projectId, origin)
      await requireProducerCurrent(origin)
      return result
    } catch (err) {
      await requireProducerCurrent(origin)
      const message = err instanceof Error ? err.message : 'Failed to remove member'
      set({ error: message })
      throw err
    }
  },

  clearError(): void {
    set({ error: null })
  }
}), shallow)

// Selectors
export const selectAllProjects = (state: ProjectState): Project[] =>
  Object.values(state.projects)

export const selectActiveProjects = (state: ProjectState): Project[] =>
  Object.values(state.projects).filter((p) => p.is_archived !== 1)

export const selectCurrentProject = (state: ProjectState): Project | null =>
  state.currentProjectId ? state.projects[state.currentProjectId] ?? null : null

export const selectDefaultProject = (state: ProjectState): Project | undefined =>
  Object.values(state.projects).find((p) => p.is_default === 1)

export const selectProjectMembers =
  (projectId: string) =>
  (state: ProjectState): ProjectMember[] =>
    state.members[projectId] ?? []
