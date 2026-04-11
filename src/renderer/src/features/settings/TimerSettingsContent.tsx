import { useState, useCallback } from 'react'
import { Plus, X, Check } from 'lucide-react'
import { useSettingsStore, useSetting } from '../../shared/stores/settingsStore'
import { useToast } from '../../shared/components/Toast'
import { DEFAULT_TIMER_PRESETS, type TimerPreset } from '../../shared/stores/timerStore'

function useTimerPresets(): TimerPreset[] {
  const raw = useSetting('timer_presets')
  if (!raw) return DEFAULT_TIMER_PRESETS
  try {
    const parsed: TimerPreset[] = JSON.parse(raw)
    return parsed.length > 0 ? parsed : DEFAULT_TIMER_PRESETS
  } catch {
    return DEFAULT_TIMER_PRESETS
  }
}

function ToggleButton({
  settingKey,
  defaultValue
}: {
  settingKey: string
  defaultValue: string
}): React.JSX.Element {
  const { setSetting } = useSettingsStore()
  const value = useSetting(settingKey) ?? defaultValue

  return (
    <div className="flex rounded-lg border border-border overflow-hidden">
      <button
        onClick={() => setSetting(settingKey, 'true')}
        className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
          value === 'true' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
        }`}
      >
        On
      </button>
      <button
        onClick={() => setSetting(settingKey, 'false')}
        className={`px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
          value === 'false' ? 'bg-accent/12 text-accent' : 'text-muted hover:bg-foreground/6'
        }`}
      >
        Off
      </button>
    </div>
  )
}

export function TimerSettingsContent(): React.JSX.Element {
  const { setSetting } = useSettingsStore()
  const presets = useTimerPresets()
  const defaultPresetId = useSetting('timer_default_preset') ?? presets[1]?.id ?? presets[0]?.id ?? ''
  const breakMinutes = useSetting('timer_break_minutes') ?? '5'
  const defaultReps = useSetting('timer_default_reps') ?? '1'

  // Add preset form
  const [adding, setAdding] = useState(false)
  const [newMinutes, setNewMinutes] = useState('')

  const savePresets = useCallback(
    (updated: TimerPreset[]) => {
      setSetting('timer_presets', JSON.stringify(updated))
    },
    [setSetting]
  )

  const { addToast } = useToast()

  const handleAddPreset = (): void => {
    const mins = parseInt(newMinutes, 10)
    if (isNaN(mins) || mins < 1) return
    if (presets.some((p) => p.minutes === mins)) {
      addToast({ message: `A ${mins} minute preset already exists`, variant: 'danger' })
      return
    }

    const preset: TimerPreset = {
      id: `preset-custom-${crypto.randomUUID().slice(0, 8)}`,
      name: `${mins} min`,
      minutes: mins
    }
    savePresets([preset, ...presets])
    setNewMinutes('')
    setAdding(false)
  }

  const handleRemovePreset = useCallback(
    (id: string) => {
      const updated = presets.filter((p) => p.id !== id)
      savePresets(updated.length > 0 ? updated : DEFAULT_TIMER_PRESETS)
    },
    [presets, savePresets]
  )

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Presets</p>

      {/* Timer Presets */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-light text-foreground">Timer presets</p>
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/10"
          >
            <Plus size={12} />
            Add
          </button>
        </div>
        <div className="flex flex-col gap-1">
          {adding && (
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-1.5"
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); handleAddPreset() }
                if (e.key === 'Escape') { e.stopPropagation(); setAdding(false) }
              }}
            >
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={newMinutes}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, '')
                  if (v === '' || (parseInt(v, 10) >= 1 && parseInt(v, 10) <= 999)) setNewMinutes(v)
                }}
                autoFocus
                className="w-12 bg-transparent text-sm font-light text-foreground focus:outline-none"
              />
              <span className="text-[10px] font-bold uppercase tracking-widest text-muted">min</span>
              <button
                type="button"
                onClick={handleAddPreset}
                className="rounded p-1 text-accent transition-colors hover:bg-accent/10"
              >
                <Check size={12} />
              </button>
              <button
                type="button"
                onClick={() => setAdding(false)}
                className="rounded p-1 text-danger transition-colors hover:bg-danger/10"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {presets.map((preset) => (
            <div
              key={preset.id}
              className="group flex items-center justify-between rounded-lg px-3 py-1.5 transition-colors hover:bg-foreground/6"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-light text-foreground">{preset.name}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted">
                  {preset.minutes}m
                </span>
              </div>
              <button
                onClick={() => handleRemovePreset(preset.id)}
                className="rounded p-1 text-danger opacity-0 transition-opacity hover:bg-danger/10 group-hover:opacity-100"
                title="Remove preset"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Default Timer */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Default timer</p>
          <p className="text-[10px] text-muted">Used when starting a timer without choosing a preset</p>
        </div>
        <select
          value={defaultPresetId}
          onChange={(e) => setSetting('timer_default_preset', e.target.value)}
          className="rounded-lg border border-border bg-transparent px-2 py-1.5 text-sm font-light text-foreground focus:outline-none cursor-pointer"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.minutes}m)</option>
          ))}
        </select>
      </div>

      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mt-6">Breaks</p>

      {/* Break Duration */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Break duration</p>
          <p className="text-[10px] text-muted">Rest period after each work timer</p>
        </div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={1}
            max={60}
            value={breakMinutes}
            onChange={(e) => setSetting('timer_break_minutes', e.target.value)}
            className="w-14 rounded-lg border border-border bg-transparent px-2 py-1.5 text-center text-sm font-light text-foreground focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted">min</span>
        </div>
      </div>

      {/* Auto-break */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Auto-start break</p>
          <p className="text-[10px] text-muted">Automatically start break after work timer</p>
        </div>
        <ToggleButton settingKey="timer_auto_break" defaultValue="true" />
      </div>

      {/* Long Break — only visible when auto-break is on */}
      {(useSetting('timer_auto_break') ?? 'true') !== 'false' && (
        <>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-light text-foreground">Long break</p>
              <p className="text-[10px] text-muted">Longer rest after several work sessions</p>
            </div>
            <ToggleButton settingKey="timer_long_break_enabled" defaultValue="false" />
          </div>

          {(useSetting('timer_long_break_enabled') ?? 'false') === 'true' && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-light text-foreground">Long break duration</p>
                  <p className="text-[10px] text-muted">Duration of the long break</p>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={1}
                    max={60}
                    value={useSetting('timer_long_break_minutes') ?? '15'}
                    onChange={(e) => setSetting('timer_long_break_minutes', e.target.value)}
                    className="w-14 rounded-lg border border-border bg-transparent px-2 py-1.5 text-center text-sm font-light text-foreground focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">min</span>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-light text-foreground">Long break every</p>
                  <p className="text-[10px] text-muted">Work sessions before long break</p>
                </div>
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    min={2}
                    max={10}
                    value={useSetting('timer_long_break_interval') ?? '4'}
                    onChange={(e) => setSetting('timer_long_break_interval', e.target.value)}
                    className="w-14 rounded-lg border border-border bg-transparent px-2 py-1.5 text-center text-sm font-light text-foreground focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <span className="text-[10px] font-bold uppercase tracking-widest text-muted">sessions</span>
                </div>
              </div>
            </>
          )}
        </>
      )}

      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mt-6">Repetition</p>

      {/* Repetition mode */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Repetition mode</p>
          <p className="text-[10px] text-muted">Cycle work-break for multiple repetitions</p>
        </div>
        <ToggleButton settingKey="timer_repetition_enabled" defaultValue="false" />
      </div>

      {/* Default reps — only visible when repetition mode is on */}
      {(useSetting('timer_repetition_enabled') ?? 'false') === 'true' && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-light text-foreground">Default repetitions</p>
            <p className="text-[10px] text-muted">Number of work-break cycles</p>
          </div>
          <input
            type="number"
            min={1}
            max={99}
            value={defaultReps}
            onChange={(e) => setSetting('timer_default_reps', e.target.value)}
            className="w-14 rounded-lg border border-border bg-transparent px-2 py-1.5 text-center text-sm font-light text-foreground focus:border-accent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      )}

      {/* Perpetual mode */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Perpetual mode</p>
          <p className="text-[10px] text-muted">Run indefinitely until manually stopped</p>
        </div>
        <ToggleButton settingKey="timer_perpetual" defaultValue="false" />
      </div>

      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mt-6">Flowtime</p>

      {/* Flowtime */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Flowtime mode</p>
          <p className="text-[10px] text-muted">Open-ended focus — timer counts up, you decide when to stop</p>
        </div>
        <ToggleButton settingKey="timer_flowtime_enabled" defaultValue="false" />
      </div>

      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mt-6">Behavior</p>

      {/* Minimize on start */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Minimize on start</p>
          <p className="text-[10px] text-muted">Minimize the window to tray when starting a timer</p>
        </div>
        <ToggleButton settingKey="timer_minimize_on_start" defaultValue="true" />
      </div>

      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mt-6">Alerts</p>

      {/* Sound */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Sound notification</p>
          <p className="text-[10px] text-muted">Play a sound when timer completes</p>
        </div>
        <ToggleButton settingKey="timer_sound" defaultValue="true" />
      </div>

      {/* System notification */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">System notification</p>
          <p className="text-[10px] text-muted">Show a system notification when timer completes</p>
        </div>
        <ToggleButton settingKey="timer_notification" defaultValue="true" />
      </div>
    </div>
  )
}
