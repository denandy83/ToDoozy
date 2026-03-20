import { useCallback, useState, useRef, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useTaskStore, useSubtasks, useChildCount } from '../../shared/stores'
import { useStatusesByProject } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores'
import { StatusButton } from '../../shared/components/StatusButton'
import type { Task } from '../../../../shared/types'

interface DetailSubtasksProps {
  taskId: string
  projectId: string
}

export function DetailSubtasks({ taskId, projectId }: DetailSubtasksProps): React.JSX.Element {
  const subtasks = useSubtasks(taskId)
  const childCount = useChildCount(taskId)
  const statuses = useStatusesByProject(projectId)
  const { createSubtask, updateTask, setCurrentTask, setPendingDeleteTask } = useTaskStore()
  const currentUser = useAuthStore((s) => s.currentUser)

  const [showInput, setShowInput] = useState(false)
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showInput) inputRef.current?.focus()
  }, [showInput])

  const handleAdd = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || !currentUser) return

    const defaultStatus = statuses.find((s) => s.is_default === 1)
    if (!defaultStatus) return

    const maxOrder = subtasks.reduce((max, t) => Math.max(max, t.order_index), -1)
    await createSubtask(taskId, {
      id: crypto.randomUUID(),
      project_id: projectId,
      owner_id: currentUser.id,
      title: trimmed,
      status_id: defaultStatus.id,
      order_index: maxOrder + 1
    })
    setInputValue('')
    inputRef.current?.focus()
  }, [inputValue, currentUser, statuses, subtasks, createSubtask, taskId, projectId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleAdd()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setShowInput(false)
        setInputValue('')
      }
    },
    [handleAdd]
  )

  const handleStatusChange = useCallback(
    async (subtaskId: string, newStatusId: string) => {
      const newStatus = statuses.find((s) => s.id === newStatusId)
      const update: { status_id: string; completed_date?: string | null } = {
        status_id: newStatusId
      }
      if (newStatus?.is_done === 1) {
        update.completed_date = new Date().toISOString()
      } else {
        update.completed_date = null
      }
      await updateTask(subtaskId, update)
    },
    [statuses, updateTask]
  )

  const handleDelete = useCallback(
    (subtaskId: string) => {
      setPendingDeleteTask(subtaskId)
    },
    [setPendingDeleteTask]
  )

  const handleSubtaskClick = useCallback(
    (subtaskId: string) => {
      setCurrentTask(subtaskId)
    },
    [setCurrentTask]
  )

  const pct = childCount.total > 0 ? (childCount.done / childCount.total) * 100 : 0

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          Subtasks
        </span>
        {childCount.total > 0 && (
          <div className="flex items-center gap-1.5">
            <div className="h-1 w-8 overflow-hidden rounded-full bg-foreground/10">
              <div
                className="h-full rounded-full bg-accent transition-all motion-safe:duration-300"
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
              {childCount.done}/{childCount.total}
            </span>
          </div>
        )}
      </div>

      {/* Subtask list */}
      {subtasks.map((subtask) => (
        <SubtaskRow
          key={subtask.id}
          subtask={subtask}
          statuses={statuses}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onClick={handleSubtaskClick}
        />
      ))}

      {/* Add subtask input */}
      {showInput ? (
        <div className="flex items-center gap-2 px-2 py-1.5">
          {/* Spacer to align with subtask title text (after the status icon) */}
          <div className="flex-shrink-0 invisible"><div className="h-4 w-4" /></div>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (!inputValue.trim()) {
                setShowInput(false)
              }
            }}
            placeholder="Subtask title..."
            className="flex-1 bg-transparent text-[13px] font-light text-foreground placeholder:text-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          />
        </div>
      ) : (
        <button
          onClick={() => setShowInput(true)}
          className="flex items-center gap-1.5 py-1 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:text-foreground"
        >
          <Plus size={12} />
          Add Subtask
        </button>
      )}
    </div>
  )
}

interface SubtaskRowProps {
  subtask: Task
  statuses: import('../../../../shared/types').Status[]
  onStatusChange: (subtaskId: string, newStatusId: string) => void
  onDelete: (subtaskId: string) => void
  onClick: (subtaskId: string) => void
}

function SubtaskRow({
  subtask,
  statuses,
  onStatusChange,
  onDelete,
  onClick
}: SubtaskRowProps): React.JSX.Element {
  const doneStatus = statuses.find((s) => s.id === subtask.status_id)
  const isDone = doneStatus?.is_done === 1

  return (
    <div
      onClick={() => onClick(subtask.id)}
      className="group flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 transition-colors hover:bg-foreground/6"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onClick(subtask.id)
      }}
    >
      <StatusButton
        currentStatusId={subtask.status_id}
        statuses={statuses}
        onStatusChange={(newStatusId) => onStatusChange(subtask.id, newStatusId)}
      />
      <span
        className={`flex-1 truncate text-[13px] font-light tracking-tight ${
          isDone ? 'text-muted line-through' : 'text-foreground'
        }`}
      >
        {subtask.title}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete(subtask.id)
        }}
        className="flex-shrink-0 rounded p-0.5 text-danger opacity-0 transition-opacity hover:bg-danger/10 focus-visible:opacity-100 group-hover:opacity-100"
        title="Delete subtask"
        aria-label="Delete subtask"
      >
        <Trash2 size={12} />
      </button>
    </div>
  )
}
