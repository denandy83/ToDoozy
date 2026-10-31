import { useCallback } from 'react'
import { hydrationContext } from '../stores/hydrationContext'
import { useAttachmentStore } from '../stores'
import { useToast } from '../components/Toast'

export function useAttachFiles(taskId: string): () => Promise<void> {
  const { addAttachment } = useAttachmentStore()
  const { addToast } = useToast()

  return useCallback(async () => {
    const origin = hydrationContext()
    const result = await window.api.fs.showOpenDialog()
    if (!await origin.isCurrent()) return
    if (result.canceled || result.filePaths.length === 0) return

    for (const filePath of result.filePaths) {
      if (!await origin.isCurrent()) return
      try {
        const attachment = await origin.api.attachments.createFromFile(taskId, filePath)
        await addAttachment(attachment, origin)
      } catch (err) {
        if (!await origin.isCurrent()) return
        console.error('Failed to attach file:', err)
        addToast({ message: 'Failed to attach file', variant: 'danger' })
      }
    }
  }, [taskId, addAttachment, addToast])
}
