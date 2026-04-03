import { useEffect, useState, useMemo, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Flame, Trophy } from 'lucide-react'
import { useAuthStore } from '../../shared/stores'
import { useProjectStore, selectAllProjects } from '../../shared/stores'

type TimeRange = 7 | 30 | 90

interface CompletionData {
  date: string
  count: number
}

interface FocusData {
  date: string
  minutes: number
}

interface HeatmapData {
  date: string
  count: number
}

export function StatsView(): React.JSX.Element {
  const userId = useAuthStore((s) => s.currentUser)?.id ?? ''
  const allProjects = useProjectStore(selectAllProjects)
  const [timeRange, setTimeRange] = useState<TimeRange>(30)
  const [projectFilter, setProjectFilter] = useState<string | null>(null)
  const [completions, setCompletions] = useState<CompletionData[]>([])
  const [focusData, setFocusData] = useState<FocusData[]>([])
  const [heatmapData, setHeatmapData] = useState<HeatmapData[]>([])
  const [streaks, setStreaks] = useState({ current: 0, best: 0 })

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
      const [comp, focus, heat, str] = await Promise.all([
        window.api.stats.completions(userId, projectFilter, startDate, endDate),
        window.api.stats.focus(userId, projectFilter, startDate, endDate),
        window.api.stats.heatmap(userId, heatmapRange.start, heatmapRange.end),
        window.api.stats.streaks(userId)
      ])
      setCompletions(comp)
      setFocusData(focus)
      setHeatmapData(heat)
      setStreaks(str)
    }
    load()
  }, [userId, projectFilter, startDate, endDate, heatmapRange])

  // Compute overview numbers
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const weekStart = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() - d.getDay())
    return d.toISOString().slice(0, 10)
  }, [])
  const monthStart = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
  }, [])

  const todayCount = completions.filter((c) => c.date === todayStr).reduce((s, c) => s + c.count, 0)
  const weekCount = completions.filter((c) => c.date >= weekStart).reduce((s, c) => s + c.count, 0)
  const monthCount = completions.filter((c) => c.date >= monthStart).reduce((s, c) => s + c.count, 0)
  const todayFocus = focusData.filter((f) => f.date === todayStr).reduce((s, f) => s + f.minutes, 0)
  const weekFocus = focusData.filter((f) => f.date >= weekStart).reduce((s, f) => s + f.minutes, 0)

  // Fill chart data with zeros for missing dates
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

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 pb-2 pt-4">
        <h1 className="text-3xl font-light uppercase tracking-[0.15em] text-foreground">Stats</h1>

        {/* Filters */}
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
        {/* Overview Cards */}
        <div className="grid grid-cols-5 gap-3">
          <OverviewCard label="Today" value={todayCount} />
          <OverviewCard label="This Week" value={weekCount} />
          <OverviewCard label="This Month" value={monthCount} />
          <OverviewCard label="Focus Today" value={`${todayFocus}m`} />
          <OverviewCard label="Focus Week" value={`${weekFocus}m`} />
        </div>

        {/* Completion Chart */}
        <ChartSection title="Task Completions">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={completionChart}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: 'var(--color-muted)' }}
                tickFormatter={(v: string) => v.slice(5)}
                interval={timeRange > 30 ? 6 : timeRange > 7 ? 2 : 0}
              />
              <YAxis tick={{ fontSize: 9, fill: 'var(--color-muted)' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', fontSize: 11 }}
              />
              <Bar dataKey="count" fill="var(--color-accent)" radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>

        {/* Focus Time Chart */}
        <ChartSection title="Focus Time (minutes)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={focusChart}>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 9, fill: 'var(--color-muted)' }}
                tickFormatter={(v: string) => v.slice(5)}
                interval={timeRange > 30 ? 6 : timeRange > 7 ? 2 : 0}
              />
              <YAxis tick={{ fontSize: 9, fill: 'var(--color-muted)' }} allowDecimals={false} />
              <Tooltip
                contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', fontSize: 11 }}
              />
              <Bar dataKey="minutes" fill="var(--color-accent)" radius={[2, 2, 0, 0]} opacity={0.7} />
            </BarChart>
          </ResponsiveContainer>
        </ChartSection>

        {/* Streaks & Heatmap */}
        <div className="grid grid-cols-2 gap-6">
          <div className="space-y-4">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Streaks</h2>
            <div className="flex items-center gap-4">
              <div className={`flex items-center gap-2 rounded-lg border px-4 py-3 ${streaks.current > 0 ? 'border-orange-400/30 bg-orange-400/5' : 'border-border bg-background'}`}>
                <Flame size={20} className={streaks.current > 0 ? 'text-orange-400 motion-safe:animate-pulse' : 'text-muted'} />
                <div>
                  <div className="text-2xl font-light text-foreground">{streaks.current}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted">Current</div>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-3">
                <Trophy size={20} className="text-amber-400" />
                <div>
                  <div className="text-2xl font-light text-foreground">{streaks.best}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wider text-muted">Best</div>
                </div>
              </div>
            </div>
            <p className="text-sm font-light text-muted">
              {streaks.current > 0
                ? `You're on a ${streaks.current}-day streak! Keep it up!`
                : 'Start a new streak today!'}
            </p>
          </div>

          {/* Activity Heatmap */}
          <div className="space-y-2">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Activity (90 days)</h2>
            <ActivityHeatmap data={heatmapData} />
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Sub-components ─────────────────────────────────────────────── */

interface OverviewCardProps {
  label: string
  value: number | string
}

function OverviewCard({ label, value }: OverviewCardProps): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-background px-4 py-3">
      <div className="text-2xl font-light text-foreground">{value}</div>
      <div className="text-[9px] font-bold uppercase tracking-wider text-muted">{label}</div>
    </div>
  )
}

