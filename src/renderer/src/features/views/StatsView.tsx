import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts'
import { Flame, Trophy, AlertTriangle, CheckCircle2, Clock, ListTodo } from 'lucide-react'
import { useAuthStore } from '../../shared/stores'
import { useProjectStore, selectAllProjects } from '../../shared/stores'

type TimeRange = 7 | 30 | 90

interface CompletionData { date: string; count: number }
interface FocusData { date: string; minutes: number }
interface HeatmapData { date: string; count: number }
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

  const projectIds = useMemo(() => projectFilter ? [projectFilter] : null, [projectFilter])

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
    const start = new Date()
    start.setDate(start.getDate() - 90)
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) + 'T23:59:59' }
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
  }, [userId, projectIds, startDate, endDate, heatmapRange])

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

  // Fill chart data
  const completionChart = useMemo(() => {
    const map = new Map(completions.map((c) => [c.date, c.count]))
    const result: Array<{ date: string; count: number }> = []
    const d = new Date(startDate)
    const end = new Date(endDate)
    while (d <= end) {
      const key = d.toISOString().slice(0, 10)
      result.push({ date: key, count: map.get(key) ?? 0 })
      d.setDate(d.getDate() + 1)
    }
    return result
  }, [completions, startDate, endDate])

  const focusChart = useMemo(() => {
    const map = new Map(focusData.map((f) => [f.date, f.minutes]))
    const result: Array<{ date: string; minutes: number }> = []
    const d = new Date(startDate)
    const end = new Date(endDate)
    while (d <= end) {
      const key = d.toISOString().slice(0, 10)
      result.push({ date: key, minutes: map.get(key) ?? 0 })
      d.setDate(d.getDate() + 1)
    }
    return result
  }, [focusData, startDate, endDate])

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
        {/* Streaks — top of page */}
        <div className="flex items-center gap-4">
          <div className={`flex items-center gap-3 rounded-lg border px-5 py-3 ${streaks.current > 0 ? 'border-orange-400/30 bg-orange-400/5' : 'border-border bg-background'}`}>
            <Flame size={24} className={streaks.current > 0 ? 'text-orange-400 motion-safe:animate-pulse' : 'text-muted'} />
            <div>
              <div className="text-3xl font-light text-foreground">{streaks.current}</div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted">Day Streak</div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-background px-5 py-3">
            <Trophy size={24} className="text-amber-400" />
            <div>
              <div className="text-3xl font-light text-foreground">{streaks.best}</div>
              <div className="text-[9px] font-bold uppercase tracking-wider text-muted">Best Streak</div>
            </div>
          </div>
          {streaks.current > 0 && streaks.current >= streaks.best && (
            <span className="text-[11px] font-bold uppercase tracking-widest text-orange-400">New Record!</span>
          )}
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-6 gap-3">
          <OverviewCard label="Completed Today" value={todayCount} icon={<CheckCircle2 size={14} className="text-emerald-400" />} />
          <OverviewCard label="This Week" value={weekCount} icon={<CheckCircle2 size={14} className="text-emerald-400" />} />
          <OverviewCard label={`Last ${timeRange}d`} value={totalRange} icon={<CheckCircle2 size={14} className="text-accent" />} />
          <OverviewCard label="Open Tasks" value={summary.open} icon={<ListTodo size={14} className="text-accent" />} />
          <OverviewCard label="Overdue" value={summary.overdue} icon={<AlertTriangle size={14} className={summary.overdue > 0 ? 'text-red-400' : 'text-muted'} />} highlight={summary.overdue > 0} />
          <OverviewCard label="Avg Days to Done" value={summary.avgCompletionDays > 0 ? `${summary.avgCompletionDays}d` : '—'} icon={<Clock size={14} className="text-muted" />} />
        </div>

        {/* Focus row */}
        <div className="grid grid-cols-3 gap-3">
          <OverviewCard label="Focus Today" value={todayFocus > 0 ? `${todayFocus}m` : '—'} />
          <OverviewCard label="Focus This Week" value={weekFocus > 0 ? `${weekFocus}m` : '—'} />
          <OverviewCard label="Completion Rate" value={`${completionRate}%`} />
        </div>

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

        {/* Row 3: Activity Heatmap + Project Breakdown */}
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-2">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Activity (90 days)</h2>
            <div className="rounded-lg border border-border bg-background p-4">
              <ActivityHeatmap data={heatmapData} />
            </div>
          </div>
          <ProjectBreakdown data={projectData} />
        </div>
      </div>
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────────── */

