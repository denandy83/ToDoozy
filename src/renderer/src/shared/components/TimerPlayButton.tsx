import { useState, useCallback, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Play } from 'lucide-react'
import { useTimerStore } from '../stores/timerStore'
import { useTimerSettings } from '../hooks/useTimerSettings'
import { useAuthStore } from '../stores/authStore'
import { useTaskStore } from '../stores/taskStore'
import { useStatusesByProject } from '../stores/statusStore'

interface TimerPlayButtonProps {
  taskId: string
  taskTitle: string
  projectId: string
}

export function TimerPlayButton({ taskId, taskTitle, projectId }: TimerPlayButtonProps): React.JSX.Element {
  const [popupOpen, setPopupOpen] = useState(false)
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 })
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

  const handleStartTimer = useCallback(
    (minutes: number, reps: number, isPerpetual: boolean, isFlowtime: boolean = false) => {
      if (!currentUser) return
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
        longBreakInterval: settings.longBreakEnabled ? settings.longBreakInterval : 0
      })
      setPopupOpen(false)
    },
    [taskId, taskTitle, settings, currentUser, startTimer, autoMoveToInProgress]
  )

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      if (isTimerRunning) return

      // Direct start only if neither repetition nor flowtime is enabled
      if (!settings.repetitionEnabled && !settings.flowtimeEnabled) {
        handleStartTimer(settings.defaultPreset.minutes, 1, false, false)
        return
      }

      // Show popup
      const btn = btnRef.current
      if (btn) {
        const rect = btn.getBoundingClientRect()
        const popupW = 200
        const popupH = 160
        let top = rect.bottom + 4
        let left = rect.left - popupW / 2 + rect.width / 2

        if (left + popupW > window.innerWidth - 8) left = window.innerWidth - popupW - 8
        if (left < 8) left = 8
        if (top + popupH > window.innerHeight - 8) top = rect.top - popupH - 4

        setPopupPos({ top, left })
      }
      setPopupOpen(true)
    },
    [isTimerRunning, settings, handleStartTimer]
  )

  // Close popup on outside click
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

      {popupOpen &&
        createPortal(
          <TimerPopup
            ref={popupRef}
            position={popupPos}
            settings={settings}
            onStart={handleStartTimer}
            onClose={() => setPopupOpen(false)}
          />,
          document.body
        )}
    </>
  )
}

interface TimerPopupProps {
  position: { top: number; left: number }
  settings: ReturnType<typeof import('../hooks/useTimerSettings').useTimerSettings>
  onStart: (minutes: number, reps: number, isPerpetual: boolean, isFlowtime: boolean) => void
  onClose: () => void
}

import { forwardRef } from 'react'

const TimerPopup = forwardRef<HTMLDivElement, TimerPopupProps>(function TimerPopup(
  { position, settings, onStart, onClose },
  ref
) {
  const [reps, setReps] = useState(settings.defaultReps)
  const [isFlowtime, setIsFlowtime] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.select()
  }, [])

  const handleConfirm = useCallback(() => {
    onStart(
      settings.defaultPreset.minutes,
      isFlowtime ? 0 : (settings.perpetualMode ? 0 : reps),
      isFlowtime ? false : settings.perpetualMode,
      isFlowtime
    )
  }, [settings, reps, isFlowtime, onStart])

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
      className="fixed z-[9999] w-[200px] rounded-lg border border-border bg-surface p-3 shadow-xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-100"
      style={{ top: position.top, left: position.left }}
    >
      <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
        Start Timer
      </p>

      {/* Flowtime toggle */}
      {settings.flowtimeEnabled && (
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Flowtime</span>
          <button
            onClick={() => setIsFlowtime(!isFlowtime)}
            className={`relative h-5 w-9 rounded-full transition-colors ${isFlowtime ? 'bg-accent' : 'bg-border'}`}
          >
            <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform ${isFlowtime ? 'translate-x-4' : ''}`} />
          </button>
        </div>
      )}

      {/* Preset info and reps — hidden when flowtime is on */}
      {!isFlowtime && (
        <>
          <p className="mb-3 text-sm font-light text-foreground">
            {settings.defaultPreset.name} ({settings.defaultPreset.minutes}m)
          </p>

          {settings.perpetualMode ? (
            <p className="mb-3 text-[10px] font-bold uppercase tracking-widest text-muted">
              Perpetual mode
            </p>
          ) : settings.repetitionEnabled ? (
            <div className="mb-3 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">Reps</span>
              <input
                ref={inputRef}
                type="number"
                min={1}
                max={99}
                value={reps}
                onChange={(e) => setReps(Math.max(1, parseInt(e.target.value, 10) || 1))}
                onKeyDown={handleKeyDown}
                className="w-14 rounded-lg border border-border bg-transparent px-2 py-1 text-center text-sm font-light text-foreground focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          ) : null}
        </>
      )}

      <button
        onClick={handleConfirm}
        onKeyDown={handleKeyDown}
        className="w-full rounded-lg bg-accent/12 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/20"
      >
        Start
      </button>
    </div>
  )
})
