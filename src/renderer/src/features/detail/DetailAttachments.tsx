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
  const { hydrateAttachments, addAttachment, removeAttachment } = useAttachmentStore()
  const attachments = useAttachmentsByTaskId(taskId)
  const { addToast } = useToast()
  const handleAttachFiles = useAttachFiles(taskId)

  useEffect(() => {
    hydrateAttachments(taskId)
  }, [taskId, hydrateAttachments])

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
              // Re-attach would require the original file — not possible after deletion
              // Just inform the user
              addToast({ message: 'Cannot undo attachment removal', variant: 'danger' })
            }
          }
        ]
      })
    },
    [removeAttachment, addAttachment, addToast]
  )

  const handleOpen = useCallback(async (attachment: Attachment) => {
    try {
      await window.api.attachments.open(attachment.id)
    } catch (err) {
      console.error('Failed to open attachment:', err)
      addToast({ message: 'Failed to open file', variant: 'danger' })
    }
  }, [addToast])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Attachments
        </span>
        <button
          onClick={handleAttachFiles}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest transition-colors text-muted hover:bg-foreground/6 hover:text-foreground"
          title="Attach files"
        >
          <Paperclip size={10} />
          Add
        </button>
      </div>

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

  return (
    <div className="group relative flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 transition-colors hover:bg-foreground/6">
      <button
        onClick={onOpen}
        className="flex items-center gap-2 cursor-pointer"
        title={attachment.filename}
      >
        <span className="text-muted">{getFileIcon(attachment.mime_type)}</span>
        <span className="text-[11px] font-light text-foreground">{truncated}</span>
      </button>
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
    </div>
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
