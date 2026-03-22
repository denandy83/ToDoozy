import { useCallback } from 'react'
import { useAttachmentStore } from '../stores'
import { useToast } from '../components/Toast'

const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10 MB
const MAX_ATTACHMENTS = 10

export function useAttachFiles(taskId: string, currentCount: number): () => Promise<void> {
  const { addAttachment } = useAttachmentStore()
  const icloudEnabled = useAttachmentStore((s) => s.icloudEnabled)
  const { addToast } = useToast()

  return useCallback(async () => {
    if (!icloudEnabled) {
      addToast({ message: 'Enable iCloud Drive in Settings to attach files', variant: 'danger' })
      return
    }

    if (currentCount >= MAX_ATTACHMENTS) {
      addToast({ message: `Maximum ${MAX_ATTACHMENTS} attachments per task`, variant: 'danger' })
      return
    }

    const result = await window.api.fs.showOpenDialog()
    if (result.canceled || result.filePaths.length === 0) return

    const remaining = MAX_ATTACHMENTS - currentCount
    const filesToAttach = result.filePaths.slice(0, remaining)
    if (result.filePaths.length > remaining) {
      addToast({
        message: `Only ${remaining} more attachment(s) allowed — ${result.filePaths.length - remaining} file(s) skipped`,
        variant: 'danger'
      })
    }

    for (const filePath of filesToAttach) {
      try {
        const copyResult = await window.api.fs.copyFileToAttachments(filePath, taskId, icloudEnabled)

        if (copyResult.sizeBytes > MAX_FILE_SIZE) {
          addToast({ message: `${copyResult.filename} exceeds 10 MB limit`, variant: 'danger' })
          await window.api.fs.deleteAttachmentFiles(copyResult.localPath, copyResult.icloudPath)
          continue
        }

        await addAttachment({
          id: crypto.randomUUID(),
          task_id: taskId,
          filename: copyResult.filename,
          mime_type: copyResult.mimeType,
          size_bytes: copyResult.sizeBytes,
          local_path: copyResult.localPath,
          icloud_path: copyResult.icloudPath
        })
      } catch (err) {
        console.error('Failed to attach file:', err)
        addToast({ message: 'Failed to attach file', variant: 'danger' })
      }
    }
  }, [taskId, icloudEnabled, currentCount, addAttachment, addToast])
}
