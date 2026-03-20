import { useState, useCallback, useEffect, useRef } from 'react'
import { Keyboard } from 'lucide-react'
import { useSetting, useSettingsStore } from '../../shared/stores/settingsStore'
import {
  DEFAULT_QUICK_ADD_SHORTCUT,
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

export function ShortcutRecorder(): React.JSX.Element {
  const savedShortcut = useSetting('quick_add_shortcut')
  const currentShortcut = savedShortcut ?? DEFAULT_QUICK_ADD_SHORTCUT
  const { setSetting } = useSettingsStore()
  const [recording, setRecording] = useState(false)
  const [pendingAccelerator, setPendingAccelerator] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!recording) return
      e.preventDefault()
      e.stopPropagation()

      const accelerator = keyEventToAccelerator(e)
      if (!accelerator) return

      // Check reserved
      const reservedBy = getReservedShortcutName(accelerator)
      if (reservedBy) {
        setError(`This shortcut is reserved by macOS (${reservedBy}) and can't be used.`)
        setPendingAccelerator(null)
        setRecording(false)
        return
      }

      setPendingAccelerator(accelerator)
      setRecording(false)
    },
    [recording]
  )

  useEffect(() => {
    if (!recording) return undefined
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [recording, handleKeyDown])

  // Auto-save when a pending accelerator is set
  useEffect(() => {
    if (!pendingAccelerator) return

    async function save(): Promise<void> {
      try {
        const result = await window.api.quickadd.updateShortcut(pendingAccelerator!)
        if (result.success) {
          await setSetting('quick_add_shortcut', pendingAccelerator!)
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
  }, [pendingAccelerator, setSetting])

  const handleStartRecording = useCallback(() => {
    setError(null)
    setSuccess(false)
    setRecording(true)
  }, [])

  const handleCancelRecording = useCallback(() => {
    setRecording(false)
    setPendingAccelerator(null)
  }, [])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-light text-foreground">Quick add shortcut</p>
          <p className="text-[10px] text-muted">Global shortcut to open quick-add from anywhere</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5">
            <Keyboard size={12} className="text-muted" />
            <span className="text-[11px] font-bold tracking-widest text-foreground">
              {recording ? 'Press keys...' : formatAccelerator(currentShortcut)}
            </span>
          </div>
          {recording ? (
            <button
              onClick={handleCancelRecording}
              className="rounded-lg border border-border px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6"
            >
              Cancel
            </button>
          ) : (
            <button
              ref={buttonRef}
              onClick={handleStartRecording}
              className="rounded-lg border border-accent/30 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-accent transition-colors hover:bg-accent/10"
            >
              Record
            </button>
          )}
        </div>
      </div>
      {error && <p className="text-[10px] font-medium text-danger">{error}</p>}
      {success && <p className="text-[10px] font-medium text-success">Shortcut updated</p>}
    </div>
  )
}
