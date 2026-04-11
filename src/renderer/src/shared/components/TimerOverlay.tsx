import { useTimerStore } from '../stores/timerStore'
import { Pause, Play, Square } from 'lucide-react'

export function TimerOverlay(): React.JSX.Element | null {
  const isRunning = useTimerStore((s) => s.isRunning)
  const isPaused = useTimerStore((s) => s.isPaused)
  const phase = useTimerStore((s) => s.phase)
  const remainingSeconds = useTimerStore((s) => s.remainingSeconds)
  const taskTitle = useTimerStore((s) => s.taskTitle)
  const currentRep = useTimerStore((s) => s.currentRep)
  const totalReps = useTimerStore((s) => s.totalReps)
  const isPerpetual = useTimerStore((s) => s.isPerpetual)
  const isFlowtime = useTimerStore((s) => s.isFlowtime)
  const elapsedSeconds = useTimerStore((s) => s.elapsedSeconds)
  const isLongBreak = useTimerStore((s) => s.isLongBreak)
  const sessionsCompleted = useTimerStore((s) => s.sessionsCompleted)
  const totalFocusSecondsToday = useTimerStore((s) => s.totalFocusSecondsToday)
  const pause = useTimerStore((s) => s.pause)
  const resume = useTimerStore((s) => s.resume)
  const stop = useTimerStore((s) => s.stop)

  if (!isRunning) return null

  const displaySeconds = (isFlowtime && phase === 'work') ? elapsedSeconds : remainingSeconds
  const minutes = Math.floor(displaySeconds / 60)
  const seconds = displaySeconds % 60
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`

  const isBreak = phase === 'break'
  const showReps = isPerpetual || totalReps > 1

  const phaseLabel = phase === 'work'
    ? (isFlowtime ? 'Flowtime' : 'Focus')
    : isLongBreak
      ? 'Long Break'
      : 'Break'

  const phaseColor = phase === 'work'
    ? 'text-accent'
    : isLongBreak
      ? 'text-amber-400'
      : 'text-emerald-400'

  return (
    <div className="fixed inset-0 z-[9998] flex flex-col items-center justify-center backdrop-blur-xl bg-background/80">
      {/* Phase label */}
      <p className={`mb-4 text-[11px] font-bold uppercase tracking-widest ${phaseColor}`}>
        {phaseLabel}
      </p>

      {/* Countdown */}
      <p
        className={`font-light tabular-nums ${isBreak ? (isLongBreak ? 'text-amber-400' : 'text-emerald-400') : 'text-foreground'}`}
        style={{ fontSize: '8rem', lineHeight: 1 }}
      >
        {timeStr}
      </p>

      {/* Reps */}
      {showReps && (
        <p className="mt-3 text-[10px] font-bold uppercase tracking-widest text-muted">
          {isPerpetual ? `Rep ${currentRep}` : `${currentRep} / ${totalReps}`}
        </p>
      )}

      {/* Task title */}
      {taskTitle && (
        <p className="mt-6 max-w-md truncate text-sm font-light text-muted/60">
          {taskTitle}
        </p>
      )}

      {/* Controls */}
      <div className="mt-10 flex items-center gap-4">
        <button
          onClick={isPaused ? resume : pause}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-foreground transition-colors hover:bg-foreground/10"
          title={isPaused ? 'Resume' : 'Pause'}
        >
          {isPaused ? <Play size={20} /> : <Pause size={20} />}
        </button>
        <button
          onClick={stop}
          className="flex h-12 w-12 items-center justify-center rounded-full border border-danger/30 bg-surface text-danger transition-colors hover:bg-danger/10"
          title="Stop"
        >
          <Square size={18} />
        </button>
      </div>

      {/* Session stats */}
      {sessionsCompleted > 0 && (
        <p className="mt-8 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">
          {sessionsCompleted} {sessionsCompleted === 1 ? 'session' : 'sessions'} &middot; {Math.round(totalFocusSecondsToday / 60)}m focused today
        </p>
      )}
    </div>
  )
}
