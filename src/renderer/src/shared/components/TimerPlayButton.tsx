import { useState, useCallback, useRef, useEffect, useLayoutEffect, forwardRef } from 'react'
import { createPortal } from 'react-dom'
import { Play } from 'lucide-react'
import { useTimerStore } from '../stores/timerStore'
import { useTimerSettings, type TimerSettings, type TimerMode, type TimerDuration } from '../hooks/useTimerSettings'
import { useAuthStore } from '../stores/authStore'
import { useTaskStore } from '../stores/taskStore'
import { useStatusesByProject } from '../stores/statusStore'

interface TimerPlayButtonProps {
  taskId: string
  taskTitle: string
  projectId: string
}

export interface StartParams {
  mode: TimerMode
  duration: TimerDuration
  minutes: number
  reps: number
}

export function paramsToStoreArgs(p: StartParams): { isFlowtime: boolean; isPerpetual: boolean; reps: number; minutes: number } {
  if (p.mode === 'flowtime') {
    return { isFlowtime: true, isPerpetual: false, reps: 0, minutes: p.minutes }
  }
  if (p.duration === 'infinite') {
    return { isFlowtime: false, isPerpetual: true, reps: 1, minutes: p.minutes }
  }
  return { isFlowtime: false, isPerpetual: false, reps: p.reps, minutes: p.minutes }
}

export function TimerPlayButton({ taskId, taskTitle, projectId }: TimerPlayButtonProps): React.JSX.Element {
  const [popupOpen, setPopupOpen] = useState(false)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popupRef = useRef<HTMLDivElement>(null)
  const settings = useTimerSettings()
  const isTimerRunning = useTimerStore((s) => s.isRunning)
  const startTimer = useTimerStore((s) => s.startTimer)
  const currentUser = useAuthStore((s) => s.currentUser)
  const statuses = useStatusesByProject(projectId)
  const { updateTask } = useTaskStore()
  const task = useTaskStore((s) => s.tasks[taskId])

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

  const startWithParams = useCallback(
    (params: StartParams) => {
      if (!currentUser) return
      const { isFlowtime, isPerpetual, reps, minutes } = paramsToStoreArgs(params)
      autoMoveToInProgress()
      startTimer({
        taskId,
        taskTitle,
        minutes,
        reps,
        isPerpetual,
        breakMinutes: settings.breakMinutes,
        soundEnabled: settings.soundEnabled,
        notificationEnabled: settings.notificationEnabled,
        autoBreak: settings.autoBreak,
        userId: currentUser.id,
        isFlowtime,
        longBreakMinutes: settings.longBreakEnabled ? settings.longBreakMinutes : 0,
        longBreakInterval: settings.longBreakEnabled ? settings.longBreakInterval : 0,
        cookieMinutesPerHour: isFlowtime ? settings.cookieMinutesPerHour : 0
      })
      setPopupOpen(false)
    },
    [taskId, taskTitle, settings, currentUser, startTimer, autoMoveToInProgress]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isTimerRunning) return

      if (settings.skipStartDialog) {
        startWithParams({
          mode: settings.defaultMode,
          duration: settings.defaultDuration,
          minutes: settings.defaultPreset.minutes,
          reps: settings.defaultReps
        })
        return
      }

      const btn = btnRef.current
      if (!btn) return
      setAnchorRect(btn.getBoundingClientRect())
      setPopupOpen(true)
    },
    [isTimerRunning, settings, startWithParams]
  )

  useEffect(() => {
    if (!popupOpen) return
    const handleMouseDown = (e: MouseEvent): void => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        setPopupOpen(false)
      }
    }
    const handleEscape = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPopupOpen(false)
    }
    document.addEventListener('mousedown', handleMouseDown)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleMouseDown)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [popupOpen])

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleClick}
        disabled={isTimerRunning}
        className="flex-shrink-0 rounded p-0.5 text-muted/0 transition-colors group-hover:text-muted/50 hover:text-foreground hover:bg-foreground/6 disabled:opacity-30 disabled:cursor-not-allowed"
        title={isTimerRunning ? 'Timer already running' : 'Start timer'}
        aria-label="Start timer"
        tabIndex={0}
      >
        <Play size={12} fill="currentColor" />
      </button>

      {popupOpen && anchorRect &&
        createPortal(
          <TimerPopup
            ref={popupRef}
            anchorRect={anchorRect}
            settings={settings}
            onStart={startWithParams}
            onClose={() => setPopupOpen(false)}
          />,
          document.body
        )}
    </>
  )
}

interface TimerPopupProps {
  anchorRect: DOMRect
  settings: TimerSettings
  onStart: (params: StartParams) => void
  onClose: () => void
}

const SEGMENT_BTN_BASE =
  'flex-1 rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors'
const SEGMENT_BTN_ACTIVE = 'bg-accent/12 border border-accent/15 text-accent'
const SEGMENT_BTN_INACTIVE = 'border border-transparent text-muted hover:bg-foreground/6 hover:text-foreground'

