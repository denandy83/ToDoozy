import { useCallback, useMemo, useState } from 'react'
import {
  parseRecurrence,
  serializeRecurrence,
  describeRecurrence,
  getNextOccurrence,
  formatShortDate,
  getTodayWeekDay,
  getTodayDate,
  getTodayMonth,
  WEEK_DAYS,
  MONTH_NAMES,
  DAY_LABELS,
  ORDINALS
} from '../../../../shared/recurrenceUtils'
import type { RecurrenceConfig } from '../../../../shared/types'
import { DatePicker } from '../../shared/components/DatePicker'

const PRESETS = [
  { label: 'None', value: null },
  { label: 'Daily', value: 'days' },
  { label: 'Weekly', value: 'weeks' },
  { label: 'Monthly', value: 'months' }
] as const

interface DetailRecurrenceProps {
  recurrenceRule: string | null
  onRecurrenceChange: (rule: string | null) => void
}

export function DetailRecurrence({
  recurrenceRule,
  onRecurrenceChange
}: DetailRecurrenceProps): React.JSX.Element {
  const parsed = useMemo(() => parseRecurrence(recurrenceRule), [recurrenceRule])
  const [expanded, setExpanded] = useState(parsed !== null)

  // Local config state for the picker
  const [config, setConfig] = useState<RecurrenceConfig>(() => {
    if (parsed) return { ...parsed }
    return {
      interval: 1,
      unit: 'days',
      afterCompletion: false
    }
  })

  const updateAndEmit = useCallback(
    (newConfig: RecurrenceConfig) => {
      setConfig(newConfig)
      onRecurrenceChange(serializeRecurrence(newConfig))
    },
    [onRecurrenceChange]
  )

  const handlePresetClick = useCallback(
    (unit: string | null) => {
      if (unit === null) {
        setExpanded(false)
        onRecurrenceChange(null)
        return
      }
      setExpanded(true)
      const newConfig: RecurrenceConfig = {
        interval: 1,
        unit: unit as RecurrenceConfig['unit'],
        afterCompletion: false
      }
      if (unit === 'weeks') {
        newConfig.weekDays = [getTodayWeekDay()]
      } else if (unit === 'months') {
        newConfig.monthDay = getTodayDate()
      } else if (unit === 'years') {
        newConfig.yearMonth = getTodayMonth()
        newConfig.yearDay = getTodayDate()
      }
      updateAndEmit(newConfig)
    },
    [onRecurrenceChange, updateAndEmit]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && expanded && !recurrenceRule) {
        e.stopPropagation()
        setExpanded(false)
      }
    },
    [expanded, recurrenceRule]
  )

  // Determine which preset is active (modifiers like afterCompletion/untilDate don't change the preset)
  const activePreset = !recurrenceRule
    ? 'None'
    : config.unit === 'days' && config.interval === 1
      ? 'Daily'
      : config.unit === 'weeks' && config.interval === 1
        ? 'Weekly'
        : config.unit === 'months' && config.interval === 1
          ? 'Monthly'
          : null

  // Preview
  const previewText = recurrenceRule ? describeRecurrence(recurrenceRule) : null
  const nextDate = useMemo(() => {
    if (!recurrenceRule) return null
    return getNextOccurrence(recurrenceRule, new Date())
  }, [recurrenceRule])

  return (
    <div className="flex flex-col gap-2" onKeyDown={handleKeyDown}>
      {/* Preset buttons */}
      <div className="flex flex-wrap items-center gap-1" role="radiogroup">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            role="radio"
            tabIndex={activePreset === preset.label ? 0 : -1}
            aria-checked={activePreset === preset.label}
            aria-pressed={activePreset === preset.label}
            onClick={() => handlePresetClick(preset.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault()
                e.stopPropagation()
                const btn = e.currentTarget as HTMLElement
                const parent = btn.parentElement
                if (!parent) return
                const buttons = Array.from(parent.querySelectorAll<HTMLElement>('button[role="radio"]'))
                const idx = buttons.indexOf(btn)
                const next = e.key === 'ArrowRight'
                  ? buttons[(idx + 1) % buttons.length]
                  : buttons[(idx - 1 + buttons.length) % buttons.length]
                next.focus()
                next.click()
              }
            }}
            className={`rounded px-2 py-1 text-[9px] font-bold uppercase tracking-wider transition-colors ${
              activePreset === preset.label
                ? 'bg-accent text-accent-fg'
                : 'text-muted hover:bg-foreground/6'
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      {/* Expanded picker */}
      {expanded && recurrenceRule && (
        <RecurrencePicker config={config} onChange={updateAndEmit} />
      )}

      {/* Preview line */}
      {expanded && previewText && (
        <div className="text-[11px] font-light text-accent">
          → {previewText}
          {nextDate && ` (next: ${formatShortDate(nextDate)})`}
        </div>
      )}
    </div>
  )
}

interface RecurrencePickerProps {
  config: RecurrenceConfig
  onChange: (config: RecurrenceConfig) => void
}

function RecurrencePicker({ config, onChange }: RecurrencePickerProps): React.JSX.Element {
  const handleIntervalChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Math.max(1, parseInt(e.target.value, 10) || 1)
      onChange({ ...config, interval: val })
    },
    [config, onChange]
  )

  const handleUnitChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const unit = e.target.value as RecurrenceConfig['unit']
      const updated: RecurrenceConfig = { ...config, unit }
      // Reset unit-specific fields
      delete updated.weekDays
      delete updated.monthDay
      delete updated.monthOrdinal
      delete updated.yearMonth
      delete updated.yearDay

      if (unit === 'weeks') {
        updated.weekDays = [getTodayWeekDay()]
      } else if (unit === 'months') {
        updated.monthDay = getTodayDate()
      } else if (unit === 'years') {
        updated.yearMonth = getTodayMonth()
        updated.yearDay = getTodayDate()
      }
      onChange(updated)
    },
    [config, onChange]
  )

  const toggleWeekDay = useCallback(
    (day: string) => {
      const current = new Set(config.weekDays ?? [])
      if (current.has(day)) {
        if (current.size > 1) current.delete(day)
      } else {
        current.add(day)
      }
      onChange({ ...config, weekDays: [...current] })
    },
    [config, onChange]
  )

  const handleMonthModeChange = useCallback(
    (mode: 'day' | 'ordinal') => {
      if (mode === 'day') {
        const updated = { ...config, monthDay: getTodayDate() }
        delete updated.monthOrdinal
        onChange(updated)
      } else {
        const todayDay = WEEK_DAYS[new Date().getDay()]
        const updated = { ...config, monthOrdinal: { nth: '1st' as const, day: todayDay } }
        delete updated.monthDay
        onChange(updated)
      }
    },
    [config, onChange]
  )

  const handleAfterCompletionToggle = useCallback(
    (after: boolean) => {
      onChange({ ...config, afterCompletion: after })
    },
    [config, onChange]
  )

  const handleEndDateToggle = useCallback(
    (hasEnd: boolean) => {
      if (hasEnd) {
        const d = new Date()
        d.setMonth(d.getMonth() + 3)
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        onChange({ ...config, untilDate: iso })
      } else {
        const updated = { ...config }
        delete updated.untilDate
        onChange(updated)
      }
    },
    [config, onChange]
  )

  return (
    <div className="flex flex-col gap-2 rounded border border-border bg-surface/50 p-2.5">
      {/* Row 1: Every [N] [unit] */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Every</span>
        <input
          type="text"
          inputMode="numeric"
          value={config.interval}
          onChange={handleIntervalChange}
          onFocus={(e) => e.target.select()}
          className="w-12 rounded border border-border bg-transparent px-1.5 py-0.5 text-center text-sm font-light text-foreground focus:border-accent focus:outline-none"
        />
        <select
          value={config.unit}
          onChange={handleUnitChange}
          className="rounded border border-border bg-transparent px-1.5 py-0.5 text-sm font-light text-foreground focus:border-accent focus:outline-none"
        >
          <option value="days">days</option>
          <option value="weeks">weeks</option>
          <option value="months">months</option>
          <option value="years">years</option>
        </select>
      </div>

      {/* Row 2: Fixed / After completion */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => handleAfterCompletionToggle(false)}
          className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
            !config.afterCompletion ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-foreground/6'
          }`}
        >
          Fixed
        </button>
        <button
          onClick={() => handleAfterCompletionToggle(true)}
          className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
            config.afterCompletion ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-foreground/6'
          }`}
        >
          After completion
        </button>
      </div>

      {/* Row 3: Unit-specific controls (hidden in after-completion mode — days are computed from completion date) */}
      {!config.afterCompletion && config.unit === 'weeks' && (
        <WeekDayPicker selected={config.weekDays ?? []} onToggle={toggleWeekDay} />
      )}
      {!config.afterCompletion && config.unit === 'months' && (
        <MonthPicker config={config} onChange={onChange} onModeChange={handleMonthModeChange} />
      )}
      {!config.afterCompletion && config.unit === 'years' && (
        <YearPicker config={config} onChange={onChange} />
      )}

      {/* Row 4: Ends */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Ends</span>
        <select
          value={config.untilDate ? 'date' : 'never'}
          onChange={(e) => handleEndDateToggle(e.target.value === 'date')}
          className="rounded border border-border bg-transparent px-1.5 py-0.5 text-sm font-light text-foreground focus:border-accent focus:outline-none"
        >
          <option value="never">Never</option>
          <option value="date">On date</option>
        </select>
        {config.untilDate && (
          <DatePicker
            value={config.untilDate}
            onChange={(val) => {
              if (val) {
                onChange({ ...config, untilDate: val.split('T')[0] })
              } else {
                const updated = { ...config }
                delete updated.untilDate
                onChange(updated)
              }
            }}
          />
        )}
      </div>
    </div>
  )
}

interface WeekDayPickerProps {
  selected: string[]
  onToggle: (day: string) => void
}

function WeekDayPicker({ selected, onToggle }: WeekDayPickerProps): React.JSX.Element {
  const selectedSet = new Set(selected)
  const labels = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
  // Map labels to WEEK_DAYS indices: mon=1, tue=2, ..., sun=0
  const dayOrder = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

  return (
    <div className="flex items-center gap-0.5">
      {dayOrder.map((day, i) => (
        <button
          key={day}
          onClick={() => onToggle(day)}
          onKeyDown={(e) => {
            if (e.key === ' ') { e.preventDefault(); onToggle(day) }
          }}
          className={`flex h-6 w-6 items-center justify-center rounded text-[9px] font-bold uppercase transition-colors ${
            selectedSet.has(day)
              ? 'bg-accent text-accent-fg'
              : 'text-muted hover:bg-foreground/6'
          }`}
          aria-label={DAY_LABELS[WEEK_DAYS.indexOf(day as typeof WEEK_DAYS[number])]}
        >
          {labels[i]}
        </button>
      ))}
    </div>
  )
}

interface MonthPickerProps {
  config: RecurrenceConfig
  onChange: (config: RecurrenceConfig) => void
  onModeChange: (mode: 'day' | 'ordinal') => void
}

function MonthPicker({ config, onChange, onModeChange }: MonthPickerProps): React.JSX.Element {
  const isOrdinal = !!config.monthOrdinal

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <button
          onClick={() => onModeChange('day')}
          className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
            !isOrdinal ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-foreground/6'
          }`}
        >
          On day
        </button>
        <button
          onClick={() => onModeChange('ordinal')}
          className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
            isOrdinal ? 'bg-accent text-accent-fg' : 'text-muted hover:bg-foreground/6'
          }`}
        >
          On the
        </button>
      </div>

      {!isOrdinal ? (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Day</span>
          <input
            type="text"
            inputMode="numeric"
            value={config.monthDay ?? getTodayDate()}
            onChange={(e) => {
              const val = Math.max(1, Math.min(31, parseInt(e.target.value, 10) || 1))
              onChange({ ...config, monthDay: val })
            }}
            onFocus={(e) => e.target.select()}
            className="w-12 rounded border border-border bg-transparent px-1.5 py-0.5 text-center text-sm font-light text-foreground focus:border-accent focus:outline-none"
          />
        </div>
      ) : (
        <div className="flex items-center gap-1.5">
          <select
            value={config.monthOrdinal?.nth ?? '1st'}
            onChange={(e) => {
              const nth = e.target.value as typeof ORDINALS[number]
              onChange({
                ...config,
                monthOrdinal: { nth, day: config.monthOrdinal?.day ?? getTodayWeekDay() }
              })
            }}
            className="rounded border border-border bg-transparent px-1.5 py-0.5 text-sm font-light text-foreground focus:border-accent focus:outline-none"
          >
            {ORDINALS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <select
            value={config.monthOrdinal?.day ?? getTodayWeekDay()}
            onChange={(e) => {
              onChange({
                ...config,
                monthOrdinal: { nth: config.monthOrdinal?.nth ?? '1st', day: e.target.value }
              })
            }}
            className="rounded border border-border bg-transparent px-1.5 py-0.5 text-sm font-light text-foreground focus:border-accent focus:outline-none"
          >
            {WEEK_DAYS.filter((d) => d !== 'sun').map((d) => (
              <option key={d} value={d}>{DAY_LABELS[WEEK_DAYS.indexOf(d)]}</option>
            ))}
            <option value="sun">{DAY_LABELS[0]}</option>
          </select>
        </div>
      )}
    </div>
  )
}

interface YearPickerProps {
  config: RecurrenceConfig
  onChange: (config: RecurrenceConfig) => void
}

function YearPicker({ config, onChange }: YearPickerProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-1.5">
      <select
        value={config.yearMonth ?? getTodayMonth()}
        onChange={(e) => {
          const val = parseInt(e.target.value, 10)
          onChange({ ...config, yearMonth: val })
        }}
        className="rounded border border-border bg-transparent px-1.5 py-0.5 text-sm font-light text-foreground focus:border-accent focus:outline-none"
      >
        {MONTH_NAMES.map((m, i) => (
          <option key={m} value={i + 1}>{m}</option>
        ))}
      </select>
      <input
        type="text"
        inputMode="numeric"
        value={config.yearDay ?? getTodayDate()}
        onChange={(e) => {
          const val = Math.max(1, Math.min(31, parseInt(e.target.value, 10) || 1))
          onChange({ ...config, yearDay: val })
        }}
        onFocus={(e) => e.target.select()}
        className="w-12 rounded border border-border bg-transparent px-1.5 py-0.5 text-center text-sm font-light text-foreground focus:border-accent focus:outline-none"
      />
    </div>
  )
}
