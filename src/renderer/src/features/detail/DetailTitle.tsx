import { useCallback, useEffect, useRef, useState } from 'react'

interface DetailTitleProps {
  title: string
  onTitleChange: (title: string) => void
}

export function DetailTitle({ title, onTitleChange }: DetailTitleProps): React.JSX.Element {
  const [value, setValue] = useState(title)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setValue(title)
  }, [title])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
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
      ;(e.target as HTMLInputElement).blur()
    }
  }, [])

  return (
    <input
      type="text"
      value={value}
      onChange={handleChange}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      className="w-full bg-transparent text-xl font-light tracking-tight text-foreground focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
      placeholder="Task title..."
      aria-label="Task title"
      data-detail-title=""
      data-detail-field="0"
    />
  )
}
