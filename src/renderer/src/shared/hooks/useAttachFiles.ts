import { useCallback } from 'react'
import { useAttachmentStore } from '../stores'
import { useToast } from '../components/Toast'

export function useAttachFiles(taskId: string): () => Promise<void> {
  const { addAttachment } = useAttachmentStore()
  const { addToast } = useToast()

  return useCallback(async () => {
    const result = await window.api.fs.showOpenDialog()
    if (result.canceled || result.filePaths.length === 0) return

    for (const filePath of result.filePaths) {
      try {
        const attachment = await window.api.attachments.createFromFile(taskId, filePath)
        addAttachment(attachment)
      } catch (err) {
        console.error('Failed to attach file:', err)
        addToast({ message: 'Failed to attach file', variant: 'danger' })
      }
    }
  }, [taskId, addAttachment, addToast])
}
