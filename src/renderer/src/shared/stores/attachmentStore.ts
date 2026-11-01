import { hydrationContext, type HydrationOrigin } from './hydrationContext'
import { useAuthStore } from './authStore'
import { useMemo } from 'react'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { Attachment } from '../../../../shared/types'

interface AttachmentState {
  attachments: Record<string, Attachment>
  loading: boolean
}

interface AttachmentActions {
  hydrateAttachments(taskId: string): Promise<void>
  addAttachment(attachment: Attachment, origin: ReturnType<typeof hydrationContext>): Promise<void>
  removeAttachment(id: string, origin?: HydrationOrigin): Promise<boolean>
  clearAttachments(): void
}

export type AttachmentStore = AttachmentState & AttachmentActions

let attachmentRequest = 0

export async function attachmentContext(taskId: string, origin?: HydrationOrigin): Promise<ReturnType<typeof hydrationContext>> {
  const initial = hydrationContext(origin)
  const userId = useAuthStore.getState().currentUser?.id
  const task = await initial.api.tasks.findById(taskId)
  if (!userId || !task || task.deleted_at || !initial.isProjectCurrent(task.project_id)) throw new Error('Attachment task unavailable')
  const context = hydrationContext(initial, task.project_id)
  return { ...context, isCurrent: async () => {
    try {
      if (!await context.isCurrent()) return false
      const [current, projects] = await Promise.all([
        context.api.tasks.findById(taskId),
        context.api.projects.getProjectsForUser(userId, task.project_id)
      ])
      context.assertCurrent()
      return !!current && !current.deleted_at && current.project_id === task.project_id && projects.some(project => project.id === task.project_id)
    } catch { return false }
  } }
}

export const useAttachmentStore = createWithEqualityFn<AttachmentStore>((set, get) => ({
  attachments: {},
  loading: false,

  async hydrateAttachments(taskId: string): Promise<void> {
    const request = ++attachmentRequest
    const initial = hydrationContext()
    let origin: Awaited<ReturnType<typeof attachmentContext>> | undefined
    const current = async (): Promise<boolean> => request === attachmentRequest && await (origin ?? initial).isCurrent()
    try {
      origin = await attachmentContext(taskId, initial)
      if (!await current()) return
      set({ loading: true })
      const list = await origin.api.attachments.findByTaskId(taskId)
      if (!await current()) return
      const map: Record<string, Attachment> = {}
      for (const att of list) {
        map[att.id] = att
      }
      set({ attachments: map, loading: false })
    } catch (err) {
      if (!await current()) return
      console.error('Failed to hydrate attachments:', err)
      set({ loading: false })
    }
  },

  async addAttachment(attachment: Attachment, origin: ReturnType<typeof hydrationContext>): Promise<void> {
    if (!await origin.isCurrent()) return
    const current = await attachmentContext(attachment.task_id, origin)
    if (!await current.isCurrent()) return
    set((state) => ({
      attachments: { ...state.attachments, [attachment.id]: attachment }
    }))
  },

  async removeAttachment(id: string, producer?: HydrationOrigin): Promise<boolean> {
    const attachment = get().attachments[id]
    if (!attachment) return false
    const origin = await attachmentContext(attachment.task_id, producer)
    if (!await origin.isCurrent()) return false
    const result = await origin.api.attachments.delete(id)
    if (!await origin.isCurrent()) return false
    if (result) {
      set((state) => {
        const { [id]: _, ...remaining } = state.attachments
        return { attachments: remaining }
      })
    }
    return result
  },

  clearAttachments(): void {
    attachmentRequest++
    set({ attachments: {}, loading: false })
  }
}), shallow)

export function useAttachmentsByTaskId(taskId: string): Attachment[] {
  const attachments = useAttachmentStore((s) => s.attachments)
  return useMemo(
    () =>
      Object.values(attachments)
        .filter((a) => a.task_id === taskId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)),
    [attachments, taskId]
  )
}
