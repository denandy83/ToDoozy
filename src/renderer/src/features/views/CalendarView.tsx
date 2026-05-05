import { useCallback, useMemo, useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, Repeat } from 'lucide-react'
import { useDroppable, useDraggable } from '@dnd-kit/core'
import { useTaskStore } from '../../shared/stores'
import { useProjectStore, selectAllProjects } from '../../shared/stores'
import { useStatusStore } from '../../shared/stores'
import {
  useLabelStore,
  selectActiveLabelFilters,
  selectHasActiveLabelFilters,
  selectFilterMode,
  selectPriorityFilters,
  selectHasPriorityFilters,
  selectStatusFilters,
  selectHasStatusFilters,
  selectExcludeLabelFilters,
  selectHasExcludeLabelFilters,
  selectExcludeStatusFilters,
  selectHasExcludeStatusFilters,
  selectExcludePriorityFilters,
  selectHasExcludePriorityFilters,
  selectDueDatePreset,
  selectDueDateRange,
  selectKeyword,
  selectHasAnyFilter,
  selectLabelFilterLogic
} from '../../shared/stores'
import { useSettingsStore } from '../../shared/stores/settingsStore'
import { matchesDueDateFilter } from '../../shared/utils/dueDateFilter'
import { useContextMenuStore } from '../../shared/stores/contextMenuStore'
import type { Task, Project } from '../../../../shared/types'
import { useCalendar, type CalendarLayout, toYMD } from './useCalendar'
import { getNextOccurrence, parseRecurrence } from '../../../../shared/recurrenceUtils'

const WEEKDAY_LABELS_MONDAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const WEEKDAY_LABELS_SUNDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function getISOWeekNumber(dateStr: string): number {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7))
  const yearStart = new Date(d.getFullYear(), 0, 4)
  return 1 + Math.round(((d.getTime() - yearStart.getTime()) / 86400000 - 3 + ((yearStart.getDay() + 6) % 7)) / 7)
}

function sortTasksByStatus(tasks: Task[], allStatuses: Record<string, { is_done?: number; is_default?: number }>): Task[] {
  return [...tasks].sort((a, b) => {
    const sa = allStatuses[a.status_id]
    const sb = allStatuses[b.status_id]
    const bucketA = sa?.is_default === 1 ? 0 : sa?.is_done === 1 ? 2 : 1
    const bucketB = sb?.is_default === 1 ? 0 : sb?.is_done === 1 ? 2 : 1
    if (bucketA !== bucketB) return bucketA - bucketB
    return a.order_index - b.order_index
  })
}

