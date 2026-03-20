import { useState, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { Plus } from 'lucide-react'

interface AddTaskInputProps {
  viewName: string
  onSubmit: (title: string) => void
  disabled?: boolean
}

export interface AddTaskInputHandle {
  focus: () => void
}

export const AddTaskInput = forwardRef<AddTaskInputHandle, AddTaskInputProps>(
  function AddTaskInput({ viewName, onSubmit, disabled }, ref) {
    const [value, setValue] = useState('')
    const inputRef = useRef<HTMLInputElement>(null)

    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus()
    }))

    const handleSubmit = useCallback(() => {
      const trimmed = value.trim()
      if (!trimmed) return
      onSubmit(trimmed)
      setValue('')
    }, [value, onSubmit])

    const handleKeyDown = useCallback(
      (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          handleSubmit()
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setValue('')
          inputRef.current?.blur()
        }
      },
      [handleSubmit]
    )

    return (
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Plus size={14} className="flex-shrink-0 text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Add to ${viewName}...`}
          disabled={disabled}
          className="flex-1 bg-transparent text-[15px] font-light tracking-tight text-foreground placeholder:text-muted/40 disabled:opacity-50"
        />
      </div>
    )
  }
)