interface TimeRangeSelectorProps {
  value: TimeRange
  onChange: (range: TimeRange) => void
}

function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps): React.JSX.Element {
  return (
    <div className="flex rounded-lg border border-border overflow-hidden">
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

interface ActivityHeatmapProps {
  data: Array<{ date: string; count: number }>
}

function ActivityHeatmap({ data }: ActivityHeatmapProps): React.JSX.Element {
  const dataMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const d of data) map.set(d.date, d.count)
    return map
  }, [data])

  // Build 13 weeks x 7 days grid
  const grid = useMemo(() => {
    const cells: Array<{ date: string; count: number; dayOfWeek: number; weekIndex: number }> = []
    const today = new Date()
    const start = new Date(today)
    start.setDate(today.getDate() - 90)
    // Align to Monday
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))

    const d = new Date(start)
    let weekIndex = 0
    while (d <= today) {
      const dayOfWeek = (d.getDay() + 6) % 7 // Mon=0, Sun=6
      const dateStr = d.toISOString().slice(0, 10)
      cells.push({ date: dateStr, count: dataMap.get(dateStr) ?? 0, dayOfWeek, weekIndex })
      if (dayOfWeek === 6) weekIndex++
      d.setDate(d.getDate() + 1)
    }
    return cells
  }, [dataMap])

  const getColor = useCallback((count: number): string => {
    if (count === 0) return 'var(--color-border)'
    if (count <= 2) return 'var(--color-accent-30, rgba(99, 102, 241, 0.3))'
    if (count <= 4) return 'var(--color-accent-60, rgba(99, 102, 241, 0.6))'
    return 'var(--color-accent, #6366f1)'
  }, [])

  return (
    <div className="flex gap-[2px]">
      {Array.from({ length: 14 }, (_, weekIdx) => (
        <div key={weekIdx} className="flex flex-col gap-[2px]">
          {Array.from({ length: 7 }, (_, dayIdx) => {
            const cell = grid.find((c) => c.weekIndex === weekIdx && c.dayOfWeek === dayIdx)
            return (
              <div
                key={dayIdx}
                className="h-[10px] w-[10px] rounded-[2px] transition-colors"
                style={{ backgroundColor: cell ? getColor(cell.count) : 'var(--color-border)' }}
                title={cell ? `${cell.date}: ${cell.count} activities` : ''}
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
