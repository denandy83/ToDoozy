import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts'
import { Flame, Trophy, AlertTriangle, CheckCircle2, Clock, ListTodo, ArrowRight } from 'lucide-react'
import { useAuthStore } from '../../shared/stores'
import { useProjectStore, selectAllProjects } from '../../shared/stores'
import { useViewStore } from '../../shared/stores/viewStore'
import { useTaskStore } from '../../shared/stores/taskStore'
import { useSetting } from '../../shared/stores/settingsStore'
import { Modal } from '../../shared/components/Modal'

type StatsFilter = 'completed_today' | 'completed_week' | 'completed_range' | 'open' | 'overdue' | 'focus_today' | 'focus_week'
interface StatsTask { id: string; projectId: string; title: string; projectName: string; completedDate: string | null; dueDate: string | null; priority: number; focusMinutes?: number }

type TimeRange = 7 | 30 | 90

interface CompletionData { date: string; count: number }
interface FocusData { date: string; minutes: number }
interface HeatmapData { date: string; count: number; created: number; completed: number; updated: number }
interface SummaryData { total: number; open: number; overdue: number; completed: number; avgCompletionDays: number }
interface PriorityData { priority: number; count: number }
interface DayOfWeekData { dayOfWeek: number; count: number }
interface ProjectData { projectId: string; projectName: string; open: number; completed: number }

