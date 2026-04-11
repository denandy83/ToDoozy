import { useMemo } from 'react'
import { useSetting } from '../stores/settingsStore'
import { DEFAULT_TIMER_PRESETS, type TimerPreset } from '../stores/timerStore'

export interface TimerSettings {
  presets: TimerPreset[]
  defaultPreset: TimerPreset
  breakMinutes: number
  repetitionEnabled: boolean
  defaultReps: number
  perpetualMode: boolean
  soundEnabled: boolean
  notificationEnabled: boolean
  autoBreak: boolean
  flowtimeEnabled: boolean
  longBreakEnabled: boolean
  longBreakMinutes: number
  longBreakInterval: number
}

export function useTimerSettings(): TimerSettings {
  const presetsRaw = useSetting('timer_presets')
  const defaultPresetId = useSetting('timer_default_preset')
  const breakMinutesRaw = useSetting('timer_break_minutes')
  const repetitionEnabled = useSetting('timer_repetition_enabled')
  const defaultRepsRaw = useSetting('timer_default_reps')
  const perpetualMode = useSetting('timer_perpetual')
  const soundEnabled = useSetting('timer_sound')
  const notificationEnabled = useSetting('timer_notification')
  const autoBreak = useSetting('timer_auto_break')
  const flowtimeEnabled = useSetting('timer_flowtime_enabled')
  const longBreakEnabled = useSetting('timer_long_break_enabled')
  const longBreakMinutesRaw = useSetting('timer_long_break_minutes')
  const longBreakIntervalRaw = useSetting('timer_long_break_interval')

  return useMemo(() => {
    let presets: TimerPreset[]
    try {
      presets = presetsRaw ? JSON.parse(presetsRaw) : DEFAULT_TIMER_PRESETS
      if (!Array.isArray(presets) || presets.length === 0) presets = DEFAULT_TIMER_PRESETS
    } catch {
      presets = DEFAULT_TIMER_PRESETS
    }

    const defaultPreset = presets.find((p) => p.id === defaultPresetId) ?? presets[1] ?? presets[0]

    return {
      presets,
      defaultPreset,
      breakMinutes: parseInt(breakMinutesRaw ?? '5', 10) || 5,
      repetitionEnabled: repetitionEnabled === 'true',
      defaultReps: parseInt(defaultRepsRaw ?? '1', 10) || 1,
      perpetualMode: perpetualMode === 'true',
      soundEnabled: (soundEnabled ?? 'true') !== 'false',
      notificationEnabled: (notificationEnabled ?? 'true') !== 'false',
      autoBreak: (autoBreak ?? 'true') !== 'false',
      flowtimeEnabled: flowtimeEnabled === 'true',
      longBreakEnabled: longBreakEnabled === 'true',
      longBreakMinutes: parseInt(longBreakMinutesRaw ?? '15', 10) || 15,
      longBreakInterval: parseInt(longBreakIntervalRaw ?? '4', 10) || 4
    }
  }, [presetsRaw, defaultPresetId, breakMinutesRaw, repetitionEnabled, defaultRepsRaw, perpetualMode, soundEnabled, notificationEnabled, autoBreak, flowtimeEnabled, longBreakEnabled, longBreakMinutesRaw, longBreakIntervalRaw])
}
