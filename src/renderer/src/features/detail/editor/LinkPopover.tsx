import { useState, useRef, useEffect, useCallback } from 'react'
import type { Editor } from '@tiptap/react'
import { ExternalLink, Pencil, Trash2 } from 'lucide-react'
import { normalizeUrl } from './TiptapEditor'
import { useDismissibleSurface } from '../../../shared/motion/useDismissibleSurface'
import { useFocusRestore } from '../../../shared/hooks/useFocusRestore'

interface LinkPopoverProps {
  editor: Editor
  position: { top: number; left: number }
  url: string
  text: string
  onClose: () => void
}

export function LinkPopover({
  editor,
  position,
  url,
  text,
  onClose
}: LinkPopoverProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [editUrl, setEditUrl] = useState(url)
  const [editText, setEditText] = useState(text)
  const popoverRef = useRef<HTMLDivElement>(null)
  const urlInputRef = useRef<HTMLInputElement>(null)
  const surface = useDismissibleSurface(onClose, 'menu')
  const open = surface.props['data-state'] === 'open'
  const close = surface.close
  useFocusRestore(open, popoverRef)

  useEffect(() => {
    if (isEditing && urlInputRef.current) {
      urlInputRef.current.focus()
    }
  }, [isEditing])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent): void => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        close()
      }
    }
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [open, close])

  const handleSave = useCallback(() => {
    const { from, to } = editor.state.selection
    // Update the link
    editor
      .chain()
      .focus()
      .extendMarkRange('link')
      .setLink({ href: normalizeUrl(editUrl) })
      .command(({ tr, dispatch }) => {
        if (dispatch && editText !== text) {
          const linkMark = editor.schema.marks.link.create({ href: normalizeUrl(editUrl) })
          tr.replaceRangeWith(
            from,
            to,
            editor.schema.text(editText, [linkMark])
          )
        }
        return true
      })
      .run()
    close()
  }, [editor, editUrl, editText, text, close])

  const handleRemove = useCallback(() => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    close()
  }, [editor, close])

  return (
    <div
      ref={popoverRef}
      {...surface.props}
      className="ui-surface ui-menu fixed z-[10000] w-64 rounded-lg border border-border bg-surface p-3 shadow-xl"
      style={{ top: position.top, left: position.left }}
    >
      {isEditing ? (
        <div className="flex flex-col gap-2">
          <input
            ref={urlInputRef}
            type="text"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            placeholder="Display text"
            className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm font-light text-foreground focus:border-accent focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
            }}
          />
          <input
            type="text"
            value={editUrl}
            onChange={(e) => setEditUrl(e.target.value)}
            placeholder="URL"
            className="w-full rounded border border-border bg-transparent px-2 py-1 text-sm font-light text-foreground focus:border-accent focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSave()
            }}
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={close}
              className="rounded px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-muted hover:bg-foreground/6"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="rounded bg-accent px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-accent-fg hover:bg-accent/80"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="truncate text-sm font-light text-foreground">{text}</div>
          <div className="flex items-center gap-1 truncate text-[10px] text-muted">
            <ExternalLink size={10} />
            <button
              onClick={() => window.open(url, '_blank')}
              className="truncate text-accent hover:underline"
            >
              {url}
            </button>
          </div>
          <div className="flex items-center gap-1 border-t border-border pt-2">
            <button
              onClick={() => setIsEditing(true)}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-foreground hover:bg-foreground/6"
            >
              <Pencil size={10} />
              Edit
            </button>
            <button
              onClick={handleRemove}
              className="flex items-center gap-1.5 rounded px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-danger hover:bg-danger/10"
            >
              <Trash2 size={10} />
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
