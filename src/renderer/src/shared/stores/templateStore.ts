import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type {
  ProjectTemplate,
  CreateProjectTemplateInput,
  UpdateProjectTemplateInput
} from '../../../../shared/types'

interface TemplateState {
  projectTemplates: Record<string, ProjectTemplate>
  loading: boolean
  error: string | null
}

interface TemplateActions {
  hydrateProjectTemplates(userId: string): Promise<void>
  createProjectTemplate(input: CreateProjectTemplateInput): Promise<ProjectTemplate>
  updateProjectTemplate(
    id: string,
    input: UpdateProjectTemplateInput
  ): Promise<ProjectTemplate | null>
  deleteProjectTemplate(id: string): Promise<boolean>
  clearError(): void
}

export type TemplateStore = TemplateState & TemplateActions

export const useTemplateStore = createWithEqualityFn<TemplateStore>(
  (set) => ({
    projectTemplates: {},
    loading: false,
    error: null,

    async hydrateProjectTemplates(userId: string): Promise<void> {
      set({ loading: true, error: null })
      try {
        const templates = await window.api.projectTemplates.findAll(userId)
        const map: Record<string, ProjectTemplate> = {}
        for (const t of templates) {
          map[t.id] = t
        }
        set({ projectTemplates: map, loading: false })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to load project templates'
        set({ error: message, loading: false })
      }
    },

    async createProjectTemplate(
      input: CreateProjectTemplateInput
    ): Promise<ProjectTemplate> {
      try {
        const template = await window.api.projectTemplates.create(input)
        set((state) => ({
          projectTemplates: { ...state.projectTemplates, [template.id]: template }
        }))
        return template
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to create project template'
        set({ error: message })
        throw err
      }
    },

    async updateProjectTemplate(
      id: string,
      input: UpdateProjectTemplateInput
    ): Promise<ProjectTemplate | null> {
      try {
        const template = await window.api.projectTemplates.update(id, input)
        if (template) {
          set((state) => ({
            projectTemplates: { ...state.projectTemplates, [template.id]: template }
          }))
        }
        return template
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to update project template'
        set({ error: message })
        throw err
      }
    },

    async deleteProjectTemplate(id: string): Promise<boolean> {
      try {
        const result = await window.api.projectTemplates.delete(id)
        if (result) {
          set((state) => {
            const { [id]: _, ...remaining } = state.projectTemplates
            return { projectTemplates: remaining }
          })
        }
        return result
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to delete project template'
        set({ error: message })
        throw err
      }
    },

    clearError(): void {
      set({ error: null })
    }
  }),
  shallow
)

// Selectors
export const selectAllProjectTemplates = (state: TemplateState): ProjectTemplate[] =>
  Object.values(state.projectTemplates)
