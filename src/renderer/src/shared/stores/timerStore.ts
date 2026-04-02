import { createWithEqualityFn } from 'zustand/traditional'
import { shallow } from 'zustand/shallow'
import { useSettingsStore } from './settingsStore'

// ── Types ──────────────────────────────────────────────────────────────

export interface TimerPreset {
  id: string
  name: string
  minutes: number
}

export const DEFAULT_TIMER_PRESETS: TimerPreset[] = [
  { id: 'preset-10', name: '10 min', minutes: 10 },
  { id: 'preset-25', name: '25 min', minutes: 25 },
  { id: 'preset-50', name: '50 min', minutes: 50 }
]

export type TimerPhase = 'work' | 'break'

interface TimerState {
  isRunning: boolean
  isPaused: boolean
  phase: TimerPhase
  taskId: string | null
  taskTitle: string | null
  /** Work duration in seconds (preserved across work/break cycles) */
  workSeconds: number
  /** Break duration in seconds */
  breakSeconds: number
  /** Remaining seconds in current phase */
  remainingSeconds: number
  currentRep: number
  totalReps: number
  isPerpetual: boolean
  soundEnabled: boolean
  notificationEnabled: boolean
  autoBreak: boolean
}

interface TimerActions {
  startTimer(params: StartTimerParams): void
  pause(): void
  resume(): void
  stop(): void
  tick(): void
}

export interface StartTimerParams {
  taskId: string
  taskTitle: string
  minutes: number
  reps: number
  isPerpetual: boolean
  breakMinutes: number
  soundEnabled: boolean
  notificationEnabled: boolean
  autoBreak: boolean
  userId: string
}

export type TimerStore = TimerState & TimerActions

// ── Interval management ────────────────────────────────────────────────

let tickInterval: ReturnType<typeof setInterval> | null = null
let cachedUserId: string | null = null

function clearTickInterval(): void {
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }
}

function startTickInterval(): void {
  clearTickInterval()
  tickInterval = setInterval(() => {
    useTimerStore.getState().tick()
  }, 1000)
}

// ── Store ──────────────────────────────────────────────────────────────

const initialState: TimerState = {
  isRunning: false,
  isPaused: false,
  phase: 'work',
  taskId: null,
  taskTitle: null,
  workSeconds: 0,
  breakSeconds: 0,
  remainingSeconds: 0,
  currentRep: 0,
  totalReps: 0,
  isPerpetual: false,
  soundEnabled: true,
  notificationEnabled: true,
  autoBreak: true
}

export const useTimerStore = createWithEqualityFn<TimerStore>((set, get) => ({
  ...initialState,

  startTimer(params): void {
    clearTickInterval()
    cachedUserId = params.userId

    const workSec = params.minutes * 60
    const breakSec = params.breakMinutes * 60
    set({
      isRunning: true,
      isPaused: false,
      phase: 'work',
      taskId: params.taskId,
      taskTitle: params.taskTitle,
      workSeconds: workSec,
      breakSeconds: breakSec,
      remainingSeconds: workSec,
      currentRep: 1,
      totalReps: params.reps,
      isPerpetual: params.isPerpetual,
      soundEnabled: params.soundEnabled,
      notificationEnabled: params.notificationEnabled,
      autoBreak: params.autoBreak
    })

    startTickInterval()
    syncTrayTimer(get())
    const minimizeSetting = useSettingsStore.getState().settings['timer_minimize_on_start'] ?? 'true'
    if (minimizeSetting === 'true') {
      window.api.timer?.minimizeToTray()
    }
  },

  pause(): void {
    clearTickInterval()
    set({ isPaused: true })
    syncTrayTimer(get())
  },

  resume(): void {
    set({ isPaused: false })
    startTickInterval()
    syncTrayTimer(get())
  },

  stop(): void {
    clearTickInterval()
    // Log elapsed time before resetting
    const state = get()
    if (state.isRunning && state.taskId && cachedUserId && state.phase === 'work') {
      const elapsedSeconds = state.workSeconds - state.remainingSeconds
      const minutes = Math.round(elapsedSeconds / 60)
      if (minutes > 0) {
        logFocusSession(state.taskId, cachedUserId, minutes)
      }
    }
    cachedUserId = null
    set(initialState)
    syncTrayTimer(initialState)
  },

  tick(): void {
    const state = get()
    if (!state.isRunning || state.isPaused) return

    const next = state.remainingSeconds - 1
    if (next <= 0) {
      completePhase(get, set)
    } else {
      set({ remainingSeconds: next })
      syncTrayTimer({ ...state, remainingSeconds: next })
    }
  }
}), shallow)

