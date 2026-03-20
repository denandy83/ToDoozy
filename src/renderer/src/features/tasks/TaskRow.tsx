import { useCallback, useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Trash2, ChevronRight, Plus, Sun } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { StatusButton } from '../../shared/components/StatusButton'
import { LabelChip } from '../../shared/components/LabelChip'
import { LabelPicker } from '../../shared/components/LabelPicker'
import { PriorityBadge } from '../../shared/components/PriorityBadge'
import { PRIORITY_LEVELS } from '../../shared/components/PriorityIndicator'
import { usePrioritySettings } from '../../shared/hooks/usePrioritySettings'
import { useTaskStore, useSubtasks, useChildCount, useTaskLabelsHook } from '../../shared/stores'
import { useLabelStore } from '../../shared/stores'
import { useAuthStore } from '../../shared/stores'
import { useContextMenuStore } from '../../shared/stores/contextMenuStore'
import type { Task, Status, Label, Project } from '../../../../shared/types'
import { shouldForceDelete } from '../../shared/utils/shiftDelete'
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
  onSelect: (taskId: string, e: React.MouseEvent) => void
  onStatusChange: (taskId: string, newStatusId: string) => void
  onTitleChange: (taskId: string, newTitle: string) => void
  onDelete: (taskId: string) => void
  onToggleExpanded: (taskId: string) => void
  onAddLabel: (taskId: string, labelId: string) => void
  onRemoveLabel: (taskId: string, labelId: string) => void
  onCreateLabel: (name: string, color: string) => void
  project?: Project
  statusIdOverride?: string
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
  onCreateLabel,
  project,
  statusIdOverride
}: TaskRowProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(task.title)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addLabelBtnRef = useRef<HTMLButtonElement>(null)

  const childCount = useChildCount(task.id)
  const hasChildren = childCount.total > 0
  const taskLabels = useTaskLabelsHook(task.id)
  const toggleLabelFilter = useLabelStore((s) => s.toggleLabelFilter)
  const openContextMenu = useContextMenuStore((s) => s.open)
  const openBulkContextMenu = useContextMenuStore((s) => s.openBulk)
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
  const prioritySettings = usePrioritySettings()
  const pendingSubtaskParentId = useTaskStore((s) => s.pendingSubtaskParentId)
  const hasPendingSubtask = pendingSubtaskParentId === task.id
  const movingTaskId = useTaskStore((s) => s.movingTaskId)
  const isMoving = movingTaskId === task.id

  // Priority visual helpers
  const priorityLevel = PRIORITY_LEVELS[task.priority] ?? PRIORITY_LEVELS[0]
  const showColorBar = prioritySettings.colorBar && task.priority > 0
  const showBadge = prioritySettings.badges && task.priority > 0
  const showTint = prioritySettings.backgroundTint && task.priority >= 3
  const tintOpacity = task.priority === 4 ? 0.06 : task.priority === 3 ? 0.03 : 0
  const fontWeightClass = prioritySettings.fontWeight
    ? task.priority >= 4
      ? 'font-medium'
      : task.priority >= 3
        ? 'font-normal'
        : 'font-light'
    : 'font-light'

  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging
  } = useSortable({
    id: task.id,
    disabled: isDragOverlay ?? false
  })

  const style = isDragOverlay
    ? undefined
    : {
        paddingLeft: `${16 + depth * 24}px`,
        opacity: isDragging ? 0.3 : undefined
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

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (selectedTaskIds.has(task.id) && selectedTaskIds.size > 1) {
        openBulkContextMenu([...selectedTaskIds], e.clientX, e.clientY)
      } else {
        useTaskStore.getState().selectTask(task.id, { fromContextMenu: true })
        openContextMenu(task.id, e.clientX, e.clientY)
      }
    },
    [task.id, selectedTaskIds, openContextMenu, openBulkContextMenu]
  )

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (!isEditing) onSelect(task.id, e)
  }, [isEditing, onSelect, task.id])

  const handleStatusChange = useCallback(
    (newStatusId: string) => {
      onStatusChange(task.id, newStatusId)
    },
    [onStatusChange, task.id]
  )

  const { deleteTask: forceDelete } = useTaskStore()
  const handleDelete = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (shouldForceDelete(e)) {
        forceDelete(task.id)
      } else {
        onDelete(task.id)
      }
    },
    [onDelete, task.id, forceDelete]
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
        const pickerWidth = 220
        const pickerHeight = 280

        // Find the right edge of the scrollable task list area (not the full window)
        const scrollParent = btn.closest('[role="grid"]') ?? btn.closest('main')
        const containerRight = scrollParent
          ? scrollParent.getBoundingClientRect().right
          : window.innerWidth

        let top = rect.top
        let left = containerRight - pickerWidth - 8

        // Fallback: if that puts it behind the button, open below instead
        if (left < rect.right + 8) {
          left = rect.left
          top = rect.bottom + 4
          if (left + pickerWidth > containerRight - 8) {
            left = containerRight - pickerWidth - 8
          }
        }

        // Clamp vertically
        if (top + pickerHeight > window.innerHeight - 8) {
          top = window.innerHeight - pickerHeight - 8
        }
        setPickerPos({ top: Math.max(8, top), left: Math.max(8, left) })
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

  const effectiveStatusId = statusIdOverride ?? task.status_id
  const doneStatus = statuses.find((s) => s.id === effectiveStatusId)
  const isDone = doneStatus?.is_done === 1

  const isDropAbove = dropIndicator?.targetId === task.id && dropIndicator.intent === 'above'
  const isDropBelow = dropIndicator?.targetId === task.id && dropIndicator.intent === 'below'
  const isDropInside = dropIndicator?.targetId === task.id && dropIndicator.intent === 'inside'

  const tintStyle = showTint ? { backgroundColor: `${priorityLevel.color}${Math.round(tintOpacity * 255).toString(16).padStart(2, '0')}` } : undefined

  const rowStyle = isDragOverlay
    ? { paddingLeft: `${16 + depth * 24}px`, ...tintStyle }
    : {
        ...style,
        ...tintStyle,
        opacity: filterOpacity !== undefined ? filterOpacity : style?.opacity
      }

  return (
    <>
      <div
        ref={setNodeRef}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
        className={`group relative flex items-center gap-2 py-2 pr-6 transition-all cursor-pointer select-none ${
          isMoving
            ? 'bg-accent/20 border-l-2 border-accent ring-1 ring-accent/40'
            : isSelected
              ? 'bg-accent/12 border-l-2 border-accent ring-1 ring-accent/30'
              : 'border-l-2 border-transparent hover:bg-foreground/6'
        } ${isDropInside ? 'bg-accent/15 ring-2 ring-accent/30 scale-[1.01]' : ''}`}
        style={rowStyle}
        {...attributes}
        {...listeners}
        role="row"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        tabIndex={0}
      >
        {/* Priority color bar */}
        {showColorBar && (
          <div
            className="absolute left-0 top-1 bottom-1 w-[1.5px] rounded-full"
            style={{ backgroundColor: priorityLevel.color }}
          />
        )}

        {/* Drop indicator: above line */}
        {isDropAbove && (
          <div className="absolute left-0 right-0 top-0 z-10 h-0.5 bg-accent" />
        )}
        {/* Drop indicator: below line */}
        {isDropBelow && (
          <div className="absolute bottom-0 left-0 right-0 z-10 h-0.5 bg-accent" />
        )}

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

        {project ? (
          <ProjectIndicator project={project} />
        ) : task.is_in_my_day === 1 ? (
          <MyDayIndicator />
        ) : null}

        <StatusButton
          currentStatusId={statusIdOverride ?? task.status_id}
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
            className={`flex-1 select-text bg-transparent text-[15px] ${fontWeightClass} tracking-tight text-foreground focus:outline-none`}
          />
        ) : (
          <span
            className={`flex-1 truncate text-[15px] ${fontWeightClass} tracking-tight ${
              isDone ? 'text-muted line-through' : 'text-foreground'
            }`}
          >
            {task.title}
          </span>
        )}

        {/* Subtask count badge + progress */}
        {hasChildren && (
          <SubtaskBadge done={childCount.done} total={childCount.total} />
        )}

        {/* Priority badge */}
        {showBadge && <PriorityBadge priority={task.priority} showIcon={prioritySettings.badgeIcons} showLabel={prioritySettings.badgeLabels} />}

        {/* Label chips — show max 3, then "+X" */}
        {taskLabels.length > 0 && (
          <div className="flex flex-shrink-0 items-center gap-1">
            {taskLabels.slice(0, 3).map((label) => (
              <LabelChip
                key={label.id}
                name={label.name}
                color={label.color}
                onClick={() => toggleLabelFilter(label.id)}
              />
            ))}
            {taskLabels.length > 3 && (
              <LabelOverflowBadge labels={taskLabels.slice(3)} />
            )}
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

      {/* Render subtasks if expanded or pending inline add */}
      {((hasChildren && isExpanded) || hasPendingSubtask) && !isDragging && (
        <SubtaskList
          parentId={task.id}
          projectId={task.project_id}
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
  projectId: string
  statuses: Status[]
  allLabels: Label[]
  depth: number
  dropIndicator?: DropIndicator | null
  onSelect: (taskId: string, e: React.MouseEvent) => void
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
  projectId,
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
  const subtasks = useSubtasks(parentId)
  const expandedTaskIds = useTaskStore((s) => s.expandedTaskIds)
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
  const pendingSubtaskParentId = useTaskStore((s) => s.pendingSubtaskParentId)
  const { createSubtask, setPendingSubtaskParent } = useTaskStore()
  const currentUser = useAuthStore((s) => s.currentUser)

  const isPending = pendingSubtaskParentId === parentId
  const [inputValue, setInputValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (isPending) {
      inputRef.current?.focus()
    }
  }, [isPending])

  const handleAdd = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!trimmed || !currentUser) return

    const defaultStatus = statuses.find((s) => s.is_default === 1)
    if (!defaultStatus) return

    const maxOrder = subtasks.reduce((max, t) => Math.max(max, t.order_index), -1)
    await createSubtask(parentId, {
      id: crypto.randomUUID(),
      project_id: projectId,
      owner_id: currentUser.id,
      title: trimmed,
      status_id: defaultStatus.id,
      order_index: maxOrder + 1
    })
    setInputValue('')
    inputRef.current?.focus()
  }, [inputValue, currentUser, statuses, subtasks, createSubtask, parentId, projectId])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleAdd()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        setInputValue('')
        setPendingSubtaskParent(null)
      }
    },
    [handleAdd, setPendingSubtaskParent]
  )

  return (
    <>
      {subtasks.map((child) => (
        <TaskRow
          key={child.id}
          task={child}
          statuses={statuses}
          allLabels={allLabels}
          isSelected={selectedTaskIds.has(child.id)}
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
      {isPending && (
        <div
          className="flex items-center gap-2 rounded border border-transparent py-2 pr-6"
          style={{ paddingLeft: `${16 + depth * 24}px` }}
        >
          {/* Spacers to align with task title: chevron + status icon */}
          <div className="flex-shrink-0 p-0.5 invisible"><ChevronRight size={12} /></div>
          <div className="flex-shrink-0 p-0.5 invisible"><div className="h-4 w-4" /></div>
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (!inputValue.trim()) {
                setPendingSubtaskParent(null)
              }
            }}
            placeholder="Subtask title..."
            className="flex-1 bg-transparent text-[15px] font-light tracking-tight text-foreground placeholder:text-muted/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
          />
        </div>
      )}
    </>
  )
}

