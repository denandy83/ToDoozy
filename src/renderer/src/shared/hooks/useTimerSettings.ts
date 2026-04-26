import { useMemo } from 'react'
import { useSetting } from '../stores/settingsStore'
import { DEFAULT_TIMER_PRESETS, type TimerPreset } from '../stores/timerStore'

export type TimerMode = 'flowtime' | 'timer'
export type TimerDuration = 'infinite' | 'limited'

export interface TimerSettings {
  presets: TimerPreset[]
  defaultPreset: TimerPreset
  breakMinutes: number
  defaultReps: number
  soundEnabled: boolean
  notificationEnabled: boolean
  autoBreak: boolean
  longBreakEnabled: boolean
  longBreakMinutes: number
  longBreakInterval: number
  cookieMinutesPerHour: number
  cookieTransfer: boolean
  defaultMode: TimerMode
  defaultDuration: TimerDuration
  skipStartDialog: boolean
}

export function useTimerSettings(): TimerSettings {
  const presetsRaw = useSetting('timer_presets')
  const defaultPresetId = useSetting('timer_default_preset')
  const breakMinutesRaw = useSetting('timer_break_minutes')
  const defaultRepsRaw = useSetting('timer_default_reps')
  const perpetualMode = useSetting('timer_perpetual')
  const soundEnabled = useSetting('timer_sound')
  const notificationEnabled = useSetting('timer_notification')
  const autoBreak = useSetting('timer_auto_break')
  const flowtimeEnabled = useSetting('timer_flowtime_enabled')
  const longBreakEnabled = useSetting('timer_long_break_enabled')
  const longBreakMinutesRaw = useSetting('timer_long_break_minutes')
  const longBreakIntervalRaw = useSetting('timer_long_break_interval')
  const cookieMinutesPerHourRaw = useSetting('timer_cookie_minutes_per_hour')
  const cookieTransfer = useSetting('timer_cookie_transfer')
  const defaultModeRaw = useSetting('timer_default_mode')
  const skipStartDialog = useSetting('timer_skip_start_dialog')

  return useMemo(() => {
    let presets: TimerPreset[]
    try {
      presets = presetsRaw ? JSON.parse(presetsRaw) : DEFAULT_TIMER_PRESETS
      if (!Array.isArray(presets) || presets.length === 0) presets = DEFAULT_TIMER_PRESETS
    } catch {
      presets = DEFAULT_TIMER_PRESETS
    }

    const defaultPreset = presets.find((p) => p.id === defaultPresetId) ?? presets[1] ?? presets[0]

    // Default mode: explicit setting wins; otherwise migrate from legacy timer_flowtime_enabled.
    const defaultMode: TimerMode =
      defaultModeRaw === 'flowtime' || defaultModeRaw === 'timer'
        ? defaultModeRaw
        : flowtimeEnabled === 'true'
          ? 'flowtime'
          : 'timer'

    // Default duration inside Timer mode: reuses legacy timer_perpetual.
    const defaultDuration: TimerDuration = perpetualMode === 'true' ? 'infinite' : 'limited'

    return {
      presets,
      defaultPreset,
      breakMinutes: parseInt(breakMinutesRaw ?? '5', 10) || 5,
      defaultReps: parseInt(defaultRepsRaw ?? '1', 10) || 1,
      soundEnabled: (soundEnabled ?? 'true') !== 'false',
      notificationEnabled: (notificationEnabled ?? 'true') !== 'false',
      autoBreak: (autoBreak ?? 'true') !== 'false',
      longBreakEnabled: longBreakEnabled === 'true',
      longBreakMinutes: parseInt(longBreakMinutesRaw ?? '15', 10) || 15,
      longBreakInterval: parseInt(longBreakIntervalRaw ?? '4', 10) || 4,
      cookieMinutesPerHour: parseInt(cookieMinutesPerHourRaw ?? '10', 10) || 10,
      cookieTransfer: cookieTransfer === 'true',
      defaultMode,
      defaultDuration,
      skipStartDialog: skipStartDialog === 'true'
    }
  }, [presetsRaw, defaultPresetId, breakMinutesRaw, defaultRepsRaw, perpetualMode, soundEnabled, notificationEnabled, autoBreak, flowtimeEnabled, longBreakEnabled, longBreakMinutesRaw, longBreakIntervalRaw, cookieMinutesPerHourRaw, cookieTransfer, defaultModeRaw, skipStartDialog])
}
