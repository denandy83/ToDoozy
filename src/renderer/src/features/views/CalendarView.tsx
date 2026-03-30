import { useCallback, useMemo, useEffect } from 'react'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'
import { useDroppable } from '@dnd-kit/core'
import { useTaskStore } from '../../shared/stores'
import { useProjectStore, selectAllProjects } from '../../shared/stores'
import { useStatusStore } from '../../shared/stores'
import { useLabelStore } from '../../shared/stores'
import { useSettingsStore } from '../../shared/stores/settingsStore'
import { useContextMenuStore } from '../../shared/stores/contextMenuStore'
import type { Task, Project } from '../../../../shared/types'
import { useCalendar, toYMD, type CalendarLayout } from './useCalendar'

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function CalendarView(): React.JSX.Element {
  const calendarLayoutSetting = useSettingsStore((s) => s.settings['calendar_layout'] ?? 'month')
  const layout = (calendarLayoutSetting === 'week' ? 'week' : 'month') as CalendarLayout
  const { setSetting } = useSettingsStore()

  const { days, title, goNext, goPrev, goToday } = useCalendar(layout)

  const allTasks = useTaskStore((s) => s.tasks)
  const allProjects = useProjectStore(selectAllProjects)
  const allStatuses = useStatusStore((s) => s.statuses)
  const { hydrateAllTaskLabels } = useTaskStore()
  const { hydrateStatuses } = useStatusStore()
  const { hydrateLabels } = useLabelStore()

  const projectMap = useMemo(() => {
    const map: Record<string, Project> = {}
    for (const p of allProjects) map[p.id] = p
    return map
  }, [allProjects])

  // Get all tasks that have a due_date and are not archived/template
  const calendarTasks = useMemo(() => {
    return Object.values(allTasks).filter(
      (t) => t.due_date && t.is_archived === 0 && t.is_template === 0 && t.parent_id === null
    )
  }, [allTasks])

  // Group tasks by date (YYYY-MM-DD)
  const tasksByDate = useMemo(() => {
    const grouped: Record<string, Task[]> = {}
    for (const task of calendarTasks) {
      if (!task.due_date) continue
      const dateKey = task.due_date.split('T')[0]
      if (!grouped[dateKey]) grouped[dateKey] = []
      grouped[dateKey].push(task)
    }
    // Sort tasks within each date by order_index
    for (const date of Object.keys(grouped)) {
      grouped[date].sort((a, b) => a.order_index - b.order_index)
    }
    return grouped
  }, [calendarTasks])

  // Hydrate labels and statuses for all projects that have calendar tasks
  const calendarProjectIds = useMemo(() => {
    const ids = new Set<string>()
    for (const task of calendarTasks) ids.add(task.project_id)
    return [...ids]
  }, [calendarTasks])

  useEffect(() => {
    for (const pid of calendarProjectIds) {
      hydrateAllTaskLabels(pid)
      hydrateStatuses(pid)
      hydrateLabels(pid)
    }
  }, [calendarProjectIds, hydrateAllTaskLabels, hydrateStatuses, hydrateLabels])

  const toggleLayout = useCallback(() => {
    const next = layout === 'month' ? 'week' : 'month'
    setSetting('calendar_layout', next)
  }, [layout, setSetting])

  const todayStr = useMemo(() => toYMD(new Date()), [])
  const hasAnyTasks = calendarTasks.length > 0

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft' && !e.metaKey) {
        e.preventDefault()
        goPrev()
      } else if (e.key === 'ArrowRight' && !e.metaKey) {
        e.preventDefault()
        goNext()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goNext, goPrev])

  if (!hasAnyTasks) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8">
        <CalendarIcon size={48} className="text-muted/30" />
        <p className="text-sm font-light text-muted">No tasks with due dates</p>
        <p className="text-[10px] text-muted/60">Assign due dates to tasks to see them here</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Calendar header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <button
          onClick={goPrev}
          className="rounded-md p-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          aria-label={layout === 'month' ? 'Previous month' : 'Previous week'}
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={goToday}
          className="rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
        >
          Today
        </button>
        <button
          onClick={goNext}
          className="rounded-md p-1 text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          aria-label={layout === 'month' ? 'Next month' : 'Next week'}
        >
          <ChevronRight size={16} />
        </button>

        <span className="text-sm font-light text-foreground">{title}</span>

        <div className="ml-auto">
          <button
            onClick={toggleLayout}
            className="rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 hover:text-foreground"
          >
            {layout === 'month' ? 'Week' : 'Month'}
          </button>
        </div>
      </div>

      {/* Weekday labels */}
      <div className={`grid ${layout === 'month' ? 'grid-cols-7' : 'grid-cols-7'} border-b border-border`}>
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="py-1.5 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-muted"
          >
            {label}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      {layout === 'month' ? (
        <MonthGrid days={days} tasksByDate={tasksByDate} projectMap={projectMap} todayStr={todayStr} allStatuses={allStatuses} />
      ) : (
        <WeekGrid days={days} tasksByDate={tasksByDate} projectMap={projectMap} todayStr={todayStr} allStatuses={allStatuses} />
      )}
    </div>
  )
}

