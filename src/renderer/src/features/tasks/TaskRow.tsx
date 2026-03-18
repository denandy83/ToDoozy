import { useCallback, useRef, useState, useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import { StatusButton } from '../../shared/components/StatusButton'
import type { Task, Status } from '../../../../shared/types'

interface TaskRowProps {
  task: Task
  statuses: Status[]
  isSelected: boolean
  onSelect: (taskId: string) => void
  onStatusChange: (taskId: string, newStatusId: string) => void
  onTitleChange: (taskId: string, newTitle: string) => void
  onDelete: (taskId: string) => void
}

export function TaskRow({
  task,
  statuses,
  isSelected,
  onSelect,
  onStatusChange,
  onTitleChange,
  onDelete
}: TaskRowProps): React.JSX.Element {
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

  // Cleanup debounce on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const handleDoubleClick = useCallback(() => {
    setIsEditing(true)
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
      // Autosave with 1s debounce
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

  const handleClick = useCallback(() => {
    if (!isEditing) onSelect(task.id)
  }, [isEditing, onSelect, task.id])

  const handleStatusChange = useCallback(
    (newStatusId: string) => {
      onStatusChange(task.id, newStatusId)
    },
    [onStatusChange, task.id]
  )

  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onDelete(task.id)
    },
    [onDelete, task.id]
  )

  const doneStatus = statuses.find((s) => s.id === task.status_id)
  const isDone = doneStatus?.is_done === 1

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={`group flex items-center gap-3 px-4 py-2 transition-colors cursor-pointer ${
        isSelected
          ? 'bg-accent/12 border-l-2 border-accent/15'
          : 'border-l-2 border-transparent hover:bg-foreground/6'
      }`}
      role="row"
      aria-selected={isSelected}
      tabIndex={0}
    >
      <StatusButton
        currentStatusId={task.status_id}
        statuses={statuses}
        onStatusChange={handleStatusChange}
      />

      {isEditing ? (
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={handleEditChange}
          onKeyDown={handleEditKeyDown}
          onBlur={saveTitle}
          className="flex-1 bg-transparent text-[15px] font-light tracking-tight text-foreground focus:outline-none"
        />
      ) : (
        <span
          className={`flex-1 truncate text-[15px] font-light tracking-tight ${
            isDone ? 'text-muted line-through' : 'text-foreground'
          }`}
        >
          {task.title}
        </span>
      )}

      <button
        onClick={handleDelete}
        className="flex-shrink-0 rounded p-1 text-danger opacity-0 transition-opacity hover:bg-danger/10 focus-visible:opacity-100 group-hover:opacity-100"
        title="Delete task"
        aria-label="Delete task"
      >
        <Trash2 size={14} />
      </button>
    </div>
  )
}
