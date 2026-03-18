import { useState, useCallback } from 'react'
import { Check } from 'lucide-react'
import { PRIORITY_LEVELS } from './PriorityIndicator'
import { LabelPicker } from './LabelPicker'
import type { Task, Label, Status } from '../../../../shared/types'

interface SubmenuContainerProps {
  children: React.ReactNode
  openLeft: boolean
}

export function SubmenuContainer({ children, openLeft }: SubmenuContainerProps): React.JSX.Element {
  return (
    <div
      className={`absolute top-0 z-[10001] w-52 rounded-lg border border-border bg-surface py-1 shadow-xl ${
        openLeft ? 'right-full mr-1' : 'left-full ml-1'
      }`}
    >
      {children}
    </div>
  )
}

// --- Priority Flyout ---

interface PrioritySubmenuProps {
  task: Task
  openLeft: boolean
  onPriorityChange: (priority: number) => void
}

export function PrioritySubmenu({ task, openLeft, onPriorityChange }: PrioritySubmenuProps): React.JSX.Element {
  return (
    <SubmenuContainer openLeft={openLeft}>
      {PRIORITY_LEVELS.map((level) => (
        <button
          key={level.value}
          onClick={() => onPriorityChange(level.value)}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm font-light text-foreground transition-colors hover:bg-foreground/6"
        >
          <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: level.color }} />
          <span className="flex-1">{level.label}</span>
          {task.priority === level.value && <Check size={14} className="text-accent" />}
        </button>
      ))}
    </SubmenuContainer>
  )
}

// --- Recurrence Flyout ---

const RECURRENCE_OPTIONS = [
  { value: null, label: 'None' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'every:3', label: 'Every 3 Days' },
  { value: 'every:14', label: 'Every 14 Days' }
] as const

interface RecurrenceSubmenuProps {
  task: Task
  openLeft: boolean
  onRecurrenceChange: (rule: string | null) => void
}

export function RecurrenceSubmenu({ task, openLeft, onRecurrenceChange }: RecurrenceSubmenuProps): React.JSX.Element {
  return (
    <SubmenuContainer openLeft={openLeft}>
      {RECURRENCE_OPTIONS.map((opt) => (
        <button
          key={opt.label}
          onClick={() => onRecurrenceChange(opt.value)}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm font-light text-foreground transition-colors hover:bg-foreground/6"
        >
          <span className="flex-1">{opt.label}</span>
          {task.recurrence_rule === opt.value && <Check size={14} className="text-accent" />}
        </button>
      ))}
    </SubmenuContainer>
  )
}

// --- Labels Flyout ---

interface LabelsSubmenuProps {
  allLabels: Label[]
  assignedLabelIds: Set<string>
  openLeft: boolean
  onToggleLabel: (labelId: string) => void
  onCreateLabel: (name: string, color: string) => void
}

export function LabelsSubmenu({
  allLabels,
  assignedLabelIds,
  openLeft,
  onToggleLabel,
  onCreateLabel
}: LabelsSubmenuProps): React.JSX.Element {
  return (
    <div
      className={`absolute top-0 z-[10001] ${openLeft ? 'right-full mr-1' : 'left-full ml-1'}`}
    >
      <LabelPicker
        allLabels={allLabels}
        assignedLabelIds={assignedLabelIds}
        onToggleLabel={onToggleLabel}
        onCreateLabel={onCreateLabel}
        onClose={() => {}}
      />
    </div>
  )
}

// --- Snooze Flyout ---

function addDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function getLaterToday(): string {
  const d = new Date()
  d.setHours(d.getHours() + 3)
  return d.toISOString()
}

const SNOOZE_PRESETS = [
  { label: 'Later Today', getDate: getLaterToday },
  { label: 'Tomorrow', getDate: () => addDays(1) },
  { label: 'In 3 Days', getDate: () => addDays(3) },
  { label: 'Next Week', getDate: () => addDays(7) }
] as const

interface SnoozeSubmenuProps {
  openLeft: boolean
  onSnooze: (date: string) => void
}

export function SnoozeSubmenu({ openLeft, onSnooze }: SnoozeSubmenuProps): React.JSX.Element {
  const [showPicker, setShowPicker] = useState(false)

  const handlePickDate = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.value) {
        onSnooze(e.target.value)
      }
    },
    [onSnooze]
  )

  return (
    <SubmenuContainer openLeft={openLeft}>
      {SNOOZE_PRESETS.map((preset) => (
        <button
          key={preset.label}
          onClick={() => onSnooze(preset.getDate())}
          className="flex w-full items-center px-3 py-1.5 text-left text-sm font-light text-foreground transition-colors hover:bg-foreground/6"
        >
          {preset.label}
        </button>
      ))}
      <div className="my-1 border-t border-border" />
      {showPicker ? (
        <div className="px-3 py-1.5">
          <input
            type="date"
            onChange={handlePickDate}
            className="w-full bg-transparent text-sm font-light text-foreground focus:outline-none [&::-webkit-calendar-picker-indicator]:invert"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation()
                setShowPicker(false)
              }
            }}
          />
        </div>
      ) : (
        <button
          onClick={() => setShowPicker(true)}
          className="flex w-full items-center px-3 py-1.5 text-left text-sm font-light text-foreground transition-colors hover:bg-foreground/6"
        >
          Pick Date...
        </button>
      )}
    </SubmenuContainer>
  )
}

// --- Focus Flyout ---

const FOCUS_PRESETS = [
  { label: 'Deep Work', minutes: 25 },
  { label: 'Short Sprint', minutes: 15 },
  { label: 'Quick Fix', minutes: 5 },
  { label: 'Long Session', minutes: 50 }
] as const

interface FocusSubmenuProps {
  openLeft: boolean
  onFocus: (minutes: number) => void
}

export function FocusSubmenu({ openLeft, onFocus }: FocusSubmenuProps): React.JSX.Element {
  return (
    <SubmenuContainer openLeft={openLeft}>
      {FOCUS_PRESETS.map((preset) => (
        <button
          key={preset.label}
          onClick={() => onFocus(preset.minutes)}
          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm font-light text-foreground transition-colors hover:bg-foreground/6"
        >
          <span>{preset.label}</span>
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
            {preset.minutes}m
          </span>
        </button>
      ))}
    </SubmenuContainer>
  )
}

// --- Status Row ---

interface StatusRowProps {
  task: Task
  statuses: Status[]
  onStatusChange: (statusId: string) => void
}

export function StatusRow({ task, statuses, onStatusChange }: StatusRowProps): React.JSX.Element {
  const sorted = [...statuses].sort((a, b) => a.order_index - b.order_index)
  return (
    <div className="flex items-center gap-1 px-2 py-1.5">
      {sorted.map((status) => (
        <button
          key={status.id}
          onClick={() => onStatusChange(status.id)}
          className={`rounded px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${
            task.status_id === status.id
              ? 'text-white'
              : 'text-muted hover:bg-foreground/6'
          }`}
          style={task.status_id === status.id ? { backgroundColor: status.color } : undefined}
          title={status.name}
        >
          {status.name}
        </button>
      ))}
    </div>
  )
}