interface OverviewCardProps {
  label: string
  value: number | string
  icon?: React.ReactNode
  highlight?: boolean
}

function OverviewCard({ label, value, icon, highlight }: OverviewCardProps): React.JSX.Element {
  return (
    <div className={`rounded-lg border px-4 py-3 ${highlight ? 'border-red-400/30 bg-red-400/5' : 'border-border bg-background'}`}>
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-2xl font-light text-foreground">{value}</span>
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
  data: Array<{ date: string; count: number }>
}

function ActivityHeatmap({ data }: ActivityHeatmapProps): React.JSX.Element {
  const dataMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of data) map.set(d.date, d.count)
    return map
  }, [data])

  const { grid, weekCount, monthLabels } = useMemo(() => {
    const cells: Array<{ date: string; count: number; dayOfWeek: number; weekIndex: number }> = []
    const today = new Date()
    const start = new Date(today)
    start.setDate(today.getDate() - 90)
    // Align to Monday
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))

    const d = new Date(start)
    let weekIndex = 0
    const months: Array<{ label: string; weekIndex: number }> = []
    let lastMonth = -1

    while (d <= today) {
      const dayOfWeek = (d.getDay() + 6) % 7 // Mon=0, Sun=6
      const dateStr = d.toISOString().slice(0, 10)

      // Track month boundaries
      if (d.getMonth() !== lastMonth && dayOfWeek === 0) {
        months.push({ label: d.toLocaleString('default', { month: 'short' }), weekIndex })
        lastMonth = d.getMonth()
      }

      cells.push({ date: dateStr, count: dataMap.get(dateStr) ?? 0, dayOfWeek, weekIndex })
      if (dayOfWeek === 6) weekIndex++
      d.setDate(d.getDate() + 1)
    }
    return { grid: cells, weekCount: weekIndex + 1, monthLabels: months }
  }, [dataMap])

  const getColor = useCallback((count: number): string => {
    if (count === 0) return 'var(--color-border)'
    if (count <= 2) return 'var(--color-accent-30, rgba(99, 102, 241, 0.3))'
    if (count <= 4) return 'var(--color-accent-60, rgba(99, 102, 241, 0.6))'
    return 'var(--color-accent, #6366f1)'
  }, [])

  const dayLabels = ['Mon', '', 'Wed', '', 'Fri', '', '']

  return (
    <div>
      {/* Month labels */}
      <div className="mb-1 flex" style={{ paddingLeft: 28 }}>
        {monthLabels.map((m, i) => (
          <span
            key={i}
            className="text-[9px] text-muted"
            style={{
              position: 'relative',
              left: m.weekIndex * 12,
              marginRight: i < monthLabels.length - 1 ? 0 : undefined
            }}
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
                    className="h-[10px] w-[10px] rounded-[2px] transition-colors"
                    style={{ backgroundColor: cell ? getColor(cell.count) : 'transparent' }}
                    title={cell ? `${cell.date}: ${cell.count} activities` : ''}
                  />
                )
              })}
            </div>
          ))}
        </div>
      </div>
      {/* Legend */}
      <div className="mt-2 flex items-center justify-end gap-1">
        <span className="mr-1 text-[8px] text-muted">Less</span>
        {[0, 1, 3, 5].map((v) => (
          <div key={v} className="h-[8px] w-[8px] rounded-[1px]" style={{ backgroundColor: getColor(v) }} />
        ))}
        <span className="ml-1 text-[8px] text-muted">More</span>
      </div>
    </div>
  )
}
