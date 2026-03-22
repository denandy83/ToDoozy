import { useMemo } from 'react'
import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import type { Attachment, CreateAttachmentInput } from '../../../../shared/types'

interface AttachmentState {
  attachments: Record<string, Attachment>
  icloudAvailable: boolean
  icloudEnabled: boolean
  loading: boolean
}

interface AttachmentActions {
  hydrateAttachments(taskId: string): Promise<void>
  checkIcloudStatus(): Promise<void>
  setIcloudEnabled(enabled: boolean): Promise<void>
  addAttachment(input: CreateAttachmentInput): Promise<Attachment>
  removeAttachment(id: string): Promise<boolean>
  clearAttachments(): void
}

export type AttachmentStore = AttachmentState & AttachmentActions

export const useAttachmentStore = createWithEqualityFn<AttachmentStore>((set, get) => ({
  attachments: {},
  icloudAvailable: false,
  icloudEnabled: false,
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

  async checkIcloudStatus(): Promise<void> {
    try {
      const available = await window.api.fs.checkIcloudAvailable()
      const enabledSetting = await window.api.settings.get('icloud_enabled')
      set({
        icloudAvailable: available,
        icloudEnabled: available && enabledSetting === 'true'
      })
    } catch (err) {
      console.error('Failed to check iCloud status:', err)
    }
  },

  async setIcloudEnabled(enabled: boolean): Promise<void> {
    await window.api.settings.set('icloud_enabled', enabled ? 'true' : 'false')
    set({ icloudEnabled: enabled })
  },

  async addAttachment(input: CreateAttachmentInput): Promise<Attachment> {
    const attachment = await window.api.attachments.create(input)
    set((state) => ({
      attachments: { ...state.attachments, [attachment.id]: attachment }
    }))
    return attachment
  },

  async removeAttachment(id: string): Promise<boolean> {
    const attachment = get().attachments[id]
    if (attachment) {
      await window.api.fs.deleteAttachmentFiles(attachment.local_path, attachment.icloud_path)
    }
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
