import { describe, it, expect } from 'vitest'
import { buildTimerStartArgs, paramsToStoreArgs } from './timerStartArgs'
import type { TimerSettings } from '../hooks/useTimerSettings'

const baseSettings: TimerSettings = {
  presets: [{ id: 'p1', name: 'Pomodoro', minutes: 25 }],
  defaultPreset: { id: 'p1', name: 'Pomodoro', minutes: 25 },
  breakMinutes: 5,
  defaultReps: 4,
  soundEnabled: true,
  notificationEnabled: true,
  autoBreak: true,
  longBreakEnabled: true,
  longBreakMinutes: 15,
  longBreakInterval: 4,
  cookieMinutesPerHour: 10,
  cookieTransfer: false,
  defaultMode: 'timer',
  defaultDuration: 'limited',
  skipStartDialog: false
}

const identity = { taskId: 't1', taskTitle: 'Test task', userId: 'u1' }

describe('paramsToStoreArgs', () => {
  it('flowtime mode produces isFlowtime=true regardless of duration', () => {
    expect(paramsToStoreArgs({ mode: 'flowtime', duration: 'limited', minutes: 25, reps: 4 })).toEqual({
      isFlowtime: true,
      isPerpetual: false,
      reps: 0,
      minutes: 25
    })
    expect(paramsToStoreArgs({ mode: 'flowtime', duration: 'infinite', minutes: 25, reps: 1 })).toEqual({
      isFlowtime: true,
      isPerpetual: false,
      reps: 0,
      minutes: 25
    })
  })

  it('timer + infinite produces a perpetual countdown', () => {
    expect(paramsToStoreArgs({ mode: 'timer', duration: 'infinite', minutes: 25, reps: 4 })).toEqual({
      isFlowtime: false,
      isPerpetual: true,
      reps: 1,
      minutes: 25
    })
  })

  it('timer + limited produces a finite countdown with the chosen reps', () => {
    expect(paramsToStoreArgs({ mode: 'timer', duration: 'limited', minutes: 25, reps: 4 })).toEqual({
      isFlowtime: false,
      isPerpetual: false,
      reps: 4,
      minutes: 25
    })
  })
})

describe('buildTimerStartArgs', () => {
  it('flowtime mode activates the cookie pool and counts up (regression: context-menu Start Timer)', () => {
    const args = buildTimerStartArgs(
      { mode: 'flowtime', duration: 'limited', minutes: 25, reps: 4 },
      { ...baseSettings, defaultMode: 'flowtime', cookieMinutesPerHour: 12 },
      identity
    )
    expect(args.isFlowtime).toBe(true)
    expect(args.isPerpetual).toBe(false)
    expect(args.reps).toBe(0)
    expect(args.cookieMinutesPerHour).toBe(12)
  })

  it('timer mode never activates the cookie pool', () => {
    const args = buildTimerStartArgs(
      { mode: 'timer', duration: 'limited', minutes: 25, reps: 4 },
      baseSettings,
      identity
    )
    expect(args.isFlowtime).toBe(false)
    expect(args.cookieMinutesPerHour).toBe(0)
    expect(args.reps).toBe(4)
  })

  it('timer + infinite produces a perpetual countdown with no cookie pool', () => {
    const args = buildTimerStartArgs(
      { mode: 'timer', duration: 'infinite', minutes: 25, reps: 4 },
      baseSettings,
      identity
    )
    expect(args.isPerpetual).toBe(true)
    expect(args.reps).toBe(1)
    expect(args.isFlowtime).toBe(false)
    expect(args.cookieMinutesPerHour).toBe(0)
  })

  it('carries identity and ancillary settings through unchanged', () => {
    const args = buildTimerStartArgs(
      { mode: 'timer', duration: 'limited', minutes: 30, reps: 2 },
      baseSettings,
      identity
    )
    expect(args).toMatchObject({
      taskId: 't1',
      taskTitle: 'Test task',
      userId: 'u1',
      minutes: 30,
      breakMinutes: 5,
      soundEnabled: true,
      notificationEnabled: true,
      autoBreak: true,
      longBreakMinutes: 15,
      longBreakInterval: 4
    })
  })

  it('zeroes long-break settings when long breaks are disabled', () => {
    const args = buildTimerStartArgs(
      { mode: 'timer', duration: 'limited', minutes: 25, reps: 1 },
      { ...baseSettings, longBreakEnabled: false },
      identity
    )
    expect(args.longBreakMinutes).toBe(0)
    expect(args.longBreakInterval).toBe(0)
  })
})
