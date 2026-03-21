import { useState, useCallback, useRef, useEffect } from 'react'
import { Plus, X, Check } from 'lucide-react'
import { useSettingsStore, useSetting } from '../../shared/stores/settingsStore'
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
  const [newName, setNewName] = useState('')
  const [newMinutes, setNewMinutes] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (adding) nameRef.current?.focus()
  }, [adding])

  const savePresets = useCallback(
    (updated: TimerPreset[]) => {
      setSetting('timer_presets', JSON.stringify(updated))
    },
    [setSetting]
  )

  const handleAddPreset = useCallback(() => {
    const name = newName.trim()
    const mins = parseInt(newMinutes, 10)
    if (!name || isNaN(mins) || mins < 1) return

    const preset: TimerPreset = {
      id: `preset-custom-${crypto.randomUUID().slice(0, 8)}`,
      name,
      minutes: mins
    }
    savePresets([...presets, preset])
    setNewName('')
    setNewMinutes('')
    setAdding(false)
  }, [newName, newMinutes, presets, savePresets])

  const handleRemovePreset = useCallback(
    (id: string) => {
      const updated = presets.filter((p) => p.id !== id)
      savePresets(updated.length > 0 ? updated : DEFAULT_TIMER_PRESETS)
    },
    [presets, savePresets]
  )

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted">Timer</p>

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
          {adding && (
            <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
              <input
                ref={nameRef}
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddPreset()
                  if (e.key === 'Escape') { e.stopPropagation(); setAdding(false) }
                }}
                placeholder="Name"
                className="flex-1 bg-transparent text-sm font-light text-foreground placeholder:text-muted/40 focus:outline-none"
              />
              <input
                type="number"
                min={1}
                max={999}
                value={newMinutes}
                onChange={(e) => setNewMinutes(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddPreset()
                  if (e.key === 'Escape') { e.stopPropagation(); setAdding(false) }
                }}
                placeholder="Min"
                className="w-16 bg-transparent text-center text-sm font-light text-foreground placeholder:text-muted/40 focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button onClick={() => setAdding(false)} className="rounded p-1 text-muted hover:bg-foreground/6">
                <X size={12} />
              </button>
              <button
                onClick={handleAddPreset}
                disabled={!newName.trim() || !newMinutes || parseInt(newMinutes, 10) < 1}
                className="rounded p-1 text-accent hover:bg-accent/10 disabled:opacity-50"
              >
                <Check size={12} />
              </button>
            </div>
          )}
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

      {/* Repetition mode */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Repetition mode</p>
          <p className="text-[10px] text-muted">Cycle work-break for multiple repetitions</p>
        </div>
        <ToggleButton settingKey="timer_repetition_enabled" defaultValue="false" />
      </div>

      {/* Default reps */}
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

      {/* Perpetual mode */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Perpetual mode</p>
          <p className="text-[10px] text-muted">Run indefinitely until manually stopped</p>
        </div>
        <ToggleButton settingKey="timer_perpetual" defaultValue="false" />
      </div>

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
