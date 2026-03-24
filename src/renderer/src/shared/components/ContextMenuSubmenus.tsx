import { useState, useCallback } from 'react'
import { Check } from 'lucide-react'
import { PRIORITY_LEVELS } from './PriorityIndicator'
import { LabelPicker } from './LabelPicker'
import { useTimerStore } from '../stores/timerStore'
import { useTimerSettings } from '../hooks/useTimerSettings'
import { useAuthStore } from '../stores/authStore'
import { useTaskStore } from '../stores/taskStore'
import { useStatusesByProject } from '../stores/statusStore'
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

// --- Status Flyout ---

interface StatusSubmenuProps {
  task: Task
  statuses: Status[]
  openLeft: boolean
  onStatusChange: (statusId: string) => void
}

export function StatusSubmenu({ task, statuses, openLeft, onStatusChange }: StatusSubmenuProps): React.JSX.Element {
  const defaultStatuses = statuses.filter((s) => s.is_default === 1)
  const middleStatuses = statuses.filter((s) => s.is_default !== 1 && s.is_done !== 1).sort((a, b) => a.order_index - b.order_index)
  const doneStatuses = statuses.filter((s) => s.is_done === 1)
  const sorted = [...defaultStatuses, ...middleStatuses, ...doneStatuses]
  return (
    <SubmenuContainer openLeft={openLeft}>
      {sorted.map((status) => (
        <button
          key={status.id}
          onClick={() => onStatusChange(status.id)}
          className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm font-light text-foreground transition-colors hover:bg-foreground/6"
        >
          <div className="h-2.5 w-2.5 flex-shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
          <span className="flex-1">{status.name}</span>
          {task.status_id === status.id && <Check size={14} className="text-accent" />}
        </button>
      ))}
    </SubmenuContainer>
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
  projectId?: string
}

export function LabelsSubmenu({
  allLabels,
  assignedLabelIds,
  openLeft,
  onToggleLabel,
  onCreateLabel,
  projectId
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
        projectId={projectId}
      />
    </div>
  )
}

// --- Snooze Flyout ---

import { getSnoozePresets } from '../utils/snooze'

interface SnoozeSubmenuProps {
  openLeft: boolean
  currentDueDate?: string | null
  onSnooze: (date: string) => void
}

export function SnoozeSubmenu({ openLeft, currentDueDate, onSnooze }: SnoozeSubmenuProps): React.JSX.Element {
  const [showPicker, setShowPicker] = useState(false)
  const presets = getSnoozePresets(currentDueDate)

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
      {presets.map((preset) => (
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
              ? 'text-accent-fg'
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

// --- Timer Flyout ---

interface TimerSubmenuProps {
  taskId: string
  taskTitle: string
  projectId: string
  openLeft: boolean
  onClose: () => void
}

export function TimerSubmenu({ taskId, taskTitle, projectId, openLeft, onClose }: TimerSubmenuProps): React.JSX.Element {
  const settings = useTimerSettings()
  const isRunning = useTimerStore((s) => s.isRunning)
  const startTimer = useTimerStore((s) => s.startTimer)
  const currentUser = useAuthStore((s) => s.currentUser)
  const { updateTask } = useTaskStore()
  const task = useTaskStore((s) => s.tasks[taskId])
  const statuses = useStatusesByProject(projectId)

  const autoMoveToInProgress = useCallback(() => {
    if (!task) return
    const defaultStatus = statuses.find((s) => s.is_default === 1)
    const isNotStarted = defaultStatus && task.status_id === defaultStatus.id
    if (!isNotStarted) return
    const inProgressStatus = statuses.find((s) => s.is_default === 0 && s.is_done === 0)
    if (inProgressStatus) {
      updateTask(task.id, { status_id: inProgressStatus.id })
    }
  }, [task, statuses, updateTask])

  const handleStart = useCallback(
    (minutes: number) => {
      if (!currentUser || isRunning) return
      autoMoveToInProgress()
      startTimer({
        taskId,
        taskTitle,
        minutes,
        reps: settings.repetitionEnabled ? settings.defaultReps : 1,
        isPerpetual: settings.perpetualMode,
        breakMinutes: settings.breakMinutes,
        soundEnabled: settings.soundEnabled,
        notificationEnabled: settings.notificationEnabled,
        autoBreak: settings.autoBreak,
        userId: currentUser.id
      })
      onClose()
    },
    [taskId, taskTitle, settings, currentUser, isRunning, startTimer, autoMoveToInProgress, onClose]
  )

  return (
    <SubmenuContainer openLeft={openLeft}>
      {isRunning ? (
        <div className="px-3 py-1.5 text-sm font-light text-muted">Timer already running</div>
      ) : (
        settings.presets.map((preset) => (
          <button
            key={preset.id}
            onClick={() => handleStart(preset.minutes)}
            className="flex w-full items-center justify-between px-3 py-1.5 text-left text-sm font-light text-foreground transition-colors hover:bg-foreground/6"
          >
            <span>{preset.name}</span>
            <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
              {preset.minutes}m
            </span>
          </button>
        ))
      )}
    </SubmenuContainer>
  )
}