function LabelOverflowBadge({ labels }: { labels: Label[] }): React.JSX.Element {
  const [hovered, setHovered] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })

  const handleMouseEnter = useCallback(() => {
    if (ref.current) {
      const rect = ref.current.getBoundingClientRect()
      setPos({ top: rect.top, left: rect.left + rect.width / 2 })
    }
    setHovered(true)
  }, [])

  return (
    <>
      <span
        ref={ref}
        className="text-[9px] font-bold tabular-nums text-muted cursor-default"
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setHovered(false)}
      >
        +{labels.length}
      </span>
      {hovered && createPortal(
        <div
          className="pointer-events-none fixed z-[9999] flex flex-col gap-1 rounded-lg border border-border bg-surface px-3 py-2 shadow-xl"
          style={{ top: pos.top - 8, left: pos.left, transform: 'translate(-50%, -100%)' }}
        >
          {labels.map((l) => (
            <span key={l.id} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: l.color }} />
              <span className="text-[9px] font-bold uppercase tracking-wider text-foreground">{l.name}</span>
            </span>
          ))}
        </div>,
        document.body
      )}
    </>
  )
}

function MyDayIndicator(): React.JSX.Element {
  return (
    <div
      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent/15"
      title="In My Day"
    >
      <Sun size={10} className="text-accent" />
    </div>
  )
}

function getProjectInitials(name: string): string {
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

function ProjectIndicator({ project }: { project: Project }): React.JSX.Element {
  return (
    <div
      className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
      style={{ backgroundColor: project.color }}
      title={project.name}
    >
      <span className="text-[7px] font-bold leading-none text-white">
        {getProjectInitials(project.name)}
      </span>
    </div>
  )
}
