import { captureSyncProducer, requireProducerCurrent, type SyncProducer } from '../../services/syncContext'
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
  currentProjectId: string | null
  loading: boolean
  error: string | null
}

interface ProjectActions {
  hydrateProjects(userId: string): Promise<void>
  hydrateMembers(projectId: string, origin?: Pick<SyncProducer, 'api' | 'isCurrent'>): Promise<void>
  createProject(input: CreateProjectInput): Promise<Project>
  updateProject(id: string, input: UpdateProjectInput): Promise<Project | null>
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
  loading: false,
  error: null,

  async hydrateProjects(userId: string): Promise<void> {
    const { api, isCurrent } = hydrationContext()
    const initialIds = Object.keys(get().projects)
    set({ loading: true, error: null })
    try {
      const projects = await api.projects.getProjectsForUser(userId)
      const projectMap: Record<string, Project> = {}
      for (const project of projects) {
        projectMap[project.id] = project
      }
      // Auto-select default project if none selected
      if (!await isCurrent()) return
      for (const id of initialIds) if (!projectMap[id]) evictProjectData(id)
      const currentId = get().currentProjectId
      if (!currentId || !projectMap[currentId]) {
        const defaultProject = projects.find((p) => p.is_default === 1) ?? projects[0] ?? null
        set({
          projects: projectMap,
          currentProjectId: defaultProject?.id ?? null,
          loading: false
        })
      } else {
        set({ projects: projectMap, loading: false })
      }
      // Hydrate members for all projects (for sidebar shared icon)
      const membersMap: Record<string, ProjectMember[]> = {}
      for (const project of projects) {
        try {
          membersMap[project.id] = await api.projects.getMembers(project.id)
        } catch { /* ignore */ }
      }
      if (!await isCurrent()) return
      set({ members: membersMap })
    } catch (err) {
      if (!await isCurrent()) return
      const message = err instanceof Error ? err.message : 'Failed to load projects'
      set({ error: message, loading: false })
    }
  },

  async hydrateMembers(projectId: string, origin?: Pick<SyncProducer, 'api' | 'isCurrent'>): Promise<void> {
    const { api, isCurrent } = origin ?? hydrationContext()
    try {
      const members = await api.projects.getMembers(projectId)
      if (!await isCurrent()) return
      set((state) => ({
        members: { ...state.members, [projectId]: members }
      }))
    } catch (err) {
      if (!await isCurrent()) return
      const message = err instanceof Error ? err.message : 'Failed to load project members'
      set({ error: message })
    }
  },

  async createProject(input: CreateProjectInput): Promise<Project> {
    const origin = captureSyncProducer()
    try {
      const project = await origin.api.projects.create(input)
      await requireProducerCurrent(origin)
      set((state) => ({
        projects: { ...state.projects, [project.id]: project }
      }))
      // Sync to Supabase
      import('../../services/PersonalSyncService').then(async ({ pushProject }) => {
        if (!await origin.isCurrent()) return
        pushProject(project, origin).catch((err) => {
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

  async updateProject(id: string, input: UpdateProjectInput): Promise<Project | null> {
    const origin = captureSyncProducer()
    try {
      const project = await origin.api.projects.update(id, input)
      await requireProducerCurrent(origin)
      if (project) {
        set((state) => ({
          projects: { ...state.projects, [project.id]: project }
        }))
        // Sync to Supabase
        import('../../services/PersonalSyncService').then(async ({ pushProject }) => {
          if (!await origin.isCurrent()) return
          pushProject(project, origin).catch((err) => {
            console.error('[ProjectStore] pushProject failed after update:', err)
          })
        })
      }
      await requireProducerCurrent(origin)
      return project
    } catch (err) {
      await requireProducerCurrent(origin)
      const message = err instanceof Error ? err.message : 'Failed to update project'
      set({ error: message })
      throw err
    }
  },

  async deleteProject(id: string): Promise<boolean> {
    const origin = captureSyncProducer()
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
          if (!await origin.isCurrent()) return
          deleteProjectFromSupabase(id, origin).catch((err) => {
            console.error('[ProjectStore] deleteProjectFromSupabase failed:', err)
          })
        })
      }
      await requireProducerCurrent(origin)
      return result
    } catch (err) {
      await requireProducerCurrent(origin)
      const message = err instanceof Error ? err.message : 'Failed to delete project'
      set({ error: message })
      throw err
    }
  },

  async archiveProject(id: string): Promise<Project | null> {
    const origin = captureSyncProducer()
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
    const origin = captureSyncProducer()
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
    const origin = captureSyncProducer()
    try {
      await origin.api.projects.addMember(projectId, userId, role, invitedBy)
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
    const origin = captureSyncProducer()
    try {
      const result = await origin.api.projects.removeMember(projectId, userId)
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
