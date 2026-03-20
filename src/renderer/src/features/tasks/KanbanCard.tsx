import { useCallback, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useSortable } from '@dnd-kit/sortable'
import { Calendar } from 'lucide-react'
import type { DropIndicator } from './useDragAndDrop'
import { PriorityBadge } from '../../shared/components/PriorityBadge'
import { LabelChip } from '../../shared/components/LabelChip'
import { PRIORITY_LEVELS } from '../../shared/components/PriorityIndicator'
import { usePrioritySettings } from '../../shared/hooks/usePrioritySettings'
import { useTaskStore, useTaskLabelsHook, useChildCount } from '../../shared/stores'
import { useLabelStore } from '../../shared/stores'
import { useContextMenuStore } from '../../shared/stores/contextMenuStore'
import type { Task, Status, Label } from '../../../../shared/types'
import { formatDate } from '../../shared/utils/dateFormat'

interface KanbanCardProps {
  task: Task
  statuses: Status[]
  isSelected: boolean
  filterOpacity?: number
  isDragOverlay?: boolean
  dropIndicator?: DropIndicator | null
  onSelect: (taskId: string, e: React.MouseEvent) => void
  onStatusChange: (taskId: string, newStatusId: string) => void
  onDeleteTask: (taskId: string) => void
}

export function KanbanCard({
  task,
  statuses,
  isSelected,
  filterOpacity,
  isDragOverlay,
  dropIndicator,
  onSelect,
  onStatusChange,
  onDeleteTask
}: KanbanCardProps): React.JSX.Element {
  const taskLabels = useTaskLabelsHook(task.id)
  const childCount = useChildCount(task.id)
  const toggleLabelFilter = useLabelStore((s) => s.toggleLabelFilter)
  const openContextMenu = useContextMenuStore((s) => s.open)
  const openBulkContextMenu = useContextMenuStore((s) => s.openBulk)
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
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
    isDragging
  } = useSortable({
    id: task.id,
    disabled: isDragOverlay ?? false
  })

  const isDropAbove = dropIndicator?.targetId === task.id && dropIndicator.intent === 'above'
  const isDropBelow = dropIndicator?.targetId === task.id && dropIndicator.intent === 'below'
  const isDropInside = dropIndicator?.targetId === task.id && dropIndicator.intent === 'inside'

  const style = isDragOverlay
    ? { opacity: 0.8 }
    : {
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
    onSelect(task.id, e)
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

  const dueDateStr = task.due_date ? formatDate(task.due_date) : null

  return (
    <div
      ref={setNodeRef}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onKeyDown={handleKeyDown}
      className={`relative cursor-pointer select-none rounded-lg border p-3.5 transition-all motion-safe:duration-150 ${
        isSelected
          ? 'border-accent/15 bg-accent/12'
          : 'border-border hover:border-foreground/10 hover:bg-foreground/6'
      } ${isDropInside ? 'bg-accent/15 ring-2 ring-accent/30 scale-[1.01]' : ''}`}
      style={{ ...style, ...tintStyle }}
      {...attributes}
      {...listeners}
      role="article"
      aria-selected={isSelected}
      tabIndex={0}
    >
      {/* Drop indicator: above line */}
      {isDropAbove && (
        <div className="absolute left-0 right-0 top-0 z-10 h-0.5 rounded-t bg-accent" />
      )}
      {/* Drop indicator: below line */}
      {isDropBelow && (
        <div className="absolute bottom-0 left-0 right-0 z-10 h-0.5 rounded-b bg-accent" />
      )}

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
      {(showBadge || taskLabels.length > 0 || dueDateStr || childCount.total > 0) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {showBadge && <PriorityBadge priority={task.priority} showIcon={prioritySettings.badgeIcons} showLabel={prioritySettings.badgeLabels} />}

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

          {dueDateStr && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-muted">
              <Calendar size={10} />
              {dueDateStr}
            </span>
          )}

          {childCount.total > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1 w-6 overflow-hidden rounded-full bg-foreground/10">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{ width: `${(childCount.done / childCount.total) * 100}%` }}
                />
              </span>
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
                {childCount.done}/{childCount.total}
              </span>
            </span>
          )}
        </div>
      )}
    </div>
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
