import { useState } from 'react'
import { useAuthStore, selectIsOffline, selectIsTokenPermanentlyDead } from '../stores/authStore'
import { useSyncStore, selectConnectionLost } from '../stores/syncStore'
import { tryRestoreSession } from '../../services/sessionRecovery'

export function SessionBanner(): React.JSX.Element | null {
  const isOffline = useAuthStore(selectIsOffline)
  const isTokenPermanentlyDead = useAuthStore(selectIsTokenPermanentlyDead)
  const connectionLost = useSyncStore(selectConnectionLost)
  const logout = useAuthStore((s) => s.logout)
  const [retrying, setRetrying] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)

  // Connection-lost banner takes priority over auth-offline banner: if the WS
  // gave up retrying, the user can recover with a click without re-auth.
  if (connectionLost && !isTokenPermanentlyDead) {
    const handleReconnect = async (): Promise<void> => {
      if (reconnecting) return
      setReconnecting(true)
      try {
        const [{ forceReconnectAllPersonal }, { forceReconnectAllShared }] = await Promise.all([
          import('../../services/PersonalSyncService'),
          import('../../services/SyncService')
        ])
        await Promise.all([
          forceReconnectAllPersonal().catch(() => {}),
          forceReconnectAllShared().catch(() => {})
        ])
      } finally {
        setReconnecting(false)
      }
    }
    return (
      <div
        role="status"
        aria-live="polite"
        className="absolute inset-0 z-10 flex items-center justify-between gap-3 bg-amber-500/90 px-4"
      >
        <div className="flex items-center gap-2 text-white">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse"
            aria-hidden
          />
          <span className="text-[11px] font-bold uppercase tracking-widest">Connection lost</span>
          <span className="text-[11px] font-light tracking-wide opacity-80">
            We can't reach the sync server. Your changes are saved locally.
          </span>
        </div>
        <button
          type="button"
          onClick={handleReconnect}
          disabled={reconnecting}
          className="rounded-md border border-white/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-white/10 disabled:opacity-50"
        >
          {reconnecting ? 'Retrying…' : 'Retry now'}
        </button>
      </div>
    )
  }

  if (!isOffline) return null

  if (isTokenPermanentlyDead) {
    return (
      <div
        role="alert"
        className="absolute inset-0 z-10 flex items-center justify-between gap-3 bg-red-500/95 px-4"
      >
        <div className="flex items-center gap-2 text-white">
          <span
            className="inline-block h-1.5 w-1.5 rounded-full bg-white"
            aria-hidden
          />
          <span className="text-[11px] font-bold uppercase tracking-widest">Session expired</span>
          <span className="text-[11px] font-light tracking-wide opacity-80">
            Your session is no longer valid. Sign in again to resume syncing.
          </span>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-md border border-white/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-white/10"
        >
          Sign in again
        </button>
      </div>
    )
  }

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
      className="absolute inset-0 z-10 flex items-center justify-between gap-3 bg-amber-500/90 px-4"
    >
      <div className="flex items-center gap-2 text-white">
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-white motion-safe:animate-pulse"
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
          className="rounded-md border border-white/40 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white hover:bg-white/10 disabled:opacity-50"
        >
          {retrying ? 'Retrying…' : 'Retry now'}
        </button>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-md border border-white/20 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-white/80 hover:bg-white/10 hover:text-white"
        >
          Sign in again
        </button>
      </div>
    </div>
  )
}
