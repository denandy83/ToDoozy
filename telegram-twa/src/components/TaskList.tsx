import type { SharedTask, SharedStatus } from '../types'
import { TaskCard } from './TaskCard'

interface TaskListProps {
  tasks: SharedTask[]
  statuses: SharedStatus[]
  onSelectTask: (task: SharedTask) => void
  groupByStatus?: boolean
}

export function TaskList({ tasks, statuses, onSelectTask, groupByStatus = true }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="px-4 py-12 text-center" style={{ color: 'var(--tg-theme-hint-color)' }}>
        <p className="text-3xl mb-3">🎉</p>
        <p className="text-sm font-light">No tasks yet</p>
      </div>
    )
  }

  const statusMap = new Map(statuses.map(s => [s.id, s]))

  // Filter out parent-only view (no subtasks in the top-level list)
  const topLevelTasks = tasks.filter(t => !t.parent_id)

  if (!groupByStatus) {
    return (
      <div>
        {topLevelTasks.map(task => (
          <TaskCard
            key={task.id}
            task={task}
            status={statusMap.get(task.status_id)}
            onSelect={onSelectTask}
          />
        ))}
      </div>
    )
  }

  // Group by status, maintaining status order
  const groups = statuses
    .map(status => ({
      status,
      tasks: topLevelTasks
        .filter(t => t.status_id === status.id)
        .sort((a, b) => a.order_index - b.order_index)
    }))
    .filter(g => g.tasks.length > 0)

  return (
    <div>
      {groups.map(group => (
        <div key={group.status.id}>
          {/* Status group header */}
          <div
            className="sticky top-0 z-10 px-4 py-2 flex items-center gap-2"
            style={{ backgroundColor: 'var(--tg-theme-bg-color)' }}
          >
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: group.status.color }}
            />
            <span className="text-[10px] font-bold uppercase tracking-[0.3em]">
              {group.status.name}
            </span>
            <span
              className="text-[10px] font-bold ml-1"
              style={{ color: 'var(--tg-theme-hint-color)' }}
            >
              {group.tasks.length}
            </span>
          </div>

          {group.tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              status={group.status}
              onSelect={onSelectTask}
            />
          ))}
        </div>
      ))}
    </div>
  )
}
