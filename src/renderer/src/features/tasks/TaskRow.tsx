import { useCallback, useRef, useState, useEffect } from 'react'
import { Trash2, ChevronRight, GripVertical, Plus } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { StatusButton } from '../../shared/components/StatusButton'
import { LabelChip } from '../../shared/components/LabelChip'
import { LabelPicker } from '../../shared/components/LabelPicker'
import { useTaskStore, selectSubtasks, selectChildCount, selectTaskLabels } from '../../shared/stores'
import { useLabelStore } from '../../shared/stores'
import type { Task, Status, Label } from '../../../../shared/types'
import type { DropIndicator } from './useDragAndDrop'

interface TaskRowProps {
  task: Task
  statuses: Status[]
  allLabels: Label[]
  isSelected: boolean
  depth: number
  isExpanded: boolean
  filterOpacity?: number
  dropIndicator?: DropIndicator | null
  isDragOverlay?: boolean
  onSelect: (taskId: string) => void
  onStatusChange: (taskId: string, newStatusId: string) => void
  onTitleChange: (taskId: string, newTitle: string) => void
  onDelete: (taskId: string) => void
  onToggleExpanded: (taskId: string) => void
  onAddLabel: (taskId: string, labelId: string) => void
  onRemoveLabel: (taskId: string, labelId: string) => void
  onCreateLabel: (name: string, color: string) => void
}

