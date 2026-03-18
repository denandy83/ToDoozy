import { useState, useCallback } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Task, Status } from '../../../../shared/types'
import { TaskRow } from './TaskRow'

interface StatusSectionProps {
  status: Status
  tasks: Task[]
  allStatuses: Status[]
  selectedTaskId: string | null
  onSelectTask: (taskId: string) => void
  onStatusChange: (taskId: string, newStatusId: string) => void
  onTitleChange: (taskId: string, newTitle: string) => void
  onDeleteTask: (taskId: string) => void
}

export function StatusSection({
  status,
  tasks,
  allStatuses,
  selectedTaskId,
  onSelectTask,
  onStatusChange,
  onTitleChange,
  onDeleteTask
}: StatusSectionProps): React.JSX.Element {
  const [collapsed, setCollapsed] = useState(false)

  const toggleCollapse = useCallback(() => {
    setCollapsed((prev) => !prev)
  }, [])

  const sorted = [...tasks].sort((a, b) => a.order_index - b.order_index)

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
          style={{ color: status.color || undefined }}
        >
          {status.name}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
          {tasks.length}
        </span>
      </button>

      {!collapsed && (
        <div role="rowgroup">
          {sorted.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              statuses={allStatuses}
              isSelected={selectedTaskId === task.id}
              onSelect={onSelectTask}
              onStatusChange={onStatusChange}
              onTitleChange={onTitleChange}
              onDelete={onDeleteTask}
            />
          ))}
          {sorted.length === 0 && (
            <p className="px-4 py-3 text-sm font-light text-muted/40">No tasks</p>
          )}
        </div>
      )}
    </section>
  )
}
