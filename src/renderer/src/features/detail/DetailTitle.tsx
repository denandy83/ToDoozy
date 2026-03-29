import { useCallback, useEffect, useRef, useState } from 'react'

interface DetailTitleProps {
  title: string
  onTitleChange: (title: string) => void
}

export function DetailTitle({ title, onTitleChange }: DetailTitleProps): React.JSX.Element {
  const [value, setValue] = useState(title)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setValue(title)
  }, [title])

  // Auto-resize textarea to fit content
  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    }
  }, [value])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const val = e.target.value
      setValue(val)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const trimmed = val.trim()
        if (trimmed && trimmed !== title) {
          onTitleChange(trimmed)
        }
      }, 1000)
    },
    [title, onTitleChange]
  )

  const handleBlur = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
    const trimmed = value.trim()
    if (trimmed && trimmed !== title) {
      onTitleChange(trimmed)
    }
  }, [value, title, onTitleChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      ;(e.target as HTMLTextAreaElement).blur()
    }
  }, [])

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      rows={1}
      className="w-full resize-none overflow-hidden bg-transparent text-xl font-light tracking-tight text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      placeholder="Task title..."
      aria-label="Task title"
      data-detail-title=""
      data-detail-field="0"
    />
  )
}
