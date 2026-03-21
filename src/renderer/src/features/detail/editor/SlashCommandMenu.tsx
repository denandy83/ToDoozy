import { useState, useEffect, useCallback, useRef } from 'react'
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
  Minus
} from 'lucide-react'

interface SlashCommandMenuProps {
  editor: Editor
  position: { top: number; left: number }
  onClose: () => void
}

interface SlashCommandItem {
  label: string
  icon: React.ReactNode
  action: (editor: Editor) => void
  disabled?: boolean
  tooltip?: string
}

const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    label: 'Heading 1',
    icon: <Heading1 size={14} />,
    action: (editor) => editor.chain().focus().toggleHeading({ level: 1 }).run()
  },
  {
    label: 'Heading 2',
    icon: <Heading2 size={14} />,
    action: (editor) => editor.chain().focus().toggleHeading({ level: 2 }).run()
  },
  {
    label: 'Heading 3',
    icon: <Heading3 size={14} />,
    action: (editor) => editor.chain().focus().toggleHeading({ level: 3 }).run()
  },
  {
    label: 'Bullet List',
    icon: <List size={14} />,
    action: (editor) => editor.chain().focus().toggleBulletList().run()
  },
  {
    label: 'Numbered List',
    icon: <ListOrdered size={14} />,
    action: (editor) => editor.chain().focus().toggleOrderedList().run()
  },
  {
    label: 'Checklist',
    icon: <CheckSquare size={14} />,
    action: (editor) => editor.chain().focus().toggleTaskList().run()
  },
  {
    label: 'Code Block',
    icon: <Code2 size={14} />,
    action: (editor) => editor.chain().focus().toggleCodeBlock().run()
  },
  {
    label: 'Image',
    icon: <Image size={14} />,
    action: (editor) => {
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
  },
  {
    label: 'Attach File',
    icon: <Paperclip size={14} />,
    action: () => {},
    disabled: true,
    tooltip: 'Configure cloud storage in Settings to attach files'
  },
  {
    label: 'Horizontal Rule',
    icon: <Minus size={14} />,
    action: (editor) => editor.chain().focus().setHorizontalRule().run()
  }
]

export function SlashCommandMenu({
  editor,
  position,
  onClose
}: SlashCommandMenuProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)

  const executeCommand = useCallback(
    (index: number) => {
      const cmd = SLASH_COMMANDS[index]
      if (cmd.disabled) return
      // Delete the slash character
      const { from } = editor.state.selection
      editor.chain().deleteRange({ from: from - 1, to: from }).run()
      cmd.action(editor)
      onClose()
    },
    [editor, onClose]
  )

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((prev) => (prev + 1) % SLASH_COMMANDS.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        e.stopPropagation()
        setSelectedIndex((prev) => (prev - 1 + SLASH_COMMANDS.length) % SLASH_COMMANDS.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        executeCommand(selectedIndex)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [selectedIndex, executeCommand, onClose])

  useEffect(() => {
    const handleClick = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return (
    <div
      ref={menuRef}
      className="fixed z-[10000] w-52 rounded-lg border border-border bg-surface py-1 shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in motion-safe:duration-100"
      style={{ top: position.top, left: position.left }}
    >
      {SLASH_COMMANDS.map((cmd, i) => (
        <button
          key={cmd.label}
          className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-sm font-light transition-colors ${
            i === selectedIndex ? 'bg-foreground/6' : ''
          } ${cmd.disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-foreground/6'}`}
          onMouseEnter={() => setSelectedIndex(i)}
          onClick={() => executeCommand(i)}
          title={cmd.tooltip}
          disabled={cmd.disabled}
        >
          <span className="text-muted">{cmd.icon}</span>
          <span>{cmd.label}</span>
        </button>
      ))}
    </div>
  )
}
