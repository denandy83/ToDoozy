import { useState, useMemo, useEffect } from 'react'
import MarkdownIt from 'markdown-it'
import { useTimerStore, formatTimeRemaining } from '../stores/timerStore'
import { useTaskStore } from '../stores/taskStore'
import { Pause, Play, Square, Minimize2, Maximize2 } from 'lucide-react'

const md = new MarkdownIt({ linkify: true, breaks: true })

export function TimerOverlay(): React.JSX.Element | null {
  const isRunning = useTimerStore((s) => s.isRunning)
  const isPaused = useTimerStore((s) => s.isPaused)
  const phase = useTimerStore((s) => s.phase)
  const remainingSeconds = useTimerStore((s) => s.remainingSeconds)
  const taskTitle = useTimerStore((s) => s.taskTitle)
  const taskId = useTimerStore((s) => s.taskId)
  const currentRep = useTimerStore((s) => s.currentRep)
  const totalReps = useTimerStore((s) => s.totalReps)
  const isPerpetual = useTimerStore((s) => s.isPerpetual)
  const isFlowtime = useTimerStore((s) => s.isFlowtime)
  const elapsedSeconds = useTimerStore((s) => s.elapsedSeconds)
  const isLongBreak = useTimerStore((s) => s.isLongBreak)
  const sessionsCompleted = useTimerStore((s) => s.sessionsCompleted)
  const totalFocusSecondsToday = useTimerStore((s) => s.totalFocusSecondsToday)
  const isCookieBreak = useTimerStore((s) => s.isCookieBreak)
  const isCookieBreakPhase = useTimerStore((s) => s.isCookieBreakPhase)
  const cookiePoolSeconds = useTimerStore((s) => s.cookiePoolSeconds)
  const pause = useTimerStore((s) => s.pause)
  const resume = useTimerStore((s) => s.resume)
  const stop = useTimerStore((s) => s.stop)
  const skipBreak = useTimerStore((s) => s.skipBreak)
  const startFlowtimeBreak = useTimerStore((s) => s.startFlowtimeBreak)
  const startCookieBreak = useTimerStore((s) => s.startCookieBreak)
  const backToWork = useTimerStore((s) => s.backToWork)
  const task = useTaskStore((s) => taskId ? s.tasks[taskId] : null)
  const descriptionHtml = useMemo(() => {
    if (!task?.description?.trim()) return null
    return md.render(task.description)
  }, [task?.description])

  const [minimized, setMinimized] = useState(false)

  // Keyboard shortcut: B toggles cookie break
  useEffect(() => {
    if (!isRunning || !isCookieBreak) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'b' || e.key === 'B') {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
        e.preventDefault()
        if (isCookieBreakPhase) {
          backToWork()
        } else if (phase === 'work') {
          startCookieBreak()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isRunning, isCookieBreak, isCookieBreakPhase, phase, startCookieBreak, backToWork])

  if (!isRunning) return null

  // Determine display time
  let displaySeconds: number
  if (isCookieBreakPhase) {
    displaySeconds = cookiePoolSeconds
  } else if (isFlowtime && phase === 'work') {
    displaySeconds = elapsedSeconds
  } else {
    displaySeconds = remainingSeconds
  }

  const timeStr = isCookieBreakPhase
    ? formatTimeRemaining(cookiePoolSeconds)
    : formatTimeRemaining(displaySeconds)

  const isBreak = phase === 'break'
  const showReps = isPerpetual || totalReps > 1

  // No pause during flowtime at all (work or cookie break). Pause only for non-flowtime.
  const canPause = !isFlowtime

  const phaseLabel = isCookieBreakPhase
    ? 'Cookie Break 🍪'
    : phase === 'work'
      ? (isFlowtime ? 'Flowtime' : 'Focus')
      : isLongBreak
        ? 'Long Break'
        : 'Break'

  const phaseColor = isCookieBreakPhase
    ? (cookiePoolSeconds >= 0 ? 'text-emerald-400' : 'text-red-400')
    : phase === 'work'
      ? 'text-accent'
      : isLongBreak
        ? 'text-amber-400'
        : 'text-emerald-400'

  const timeColor = isCookieBreakPhase
    ? (cookiePoolSeconds >= 0 ? 'text-emerald-400' : 'text-red-400')
    : isBreak
      ? (isLongBreak ? 'text-amber-400' : 'text-emerald-400')
      : 'text-foreground'

  // Cookie pool display for the button during work phase
  const cookiePoolStr = formatTimeRemaining(cookiePoolSeconds)
  const cookieButtonColor = cookiePoolSeconds >= 0
    ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-400 hover:bg-emerald-400/15'
    : 'border-red-400/30 bg-red-400/5 text-red-400 hover:bg-red-400/15'

  // Minimized: compact bar at bottom
  if (minimized) {
    return (
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9998] flex items-center gap-3 rounded-2xl border border-border bg-surface/95 backdrop-blur-lg px-4 py-2 shadow-lg">
        <p className={`text-[10px] font-bold uppercase tracking-widest ${phaseColor}`}>
          {phaseLabel}
        </p>
        <p className={`text-lg font-light tabular-nums ${timeColor}`}>
          {timeStr}
        </p>
        {showReps && (
          <p className="text-[10px] text-muted">
            {isPerpetual ? currentRep : `${currentRep}/${totalReps}`}
          </p>
        )}
        <div className="flex items-center gap-1.5 ml-1">
          {canPause && (
            <button
              onClick={isPaused ? resume : pause}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-border text-foreground transition-colors hover:bg-foreground/10"
              title={isPaused ? 'Resume' : 'Pause'}
            >
              {isPaused ? <Play size={12} /> : <Pause size={12} />}
            </button>
          )}
          {isCookieBreakPhase && (
            <button
              onClick={backToWork}
              className="rounded-full border border-border px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-foreground/10"
              title="Back to work (B)"
            >
              Back to work!
            </button>
          )}
          {isCookieBreak && phase === 'work' && (
            <button
              onClick={startCookieBreak}
              className={`rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-widest transition-colors ${cookieButtonColor}`}
              title="Time for a cookie! (B)"
            >
              🍪 {cookiePoolStr}
            </button>
          )}
          {isBreak && !isCookieBreakPhase && (
            <button
              onClick={skipBreak}
              className="rounded-full border border-border px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-foreground/10"
              title="Skip break"
            >
              Skip
            </button>
          )}
          <button
            onClick={stop}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-danger/30 text-danger transition-colors hover:bg-danger/10"
            title="Stop"
          >
            <Square size={10} />
          </button>
        </div>
        <button
          onClick={() => setMinimized(false)}
          className="flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-foreground/10 hover:text-foreground"
          title="Expand timer"
        >
          <Maximize2 size={12} />
        </button>
      </div>
    )
  }

  // Full overlay
  return (
    <div className="fixed inset-0 z-[9998] flex backdrop-blur-xl bg-background/80">
      {/* Minimize button — top right */}
      <button
        onClick={() => setMinimized(true)}
        className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-foreground/10 hover:text-foreground"
        title="Minimize timer"
      >
        <Minimize2 size={16} />
      </button>

      {/* Timer — centered in available space */}
      <div className="flex flex-1 flex-col items-center justify-center">
        {/* Phase label */}
        <p className={`mb-4 text-[11px] font-bold uppercase tracking-widest ${phaseColor}`}>
          {phaseLabel}
        </p>

        {/* Countdown / elapsed */}
        <p
          className={`font-light tabular-nums ${timeColor}`}
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
          <p className="mt-6 max-w-2xl truncate text-sm font-light text-muted/60">
            {taskTitle}
          </p>
        )}

        {/* Cookie break button — flowtime work phase with cookie enabled */}
        {isCookieBreak && phase === 'work' && (
          <button
            onClick={startCookieBreak}
            className={`mt-6 rounded-full border px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${cookieButtonColor}`}
            title="Time for a cookie! (B)"
          >
            Time for a cookie! 🍪 · {cookiePoolStr}
          </button>
        )}

        {/* Earned break — flowtime work phase only, without cookie break, shows after 1 min */}
        {isFlowtime && !isCookieBreak && phase === 'work' && elapsedSeconds >= 60 && (
          <button
            onClick={startFlowtimeBreak}
            className="mt-6 rounded-full border border-emerald-400/30 bg-emerald-400/5 px-4 py-1.5 text-[11px] font-bold uppercase tracking-widest text-emerald-400 transition-colors hover:bg-emerald-400/15"
            title="Start your earned break"
          >
            Earned break · {Math.floor(Math.round(elapsedSeconds / 5) / 60)}:{(Math.round(elapsedSeconds / 5) % 60).toString().padStart(2, '0')}
          </button>
        )}

        {/* Controls */}
        <div className="mt-10 flex items-center gap-4">
          {canPause && (
            <button
              onClick={isPaused ? resume : pause}
              className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-surface text-foreground transition-colors hover:bg-foreground/10"
              title={isPaused ? 'Resume' : 'Pause'}
            >
              {isPaused ? <Play size={20} /> : <Pause size={20} />}
            </button>
          )}
          {isCookieBreakPhase && (
            <button
              onClick={backToWork}
              className="rounded-full border border-border bg-surface px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-foreground/10"
              title="Back to work! (B)"
            >
              Back to work!
            </button>
          )}
          {isBreak && !isCookieBreakPhase && (
            <button
              onClick={skipBreak}
              className="rounded-full border border-border bg-surface px-4 py-3 text-[11px] font-bold uppercase tracking-widest text-foreground transition-colors hover:bg-foreground/10"
              title="Skip break and start next work session"
            >
              Skip
            </button>
          )}
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

      {/* Task description panel — right side */}
      {descriptionHtml && (
        <div className="flex w-80 flex-col border-l border-border/30 p-6 overflow-y-auto">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Description</p>
          <div
            className="text-sm font-light leading-relaxed text-muted/80 [&_h1]:text-base [&_h1]:font-medium [&_h1]:text-foreground/70 [&_h1]:mt-3 [&_h1]:mb-1 [&_h2]:text-sm [&_h2]:font-medium [&_h2]:text-foreground/70 [&_h2]:mt-3 [&_h2]:mb-1 [&_h3]:text-sm [&_h3]:font-medium [&_h3]:text-foreground/70 [&_h3]:mt-2 [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_a]:text-accent [&_a]:underline [&_code]:rounded [&_code]:bg-foreground/10 [&_code]:px-1 [&_code]:text-xs [&_pre]:rounded-lg [&_pre]:bg-foreground/10 [&_pre]:p-3 [&_pre]:text-xs [&_pre]:overflow-x-auto [&_blockquote]:border-l-2 [&_blockquote]:border-muted/30 [&_blockquote]:pl-3 [&_blockquote]:italic [&_p]:my-1 [&_strong]:font-medium [&_strong]:text-foreground/70"
            dangerouslySetInnerHTML={{ __html: descriptionHtml }}
          />
        </div>
      )}
    </div>
  )
}
