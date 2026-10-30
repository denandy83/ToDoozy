import { captureSyncProducer, requireProducerCurrent } from '../../services/syncContext'
import { hydrationContext } from './hydrationContext'
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
      const { api, isCurrent } = hydrationContext()
      set({ loading: true, error: null })
      try {
        const templates = await api.projectTemplates.findAll(userId)
        if (!await isCurrent()) return
        const map: Record<string, ProjectTemplate> = {}
        for (const t of templates) {
          map[t.id] = t
        }
        set({ projectTemplates: map, loading: false })
      } catch (err) {
        if (!await isCurrent()) return
        const message = err instanceof Error ? err.message : 'Failed to load project templates'
        set({ error: message, loading: false })
      }
    },

    async createProjectTemplate(
      input: CreateProjectTemplateInput
    ): Promise<ProjectTemplate> {
      const origin = captureSyncProducer()
      try {
        const template = await origin.api.projectTemplates.create(input)
        await requireProducerCurrent(origin)
        set((state) => ({
          projectTemplates: { ...state.projectTemplates, [template.id]: template }
        }))
        const { pushProjectTemplate } = await import('../../services/PersonalSyncService')
        void pushProjectTemplate(template, origin)
        return template
      } catch (err) {
        if (!await origin.isCurrent()) throw err
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
      const origin = captureSyncProducer()
      try {
        const template = await origin.api.projectTemplates.update(id, input)
        await requireProducerCurrent(origin)
        if (template) {
          set((state) => ({
            projectTemplates: { ...state.projectTemplates, [template.id]: template }
          }))
          const { pushProjectTemplate } = await import('../../services/PersonalSyncService')
          void pushProjectTemplate(template, origin)
        }
        return template
      } catch (err) {
        if (!await origin.isCurrent()) throw err
        const message =
          err instanceof Error ? err.message : 'Failed to update project template'
        set({ error: message })
        throw err
      }
    },

    async deleteProjectTemplate(id: string): Promise<boolean> {
      const origin = captureSyncProducer()
      try {
        const result = await origin.api.projectTemplates.delete(id)
        await requireProducerCurrent(origin)
        if (result) {
          set((state) => {
            const { [id]: _, ...remaining } = state.projectTemplates
            return { projectTemplates: remaining }
          })
          const { deleteProjectTemplateFromSupabase } = await import(
            '../../services/PersonalSyncService'
          )
          void deleteProjectTemplateFromSupabase(id, origin)
        }
        return result
      } catch (err) {
        if (!await origin.isCurrent()) throw err
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
