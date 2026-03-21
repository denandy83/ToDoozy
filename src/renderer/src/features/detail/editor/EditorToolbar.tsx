import { useState, useRef, useEffect } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Code2,
  Image,
  Paperclip,
  Minus,
  ChevronDown
} from 'lucide-react'

interface EditorToolbarProps {
  editor: Editor
}

export function EditorToolbar({ editor }: EditorToolbarProps): React.JSX.Element {
  const [headingOpen, setHeadingOpen] = useState(false)
  const headingRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!headingOpen) return
    const handleClick = (e: MouseEvent): void => {
      if (headingRef.current && !headingRef.current.contains(e.target as Node)) {
        setHeadingOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [headingOpen])

  const handleImageInsert = (): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file || file.size > 10 * 1024 * 1024) return
      const reader = new FileReader()
      reader.onload = () => {
        editor.chain().focus().setImage({ src: reader.result as string }).run()
      }
      reader.readAsDataURL(file)
    }
    input.click()
  }

  const currentHeading = editor.isActive('heading', { level: 1 })
    ? 'H1'
    : editor.isActive('heading', { level: 2 })
      ? 'H2'
      : editor.isActive('heading', { level: 3 })
        ? 'H3'
        : 'Heading'

  return (
    <div className="flex items-center gap-0.5 border-b border-border px-2 py-1">
      {/* Heading dropdown */}
      <div ref={headingRef} className="relative">
        <button
          onClick={() => setHeadingOpen(!headingOpen)}
          className={`flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-widest transition-colors hover:bg-foreground/6 ${
            editor.isActive('heading') ? 'text-accent' : 'text-muted'
          }`}
          title="Heading"
        >
          {currentHeading}
          <ChevronDown size={10} />
        </button>
        {headingOpen && (
          <div className="absolute left-0 top-full z-[10000] mt-1 w-32 rounded-lg border border-border bg-surface py-1 shadow-xl">
            {([1, 2, 3] as const).map((level) => (
              <button
                key={level}
                onClick={() => {
                  editor.chain().focus().toggleHeading({ level }).run()
                  setHeadingOpen(false)
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm font-light transition-colors hover:bg-foreground/6 ${
                  editor.isActive('heading', { level }) ? 'text-accent' : ''
                }`}
              >
                {level === 1 && <Heading1 size={14} />}
                {level === 2 && <Heading2 size={14} />}
                {level === 3 && <Heading3 size={14} />}
                Heading {level}
              </button>
            ))}
          </div>
        )}
      </div>

      <Separator />

      <ToolbarButton
        icon={<List size={14} />}
        title="Bullet List (Cmd+Shift+8)"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      />
      <ToolbarButton
        icon={<ListOrdered size={14} />}
        title="Numbered List (Cmd+Shift+7)"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      />
      <ToolbarButton
        icon={<CheckSquare size={14} />}
        title="Checklist (Cmd+Shift+9)"
        active={editor.isActive('taskList')}
        onClick={() => editor.chain().focus().toggleTaskList().run()}
      />

      <Separator />

      <ToolbarButton
        icon={<Code2 size={14} />}
        title="Code Block"
        active={editor.isActive('codeBlock')}
        onClick={() => editor.chain().focus().toggleCodeBlock().run()}
      />
      <ToolbarButton
        icon={<Minus size={14} />}
        title="Horizontal Rule"
        active={false}
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      />
      <ToolbarButton
        icon={<Image size={14} />}
        title="Insert Image"
        active={false}
        onClick={handleImageInsert}
      />
      <ToolbarButton
        icon={<Paperclip size={14} />}
        title="Configure cloud storage in Settings to attach files"
        active={false}
        onClick={() => {}}
        disabled
      />
    </div>
  )
}

interface ToolbarButtonProps {
  icon: React.ReactNode
  title: string
  active: boolean
  onClick: () => void
  disabled?: boolean
}

function ToolbarButton({
  icon,
  title,
  active,
  onClick,
  disabled
}: ToolbarButtonProps): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded p-1 transition-colors ${
        disabled
          ? 'cursor-not-allowed opacity-30'
          : active
            ? 'bg-foreground/6 text-accent'
            : 'text-muted hover:bg-foreground/6 hover:text-foreground'
      }`}
      title={title}
    >
      {icon}
    </button>
  )
}

function Separator(): React.JSX.Element {
  return <div className="mx-1 h-4 w-px bg-border" />
}
