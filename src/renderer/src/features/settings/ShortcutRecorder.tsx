import { useState, useEffect, useRef } from 'react'
import { Keyboard } from 'lucide-react'
import { useSetting, useSettingsStore } from '../../shared/stores/settingsStore'
import {
  DEFAULT_QUICK_ADD_SHORTCUT,
  DEFAULT_APP_TOGGLE_SHORTCUT,
  keyEventToAccelerator,
  getReservedShortcutName
} from '../../../../shared/shortcut-utils'

/** Format an Electron accelerator for display (e.g. "Cmd+Shift+Space") */
function formatAccelerator(accelerator: string): string {
  return accelerator
    .replace(/CommandOrControl/g, '\u2318')
    .replace(/Command/g, '\u2318')
    .replace(/Control/g, '\u2303')
    .replace(/Alt/g, '\u2325')
    .replace(/Shift/g, '\u21E7')
    .replace(/\+/g, ' ')
}

interface ShortcutRecorderBaseProps {
  settingKey: string
  defaultShortcut: string
  label: string
  description: string
  onUpdateShortcut: (accelerator: string) => Promise<{ success: boolean; error?: string; reservedBy?: string }>
}

function ShortcutRecorderBase({
  settingKey,
  defaultShortcut,
  label,
  description,
  onUpdateShortcut
}: ShortcutRecorderBaseProps): React.JSX.Element {
  const savedShortcut = useSetting(settingKey)
  const currentShortcut = savedShortcut ?? defaultShortcut
  const { setSetting } = useSettingsStore()
  const [recording, setRecording] = useState(false)
  const [heldModifiers, setHeldModifiers] = useState('')
  const [pendingAccelerator, setPendingAccelerator] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const recordingRef = useRef(false)

  useEffect(() => {
    recordingRef.current = recording
    if (!recording) setHeldModifiers('')
  }, [recording])

  const pendingAcceleratorRef = useRef<string | null>(null)

  useEffect(() => {
    const getModifierDisplay = (e: KeyboardEvent): string => {
      const parts: string[] = []
      if (e.metaKey || e.ctrlKey) parts.push('\u2318')
      if (e.altKey) parts.push('\u2325')
      if (e.shiftKey) parts.push('\u21E7')
      return parts.join(' ')
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (!recordingRef.current) return
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        setRecording(false)
        setHeldModifiers('')
        setError(null)
        pendingAcceleratorRef.current = null
        return
      }

      setHeldModifiers(getModifierDisplay(e))

      const accelerator = keyEventToAccelerator(e)
      if (!accelerator) return

      const reservedBy = getReservedShortcutName(accelerator)
      if (reservedBy) {
        setError(`This shortcut is reserved by macOS (${reservedBy}) and can't be used.`)
        pendingAcceleratorRef.current = null
        return
      }

      setError(null)
      pendingAcceleratorRef.current = accelerator
      setHeldModifiers(formatAccelerator(accelerator))
    }

    const handleKeyUp = (e: KeyboardEvent): void => {
      if (!recordingRef.current) return
      e.preventDefault()

      if (pendingAcceleratorRef.current) {
        setPendingAccelerator(pendingAcceleratorRef.current)
        pendingAcceleratorRef.current = null
        setRecording(false)
        setHeldModifiers('')
      } else {
        setHeldModifiers(getModifierDisplay(e))
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('keyup', handleKeyUp, true)
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('keyup', handleKeyUp, true)
    }
  }, [])

  useEffect(() => {
    if (!pendingAccelerator) return

    async function save(): Promise<void> {
      try {
        const result = await onUpdateShortcut(pendingAccelerator!)
        if (result.success) {
          await setSetting(settingKey, pendingAccelerator!)
          setError(null)
          setSuccess(true)
          setTimeout(() => setSuccess(false), 2000)
        } else {
          setError(result.error ?? 'Failed to register shortcut')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update shortcut')
      }
      setPendingAccelerator(null)
    }
    save()
  }, [pendingAccelerator, setSetting, settingKey, onUpdateShortcut])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">{label}</p>
          <p className="text-[10px] text-muted">{description}</p>
        </div>
        <button
          onClick={() => {
            setError(null)
            setSuccess(false)
            setRecording(true)
          }}
          className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 transition-colors cursor-pointer ${
            recording
              ? 'border-accent bg-accent/12'
              : 'border-border hover:bg-foreground/6'
          }`}
        >
          <Keyboard size={12} className={recording ? 'text-accent' : 'text-muted'} />
          <span className={`text-[11px] font-bold tracking-widest ${recording ? 'text-accent' : 'text-foreground'}`}>
            {recording ? (heldModifiers || 'Press keys...') : formatAccelerator(currentShortcut)}
          </span>
        </button>
      </div>
      {error && <p className="text-[10px] font-medium text-danger">{error}</p>}
      {success && <p className="text-[10px] font-medium text-success">Shortcut updated</p>}
    </div>
  )
}

export function ShortcutRecorder(): React.JSX.Element {
  return (
    <ShortcutRecorderBase
      settingKey="quick_add_shortcut"
      defaultShortcut={DEFAULT_QUICK_ADD_SHORTCUT}
      label="Quick-add shortcut"
      description="Global shortcut to open quick-add from anywhere. Click inside to change."
      onUpdateShortcut={(accelerator) => window.api.quickadd.updateShortcut(accelerator)}
    />
  )
}

export function AppToggleShortcutRecorder(): React.JSX.Element {
  return (
    <ShortcutRecorderBase
      settingKey="app_toggle_shortcut"
      defaultShortcut={DEFAULT_APP_TOGGLE_SHORTCUT}
      label="Show/hide app"
      description="Global shortcut to toggle the main window from anywhere. Click inside to change."
      onUpdateShortcut={(accelerator) => window.api.appToggle.updateShortcut(accelerator)}
    />
  )
}
