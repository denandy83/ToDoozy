import { useEffect, useCallback } from 'react'
import { Paperclip, X, FileText, FileImage, FileArchive, FileAudio, FileVideo, File, FileCode } from 'lucide-react'
import { useAttachmentStore, useAttachmentsByTaskId } from '../../shared/stores'
import { useAttachFiles } from '../../shared/hooks/useAttachFiles'
import { useToast } from '../../shared/components/Toast'
import type { Attachment } from '../../../../shared/types'

const FILENAME_MAX_DISPLAY = 20

interface DetailAttachmentsProps {
  taskId: string
}

export function DetailAttachments({ taskId }: DetailAttachmentsProps): React.JSX.Element {
  const { hydrateAttachments, addAttachment, removeAttachment, checkIcloudStatus } = useAttachmentStore()
  const icloudEnabled = useAttachmentStore((s) => s.icloudEnabled)
  const icloudAvailable = useAttachmentStore((s) => s.icloudAvailable)
  const attachments = useAttachmentsByTaskId(taskId)
  const { addToast } = useToast()
  const handleAttachFiles = useAttachFiles(taskId, attachments.length)

  useEffect(() => {
    hydrateAttachments(taskId)
    checkIcloudStatus()
  }, [taskId, hydrateAttachments, checkIcloudStatus])

  const handleRemove = useCallback(
    async (attachment: Attachment) => {
      await removeAttachment(attachment.id)
      addToast({
        message: `Removed ${attachment.filename}`,
        actions: [
          {
            label: 'Undo',
            variant: 'accent',
            onClick: async () => {
              await addAttachment({
                id: attachment.id,
                task_id: attachment.task_id,
                filename: attachment.filename,
                mime_type: attachment.mime_type,
                size_bytes: attachment.size_bytes,
                local_path: attachment.local_path,
                icloud_path: attachment.icloud_path
              })
            }
          }
        ]
      })
    },
    [removeAttachment, addAttachment, addToast]
  )

  const handleOpen = useCallback((attachment: Attachment) => {
    window.api.fs.openFile(attachment.local_path)
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Attachments
        </span>
        <button
          onClick={handleAttachFiles}
          disabled={!icloudEnabled}
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest transition-colors ${
            icloudEnabled
              ? 'text-muted hover:bg-foreground/6 hover:text-foreground'
              : 'cursor-not-allowed text-muted opacity-40'
          }`}
          title={
            !icloudEnabled
              ? 'Configure iCloud Drive in Settings to attach files'
              : 'Attach files'
          }
        >
          <Paperclip size={10} />
          Add
        </button>
      </div>

      {!icloudEnabled && icloudAvailable && attachments.length === 0 && (
        <p className="text-[10px] text-muted">
          Enable iCloud Drive in Settings to attach files
        </p>
      )}

      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {attachments.map((att) => (
            <AttachmentCard
              key={att.id}
              attachment={att}
              onRemove={() => handleRemove(att)}
              onOpen={() => handleOpen(att)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface AttachmentCardProps {
  attachment: Attachment
  onRemove: () => void
  onOpen: () => void
}

function AttachmentCard({ attachment, onRemove, onOpen }: AttachmentCardProps): React.JSX.Element {
  const truncated =
    attachment.filename.length > FILENAME_MAX_DISPLAY
      ? attachment.filename.slice(0, FILENAME_MAX_DISPLAY) + '...'
      : attachment.filename

  const icon = getFileIcon(attachment.mime_type)

  return (
    <button
      onClick={onOpen}
      className="group relative flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-foreground/6"
      title={attachment.filename}
    >
      <span className="text-muted">{icon}</span>
      <span className="text-[11px] font-light text-foreground">{truncated}</span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        className="absolute -right-1 -top-1 hidden rounded-full bg-surface p-0.5 text-muted shadow-md transition-colors hover:bg-danger/10 hover:text-danger group-hover:block"
        title="Remove attachment"
        aria-label={`Remove ${attachment.filename}`}
      >
        <X size={10} />
      </button>
    </button>
  )
}

function getFileIcon(mimeType: string): React.JSX.Element {
  if (mimeType.startsWith('image/')) return <FileImage size={14} />
  if (mimeType.startsWith('audio/')) return <FileAudio size={14} />
  if (mimeType.startsWith('video/')) return <FileVideo size={14} />
  if (mimeType.includes('zip') || mimeType.includes('gzip') || mimeType.includes('tar'))
    return <FileArchive size={14} />
  if (
    mimeType.includes('javascript') ||
    mimeType.includes('typescript') ||
    mimeType.includes('json') ||
    mimeType.includes('xml') ||
    mimeType.includes('html') ||
    mimeType.includes('css')
  )
    return <FileCode size={14} />
  if (mimeType.startsWith('text/') || mimeType.includes('pdf') || mimeType.includes('document'))
    return <FileText size={14} />
  return <File size={14} />
}
