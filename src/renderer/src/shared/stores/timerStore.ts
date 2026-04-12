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
  /** Flowtime: counts up instead of down */
  isFlowtime: boolean
  /** Flowtime: seconds elapsed in work phase */
  elapsedSeconds: number
  /** Long break duration in seconds */
  longBreakSeconds: number
  /** Work sessions before long break (0 = disabled) */
  longBreakInterval: number
  /** Currently in a long break */
  isLongBreak: boolean
  /** Work sessions completed today */
  sessionsCompleted: number
  /** Total focus seconds today */
  totalFocusSecondsToday: number
  /** ISO date for daily reset */
  statsDate: string | null
}

interface TimerActions {
  startTimer(params: StartTimerParams): void
  pause(): void
  resume(): void
  stop(): void
  skipBreak(): void
  startFlowtimeBreak(): void
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
  isFlowtime?: boolean
  longBreakMinutes?: number
  longBreakInterval?: number
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
  autoBreak: true,
  isFlowtime: false,
  elapsedSeconds: 0,
  longBreakSeconds: 900,
  longBreakInterval: 0,
  isLongBreak: false,
  sessionsCompleted: 0,
  totalFocusSecondsToday: 0,
  statsDate: null
}

export const useTimerStore = createWithEqualityFn<TimerStore>((set, get) => ({
  ...initialState,

  startTimer(params): void {
    clearTickInterval()
    cachedUserId = params.userId

    // Daily stats reset
    const today = new Date().toISOString().slice(0, 10)
    const prevState = get()
    if (prevState.statsDate !== today) {
      set({ sessionsCompleted: 0, totalFocusSecondsToday: 0, statsDate: today })
    }

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
      autoBreak: params.autoBreak,
      isFlowtime: params.isFlowtime ?? false,
      elapsedSeconds: 0,
      longBreakSeconds: (params.longBreakMinutes ?? 0) * 60,
      longBreakInterval: params.longBreakInterval ?? 0,
      isLongBreak: false
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

  skipBreak(): void {
    const state = get()
    if (!state.isRunning || state.phase !== 'break') return

    clearTickInterval()
    if (state.isFlowtime) {
      // Flowtime: resume counting up from 0
      set({
        phase: 'work',
        remainingSeconds: state.workSeconds,
        elapsedSeconds: 0,
        isLongBreak: false,
        currentRep: state.currentRep + 1
      })
    } else {
      // Normal: start next work rep
      set({
        phase: 'work',
        remainingSeconds: state.workSeconds,
        elapsedSeconds: 0,
        isLongBreak: false,
        currentRep: state.currentRep + 1
      })
    }
    startTickInterval()
    syncTrayTimer(get())
  },

  stop(): void {
    clearTickInterval()
    const state = get()

    if (state.isRunning && state.phase === 'work') {
      if (state.isFlowtime && state.elapsedSeconds > 60) {
        // Flowtime: log elapsed time if > 1 minute
        const minutes = Math.round(state.elapsedSeconds / 60)
        if (state.taskId && cachedUserId && minutes > 0) {
          logFocusSession(state.taskId, cachedUserId, minutes)
        }
        set((s) => ({
          sessionsCompleted: s.sessionsCompleted + 1,
          totalFocusSecondsToday: s.totalFocusSecondsToday + state.elapsedSeconds
        }))
      } else if (!state.isFlowtime && state.taskId && cachedUserId) {
        // Normal: log elapsed countdown time
        const elapsedSeconds = state.workSeconds - state.remainingSeconds
        const minutes = Math.round(elapsedSeconds / 60)
        if (minutes > 0) {
          logFocusSession(state.taskId, cachedUserId, minutes)
        }
      }
    }

    // Preserve session stats across stops
    const { sessionsCompleted, totalFocusSecondsToday, statsDate } = get()
    cachedUserId = null
    set({ ...initialState, sessionsCompleted, totalFocusSecondsToday, statsDate })
    syncTrayTimer(initialState)
  },

  startFlowtimeBreak(): void {
    const state = get()
    if (!state.isRunning || !state.isFlowtime || state.phase !== 'work') return

    const breakSeconds = Math.round(state.elapsedSeconds / 5)

    // Log the flowtime work session
    if (state.elapsedSeconds > 60 && state.taskId && cachedUserId) {
      const minutes = Math.round(state.elapsedSeconds / 60)
      if (minutes > 0) logFocusSession(state.taskId, cachedUserId, minutes)
    }
    if (state.notificationEnabled && state.taskId) {
      showTimerNotification(state.taskId, state.taskTitle ?? 'Task', state.currentRep, state.totalReps, state.isPerpetual)
    }

    set((s) => ({
      sessionsCompleted: s.sessionsCompleted + 1,
      totalFocusSecondsToday: s.totalFocusSecondsToday + state.elapsedSeconds,
      phase: 'break' as const,
      remainingSeconds: breakSeconds,
      isLongBreak: false,
      elapsedSeconds: 0
    }))
    syncTrayTimer(get())
  },

  tick(): void {
    const state = get()
    if (!state.isRunning || state.isPaused) return

    if (state.isFlowtime && state.phase === 'work') {
      // Flowtime: count UP
      set({ elapsedSeconds: state.elapsedSeconds + 1 })
    } else {
      // Normal: count DOWN
      const next = state.remainingSeconds - 1
      if (next <= 0) {
        completePhase(get, set)
        return
      }
      set({ remainingSeconds: next })
    }
    syncTrayTimer(get())
  }
}), shallow)

// ── Phase completion ───────────────────────────────────────────────────

function completePhase(
  get: () => TimerStore,
  set: (partial: Partial<TimerState> | ((s: TimerState) => Partial<TimerState>)) => void
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

    // Track session stats
    set((s) => ({
      sessionsCompleted: s.sessionsCompleted + 1,
      totalFocusSecondsToday: s.totalFocusSecondsToday + state.workSeconds
    }))

    // Start break if auto-break enabled
    if (state.autoBreak) {
      const updatedState = get()
      // Use currentRep (per-timer) not sessionsCompleted (cumulative daily)
      const isLongBreak = state.longBreakInterval > 0
        && state.currentRep > 0
        && state.currentRep % state.longBreakInterval === 0

      const breakDuration = isLongBreak ? state.longBreakSeconds : state.breakSeconds

      if (breakDuration > 0) {
        set({
          phase: 'break',
          remainingSeconds: breakDuration,
          isLongBreak
        })
        syncTrayTimer(get())
        return
      }
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
      currentRep: state.currentRep + 1,
      isLongBreak: false
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
  isFlowtime: boolean
  elapsedSeconds: number
  isLongBreak: boolean
  sessionsCompleted: number
  totalFocusSecondsToday: number
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
      taskTitle: state.taskTitle ?? '',
      isFlowtime: state.isFlowtime,
      elapsedSeconds: state.elapsedSeconds,
      isLongBreak: state.isLongBreak,
      sessionsCompleted: state.sessionsCompleted,
      totalFocusSecondsToday: state.totalFocusSecondsToday
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
