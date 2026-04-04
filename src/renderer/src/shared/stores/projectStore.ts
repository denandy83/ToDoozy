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
  hydrateMembers(projectId: string): Promise<void>
  createProject(input: CreateProjectInput): Promise<Project>
  updateProject(id: string, input: UpdateProjectInput): Promise<Project | null>
  deleteProject(id: string): Promise<boolean>
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
    set({ loading: true, error: null })
    try {
      const projects = await window.api.projects.getProjectsForUser(userId)
      const projectMap: Record<string, Project> = {}
      for (const project of projects) {
        projectMap[project.id] = project
      }
      // Auto-select default project if none selected
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
      const membersMap: Record<string, ProjectMember[]> = { ...get().members }
      for (const project of projects) {
        try {
          membersMap[project.id] = await window.api.projects.getMembers(project.id)
        } catch { /* ignore */ }
      }
      set({ members: membersMap })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load projects'
      set({ error: message, loading: false })
    }
  },

  async hydrateMembers(projectId: string): Promise<void> {
    try {
      const members = await window.api.projects.getMembers(projectId)
      set((state) => ({
        members: { ...state.members, [projectId]: members }
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load project members'
      set({ error: message })
    }
  },

  async createProject(input: CreateProjectInput): Promise<Project> {
    try {
      const project = await window.api.projects.create(input)
      set((state) => ({
        projects: { ...state.projects, [project.id]: project }
      }))
      return project
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create project'
      set({ error: message })
      throw err
    }
  },

  async updateProject(id: string, input: UpdateProjectInput): Promise<Project | null> {
    try {
      const project = await window.api.projects.update(id, input)
      if (project) {
        set((state) => ({
          projects: { ...state.projects, [project.id]: project }
        }))
      }
      return project
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update project'
      set({ error: message })
      throw err
    }
  },

  async deleteProject(id: string): Promise<boolean> {
    try {
      const result = await window.api.projects.delete(id)
      if (result) {
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
      }
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to delete project'
      set({ error: message })
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
    try {
      await window.api.projects.addMember(projectId, userId, role, invitedBy)
      await get().hydrateMembers(projectId)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to add member'
      set({ error: message })
      throw err
    }
  },

  async removeMember(projectId: string, userId: string): Promise<boolean> {
    try {
      const result = await window.api.projects.removeMember(projectId, userId)
      await get().hydrateMembers(projectId)
      return result
    } catch (err) {
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

export const selectCurrentProject = (state: ProjectState): Project | null =>
  state.currentProjectId ? state.projects[state.currentProjectId] ?? null : null

export const selectDefaultProject = (state: ProjectState): Project | undefined =>
  Object.values(state.projects).find((p) => p.is_default === 1)

export const selectProjectMembers =
  (projectId: string) =>
  (state: ProjectState): ProjectMember[] =>
    state.members[projectId] ?? []
