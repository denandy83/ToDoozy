import { useCallback } from 'react'
import { useLabelStore } from '../stores/labelStore'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../components/Toast'
import type { Label } from '../../../../shared/types'

/**
 * Returns a callback that creates a label or matches an existing global label.
 * When a global label with the same name exists, it adds it to the project
 * and shows a toast. Otherwise creates a new global label linked to the project.
 */
export function useCreateOrMatchLabel(projectId: string): (name: string, color: string) => Promise<Label> {
  const { createLabel, addToProject } = useLabelStore()
  const userId = useAuthStore((s) => s.currentUser)?.id ?? ''
  const { addToast } = useToast()

  return useCallback(
    async (name: string, color: string): Promise<Label> => {
      // Check if a global label with this name already exists
      const existing = await window.api.labels.findByName(userId, name)
      if (existing) {
        // Add existing global label to this project
        await addToProject(projectId, existing.id)
        addToast({ message: `Existing label added: ${existing.name}` })
        return existing
      }
      // Create new global label linked to project
      return await createLabel({
        id: crypto.randomUUID(),
        user_id: userId,
        project_id: projectId,
        name,
        color
      })
    },
    [projectId, userId, createLabel, addToProject, addToast]
  )
}
