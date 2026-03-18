import { useCallback } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Calendar } from 'lucide-react'
import { PriorityBadge } from '../../shared/components/PriorityBadge'
import { LabelChip } from '../../shared/components/LabelChip'
import { PRIORITY_LEVELS } from '../../shared/components/PriorityIndicator'
import { usePrioritySettings } from '../../shared/hooks/usePrioritySettings'
import { useTaskStore, selectTaskLabels } from '../../shared/stores'
import { useLabelStore } from '../../shared/stores'
import { useContextMenuStore } from '../../shared/stores/contextMenuStore'
import type { Task, Status } from '../../../../shared/types'

interface KanbanCardProps {
  task: Task
  statuses: Status[]
  isSelected: boolean
  filterOpacity?: number
  isDragOverlay?: boolean
  onSelect: (taskId: string) => void
  onStatusChange: (taskId: string, newStatusId: string) => void
  onDeleteTask: (taskId: string) => void
}

export function KanbanCard({
  task,
  statuses,
  isSelected,
  filterOpacity,
  isDragOverlay,
  onSelect,
  onStatusChange,
  onDeleteTask
}: KanbanCardProps): React.JSX.Element {
  const taskLabels = useTaskStore(selectTaskLabels(task.id))
  const toggleLabelFilter = useLabelStore((s) => s.toggleLabelFilter)
  const openContextMenu = useContextMenuStore((s) => s.open)
  const prioritySettings = usePrioritySettings()

  const priorityLevel = PRIORITY_LEVELS[task.priority] ?? PRIORITY_LEVELS[0]
  const showBadge = prioritySettings.badges && task.priority > 0
  const showTint = prioritySettings.backgroundTint && task.priority >= 3
  const tintOpacity = task.priority === 4 ? 0.06 : task.priority === 3 ? 0.03 : 0
  const showColorBar = prioritySettings.colorBar && task.priority > 0
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
    transform,
    transition: sortableTransition,
    isDragging
  } = useSortable({
    id: task.id,
    disabled: isDragOverlay ?? false
  })

  const style = isDragOverlay
    ? { opacity: 0.8 }
    : {
        transform: CSS.Transform.toString(transform),
        transition: sortableTransition ?? undefined,
        opacity: filterOpacity !== undefined ? filterOpacity : isDragging ? 0.3 : 1
      }

  const tintStyle = showTint
    ? {
        backgroundColor: `${priorityLevel.color}${Math.round(tintOpacity * 255)
          .toString(16)
          .padStart(2, '0')}`
      }
    : undefined

  const doneStatus = statuses.find((s) => s.id === task.status_id)
  const isDone = doneStatus?.is_done === 1

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      onSelect(task.id)
      openContextMenu(task.id, e.clientX, e.clientY)
    },
    [task.id, onSelect, openContextMenu]
  )

  const handleClick = useCallback(() => {
    onSelect(task.id)
  }, [onSelect, task.id])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault()
        const sorted = [...statuses].sort((a, b) => a.order_index - b.order_index)
        const idx = sorted.findIndex((s) => s.id === task.status_id)
        const nextIdx = (idx + 1) % sorted.length
        onStatusChange(task.id, sorted[nextIdx].id)
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        onDeleteTask(task.id)
      }
    },
    [task, statuses, onStatusChange, onDeleteTask]
  )

  const dueDateStr = task.due_date
    ? new Date(task.due_date).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric'
      })
    : null

  return (
    <div
      ref={setNodeRef}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      className={`relative cursor-pointer rounded-lg border p-3.5 transition-all motion-safe:duration-150 ${
        isSelected
          ? 'border-accent/15 bg-accent/12'
          : 'border-border hover:border-foreground/10 hover:bg-foreground/6'
      }`}
      style={{ ...style, ...tintStyle }}
      {...attributes}
      {...listeners}
      role="article"
      aria-selected={isSelected}
      tabIndex={0}
    >
      {/* Priority color bar */}
      {showColorBar && (
        <div
          className="absolute left-0 top-2 bottom-2 w-[1.5px] rounded-full"
          style={{ backgroundColor: priorityLevel.color }}
        />
      )}

      {/* Title */}
      <p
        className={`text-[15px] ${fontWeightClass} tracking-tight ${
          isDone ? 'text-muted line-through' : 'text-foreground'
        }`}
      >
        {task.title}
      </p>

      {/* Metadata row */}
      {(showBadge || taskLabels.length > 0 || dueDateStr) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {showBadge && <PriorityBadge priority={task.priority} />}

          {taskLabels.map((label) => (
            <LabelChip
              key={label.id}
              name={label.name}
              color={label.color}
              onClick={() => toggleLabelFilter(label.id)}
            />
          ))}

          {dueDateStr && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted">
              <Calendar size={10} />
              {dueDateStr}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