// ── Phase completion ───────────────────────────────────────────────────

function completePhase(
  get: () => TimerStore,
  set: (partial: Partial<TimerState>) => void
): void {
  const state = get()

  if (state.phase === 'work') {
    // Sound
    if (state.soundEnabled) playTimerSound()
    // System notification
    if (state.notificationEnabled && state.taskId) {
      showTimerNotification(state.taskId, state.taskTitle ?? 'Task', state.currentRep, state.totalReps, state.isPerpetual)
    }
    // Activity log
    if (state.taskId && cachedUserId) {
      const minutes = Math.round(state.workSeconds / 60)
      logFocusSession(state.taskId, cachedUserId, minutes)
    }

    // Start break if auto-break enabled
    if (state.autoBreak && state.breakSeconds > 0) {
      set({
        phase: 'break',
        remainingSeconds: state.breakSeconds
      })
      syncTrayTimer(get())
      return
    }

    // No auto-break — go to next rep or stop
    advanceRepOrStop(get, set)
  } else {
    // Break complete — sound only
    if (state.soundEnabled) playTimerSound()
    advanceRepOrStop(get, set)
  }
}

function advanceRepOrStop(
  get: () => TimerStore,
  set: (partial: Partial<TimerState>) => void
): void {
  const state = get()
  const hasMoreReps = state.isPerpetual || state.currentRep < state.totalReps

  if (hasMoreReps) {
    set({
      phase: 'work',
      remainingSeconds: state.workSeconds,
      currentRep: state.currentRep + 1
    })
    syncTrayTimer(get())
  } else {
    get().stop()
  }
}

// ── Tray sync ──────────────────────────────────────────────────────────

export interface TrayTimerState {
  remainingSeconds: number
  isPaused: boolean
  phase: TimerPhase
  currentRep: number
  totalReps: number
  isPerpetual: boolean
  taskTitle: string
}

function syncTrayTimer(state: TimerState): void {
  if (typeof window === 'undefined' || !window.api?.timer) return

  if (!state.isRunning) {
    window.api.timer.clearTimer()
  } else {
    window.api.timer.updateTimer({
      remainingSeconds: state.remainingSeconds,
      isPaused: state.isPaused,
      phase: state.phase,
      currentRep: state.currentRep,
      totalReps: state.totalReps,
      isPerpetual: state.isPerpetual,
      taskTitle: state.taskTitle ?? ''
    })
  }
}

// ── Sound ──────────────────────────────────────────────────────────────

function playTimerSound(): void {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.frequency.value = 880
    osc.type = 'sine'
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.8)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.8)
  } catch (err) {
    console.error('Failed to play timer sound:', err)
  }
}

// ── Notification ───────────────────────────────────────────────────────

function showTimerNotification(taskId: string, taskTitle: string, currentRep: number, totalReps: number, isPerpetual: boolean): void {
  const repText = isPerpetual ? `Rep ${currentRep}` : totalReps > 1 ? `${currentRep}/${totalReps}` : ''
  const body = repText ? `${taskTitle} — ${repText} complete` : `${taskTitle} — focus session complete`
  const notification = new Notification('Timer Complete', { body })
  notification.onclick = (): void => {
    window.api.timer?.navigateToTask(taskId)
  }
}

// ── Activity log ───────────────────────────────────────────────────────

function logFocusSession(taskId: string, userId: string, minutes: number): void {
  window.api.activityLog.create({
    id: crypto.randomUUID(),
    task_id: taskId,
    user_id: userId,
    action: `Completed ${minutes} min focus session`
  }).catch((err: unknown) => {
    console.error('Failed to log focus session:', err)
  })
}

// ── Selectors ──────────────────────────────────────────────────────────

export function formatTimeRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