const PRIORITY_LABELS: Record<number, string> = { 0: 'None', 1: 'Low', 2: 'Normal', 3: 'High', 4: 'Urgent' }
const PRIORITY_COLORS: Record<number, string> = {
  0: 'var(--color-muted)',
  1: '#60a5fa',
  2: '#a78bfa',
  3: '#fb923c',
  4: '#ef4444'
}
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function StatsView(): React.JSX.Element {
  const userId = useAuthStore((s) => s.currentUser)?.id ?? ''
  const allProjects = useProjectStore(selectAllProjects)
  const weekStartSetting = useSetting('week_start') ?? 'monday'
  const weekStartDay = weekStartSetting === 'sunday' ? 0 : 1
  const [timeRange, setTimeRange] = useState<TimeRange>(30)
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [completions, setCompletions] = useState<CompletionData[]>([])
  const [focusData, setFocusData] = useState<FocusData[]>([])
  const [heatmapData, setHeatmapData] = useState<HeatmapData[]>([])
  const [streaks, setStreaks] = useState({ current: 0, best: 0 })
  const [summary, setSummary] = useState<SummaryData>({ total: 0, open: 0, overdue: 0, completed: 0, avgCompletionDays: 0 })
  const [priorityData, setPriorityData] = useState<PriorityData[]>([])
  const [dayOfWeekData, setDayOfWeekData] = useState<DayOfWeekData[]>([])
  const [projectData, setProjectData] = useState<ProjectData[]>([])
  const [cookieToday, setCookieToday] = useState({ earned: 0, spent: 0 })
  const [cookieWeek, setCookieWeek] = useState({ earned: 0, spent: 0 })
  const [cookieMonth, setCookieMonth] = useState({ earned: 0, spent: 0 })

  const [drillDown, setDrillDown] = useState<{ filter: StatsFilter; label: string } | null>(null)
  const [drillTasks, setDrillTasks] = useState<StatsTask[]>([])
  const [drillLoading, setDrillLoading] = useState(false)

  const projectIds = projectFilter ? [projectFilter] : null

  const { startDate, endDate } = useMemo(() => {
    const end = new Date()
    const start = new Date()
    start.setDate(start.getDate() - timeRange)
    return {
      startDate: start.toISOString().slice(0, 10),
      endDate: end.toISOString().slice(0, 10) + 'T23:59:59'
    }
  }, [timeRange])

  const heatmapRange = useMemo(() => {
    const end = new Date()
    const start = new Date(end.getFullYear(), end.getMonth() - 2, 1) // 1st of 3 months ago
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) + 'T23:59:59' }
  }, [])

  const { monthStart, monthEnd } = useMemo(() => {
    const now = new Date()
    const ms = new Date(now.getFullYear(), now.getMonth(), 1)
    return { monthStart: ms.toISOString().slice(0, 10), monthEnd: now.toISOString().slice(0, 10) + 'T23:59:59' }
  }, [])

  useEffect(() => {
    if (!userId) return
    const load = async (): Promise<void> => {
      const [comp, focus, heat, str, sum, prio, dow, proj] = await Promise.all([
        window.api.stats.completions(userId, projectIds, startDate, endDate),
        window.api.stats.focus(userId, projectIds, startDate, endDate),
        window.api.stats.heatmap(userId, heatmapRange.start, heatmapRange.end),
        window.api.stats.streaks(userId),
        window.api.stats.summary(userId, projectIds),
        window.api.stats.priorityBreakdown(userId, projectIds),
        window.api.stats.completionsByDayOfWeek(userId, projectIds, startDate, endDate),
        window.api.stats.projectBreakdown(userId)
      ])
      setCompletions(comp)
      setFocusData(focus)
      setHeatmapData(heat)
      setStreaks(str)
      setSummary(sum)
      setPriorityData(prio)
      setDayOfWeekData(dow)
      setProjectData(proj)
    }
    load()
  }, [userId, projectFilter, startDate, endDate, heatmapRange])

  // Cookie balance stats
  useEffect(() => {
    if (!userId) return
    const loadCookie = async (): Promise<void> => {
      const todayStr = new Date().toISOString().slice(0, 10)
      const todayEnd = todayStr + 'T23:59:59'
      const d = new Date()
      d.setDate(d.getDate() - d.getDay())
      const ws = d.toISOString().slice(0, 10)
      const [ct, cw, cm] = await Promise.all([
        window.api.stats.cookieBalance(userId, todayStr, todayEnd),
        window.api.stats.cookieBalance(userId, ws, todayEnd),
        window.api.stats.cookieBalance(userId, monthStart, monthEnd)
      ])
      setCookieToday(ct)
      setCookieWeek(cw)
      setCookieMonth(cm)
    }
    loadCookie()
  }, [userId, monthStart, monthEnd])

  // Compute overview numbers from completions
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const weekStart = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    return d.toISOString().slice(0, 10)
  }, [])

  const todayCount = completions.filter((c) => c.date === todayStr).reduce((s, c) => s + c.count, 0)
  const weekCount = completions.filter((c) => c.date >= weekStart).reduce((s, c) => s + c.count, 0)
  const totalRange = completions.reduce((s, c) => s + c.count, 0)
  const todayFocus = focusData.filter((f) => f.date === todayStr).reduce((s, f) => s + f.minutes, 0)
  const weekFocus = focusData.filter((f) => f.date >= weekStart).reduce((s, f) => s + f.minutes, 0)
  const monthFocus = focusData.filter((f) => f.date >= monthStart).reduce((s, f) => s + f.minutes, 0)

  const cookieTodayBalance = cookieToday.earned - cookieToday.spent
  const cookieWeekBalance = cookieWeek.earned - cookieWeek.spent
  const cookieMonthBalance = cookieMonth.earned - cookieMonth.spent
  const hasCookieData = cookieToday.earned > 0 || cookieToday.spent > 0 || cookieWeek.earned > 0 || cookieMonth.earned > 0

  // Fill chart data — use local dates to avoid UTC offset issues
  const completionChart = useMemo(() => {
    const map = new Map(completions.map((c) => [c.date, c.count]))
    const result: Array<{ date: string; count: number }> = []
    const d = new Date(startDate + 'T12:00:00')
    const endDay = todayStr
    while (true) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      result.push({ date: key, count: map.get(key) ?? 0 })
      if (key >= endDay) break
      d.setDate(d.getDate() + 1)
    }
    return result
  }, [completions, startDate, todayStr])

  const focusChart = useMemo(() => {
    const map = new Map(focusData.map((f) => [f.date, f.minutes]))
    const result: Array<{ date: string; minutes: number }> = []
    const d = new Date(startDate + 'T12:00:00')
    const endDay = todayStr
    while (true) {
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      result.push({ date: key, minutes: map.get(key) ?? 0 })
      if (key >= endDay) break
      d.setDate(d.getDate() + 1)
    }
    return result
  }, [focusData, startDate, todayStr])

  // Day of week chart — fill all 7 days
  const dayOfWeekChart = useMemo(() => {
    const map = new Map(dayOfWeekData.map((d) => [d.dayOfWeek, d.count]))
    return DAY_LABELS.map((label, i) => ({ day: label, count: map.get(i) ?? 0 }))
  }, [dayOfWeekData])

  // Most productive day
  const bestDay = useMemo(() => {
    if (dayOfWeekChart.every((d) => d.count === 0)) return null
    return dayOfWeekChart.reduce((best, d) => d.count > best.count ? d : best)
  }, [dayOfWeekChart])

  // Completion rate
  const completionRate = summary.total > 0 ? Math.round((summary.completed / summary.total) * 100) : 0

  const openDrillDown = useCallback(async (filter: StatsFilter, label: string) => {
    if (!userId) return
    setDrillDown({ filter, label })
    setDrillLoading(true)
    try {
      if (filter === 'focus_today' || filter === 'focus_week') {
        const focusStart = filter === 'focus_today' ? todayStr : weekStart
        const focusEnd = todayStr + 'T23:59:59'
        const tasks = await window.api.stats.focusTaskList(userId, focusStart, focusEnd, projectIds)
        setDrillTasks(tasks)
      } else {
        const tasks = await window.api.stats.taskList(
          userId, filter, projectIds,
          filter === 'completed_range' ? startDate : undefined,
          filter === 'completed_range' ? endDate : undefined
        )
        setDrillTasks(tasks)
      }
    } finally {
      setDrillLoading(false)
    }
  }, [userId, projectFilter, startDate, endDate, todayStr, weekStart])

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 pb-2 pt-4">
        <div className="ml-auto flex items-center gap-2">
          <select
            value={projectFilter ?? ''}
            onChange={(e) => setProjectFilter(e.target.value || null)}
            className="rounded border border-border bg-surface px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-foreground"
          >
            <option value="">All Projects</option>
            {allProjects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
        </div>
      </div>

      <div className="space-y-6 px-6 py-4">
        {/* Streaks + Activity Heatmap — same 6-col grid as summary cards */}
        <div className="grid grid-cols-6 gap-3">
          <div className="col-span-1 flex flex-col gap-3 pt-[22px]">
            <div className={`rounded-lg border px-4 py-3 ${streaks.current > 0 ? 'border-orange-400/30 bg-orange-400/5' : 'border-border bg-background'}`}>
              <div className="flex items-center gap-2">
                <Flame size={14} className={streaks.current > 0 ? 'text-orange-400 motion-safe:animate-pulse' : 'text-muted'} />
                <span className="text-2xl font-light text-foreground">{streaks.current}</span>
              </div>
              <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">Day Streak</div>
            </div>
            <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-background px-4 py-3">
              <Trophy size={14} className="text-amber-400" />
              <div>
                <div className="text-2xl font-light text-foreground">{streaks.best}</div>
                <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">Best Streak</div>
              </div>
            </div>
          </div>
          <div className="col-span-5 flex flex-col">
            <h2 className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Activity (3 months)</h2>
            <div className="w-fit flex-1 rounded-lg border border-border bg-background p-4">
              <ActivityHeatmap data={heatmapData} weekStartDay={weekStartDay} />
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-6 gap-3">
          <OverviewCard label="Completed Today" value={todayCount} icon={<CheckCircle2 size={14} className="text-emerald-400" />} onClick={() => openDrillDown('completed_today', 'Completed Today')} />
          <OverviewCard label="This Week" value={weekCount} icon={<CheckCircle2 size={14} className="text-emerald-400" />} onClick={() => openDrillDown('completed_week', 'Completed This Week')} />
          <OverviewCard label={`Last ${timeRange}d`} value={totalRange} icon={<CheckCircle2 size={14} className="text-accent" />} onClick={() => openDrillDown('completed_range', `Completed Last ${timeRange} Days`)} />
          <OverviewCard label="Open Tasks" value={summary.open} icon={<ListTodo size={14} className="text-accent" />} onClick={() => openDrillDown('open', 'Open Tasks')} />
          <OverviewCard label="Overdue" value={summary.overdue} icon={<AlertTriangle size={14} className={summary.overdue > 0 ? 'text-red-400' : 'text-muted'} />} highlight={summary.overdue > 0} onClick={() => openDrillDown('overdue', 'Overdue Tasks')} />
          <OverviewCard label="Avg Days to Done" value={summary.avgCompletionDays > 0 ? `${summary.avgCompletionDays}d` : '—'} icon={<Clock size={14} className="text-muted" />} />
        </div>

        {/* Focus row */}
        <div className="grid grid-cols-4 gap-3">
          <OverviewCard label="Focus Today" value={todayFocus > 0 ? `${todayFocus}m` : '—'} icon={<Clock size={14} className="text-accent" />} onClick={todayFocus > 0 ? () => openDrillDown('focus_today', 'Focus Today') : undefined} />
          <OverviewCard label="Focus This Week" value={weekFocus > 0 ? `${weekFocus}m` : '—'} icon={<Clock size={14} className="text-accent" />} onClick={weekFocus > 0 ? () => openDrillDown('focus_week', 'Focus This Week') : undefined} />
          <OverviewCard label="Focus This Month" value={monthFocus > 0 ? `${monthFocus}m` : '—'} icon={<Clock size={14} className="text-accent" />} />
          <OverviewCard label="Completion Rate" value={`${completionRate}%`} />
        </div>

        {/* Cookie Balance row — only shown when there's cookie data */}
        {hasCookieData && (
          <div className="grid grid-cols-3 gap-3">
            <CookieBalanceCard label="Cookie Today" balance={cookieTodayBalance} earned={cookieToday.earned} spent={cookieToday.spent} />
            <CookieBalanceCard label="Cookie This Week" balance={cookieWeekBalance} earned={cookieWeek.earned} spent={cookieWeek.spent} />
            <CookieBalanceCard label="Cookie This Month" balance={cookieMonthBalance} earned={cookieMonth.earned} spent={cookieMonth.spent} />
          </div>
        )}

        {/* Charts row 1: Completions + Day of Week */}
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            <ChartSection title="Task Completions">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={completionChart}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: 'var(--color-muted)' }}
                    tickFormatter={(v: string) => v.slice(5)}
                    interval={timeRange > 30 ? 6 : timeRange > 7 ? 2 : 0}
                  />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--color-muted)' }} allowDecimals={false} width={30} />
                  <Tooltip
                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', fontSize: 11 }}
                  />
                  <Bar dataKey="count" fill="var(--color-accent)" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartSection>
          </div>
          <ChartSection title={`Most Productive Day${bestDay ? `: ${bestDay.day}` : ''}`}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dayOfWeekChart}>
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: 'var(--color-muted)' }} />
                <YAxis tick={{ fontSize: 9, fill: 'var(--color-muted)' }} allowDecimals={false} width={25} />
                <Tooltip
                  contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', fontSize: 11 }}
                />
                <Bar dataKey="count" fill="var(--color-accent)" radius={[2, 2, 0, 0]} opacity={0.8} />
              </BarChart>
            </ResponsiveContainer>
          </ChartSection>
        </div>

        {/* Charts row 2: Focus + Priority */}
        <div className="grid grid-cols-3 gap-6">
          <div className="col-span-2">
            <ChartSection title="Focus Time (minutes)">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={focusChart}>
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 9, fill: 'var(--color-muted)' }}
                    tickFormatter={(v: string) => v.slice(5)}
                    interval={timeRange > 30 ? 6 : timeRange > 7 ? 2 : 0}
                  />
                  <YAxis tick={{ fontSize: 9, fill: 'var(--color-muted)' }} allowDecimals={false} width={30} />
                  <Tooltip
                    contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', fontSize: 11 }}
                  />
                  <Bar dataKey="minutes" fill="var(--color-accent)" radius={[2, 2, 0, 0]} opacity={0.7} />
                </BarChart>
              </ResponsiveContainer>
            </ChartSection>
          </div>
          <PriorityChart data={priorityData} />
        </div>

        {/* Row 3: Project Breakdown */}
        <ProjectBreakdown data={projectData} />
      </div>

      {/* Drill-down modal */}
      <Modal open={drillDown !== null} onClose={() => setDrillDown(null)} title={drillDown?.label} size="large">
        {drillLoading ? (
          <div className="flex h-32 items-center justify-center text-[11px] text-muted">Loading...</div>
        ) : drillTasks.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-[11px] text-muted">No tasks</div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            <div className="space-y-0.5">
              {drillTasks.map((task) => (
                <StatsTaskRow key={task.id} task={task} onNavigate={(taskId, projectId) => {
                  setDrillDown(null)
                  useViewStore.getState().setSelectedProject(projectId)
                  // Wait for project hydration, then select task
                  setTimeout(() => {
                    useTaskStore.getState().selectTask(taskId, { openPanel: true })
                    setTimeout(() => {
                      // Re-select after any hydration-triggered clearSelection
                      useTaskStore.getState().selectTask(taskId, { openPanel: true })
                      document.querySelector(`[data-task-id="${taskId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }, 200)
                  }, 500)
                }} />
              ))}
            </div>
            {drillTasks.length >= 200 && (
              <div className="mt-3 text-center text-[9px] text-muted">Showing first 200 tasks</div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────────── */

function CookieBalanceCard({ label, balance, earned, spent }: { label: string; balance: number; earned: number; spent: number }): React.JSX.Element {
  const isPositive = balance >= 0
  const balanceStr = `${isPositive ? '+' : ''}${balance}m`
  return (
    <div className={`rounded-lg border px-4 py-3 ${isPositive ? 'border-emerald-400/30 bg-emerald-400/5' : 'border-red-400/30 bg-red-400/5'}`}>
      <div className="flex items-center gap-2">
        <span className="text-lg">🍪</span>
        <span className={`text-2xl font-light ${isPositive ? 'text-emerald-400' : 'text-red-400'}`}>{balanceStr}</span>
      </div>
      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-[9px] text-muted">Earned {earned}m · Spent {spent}m</div>
    </div>
  )
}

interface OverviewCardProps {
  label: string
  value: number | string
  icon?: React.ReactNode
  highlight?: boolean
  onClick?: () => void
}

function OverviewCard({ label, value, icon, highlight, onClick }: OverviewCardProps): React.JSX.Element {
  const clickable = onClick !== undefined
  return (
    <div
      className={`rounded-lg border px-4 py-3 transition-colors ${highlight ? 'border-red-400/30 bg-red-400/5' : 'border-border bg-background'} ${clickable ? 'cursor-pointer hover:border-accent/30 hover:bg-accent/5' : ''}`}
      onClick={onClick}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } } : undefined}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-2xl font-light text-foreground">{value}</span>
        {clickable && <ArrowRight size={12} className="ml-auto text-muted opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">{label}</div>
    </div>
  )
}

interface TimeRangeSelectorProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
}

function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps): React.JSX.Element {
  return (
    <div className="flex overflow-hidden rounded-lg border border-border">
      {([7, 30, 90] as TimeRange[]).map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
            value === r ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
          }`}
        >
          {r}d
        </button>
      ))}
    </div>
  )
}

interface ChartSectionProps {
  title: string
  children: React.ReactNode
}

function ChartSection({ title, children }: ChartSectionProps): React.JSX.Element {
  return (
    <div className="space-y-2">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">{title}</h2>
      <div className="rounded-lg border border-border bg-background p-4">
        {children}
      </div>
    </div>
  )
}

function PriorityChart({ data }: { data: PriorityData[] }): React.JSX.Element {
  const chartData = useMemo(() => {
    return data
      .filter((d) => d.count > 0)
      .map((d) => ({ name: PRIORITY_LABELS[d.priority] ?? `P${d.priority}`, value: d.count, color: PRIORITY_COLORS[d.priority] ?? 'var(--color-muted)' }))
  }, [data])

  const total = chartData.reduce((s, d) => s + d.value, 0)

  return (
    <div className="space-y-2">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Open by Priority</h2>
      <div className="rounded-lg border border-border bg-background p-4">
        {total === 0 ? (
          <div className="flex h-[200px] items-center justify-center text-[11px] text-muted">No open tasks</div>
        ) : (
          <div className="flex items-center gap-4">
            <ResponsiveContainer width={120} height={120}>
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  cx="50%"
                  cy="50%"
                  innerRadius={30}
                  outerRadius={55}
                  strokeWidth={0}
                >
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5">
              {chartData.map((d) => (
                <div key={d.name} className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: d.color }} />
                  <span className="text-[10px] text-muted">{d.name}</span>
                  <span className="text-[10px] font-bold text-foreground">{d.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectBreakdown({ data }: { data: ProjectData[] }): React.JSX.Element {
  return (
    <div className="space-y-2">
      <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">By Project</h2>
      <div className="rounded-lg border border-border bg-background p-4">
        {data.length === 0 ? (
          <div className="flex h-[80px] items-center justify-center text-[11px] text-muted">No projects</div>
        ) : (
          <div className="space-y-2.5">
            {data.map((p) => {
              const total = p.open + p.completed
              const pct = total > 0 ? Math.round((p.completed / total) * 100) : 0
              return (
                <div key={p.projectId}>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[11px] font-light text-foreground">{p.projectName}</span>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-muted">
                      {p.completed}/{total} ({pct}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

interface ActivityHeatmapProps {
  data: Array<{ date: string; count: number; created: number; completed: number; updated: number }>
  weekStartDay?: number // 0=Sun, 1=Mon
}

function ActivityHeatmap({ data, weekStartDay = 1 }: ActivityHeatmapProps): React.JSX.Element {
  const [tooltip, setTooltip] = useState<{ date: string; created: number; completed: number; updated: number; x: number; y: number } | null>(null)

  const dataMap = useMemo(() => {
    const map = new Map<string, { count: number; created: number; completed: number; updated: number }>()
    for (const d of data) map.set(d.date, { count: d.count, created: d.created, completed: d.completed, updated: d.updated })
    return map
  }, [data])

  const { grid, weekCount, monthLabels, dayLabels: computedDayLabels } = useMemo(() => {
    const cells: Array<{ date: string; count: number; created: number; completed: number; updated: number; dayOfWeek: number; weekIndex: number }> = []
    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth() - 2, 1)
    // Align to week start day
    const offset = (start.getDay() - weekStartDay + 7) % 7
    start.setDate(start.getDate() - offset)

    const d = new Date(start)
    let weekIndex = 0
    const months: Array<{ label: string; weekIndex: number }> = []
    let lastMonth = -1

    while (d <= today) {
      const dayOfWeek = (d.getDay() - weekStartDay + 7) % 7 // 0 = first day of week
      const dateStr = d.toISOString().slice(0, 10)

      // Track month boundaries — trigger on first day of a new month
      if (d.getMonth() !== lastMonth) {
        months.push({ label: d.toLocaleString('default', { month: 'short' }), weekIndex })
        lastMonth = d.getMonth()
      }

      const entry = dataMap.get(dateStr)
      cells.push({ date: dateStr, count: entry?.count ?? 0, created: entry?.created ?? 0, completed: entry?.completed ?? 0, updated: entry?.updated ?? 0, dayOfWeek, weekIndex })
      if (dayOfWeek === 6) weekIndex++
      d.setDate(d.getDate() + 1)
    }

    // Build day labels based on week start
    const allDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    const labels = Array.from({ length: 7 }, (_, i) => {
      const dayIdx = (weekStartDay + i) % 7
      return i % 2 === 0 ? allDays[dayIdx] : ''
    })

    return { grid: cells, weekCount: weekIndex + 1, monthLabels: months, dayLabels: labels }
  }, [dataMap, weekStartDay])

  const getColor = useCallback((count: number): string => {
    if (count === 0) return 'var(--color-border)'
    if (count <= 2) return 'var(--color-accent-30, rgba(99, 102, 241, 0.3))'
    if (count <= 4) return 'var(--color-accent-60, rgba(99, 102, 241, 0.6))'
    return 'var(--color-accent, #6366f1)'
  }, [])

  const dayLabels = computedDayLabels

  return (
    <div>
      {/* Month labels */}
      <div className="relative mb-1" style={{ paddingLeft: 28, height: 14 }}>
        {monthLabels.map((m, i) => (
          <span
            key={i}
            className="absolute text-[9px] text-muted"
            style={{ left: 28 + m.weekIndex * 12 }}
          >
            {m.label}
          </span>
        ))}
      </div>
      <div className="flex gap-0">
        {/* Day labels */}
        <div className="mr-1 flex flex-col gap-[2px]" style={{ width: 24 }}>
          {dayLabels.map((label, i) => (
            <div key={i} className="flex h-[10px] items-center">
              <span className="text-[8px] text-muted">{label}</span>
            </div>
          ))}
        </div>
        {/* Grid */}
        <div className="flex gap-[2px]">
          {Array.from({ length: weekCount }, (_, weekIdx) => (
            <div key={weekIdx} className="flex flex-col gap-[2px]">
              {Array.from({ length: 7 }, (_, dayIdx) => {
                const cell = grid.find((c) => c.weekIndex === weekIdx && c.dayOfWeek === dayIdx)
                return (
                  <div
                    key={dayIdx}
                    className="h-[10px] w-[10px] rounded-[2px]"
                    style={{ backgroundColor: cell ? getColor(cell.count) : 'transparent' }}
                    onMouseEnter={(e) => {
                      if (cell) {
                        const rect = e.currentTarget.getBoundingClientRect()
                        setTooltip({ date: cell.date, created: cell.created, completed: cell.completed, updated: cell.updated, x: rect.left + 5, y: rect.top - 36 })
                      }
                    }}
                    onMouseLeave={() => setTooltip(null)}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {/* Legend — directly under the grid */}
      <div className="mt-2 flex items-center gap-1" style={{ paddingLeft: 28 }}>
        <span className="mr-1 text-[8px] text-muted">Less</span>
        {[0, 1, 3, 5].map((v) => (
          <div key={v} className="h-[8px] w-[8px] rounded-[1px]" style={{ backgroundColor: getColor(v) }} />
        ))}
        <span className="ml-1 text-[8px] text-muted">More</span>
      </div>
      {/* Instant tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none fixed z-[9999] flex flex-col gap-0.5 rounded border border-border bg-surface px-2 py-1.5 shadow-lg"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <span className="text-[9px] text-muted">
            {new Date(tooltip.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
          </span>
          <span className="text-[9px] text-foreground">
            {[
              tooltip.created > 0 ? `${tooltip.created} created` : null,
              tooltip.completed > 0 ? `${tooltip.completed} completed` : null,
              tooltip.updated > 0 ? `${tooltip.updated} updated` : null
            ].filter(Boolean).join(' · ') || 'No activity'}
          </span>
        </div>
      )}
    </div>
  )
}

const PRIORITY_DOTS: Record<number, string> = { 0: '', 1: 'text-blue-400', 2: 'text-violet-400', 3: 'text-orange-400', 4: 'text-red-400' }

function StatsTaskRow({ task, onNavigate }: { task: StatsTask; onNavigate: (taskId: string, projectId: string) => void }): React.JSX.Element {
  const dateStr = task.completedDate
    ? new Date(task.completedDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : task.dueDate
      ? new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : null

  const isOverdue = task.dueDate && !task.completedDate && new Date(task.dueDate) < new Date()

  return (
    <div
      className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-foreground/6"
      onClick={() => onNavigate(task.id, task.projectId)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onNavigate(task.id, task.projectId) }}
    >
      {task.priority > 0 && (
        <div className={`h-1.5 w-1.5 rounded-full ${PRIORITY_DOTS[task.priority] ?? ''}`} style={{ backgroundColor: PRIORITY_COLORS[task.priority] }} />
      )}
      <span className="min-w-0 flex-1 truncate text-[13px] font-light text-foreground">{task.title}</span>
      <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-muted">{task.projectName}</span>
      {task.focusMinutes !== undefined && task.focusMinutes > 0 && (
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-accent">
          {task.focusMinutes}m
        </span>
      )}
      {dateStr && (
        <span className={`shrink-0 text-[9px] font-bold uppercase tracking-wider ${isOverdue ? 'text-red-400' : 'text-muted'}`}>
          {dateStr}
        </span>
      )}
    </div>
  )
}
