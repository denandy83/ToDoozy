import { useCallback, useState, useRef, useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import { Bold, Italic, Strikethrough, Code, Link } from 'lucide-react'

interface BubbleToolbarProps {
  editor: Editor
}

export function BubbleToolbar({ editor }: BubbleToolbarProps): React.JSX.Element {
  const [showLinkInput, setShowLinkInput] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const linkInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showLinkInput && linkInputRef.current) {
      linkInputRef.current.focus()
    }
  }, [showLinkInput])

  const handleToggleLink = useCallback(() => {
    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run()
      return
    }
    const existing = editor.getAttributes('link').href as string | undefined
    setLinkUrl(existing ?? '')
    setShowLinkInput(true)
  }, [editor])

  const handleSubmitLink = useCallback(() => {
    if (linkUrl) {
      editor.chain().focus().setLink({ href: linkUrl }).run()
    } else {
      editor.chain().focus().unsetLink().run()
    }
    setShowLinkInput(false)
    setLinkUrl('')
  }, [editor, linkUrl])

  return (
    <BubbleMenu
      editor={editor}
      options={{
        placement: 'top'
      }}
      shouldShow={({ editor: ed }) => {
        const { from, to } = ed.state.selection
        if (from === to) return false
        if (ed.isActive('codeBlock')) return false
        return true
      }}
    >
      <div className="flex items-center gap-0.5 rounded-lg border border-border bg-surface px-1 py-0.5 shadow-xl">
        {showLinkInput ? (
          <div className="flex items-center gap-1 px-1">
            <input
              ref={linkInputRef}
              type="text"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              placeholder="Enter URL..."
              className="w-40 bg-transparent px-1 py-0.5 text-sm font-light text-foreground focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSubmitLink()
                }
                if (e.key === 'Escape') {
                  e.preventDefault()
                  setShowLinkInput(false)
                  setLinkUrl('')
                }
              }}
            />
            <button
              onClick={handleSubmitLink}
              className="rounded bg-accent px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-accent-fg hover:bg-accent/80"
            >
              OK
            </button>
          </div>
        ) : (
          <>
            <InlineButton
              icon={<Bold size={14} />}
              title="Bold (Cmd+B)"
              active={editor.isActive('bold')}
              onClick={() => editor.chain().focus().toggleBold().run()}
            />
            <InlineButton
              icon={<Italic size={14} />}
              title="Italic (Cmd+I)"
              active={editor.isActive('italic')}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            />
            <InlineButton
              icon={<Strikethrough size={14} />}
              title="Strikethrough (Cmd+Shift+S)"
              active={editor.isActive('strike')}
              onClick={() => editor.chain().focus().toggleStrike().run()}
            />
            <InlineButton
              icon={<Code size={14} />}
              title="Inline Code (Cmd+E)"
              active={editor.isActive('code')}
              onClick={() => editor.chain().focus().toggleCode().run()}
            />
            <div className="mx-0.5 h-4 w-px bg-border" />
            <InlineButton
              icon={<Link size={14} />}
              title="Link (Cmd+K)"
              active={editor.isActive('link')}
              onClick={handleToggleLink}
            />
          </>
        )}
      </div>
    </BubbleMenu>
  )
}

interface InlineButtonProps {
  icon: React.ReactNode
  title: string
  active: boolean
  onClick: () => void
}

function InlineButton({ icon, title, active, onClick }: InlineButtonProps): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`rounded p-1 transition-colors ${
        active
          ? 'bg-foreground/6 text-accent'
          : 'text-muted hover:bg-foreground/6 hover:text-foreground'
      }`}
      title={title}
    >
      {icon}
    </button>
  )
}