export function CalendarView(): React.JSX.Element {
  const calendarLayoutSetting = useSettingsStore((s) => s.settings['calendar_layout'] ?? 'month')
  const layout = (calendarLayoutSetting === 'week' ? 'week' : 'month') as CalendarLayout
  const weekStartSetting = useSettingsStore((s) => s.settings['week_start'] ?? 'monday')
  const weekStartsOn = weekStartSetting === 'sunday' ? 0 : 1
  const weekdayLabels = weekStartsOn === 0 ? WEEKDAY_LABELS_SUNDAY : WEEKDAY_LABELS_MONDAY
  const { setSetting } = useSettingsStore()

  const { days, title, goNext, goPrev, goToday } = useCalendar(layout, weekStartsOn)

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

  // Filter state
  const activeLabelFilters = useLabelStore(selectActiveLabelFilters)
  const hasActiveFilters = useLabelStore(selectHasActiveLabelFilters)
  const labelFilterLogic = useLabelStore(selectLabelFilterLogic)
  const filterMode = useLabelStore(selectFilterMode)
  const priorityFilters = useLabelStore(selectPriorityFilters)
  const hasPriorityFilters = useLabelStore(selectHasPriorityFilters)
  const statusFilters = useLabelStore(selectStatusFilters)
  const hasStatusFilters = useLabelStore(selectHasStatusFilters)
  const excludeLabelFilters = useLabelStore(selectExcludeLabelFilters)
  const hasExcludeLabelFilters = useLabelStore(selectHasExcludeLabelFilters)
  const excludeStatusFilters = useLabelStore(selectExcludeStatusFilters)
  const hasExcludeStatusFilters = useLabelStore(selectHasExcludeStatusFilters)
  const excludePriorityFilters = useLabelStore(selectExcludePriorityFilters)
  const hasExcludePriorityFilters = useLabelStore(selectHasExcludePriorityFilters)
  const dueDatePresetFilter = useLabelStore(selectDueDatePreset)
  const dueDateRangeFilter = useLabelStore(selectDueDateRange)
  const keywordFilter = useLabelStore(selectKeyword)
  const hasAnyFilter = useLabelStore(selectHasAnyFilter)
  const taskLabels = useTaskStore((s) => s.taskLabels)

  // Get all tasks that have a due_date OR are in My Day (not archived/template)
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])
  const allCalendarTasks = useMemo(() => {
    return Object.values(allTasks).filter(
      (t) => (t.due_date || t.is_in_my_day === 1) && t.is_archived === 0 && t.is_template === 0 && t.parent_id === null
    )
  }, [allTasks])

  // Apply filters to calendar tasks
  const calendarTasks = useMemo(() => {
    if (!hasAnyFilter || filterMode !== 'hide') return allCalendarTasks
    return allCalendarTasks.filter((task) => {
      const labels = taskLabels[task.id] ?? []
      const labelNames = new Set(labels.map((l) => l.name.toLowerCase()))
      // Include filters
      if (hasActiveFilters) {
        if (labelFilterLogic === 'all') {
          if (![...activeLabelFilters].every((fid) => labelNames.has(fid))) return false
        } else {
          if (![...activeLabelFilters].some((fid) => labelNames.has(fid))) return false
        }
      }
      if (hasPriorityFilters && !priorityFilters.has(task.priority)) return false
      if (hasStatusFilters && !statusFilters.has(task.status_id)) return false
      // Exclusion filters
      if (hasExcludeLabelFilters) {
        if ([...excludeLabelFilters].some((fid) => labelNames.has(fid))) return false
      }
      if (hasExcludePriorityFilters && excludePriorityFilters.has(task.priority)) return false
      if (hasExcludeStatusFilters && excludeStatusFilters.has(task.status_id)) return false
      if ((dueDatePresetFilter || dueDateRangeFilter) && !matchesDueDateFilter(task.due_date, dueDatePresetFilter, dueDateRangeFilter)) return false
      if (keywordFilter) {
        const kw = keywordFilter.toLowerCase()
        if (!task.title.toLowerCase().includes(kw) && !(task.description ?? '').toLowerCase().includes(kw)) return false
      }
      return true
    })
  }, [allCalendarTasks, hasAnyFilter, filterMode, hasActiveFilters, activeLabelFilters, labelFilterLogic, taskLabels, hasPriorityFilters, priorityFilters, hasStatusFilters, statusFilters, hasExcludeLabelFilters, excludeLabelFilters, hasExcludePriorityFilters, excludePriorityFilters, hasExcludeStatusFilters, excludeStatusFilters, dueDatePresetFilter, dueDateRangeFilter, keywordFilter])

  // Group tasks by date — My Day tasks appear on today (with sun icon) AND on their due date
  // Track which task+date combos are "My Day" entries or recurrence projections
  const myDayEntries = useMemo(() => new Set<string>(), [])
  const recurrenceEntries = useMemo(() => new Set<string>(), [])
  const tasksByDate = useMemo(() => {
    const grouped: Record<string, Task[]> = {}
    myDayEntries.clear()
    recurrenceEntries.clear()
    const addToDate = (dateKey: string, task: Task, isMyDayEntry: boolean): void => {
      if (!grouped[dateKey]) grouped[dateKey] = []
      // Avoid duplicates (same task on same date)
      if (!grouped[dateKey].some((t) => t.id === task.id)) {
        grouped[dateKey].push(task)
        if (isMyDayEntry) myDayEntries.add(`${task.id}:${dateKey}`)
      }
    }

    // Determine the date range of the current calendar grid
    const gridStart = days.length > 0 ? days[0].date : todayStr
    const gridEnd = days.length > 0 ? days[days.length - 1].date : todayStr

    for (const task of calendarTasks) {
      // Add to due date
      if (task.due_date) {
        addToDate(task.due_date.split('T')[0], task, false)
      }
      // Add My Day tasks to today (even if they also have a due date on another day)
      if (task.is_in_my_day === 1) {
        const dueDateStr = task.due_date ? task.due_date.split('T')[0] : null
        if (dueDateStr !== todayStr) {
          addToDate(todayStr, task, true)
        } else {
          myDayEntries.add(`${task.id}:${todayStr}`)
        }
      }

      // Expand recurring tasks into future occurrences within the grid range
      if (task.recurrence_rule && task.due_date) {
        const config = parseRecurrence(task.recurrence_rule)
        if (config && !config.afterCompletion) {
          const dueDateStr = task.due_date.split('T')[0]
          let cursor = new Date(dueDateStr + 'T00:00:00')
          // Generate up to 60 occurrences to cover the visible grid
          for (let i = 0; i < 60; i++) {
            const next = getNextOccurrence(task.recurrence_rule, cursor)
            if (!next) break
            const nextStr = toYMD(next)
            if (nextStr > gridEnd) break
            if (nextStr >= gridStart && nextStr !== dueDateStr) {
              addToDate(nextStr, task, false)
              recurrenceEntries.add(`${task.id}:${nextStr}`)
            }
            cursor = next
          }
        }
      }
    }
    // Sort tasks within each date by order_index
    for (const date of Object.keys(grouped)) {
      grouped[date].sort((a, b) => a.order_index - b.order_index)
    }
    return grouped
  }, [calendarTasks, todayStr, myDayEntries, recurrenceEntries, days])

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
      <div className="flex h-[36px] items-center gap-3 border-b border-border px-4">
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
      <div className="grid" style={{ gridTemplateColumns: '2rem repeat(7, 1fr)' }}>
        <div className="py-1.5 text-center text-[9px] font-bold uppercase tracking-wider text-muted/40">Wk</div>
        {weekdayLabels.map((label) => (
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
        <MonthGrid days={days} tasksByDate={tasksByDate} projectMap={projectMap} todayStr={todayStr} allStatuses={allStatuses} myDayEntries={myDayEntries} recurrenceEntries={recurrenceEntries} />
      ) : (
        <WeekGrid days={days} tasksByDate={tasksByDate} projectMap={projectMap} todayStr={todayStr} allStatuses={allStatuses} myDayEntries={myDayEntries} recurrenceEntries={recurrenceEntries} />
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
  allStatuses: Record<string, { is_done?: number; is_default?: number }>
  myDayEntries: Set<string>
  recurrenceEntries: Set<string>
}

function MonthGrid({ days, tasksByDate, projectMap, todayStr, allStatuses, myDayEntries, recurrenceEntries }: GridProps): React.JSX.Element {
  const rows: Array<Array<typeof days[number]>> = []
  for (let i = 0; i < days.length; i += 7) {
    rows.push(days.slice(i, i + 7))
  }

  return (
    <div className="grid flex-1 overflow-hidden" style={{ gridTemplateRows: `repeat(${rows.length}, minmax(0, 1fr))` }}>
      {rows.map((week, ri) => (
        <div key={ri} className="grid overflow-hidden border-b border-border last:border-b-0" style={{ gridTemplateColumns: '2rem repeat(7, 1fr)' }}>
          <div className="flex items-start justify-center pt-2 text-[9px] font-bold text-muted/30">
            {getISOWeekNumber(week[0].date)}
          </div>
          {week.map((day) => (
            <DayCell
              key={day.date}
              day={day}
              tasks={sortTasksByStatus(tasksByDate[day.date] ?? [], allStatuses)}
              projectMap={projectMap}
              todayStr={todayStr}
              allStatuses={allStatuses}
              myDayEntries={myDayEntries}
              recurrenceEntries={recurrenceEntries}
              compact
            />
          ))}
        </div>
      ))}
    </div>
  )
}

// --- Week Grid ---

function WeekGrid({ days, tasksByDate, projectMap, todayStr, allStatuses, myDayEntries, recurrenceEntries }: GridProps): React.JSX.Element {
  return (
    <div className="grid flex-1 overflow-hidden" style={{ gridTemplateColumns: '2rem repeat(7, 1fr)' }}>
      <div className="flex items-start justify-center pt-2 text-[9px] font-bold text-muted/30">
        {days.length > 0 ? getISOWeekNumber(days[0].date) : ''}
      </div>
      {days.map((day) => (
        <DayCell
          key={day.date}
          day={day}
          tasks={sortTasksByStatus(tasksByDate[day.date] ?? [], allStatuses)}
          projectMap={projectMap}
          todayStr={todayStr}
          allStatuses={allStatuses}
          myDayEntries={myDayEntries}
          recurrenceEntries={recurrenceEntries}
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
  myDayEntries: Set<string>
  recurrenceEntries: Set<string>
  compact: boolean
}

function DayCell({ day, tasks, projectMap, todayStr, allStatuses, myDayEntries, recurrenceEntries, compact }: DayCellProps): React.JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `calendar-day-${day.date}`,
    data: { type: 'calendar-day', date: day.date }
  })

  const isOverdue = day.date < todayStr

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col overflow-hidden border-r border-border last:border-r-0 ${
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
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {tasks.map((task) => (
          <CalendarTaskItem
            key={task.id}
            task={task}
            project={projectMap[task.project_id]}
            isDone={allStatuses[task.status_id]?.is_done === 1}
            isOverdue={isOverdue && allStatuses[task.status_id]?.is_done !== 1}
            isMyDay={myDayEntries.has(`${task.id}:${day.date}`)}
            isRecurrence={recurrenceEntries.has(`${task.id}:${day.date}`)}
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
  isMyDay?: boolean
  isRecurrence?: boolean
}

function CalendarTaskItem({ task, project, isDone, isOverdue, isMyDay, isRecurrence }: CalendarTaskItemProps): React.JSX.Element {
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
    <CalendarTaskButton
      task={task}
      project={project}
      isSelected={isSelected}
      isDone={isDone}
      isOverdue={isOverdue}
      isMyDay={isMyDay}
      isRecurrence={isRecurrence}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
    />
  )
}

function CalendarTaskButton({
  task,
  project,
  isSelected,
  isDone,
  isOverdue,
  isRecurrence,
  onClick,
  onContextMenu
}: {
  task: Task
  project: Project | undefined
  isSelected: boolean
  isDone: boolean
  isOverdue: boolean
  isMyDay?: boolean
  isRecurrence?: boolean
  onClick: (e: React.MouseEvent) => void
  onContextMenu: (e: React.MouseEvent) => void
}): React.JSX.Element {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [hover, setHover] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 })

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: task.id
  })

  const setRefs = useCallback((el: HTMLButtonElement | null) => {
    (btnRef as React.MutableRefObject<HTMLButtonElement | null>).current = el
    setNodeRef(el)
  }, [setNodeRef])

  const handleMouseEnter = useCallback(() => {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    const vw = window.innerWidth
    const x = rect.right + 8 + 200 < vw ? rect.right + 8 : rect.left - 208
    setTooltipPos({ x: Math.max(4, x), y: rect.top })
    setHover(true)
  }, [])

  return (
    <>
      <button
        ref={setRefs}
        onClick={onClick}
        onContextMenu={onContextMenu}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={() => setHover(false)}
        {...attributes}
        {...listeners}
        className={`flex w-full items-center gap-1 rounded px-1 py-0.5 text-left transition-colors ${
          isDragging ? 'opacity-40' :
          isSelected
            ? 'bg-accent/12 ring-1 ring-accent/30'
            : 'hover:bg-foreground/6'
        }`}
      >
        {project && (
          <div
            className="h-1.5 w-1.5 flex-shrink-0 rounded-full"
            style={{ backgroundColor: project.color }}
          />
        )}
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
        {isRecurrence && (
          <Repeat size={9} className="ml-auto flex-shrink-0 text-muted" />
        )}
      </button>
      {hover && createPortal(
        <div
          className="pointer-events-none fixed z-[10000] max-w-xs whitespace-normal rounded bg-surface px-2 py-1 text-[10px] font-light text-foreground shadow-md ring-1 ring-border"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          {task.title}
        </div>,
        document.body
      )}
    </>
  )
}
