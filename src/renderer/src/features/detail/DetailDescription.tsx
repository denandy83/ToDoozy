import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, Pencil } from 'lucide-react'

interface DetailDescriptionProps {
  description: string | null
  onDescriptionChange: (description: string | null) => void
}

export function DetailDescription({
  description,
  onDescriptionChange
}: DetailDescriptionProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [value, setValue] = useState(description ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setValue(description ?? '')
  }, [description])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      textareaRef.current.focus()
      // Auto-resize
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
    }
  }, [isEditing])

  const IMAGE_PATTERN = /!\[[^\]]*\]\(data:[^)]+\)/g
  const IMAGE_PLACEHOLDER = '![📷 pasted image]'

  // Show placeholders instead of base64 in textarea
  const displayValue = useMemo(
    () => value.replace(IMAGE_PATTERN, IMAGE_PLACEHOLDER),
    [value]
  )

  const imageCount = useMemo(
    () => (value.match(IMAGE_PATTERN) ?? []).length,
    [value]
  )

  // Extract base64 images from real value to re-insert when display is edited
  const imageDataRefs = useRef<string[]>([])
  useEffect(() => {
    imageDataRefs.current = value.match(IMAGE_PATTERN) ?? []
  }, [value])

  const handleDisplayChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const displayVal = e.target.value
      // Reconstruct real value by replacing placeholders back with base64 data
      let realVal = displayVal
      let idx = 0
      realVal = realVal.replace(/!\[📷 pasted image\]/g, () => {
        const img = imageDataRefs.current[idx]
        idx++
        return img ?? IMAGE_PLACEHOLDER
      })
      setValue(realVal)

      e.target.style.height = 'auto'
      e.target.style.height = e.target.scrollHeight + 'px'

      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        onDescriptionChange(realVal || null)
      }, 1000)
    },
    [onDescriptionChange]
  )


  const handleBlur = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    onDescriptionChange(value || null)
  }, [value, onDescriptionChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setIsEditing(false)
    }
  }, [])

  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (!file || file.size > 10 * 1024 * 1024) return
          const reader = new FileReader()
          reader.onload = () => {
            const base64 = reader.result as string
            const imgMd = `\n![pasted image](${base64})\n`
            const newVal = value + imgMd
            setValue(newVal)
            onDescriptionChange(newVal)
          }
          reader.readAsDataURL(file)
          return
        }
      }
    },
    [value, onDescriptionChange]
  )

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Description
        </span>
        <button
          onClick={() => setIsEditing(!isEditing)}
          className={`rounded p-0.5 transition-colors hover:bg-foreground/6 ${
            isEditing ? 'text-accent' : 'text-muted'
          }`}
          title={isEditing ? 'Preview' : 'Edit'}
          aria-label={isEditing ? 'Preview' : 'Edit'}
        >
          {isEditing ? <Eye size={12} /> : <Pencil size={12} />}
        </button>
      </div>

      {isEditing ? (
        <div className="flex flex-col gap-2">
          <textarea
            ref={textareaRef}
            value={displayValue}
            onChange={handleDisplayChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Add a description... (Markdown supported, Cmd+V to paste images)"
            className="min-h-[80px] w-full resize-none rounded border border-border bg-transparent px-3 py-2 text-sm font-light text-foreground focus:outline-none focus:border-accent"
          />
          {imageCount > 0 && (
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted">
              {imageCount} pasted {imageCount === 1 ? 'image' : 'images'} (visible in preview)
            </p>
          )}
        </div>
      ) : (
        <div
          onClick={() => setIsEditing(true)}
          className="min-h-[40px] cursor-text rounded border border-transparent px-3 py-2 text-sm font-light text-foreground/80 transition-colors hover:border-border"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setIsEditing(true)
            }
          }}
        >
          {value ? (
            <MarkdownPreview text={value} />
          ) : (
            <span className="text-muted/60">Click to add description...</span>
          )}
        </div>
      )}
    </div>
  )
}

interface MarkdownPreviewProps {
  text: string
}

function MarkdownPreview({ text }: MarkdownPreviewProps): React.JSX.Element {
  // Simple markdown rendering: images, bold, italic, code, links, line breaks
  const lines = text.split('\n')

  return (
    <div className="space-y-1">
      {lines.map((line, i) => (
        <MarkdownLine key={i} line={line} />
      ))}
    </div>
  )
}

interface MarkdownLineProps {
  line: string
}

function MarkdownLine({ line }: MarkdownLineProps): React.JSX.Element {
  if (!line.trim()) return <br />

  // Image: ![alt](src)
  const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
  if (imgMatch) {
    return (
      <img
        src={imgMatch[2]}
        alt={imgMatch[1]}
        className="max-h-48 max-w-full rounded"
      />
    )
  }

  // Heading
  if (line.startsWith('### ')) {
    return <h3 className="text-sm font-bold">{line.substring(4)}</h3>
  }
  if (line.startsWith('## ')) {
    return <h2 className="text-base font-bold">{line.substring(3)}</h2>
  }
  if (line.startsWith('# ')) {
    return <h1 className="text-lg font-bold">{line.substring(2)}</h1>
  }

  // Inline formatting
  const formatted = line
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code class="rounded bg-foreground/10 px-1 py-0.5 text-xs">$1</code>')

  return <p dangerouslySetInnerHTML={{ __html: formatted }} />
}
