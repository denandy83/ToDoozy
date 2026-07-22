import { useState, useRef, useEffect, useCallback } from 'react'
import type { Task } from '../../../../../shared/types'

interface UseInlineTitleEditResult {
  isEditing: boolean
  setIsEditing: React.Dispatch<React.SetStateAction<boolean>>
  editValue: string
  inputRef: React.RefObject<HTMLInputElement | null>
  saveTitle: () => void
  handleEditKeyDown: (e: React.KeyboardEvent) => void
  handleEditChange: (e: React.ChangeEvent<HTMLInputElement>) => void
}

/**
 * Inline title editing for a TaskRow: edit state, the debounced autosave, and
 * the keyboard handlers. Extracted verbatim from TaskRow (Story #107) — the
 * 1s autosave debounce, effect deps, and callback deps are unchanged.
 */
export function useInlineTitleEdit(
  task: Task,
  onTitleChange: (taskId: string, newTitle: string) => void
): UseInlineTitleEditResult {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(task.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!isEditing) setEditValue(task.title)
  }, [task.title, isEditing])

  useEffect(() => {
    if (isEditing) inputRef.current?.focus()
  }, [isEditing])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const saveTitle = useCallback(() => {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== task.title) {
      onTitleChange(task.id, trimmed)
    } else {
      setEditValue(task.title)
    }
    setIsEditing(false)
  }, [editValue, task.id, task.title, onTitleChange])

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        saveTitle()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setEditValue(task.title)
        setIsEditing(false)
      }
    },
    [saveTitle, task.title]
  )

  const handleEditChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = e.target.value
      setEditValue(val)
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(() => {
        const trimmed = val.trim()
        if (trimmed && trimmed !== task.title) {
          onTitleChange(task.id, trimmed)
        }
      }, 1000)
    },
    [task.id, task.title, onTitleChange]
  )

  return { isEditing, setIsEditing, editValue, inputRef, saveTitle, handleEditKeyDown, handleEditChange }
}
