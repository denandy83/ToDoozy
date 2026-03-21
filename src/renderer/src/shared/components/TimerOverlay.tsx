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
  const pause = useTimerStore((s) => s.pause)
  const resume = useTimerStore((s) => s.resume)
  const stop = useTimerStore((s) => s.stop)

  if (!isRunning) return null

  const minutes = Math.floor(remainingSeconds / 60)
  const seconds = remainingSeconds % 60
  const timeStr = `${minutes}:${seconds.toString().padStart(2, '0')}`

  const isBreak = phase === 'break'
  const showReps = isPerpetual || totalReps > 1

  return (
    <div className="fixed inset-0 z-[9998] flex flex-col items-center justify-center backdrop-blur-xl bg-background/80">
      {/* Phase label */}
      <p
        className={`mb-4 text-[11px] font-bold uppercase tracking-widest ${
          isBreak ? 'text-emerald-400' : 'text-accent'
        }`}
      >
        {isBreak ? 'Break' : 'Focus'}
      </p>

      {/* Countdown */}
      <p
        className={`font-light tabular-nums ${
          isBreak ? 'text-emerald-400' : 'text-foreground'
        }`}
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
    </div>
  )
}
