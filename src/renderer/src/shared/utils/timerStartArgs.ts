import type { StartTimerParams } from '../stores/timerStore'
import type { TimerSettings, TimerMode, TimerDuration } from '../hooks/useTimerSettings'

export interface StartParams {
  mode: TimerMode
  duration: TimerDuration
  minutes: number
  reps: number
}

/**
 * Translate a mode/duration selection into the flowtime / perpetual / reps shape
 * the timer store expects. Flowtime always counts up (reps 0, never perpetual);
 * an infinite countdown is perpetual with a single rep; a limited countdown keeps
 * the requested reps.
 */
export function paramsToStoreArgs(p: StartParams): {
  isFlowtime: boolean
  isPerpetual: boolean
  reps: number
  minutes: number
} {
  if (p.mode === 'flowtime') {
    return { isFlowtime: true, isPerpetual: false, reps: 0, minutes: p.minutes }
  }
  if (p.duration === 'infinite') {
    return { isFlowtime: false, isPerpetual: true, reps: 1, minutes: p.minutes }
  }
  return { isFlowtime: false, isPerpetual: false, reps: p.reps, minutes: p.minutes }
}

export interface TimerIdentity {
  taskId: string
  taskTitle: string
  userId: string
}

/**
 * Build the full `StartTimerParams` from a mode/duration selection plus the
 * resolved timer settings. Shared by the task-row play button and the
 * context-menu "Start Timer" submenu so both honour flowtime mode and activate
 * the cookie-break pool identically — preventing the two start paths from
 * diverging (the play-button flowtime fix once missed the submenu).
 */
export function buildTimerStartArgs(
  params: StartParams,
  settings: TimerSettings,
  identity: TimerIdentity
): StartTimerParams {
  const { isFlowtime, isPerpetual, reps, minutes } = paramsToStoreArgs(params)
  return {
    taskId: identity.taskId,
    taskTitle: identity.taskTitle,
    minutes,
    reps,
    isPerpetual,
    breakMinutes: settings.breakMinutes,
    soundEnabled: settings.soundEnabled,
    notificationEnabled: settings.notificationEnabled,
    autoBreak: settings.autoBreak,
    userId: identity.userId,
    isFlowtime,
    longBreakMinutes: settings.longBreakEnabled ? settings.longBreakMinutes : 0,
    longBreakInterval: settings.longBreakEnabled ? settings.longBreakInterval : 0,
    cookieMinutesPerHour: isFlowtime ? settings.cookieMinutesPerHour : 0
  }
}
