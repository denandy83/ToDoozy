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
  addAttachment(attachment: Attachment): void
  removeAttachment(id: string): Promise<boolean>
  clearAttachments(): void
}

export type AttachmentStore = AttachmentState & AttachmentActions

export const useAttachmentStore = createWithEqualityFn<AttachmentStore>((set) => ({
  attachments: {},
  loading: false,

  async hydrateAttachments(taskId: string): Promise<void> {
    set({ loading: true })
    try {
      const list = await window.api.attachments.findByTaskId(taskId)
      const map: Record<string, Attachment> = {}
      for (const att of list) {
        map[att.id] = att
      }
      set({ attachments: map, loading: false })
    } catch (err) {
      console.error('Failed to hydrate attachments:', err)
      set({ loading: false })
    }
  },

  addAttachment(attachment: Attachment): void {
    set((state) => ({
      attachments: { ...state.attachments, [attachment.id]: attachment }
    }))
  },

  async removeAttachment(id: string): Promise<boolean> {
    const result = await window.api.attachments.delete(id)
    if (result) {
      set((state) => {
        const { [id]: _, ...remaining } = state.attachments
        return { attachments: remaining }
      })
    }
    return result
  },

  clearAttachments(): void {
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
