import { hydrationContext } from './hydrationContext'
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
  removeAttachment(id: string): Promise<boolean>
  clearAttachments(): void
}

export type AttachmentStore = AttachmentState & AttachmentActions

let attachmentRequest = 0

export const useAttachmentStore = createWithEqualityFn<AttachmentStore>((set) => ({
  attachments: {},
  loading: false,

  async hydrateAttachments(taskId: string): Promise<void> {
    const request = ++attachmentRequest
    const origin = hydrationContext()
    const current = async (): Promise<boolean> => request === attachmentRequest && await origin.isCurrent()
    set({ loading: true })
    try {
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
    set((state) => ({
      attachments: { ...state.attachments, [attachment.id]: attachment }
    }))
  },

  async removeAttachment(id: string): Promise<boolean> {
    const origin = hydrationContext()
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
    set({ attachments: {} })
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
