import { useMemo } from 'react'
import { useLabelStore } from '../../shared/stores/labelStore'
import { useStatusStore } from '../../shared/stores'
import { TaskRow } from './TaskRow'
import type { Task } from '../../../../shared/types'

interface TaskDragOverlayProps {
  task: Task
  width?: number
}

const noopId = (_id: string): void => {}
const noopIdId = (_a: string, _b: string): void => {}
const noopClick = (_id: string, _e: React.MouseEvent): void => {}

export function TaskDragOverlay({ task, width }: TaskDragOverlayProps): React.JSX.Element {
  const labelsRecord = useLabelStore((s) => s.labels)
  const statusesRecord = useStatusStore((s) => s.statuses)
  const allLabels = useMemo(() => Object.values(labelsRecord), [labelsRecord])
  const statuses = useMemo(() => Object.values(statusesRecord), [statusesRecord])

  return (
    <div
      className="rounded-lg border border-accent/30 bg-surface shadow-lg opacity-30"
      style={{ width: width ? `${width}px` : undefined }}
    >
      <TaskRow
        task={task}
        statuses={statuses}
        allLabels={allLabels}
        isSelected={false}
        depth={0}
        isExpanded={false}
        isDragOverlay
        onSelect={noopClick}
        onStatusChange={noopIdId}
        onTitleChange={noopIdId}
        onDelete={noopId}
        onToggleExpanded={noopId}
        onAddLabel={noopIdId}
        onRemoveLabel={noopIdId}
        onCreateLabel={noopIdId}
      />
    </div>
  )
}
