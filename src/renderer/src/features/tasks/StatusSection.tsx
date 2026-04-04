import { useState, useCallback, useMemo } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTaskStore } from '../../shared/stores'
import { usePrioritySettings } from '../../shared/hooks/usePrioritySettings'
import type { Task, Status, Label, Project } from '../../../../shared/types'
import { TaskRow } from './TaskRow'
import type { DropIndicator } from './useDragAndDrop'

interface StatusSectionProps {
  status: Status
  tasks: Task[]
  allStatuses: Status[]
  allLabels: Label[]
  selectedTaskIds: Set<string>
  taskFilterOpacity?: Record<string, number>
  dropIndicator?: DropIndicator | null
  onSelectTask: (taskId: string, e: React.MouseEvent) => void
  onStatusChange: (taskId: string, newStatusId: string) => void
  onTitleChange: (taskId: string, newTitle: string) => void
  onDeleteTask: (taskId: string) => void
  onAddLabel: (taskId: string, labelId: string) => void
  onRemoveLabel: (taskId: string, labelId: string) => void
  onCreateLabel: (name: string, color: string) => void
  onOpenDetail?: (taskId: string) => void
  projectMap?: Record<string, Project>
  bucketName?: string
  bucketColor?: string
  mapStatusId?: (statusId: string) => string
  hideAssignee?: boolean
  disableDrag?: boolean
}

export function StatusSection({
  status,
  tasks,
  allStatuses,
  allLabels,
  selectedTaskIds,
  taskFilterOpacity,
  dropIndicator,
  onSelectTask,
  onStatusChange,
  onTitleChange,
  onDeleteTask,
  onAddLabel,
  onRemoveLabel,
  onCreateLabel,
  onOpenDetail,
  projectMap,
  bucketName,
  bucketColor,
  mapStatusId,
  hideAssignee,
  disableDrag
}: StatusSectionProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)
  const expandedTaskIds = useTaskStore((s) => s.expandedTaskIds)
  const toggleExpanded = useTaskStore((s) => s.toggleExpanded)
  const { autoSort } = usePrioritySettings()

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  // Only render top-level tasks (no parent_id) in status sections
  const topLevel = tasks.filter((t) => t.parent_id === null)
  const sorted = useMemo(
    () => {
      // When an external sort is active (disableDrag=true), trust the pre-sorted order
      if (disableDrag) return topLevel
      return [...topLevel].sort((a, b) => {
        if (autoSort) {
          const priDiff = b.priority - a.priority
          if (priDiff !== 0) return priDiff
        }
        return a.order_index - b.order_index
      })
    },
    [topLevel, autoSort, disableDrag]
  )
  return (
    <section>
      <button
        onClick={toggleCollapse}
        className="flex w-full items-center gap-2 px-4 py-2 transition-colors hover:bg-foreground/6"
        aria-expanded={!collapsed}
      >
        <ChevronRight
          size={12}
          className={`flex-shrink-0 text-muted transition-transform motion-safe:duration-150 ${
            !collapsed ? 'rotate-90' : ''
          }`}
        />
        <span
          className="text-[10px] font-bold uppercase tracking-[0.3em]"
          style={{ color: (bucketColor ?? status.color) || undefined }}
        >
          {bucketName ?? status.name}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
          {topLevel.length}
        </span>
      </button>

      {!collapsed && (
          <div role="rowgroup">
            {sorted.map((task) => {
              // In My Day with buckets: use allStatuses as-is (they're the 3 bucket statuses)
              // In project views: allStatuses are already the project's own statuses
              const taskStatuses = allStatuses
              return (
              <TaskRow
                key={task.id}
                task={task}
                statuses={taskStatuses}
                allLabels={allLabels}
                isSelected={selectedTaskIds.has(task.id)}
                depth={0}
                isExpanded={expandedTaskIds.has(task.id)}
                filterOpacity={taskFilterOpacity?.[task.id]}
                dropIndicator={dropIndicator}
                onSelect={onSelectTask}
                onStatusChange={onStatusChange}
                onTitleChange={onTitleChange}
                onDelete={onDeleteTask}
                onToggleExpanded={toggleExpanded}
                onAddLabel={onAddLabel}
                onRemoveLabel={onRemoveLabel}
                onCreateLabel={onCreateLabel}
                onOpenDetail={onOpenDetail}
                project={projectMap?.[task.project_id]}
                statusIdOverride={mapStatusId ? mapStatusId(task.status_id) : undefined}
                mapStatusId={mapStatusId}
                hideAssignee={hideAssignee}
                disableDrag={disableDrag}
              />
              )
            })}
            {sorted.length === 0 && (
              <p className="px-4 py-3 text-sm font-light text-muted/40">No tasks</p>
            )}
          </div>
      )}
    </section>
  )
}
