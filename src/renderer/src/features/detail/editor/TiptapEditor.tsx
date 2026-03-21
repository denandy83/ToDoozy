import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import LinkExtension from '@tiptap/extension-link'
import ImageExtension from '@tiptap/extension-image'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Placeholder from '@tiptap/extension-placeholder'
import { Markdown } from 'tiptap-markdown'
import { EditorToolbar } from './EditorToolbar'
import { BubbleToolbar } from './BubbleToolbar'
import { SlashCommandMenu } from './SlashCommandMenu'
import { LinkPopover } from './LinkPopover'

interface TiptapEditorProps {
  content: string | null
  onChange: (content: string | null) => void
}

export function TiptapEditor({ content, onChange }: TiptapEditorProps): React.JSX.Element {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [slashMenu, setSlashMenu] = useState<{ top: number; left: number } | null>(null)
  const [linkPopover, setLinkPopover] = useState<{
    top: number
    left: number
    url: string
    text: string
  } | null>(null)
  const editorContainerRef = useRef<HTMLDivElement>(null)
  const isExternalUpdate = useRef(false)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        codeBlock: {
          HTMLAttributes: {
            class: 'tiptap-code-block'
          }
        }
      }),
      LinkExtension.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: {
          class: 'tiptap-link'
        }
      }),
      ImageExtension.configure({
        HTMLAttributes: {
          class: 'tiptap-image'
        }
      }),
      TaskList,
      TaskItem.configure({
        nested: true
      }),
      Placeholder.configure({
        placeholder: 'Add a description...'
      }),
      Markdown.configure({
        html: false,
        transformPastedText: true,
        transformCopiedText: true
      })
    ],
    content: content ?? '',
    editorProps: {
      attributes: {
        class: 'tiptap-editor-content'
      },
      handleKeyDown: (_view, event) => {
        // Cmd+K for link when editor is focused
        if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
          event.preventDefault()
          event.stopPropagation()
          // Toggle link via bubble menu logic
          const ed = editor
          if (!ed) return true
          if (ed.isActive('link')) {
            ed.chain().focus().unsetLink().run()
          } else {
            const { from, to } = ed.state.selection
            if (from !== to) {
              const url = prompt('Enter URL:')
              if (url) {
                ed.chain().focus().setLink({ href: url }).run()
              }
            }
          }
          return true
        }
        // Escape blurs the editor
        if (event.key === 'Escape') {
          editor?.commands.blur()
          return true
        }
        // Cmd+Enter exits code block
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key === 'Enter' &&
          editor?.isActive('codeBlock')
        ) {
          editor.chain().focus().exitCode().run()
          return true
        }
        return false
      },
      handleClick: (_view, _pos, event) => {
        // Check if clicked on a link
        const target = event.target as HTMLElement
        const linkEl = target.closest('a.tiptap-link')
        if (linkEl && editor) {
          event.preventDefault()
          const rect = linkEl.getBoundingClientRect()
          setLinkPopover({
            top: rect.bottom + 4,
            left: rect.left,
            url: linkEl.getAttribute('href') ?? '',
            text: linkEl.textContent ?? ''
          })
          return true
        }
        setLinkPopover(null)
        return false
      }
    },
    onUpdate: ({ editor: ed }) => {
      if (isExternalUpdate.current) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const md = getMarkdown(ed)
        onChange(md || null)
      }, 1000)

      // Check for slash command
      const { from } = ed.state.selection
      const textBefore = ed.state.doc.textBetween(Math.max(0, from - 1), from)
      if (textBefore === '/') {
        // Get cursor position for menu
        const coords = ed.view.coordsAtPos(from)
        setSlashMenu({ top: coords.bottom + 4, left: coords.left })
      } else {
        setSlashMenu(null)
      }
    }
  })

  // Sync external content changes
  useEffect(() => {
    if (!editor || editor.isDestroyed) return
    const currentMd = getMarkdown(editor)
    if (currentMd !== (content ?? '')) {
      isExternalUpdate.current = true
      editor.commands.setContent(content ?? '')
      isExternalUpdate.current = false
    }
  }, [content, editor])

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  // Handle image paste
  useEffect(() => {
    if (!editor) return
    const handlePaste = (event: ClipboardEvent): void => {
      const items = event.clipboardData?.items
      if (!items) return
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          event.preventDefault()
          const file = item.getAsFile()
          if (!file || file.size > 10 * 1024 * 1024) return
          const reader = new FileReader()
          reader.onload = () => {
            editor.chain().focus().setImage({ src: reader.result as string }).run()
          }
          reader.readAsDataURL(file)
          return
        }
      }
    }

    const el = editor.view.dom
    el.addEventListener('paste', handlePaste)
    return () => el.removeEventListener('paste', handlePaste)
  }, [editor])

  const handleBlur = useCallback(() => {
    if (!editor) return
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const md = getMarkdown(editor)
    onChange(md || null)
  }, [editor, onChange])

  if (!editor) return <div />

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        Description
      </span>
      <div
        ref={editorContainerRef}
        className="rounded border border-border transition-colors focus-within:border-accent"
      >
        <EditorToolbar editor={editor} />
        <div onBlur={handleBlur}>
          <EditorContent editor={editor} />
        </div>
        <BubbleToolbar editor={editor} />
      </div>

      {slashMenu && (
        <SlashCommandMenu
          editor={editor}
          position={slashMenu}
          onClose={() => setSlashMenu(null)}
        />
      )}

      {linkPopover && (
        <LinkPopover
          editor={editor}
          position={linkPopover}
          url={linkPopover.url}
          text={linkPopover.text}
          onClose={() => setLinkPopover(null)}
        />
      )}
    </div>
  )
}

function getMarkdown(editor: Editor): string {
  const storage = editor.storage as unknown as Record<string, Record<string, unknown>>
  const mdStorage = storage.markdown
  if (mdStorage && typeof mdStorage.getMarkdown === 'function') {
    return (mdStorage.getMarkdown() as string) ?? ''
  }
  return ''
}