// --- Month Grid ---

interface GridProps {
  days: Array<{ date: string; dayOfMonth: number; isToday: boolean; isCurrentMonth: boolean }>
  tasksByDate: Record<string, Task[]>
  projectMap: Record<string, Project>
  todayStr: string
  allStatuses: Record<string, { is_done?: number }>
}

function MonthGrid({ days, tasksByDate, projectMap, todayStr, allStatuses }: GridProps): React.JSX.Element {
  const rows: Array<Array<typeof days[number]>> = []
  for (let i = 0; i < days.length; i += 7) {
    rows.push(days.slice(i, i + 7))
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {rows.map((week, ri) => (
        <div key={ri} className="grid min-h-[100px] flex-1 grid-cols-7 border-b border-border last:border-b-0">
          {week.map((day) => (
            <DayCell
              key={day.date}
              day={day}
              tasks={tasksByDate[day.date] ?? []}
              projectMap={projectMap}
              todayStr={todayStr}
              allStatuses={allStatuses}
              compact
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// --- Week Grid ---

function WeekGrid({ days, tasksByDate, projectMap, todayStr, allStatuses }: GridProps): React.JSX.Element {
  return (
    <div className="grid flex-1 grid-cols-7 overflow-hidden">
      {days.map((day) => (
        <DayCell
          key={day.date}
          day={day}
          tasks={tasksByDate[day.date] ?? []}
          projectMap={projectMap}
          todayStr={todayStr}
          allStatuses={allStatuses}
          compact={false}
        />
      ))}
    </div>
  )
}

// --- Day Cell ---

interface DayCellProps {
  day: { date: string; dayOfMonth: number; isToday: boolean; isCurrentMonth: boolean }
  tasks: Task[]
  projectMap: Record<string, Project>
  todayStr: string
  allStatuses: Record<string, { is_done?: number }>
  compact: boolean
}

function DayCell({ day, tasks, projectMap, todayStr, allStatuses, compact }: DayCellProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `calendar-day-${day.date}`,
    data: { type: 'calendar-day', date: day.date }
  })

  const isOverdue = day.date < todayStr

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col border-r border-border last:border-r-0 ${
        !day.isCurrentMonth ? 'opacity-40' : ''
      } ${isOver ? 'bg-accent/8' : ''} ${compact ? 'p-1' : 'p-2'}`}
    >
      {/* Day number */}
      <div className="mb-1 flex items-center justify-center">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
            day.isToday
              ? 'bg-accent text-accent-fg'
              : 'text-fg-secondary'
          }`}
        >
          {day.dayOfMonth}
        </span>
      </div>

      {/* Tasks */}
      <div className={`flex flex-col gap-0.5 ${compact ? '' : 'flex-1 overflow-y-auto'}`}>
        {tasks.map((task) => (
          <CalendarTaskItem
            key={task.id}
            task={task}
            project={projectMap[task.project_id]}
            isDone={allStatuses[task.status_id]?.is_done === 1}
            isOverdue={isOverdue && allStatuses[task.status_id]?.is_done !== 1}
          />
        ))}
      </div>
    </div>
  )
}

// --- Calendar Task Item ---

interface CalendarTaskItemProps {
  task: Task
  project: Project | undefined
  isDone: boolean
  isOverdue: boolean
}

function CalendarTaskItem({ task, project, isDone, isOverdue }: CalendarTaskItemProps): React.JSX.Element {
  const { selectTask } = useTaskStore()
  const selectedTaskIds = useTaskStore((s) => s.selectedTaskIds)
  const openContextMenu = useContextMenuStore((s) => s.open)
  const openBulkContextMenu = useContextMenuStore((s) => s.openBulk)
  const isSelected = selectedTaskIds.has(task.id)

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      selectTask(task.id)
      useTaskStore.getState().navigateTask(task.id)
    },
    [task.id, selectTask]
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

  return (
    <button
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition-colors ${
        isSelected
          ? 'bg-accent/12 ring-1 ring-accent/30'
          : 'hover:bg-foreground/6'
      }`}
    >
      {/* Project color dot */}
      {project && (
        <div
          className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
          style={{ backgroundColor: project.color }}
        />
      )}
      {/* Task title */}
      <span
        className={`truncate text-[11px] ${
          isDone
            ? 'font-light text-muted line-through'
            : isOverdue
              ? 'font-light text-danger'
              : 'font-light text-foreground'
        }`}
      >
        {task.title}
      </span>
    </button>
  )
}