const TimerPopup = forwardRef<HTMLDivElement, TimerPopupProps>(function TimerPopup(
  { anchorRect, settings, onStart, onClose },
  ref
) {
  const [mode, setMode] = useState<TimerMode>(settings.defaultMode)
  const [duration, setDuration] = useState<TimerDuration>(settings.defaultDuration)
  const [minutes, setMinutes] = useState(settings.defaultPreset.minutes)
  const [reps, setReps] = useState(settings.defaultReps)

  // Position synchronously before paint, and re-run when content (mode/duration)
  // changes since the popup's height changes too.
  useLayoutEffect(() => {
    const el = (ref as React.RefObject<HTMLDivElement>)?.current
    if (!el) return

    const margin = 8
    const vw = window.innerWidth
    const vh = window.innerHeight
    const popupRect = el.getBoundingClientRect()
    const popupW = popupRect.width
    const popupH = popupRect.height

    // Horizontal: center on the anchor, then clamp inside the viewport.
    let left = anchorRect.left + anchorRect.width / 2 - popupW / 2
    if (left + popupW > vw - margin) left = vw - popupW - margin
    if (left < margin) left = margin

    // Vertical: prefer below, flip above if it overflows, clamp to viewport
    // if neither side has room.
    const belowTop = anchorRect.bottom + 4
    const aboveTop = anchorRect.top - popupH - 4
    let top: number
    if (belowTop + popupH <= vh - margin) {
      top = belowTop
    } else if (aboveTop >= margin) {
      top = aboveTop
    } else {
      top = Math.max(margin, vh - popupH - margin)
    }

    el.style.left = `${left}px`
    el.style.top = `${top}px`
  }, [anchorRect, mode, duration, ref])

  useEffect(() => {
    const el = (ref as React.RefObject<HTMLDivElement>)?.current
    el?.focus()
  }, [ref])

  const handleConfirm = useCallback(() => {
    onStart({ mode, duration, minutes, reps })
  }, [mode, duration, minutes, reps, onStart])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleConfirm()
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    },
    [handleConfirm, onClose]
  )

  return (
    <div
      ref={ref}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      className="fixed z-[9999] flex h-[224px] w-[260px] flex-col rounded-lg border border-border bg-surface p-3 shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-100"
      style={{ top: -9999, left: -9999 }}
    >
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        Start Timer
      </p>

      {/* Mode selector */}
      <div className="mb-3 flex gap-1 rounded-lg border border-border p-0.5">
        <button
          type="button"
          onClick={() => setMode('flowtime')}
          className={`${SEGMENT_BTN_BASE} ${mode === 'flowtime' ? SEGMENT_BTN_ACTIVE : SEGMENT_BTN_INACTIVE}`}
        >
          Flowtime
        </button>
        <button
          type="button"
          onClick={() => setMode('timer')}
          className={`${SEGMENT_BTN_BASE} ${mode === 'timer' ? SEGMENT_BTN_ACTIVE : SEGMENT_BTN_INACTIVE}`}
        >
          Timer
        </button>
      </div>

      {mode === 'flowtime' ? (
        <p className="mb-3 text-[10px] font-light text-muted">
          Counts up — stop when you&rsquo;re done.
          {settings.cookieMinutesPerHour > 0 && (
            <> Earns {settings.cookieMinutesPerHour} min/hr cookie break.</>
          )}
        </p>
      ) : (
        <>
          <div className="mb-3 flex gap-1 rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => setDuration('limited')}
              className={`${SEGMENT_BTN_BASE} ${duration === 'limited' ? SEGMENT_BTN_ACTIVE : SEGMENT_BTN_INACTIVE}`}
            >
              Limited
            </button>
            <button
              type="button"
              onClick={() => setDuration('infinite')}
              className={`${SEGMENT_BTN_BASE} ${duration === 'infinite' ? SEGMENT_BTN_ACTIVE : SEGMENT_BTN_INACTIVE}`}
            >
              Infinite
            </button>
          </div>

          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Focus</span>
              <select
                value={minutes}
                onChange={(e) => setMinutes(parseInt(e.target.value, 10))}
                className="rounded-lg border border-border bg-transparent px-2 py-1 text-sm font-light text-foreground focus:outline-none cursor-pointer"
              >
                {settings.presets.map((p) => (
                  <option key={p.id} value={p.minutes}>{p.name}</option>
                ))}
              </select>
            </div>
            <div className={`flex items-center gap-2 ${duration === 'limited' ? '' : 'invisible'}`}>
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Reps</span>
              <input
                type="number"
                min={1}
                max={99}
                value={reps}
                onChange={(e) => setReps(Math.max(1, parseInt(e.target.value, 10) || 1))}
                onFocus={(e) => e.currentTarget.select()}
                onClick={(e) => e.currentTarget.select()}
                className="w-12 rounded-lg border border-border bg-transparent px-2 py-1 text-center text-sm font-light text-foreground selection:bg-accent/30 selection:text-foreground focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={handleConfirm}
        className="mt-auto w-full rounded-lg bg-accent/12 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/20"
      >
        Start
      </button>
    </div>
  )
})