export function TaskRow({
  task,
  statuses,
  allLabels,
  isSelected,
  depth,
  isExpanded,
  filterOpacity,
  dropIndicator,
  isDragOverlay,
  onSelect,
  onStatusChange,
  onTitleChange,
  onDelete,
  onToggleExpanded,
  onAddLabel,
  onRemoveLabel,
  onCreateLabel
}: TaskRowProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(task.title)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addLabelBtnRef = useRef<HTMLButtonElement>(null)

  const childCount = useTaskStore(selectChildCount(task.id))
  const hasChildren = childCount.total > 0
  const taskLabels = useTaskStore(selectTaskLabels(task.id))
  const toggleLabelFilter = useLabelStore((s) => s.toggleLabelFilter)

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition: sortableTransition,
    isDragging
  } = useSortable({
    id: task.id,
    disabled: isDragOverlay ?? false
  })

  const style = isDragOverlay
    ? undefined
    : {
        transform: CSS.Transform.toString(transform),
        transition: sortableTransition ?? undefined,
        paddingLeft: `${16 + depth * 24}px`
      }

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

  const handleChevronClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onToggleExpanded(task.id)
    },
    [onToggleExpanded, task.id]
  )

  const handleOpenPicker = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (pickerOpen) {
        setPickerOpen(false)
        return
      }
      const btn = addLabelBtnRef.current
      if (btn) {
        const rect = btn.getBoundingClientRect()
        setPickerPos({ top: rect.bottom + 4, left: rect.left })
      }
      setPickerOpen(true)
    },
    [pickerOpen]
  )

  const handleToggleLabel = useCallback(
    (labelId: string) => {
      const assignedIds = new Set(taskLabels.map((l) => l.id))
      if (assignedIds.has(labelId)) {
        onRemoveLabel(task.id, labelId)
      } else {
        onAddLabel(task.id, labelId)
      }
    },
    [task.id, taskLabels, onAddLabel, onRemoveLabel]
  )

  const handlePickerCreateLabel = useCallback(
    (name: string, color: string) => {
      onCreateLabel(name, color)
    },
    [onCreateLabel]
  )

  const assignedLabelIds = new Set(taskLabels.map((l) => l.id))

  const doneStatus = statuses.find((s) => s.id === task.status_id)
  const isDone = doneStatus?.is_done === 1

  const isDropAbove = dropIndicator?.targetId === task.id && dropIndicator.intent === 'above'
  const isDropBelow = dropIndicator?.targetId === task.id && dropIndicator.intent === 'below'
  const isDropInside = dropIndicator?.targetId === task.id && dropIndicator.intent === 'inside'

  const rowStyle = isDragOverlay
    ? { paddingLeft: `${16 + depth * 24}px` }
    : {
        ...style,
        opacity: filterOpacity !== undefined ? filterOpacity : (isDragging ? 0.3 : 1)
      }

  return (
    <>
      <div
        ref={setNodeRef}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        className={`group relative flex items-center gap-2 py-2 pr-4 transition-all cursor-pointer ${
          isSelected
            ? 'bg-accent/12 border-l-2 border-accent/15'
            : 'border-l-2 border-transparent hover:bg-foreground/6'
        } ${isDropInside ? 'bg-accent/8 scale-[1.01]' : ''}`}
        style={rowStyle}
        {...attributes}
        role="row"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        tabIndex={0}
      >
        {/* Drop indicator: above line */}
        {isDropAbove && (
          <div className="absolute left-0 right-0 top-0 z-10 h-0.5 bg-accent" />
        )}
        {/* Drop indicator: below line */}
        {isDropBelow && (
          <div className="absolute bottom-0 left-0 right-0 z-10 h-0.5 bg-accent" />
        )}

        {/* Drag handle */}
        <button
          ref={setActivatorNodeRef}
          {...listeners}
          className="flex-shrink-0 cursor-grab rounded p-0.5 text-muted/0 transition-colors group-hover:text-muted/50 hover:text-foreground active:cursor-grabbing"
          tabIndex={-1}
          aria-label="Drag to reorder"
        >
          <GripVertical size={12} />
        </button>

        {/* Expand/collapse chevron */}
        <button
          onClick={handleChevronClick}
          className={`flex-shrink-0 rounded p-0.5 transition-colors ${
            hasChildren
              ? 'text-muted hover:bg-foreground/6 hover:text-foreground'
              : 'invisible'
          }`}
          aria-label={isExpanded ? 'Collapse subtasks' : 'Expand subtasks'}
          tabIndex={-1}
        >
          <ChevronRight
            size={12}
            className={`transition-transform motion-safe:duration-150 ${
              isExpanded ? 'rotate-90' : ''
            }`}
          />
        </button>

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

        {/* Label chips */}
        {taskLabels.length > 0 && (
          <div className="flex flex-shrink-0 items-center gap-1">
            {taskLabels.map((label) => (
              <LabelChip
                key={label.id}
                name={label.name}
                color={label.color}
                onClick={() => toggleLabelFilter(label.id)}
              />
            ))}
          </div>
        )}

        {/* Add label button */}
        <button
          ref={addLabelBtnRef}
          onClick={handleOpenPicker}
          className="flex-shrink-0 rounded p-0.5 text-muted/0 transition-colors group-hover:text-muted/50 hover:text-foreground hover:bg-foreground/6"
          title="Add label"
          aria-label="Add label"
          tabIndex={-1}
        >
          <Plus size={14} />
        </button>

        {/* Subtask count badge + progress */}
        {hasChildren && (
          <SubtaskBadge done={childCount.done} total={childCount.total} />
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

      {/* Label picker portal */}
      {pickerOpen && pickerPos &&
        createPortal(
          <div
            className="fixed z-[9999]"
            style={{ top: pickerPos.top, left: pickerPos.left }}
          >
            <LabelPicker
              allLabels={allLabels}
              assignedLabelIds={assignedLabelIds}
              onToggleLabel={handleToggleLabel}
              onCreateLabel={handlePickerCreateLabel}
              onClose={() => setPickerOpen(false)}
            />
          </div>,
          document.body
        )
      }

      {/* Render subtasks if expanded */}
      {hasChildren && isExpanded && !isDragging && (
        <SubtaskList
          parentId={task.id}
          statuses={statuses}
          allLabels={allLabels}
          depth={depth + 1}
          dropIndicator={dropIndicator}
          onSelect={onSelect}
          onStatusChange={onStatusChange}
          onTitleChange={onTitleChange}
          onDelete={onDelete}
          onToggleExpanded={onToggleExpanded}
          onAddLabel={onAddLabel}
          onRemoveLabel={onRemoveLabel}
          onCreateLabel={onCreateLabel}
        />
      )}
    </>
  )
}

interface SubtaskBadgeProps {
  done: number
  total: number
}

function SubtaskBadge({ done, total }: SubtaskBadgeProps): React.JSX.Element {
  const pct = total > 0 ? (done / total) * 100 : 0
  return (
    <div className="flex flex-shrink-0 items-center gap-1.5">
      <div className="h-1 w-8 overflow-hidden rounded-full bg-foreground/10">
        <div
          className="h-full rounded-full bg-accent transition-all motion-safe:duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
        {done}/{total}
      </span>
    </div>
  )
}

interface SubtaskListProps {
  parentId: string
  statuses: Status[]
  allLabels: Label[]
  depth: number
  dropIndicator?: DropIndicator | null
  onSelect: (taskId: string) => void
  onStatusChange: (taskId: string, newStatusId: string) => void
  onTitleChange: (taskId: string, newTitle: string) => void
  onDelete: (taskId: string) => void
  onToggleExpanded: (taskId: string) => void
  onAddLabel: (taskId: string, labelId: string) => void
  onRemoveLabel: (taskId: string, labelId: string) => void
  onCreateLabel: (name: string, color: string) => void
}

function SubtaskList({
  parentId,
  statuses,
  allLabels,
  depth,
  dropIndicator,
  onSelect,
  onStatusChange,
  onTitleChange,
  onDelete,
  onToggleExpanded,
  onAddLabel,
  onRemoveLabel,
  onCreateLabel
}: SubtaskListProps): React.JSX.Element {
  const subtasks = useTaskStore(selectSubtasks(parentId))
  const expandedTaskIds = useTaskStore((s) => s.expandedTaskIds)
  const currentTaskId = useTaskStore((s) => s.currentTaskId)

  return (
    <>
      {subtasks.map((child) => (
        <TaskRow
          key={child.id}
          task={child}
          statuses={statuses}
          allLabels={allLabels}
          isSelected={currentTaskId === child.id}
          depth={depth}
          isExpanded={expandedTaskIds.has(child.id)}
          dropIndicator={dropIndicator}
          onSelect={onSelect}
          onStatusChange={onStatusChange}
          onTitleChange={onTitleChange}
          onDelete={onDelete}
          onToggleExpanded={onToggleExpanded}
          onAddLabel={onAddLabel}
          onRemoveLabel={onRemoveLabel}
          onCreateLabel={onCreateLabel}
        />
      ))}
    </>
  )
}
