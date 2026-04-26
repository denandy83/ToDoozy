import { useState } from 'react'
import { useAuthStore, selectIsOffline } from '../stores/authStore'
import { tryRestoreSession } from '../../services/sessionRecovery'

export function SessionBanner(): React.JSX.Element | null {
  const isOffline = useAuthStore(selectIsOffline)
  const logout = useAuthStore((s) => s.logout)
  const [retrying, setRetrying] = useState(false)

  if (!isOffline) return null

  const handleRetry = async (): Promise<void> => {
    if (retrying) return
    setRetrying(true)
    try {
      await tryRestoreSession(1)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2"
    >
      <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 motion-safe:animate-pulse"
          aria-hidden
        />
        <span className="text-[11px] font-bold uppercase tracking-widest">Sync paused</span>
        <span className="text-[11px] font-light tracking-wide opacity-80">
          Your changes are saved locally and will sync when the connection returns.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="rounded-md border border-amber-500/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-600 hover:bg-amber-500/10 disabled:opacity-50 dark:text-amber-400"
        >
          {retrying ? 'Retrying…' : 'Retry now'}
        </button>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-foreground/60 hover:bg-foreground/6 hover:text-foreground"
        >
          Sign in again
        </button>
      </div>
    </div>
  )
}
