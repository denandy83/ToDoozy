import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { resetTimerForAccount, useTimerStore, type StartTimerParams } from './timerStore'
import { useSettingsStore } from './settingsStore'
import { useAuthStore } from './authStore'

const originalSetting = useSettingsStore.getState().setSetting
let activity: ReturnType<typeof vi.fn>
function advance(seconds: number): void { vi.setSystemTime(Date.now() + seconds * 1000) }
function start(overrides: Partial<StartTimerParams> = {}): void {
  useTimerStore.getState().startTimer({ taskId: 'task', taskTitle: 'Synthetic timer', minutes: 25, breakMinutes: 1, reps: 3, isPerpetual: false, autoBreak: true, soundEnabled: false, notificationEnabled: false, userId: 'a', ...overrides })
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-16T12:00:00Z'))
  activity = vi.fn().mockResolvedValue({})
  vi.stubGlobal('window', { api: { activityLog: { create: activity }, timer: { updateTimer: vi.fn(), clearTimer: vi.fn(), minimizeToTray: vi.fn() } } })
  resetTimerForAccount()
  useAuthStore.setState({ currentUser: { id: 'a' } as never })
  useSettingsStore.setState({ settings: { timer_minimize_on_start: 'false' }, setSetting: vi.fn().mockResolvedValue(undefined) })
})
afterEach(() => { resetTimerForAccount(); useSettingsStore.setState({ setSetting: originalSetting }); vi.useRealTimers(); vi.unstubAllGlobals() })

it('checkpoints pause and excludes paused time on resume without callback execution', () => {
  start({ autoBreak: false })
  advance(600); useTimerStore.getState().pause()
  expect(useTimerStore.getState().remainingSeconds).toBe(900)
  advance(3600); useTimerStore.getState().resume()
  expect(useTimerStore.getState().remainingSeconds).toBe(900)
  advance(60); useTimerStore.getState().pause()
  expect(useTimerStore.getState().remainingSeconds).toBe(840)
  useTimerStore.getState().stop()
  expect(activity).toHaveBeenCalledOnce()
  expect(activity.mock.calls[0][0].action).toBe('Completed 11 min focus session')
})
it('logs pending work exactly once when stopping before a delayed callback', () => {
  start({ autoBreak: false })
  advance(600); useTimerStore.getState().stop()
  expect(activity).toHaveBeenCalledOnce()
  expect(activity.mock.calls[0][0].action).toBe('Completed 10 min focus session')
})
it('accounts cookie work and break time before both manual phase changes', () => {
  start({ isFlowtime: true, cookieMinutesPerHour: 6 })
  advance(600); useTimerStore.getState().startCookieBreak()
  expect(useTimerStore.getState().elapsedSeconds).toBe(600)
  expect(useTimerStore.getState().cookiePoolSeconds).toBe(60)
  advance(30); useTimerStore.getState().backToWork()
  expect(useTimerStore.getState().elapsedSeconds).toBe(600)
  expect(useTimerStore.getState().cookieSpentThisSession).toBe(30)
  expect(useTimerStore.getState().cookiePoolSeconds).toBe(30)
  advance(300); useTimerStore.getState().stop()
  expect(activity.mock.calls.map(([row]) => row.action)).toEqual(['Completed 15 min focus session', 'Cookie break: earned 90s, spent 30s'])
  expect(useTimerStore.getState().totalFocusSecondsToday).toBe(900)
})
it('keeps fractional seconds in the phase where they elapsed', () => {
  start({ isFlowtime: true, cookieMinutesPerHour: 6 })
  advance(0.5); useTimerStore.getState().startCookieBreak()
  advance(0.25); useTimerStore.getState().backToWork()
  expect(useTimerStore.getState().elapsedSeconds).toBe(0.5)
  expect(useTimerStore.getState().cookieSpentThisSession).toBe(0.25)
  expect(useTimerStore.getState().cookiePoolSeconds).toBeCloseTo(-0.2)
})
it('computes Flowtime break duration from pending work and re-reads phase after a late skip', () => {
  start({ isFlowtime: true })
  advance(600); useTimerStore.getState().startFlowtimeBreak()
  expect(useTimerStore.getState().remainingSeconds).toBe(120)
  expect(useTimerStore.getState().sessionsCompleted).toBe(1)
  advance(180); useTimerStore.getState().skipBreak()
  expect(useTimerStore.getState()).toMatchObject({ phase: 'work', currentRep: 2, elapsedSeconds: 60, sessionsCompleted: 1 })
})
it('skips only a still-current countdown break after checkpoint transitions', () => {
  start({ minutes: 1 })
  advance(90); useTimerStore.getState().skipBreak()
  expect(useTimerStore.getState()).toMatchObject({ phase: 'work', currentRep: 2, remainingSeconds: 60, sessionsCompleted: 1 })
  advance(150); useTimerStore.getState().skipBreak()
  expect(useTimerStore.getState()).toMatchObject({ phase: 'work', currentRep: 3, remainingSeconds: 30, sessionsCompleted: 2 })
})
it.each(['pause','stop'] as const)('finishes once when a checkpoint from %s crosses the final work boundary without auto-break', control => {
  start({ minutes: 1, reps: 1, autoBreak: false })
  advance(120); useTimerStore.getState()[control]()
  expect(useTimerStore.getState()).toMatchObject({ isRunning: false, isPaused: false, sessionsCompleted: 1, totalFocusSecondsToday: 60 })
  expect(activity).toHaveBeenCalledOnce()
  expect(activity.mock.calls[0][0].action).toBe('Completed 1 min focus session')
})
it('does not reset a running clock on a redundant resume', () => {
  start()
  advance(600); useTimerStore.getState().resume()
  advance(60); useTimerStore.getState().pause()
  expect(useTimerStore.getState().remainingSeconds).toBe(840)
})
it('keeps a skipped paused break paused and excludes that interval on resume', () => {
  start({ minutes: 1 })
  advance(90); useTimerStore.getState().pause(); useTimerStore.getState().skipBreak()
  expect(useTimerStore.getState()).toMatchObject({ currentRep: 2, remainingSeconds: 60, isPaused: true })
  advance(300); useTimerStore.getState().resume()
  expect(useTimerStore.getState().remainingSeconds).toBe(60)
})
it('cancels pending work on account reset without writing old statistics or cookie settings', () => {
  start({ isFlowtime: true, cookieMinutesPerHour: 6 })
  advance(600); useAuthStore.setState({ currentUser: { id: 'b' } as never })
  expect(activity).not.toHaveBeenCalled()
  expect(useTimerStore.getState()).toMatchObject({ isRunning: false, taskId: null, elapsedSeconds: 0 })
})
