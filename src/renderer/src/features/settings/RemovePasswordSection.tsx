import { useCallback, useState } from 'react'
import { useToast } from '../../shared/components/Toast'
import { getSupabase } from '../../lib/supabase'

interface RemovePasswordSectionProps {
  onRemoved: () => void
}

/**
 * Danger section in Settings → Profile → Password for OAuth users who
 * previously added a password (story #94). Calls the remove-password edge
 * function (admin API — the renderer can't clear a password itself), then
 * wipes the saved Keychain credentials for this device.
 */
export function RemovePasswordSection({ onRemoved }: RemovePasswordSectionProps): React.JSX.Element {
  const { addToast } = useToast()
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const doRemove = useCallback(async (): Promise<void> => {
    setRemoving(true)
    setError(null)
    try {
      const sb = await getSupabase()
      const { data: { session } } = await sb.auth.getSession()
      if (!session) {
        setError('You must be online to remove password login')
        return
      }
      const { data, error: fnErr } = await sb.functions.invoke('remove-password', {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      if (fnErr) {
        setError('Something went wrong. Please try again.')
        return
      }
      const result = data as { ok: boolean; error?: string } | null
      if (!result?.ok) {
        setError(
          result?.error === 'no_oauth_identity'
            ? 'Password is your only sign-in method — it cannot be removed.'
            : 'Something went wrong. Please try again.'
        )
        return
      }
      await window.api.auth.clearCredentials().catch(() => {})
      addToast({ message: 'Password login removed — sign in with Google from now on.' })
      onRemoved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove password login')
    } finally {
      setRemoving(false)
    }
  }, [addToast, onRemoved])

  const handleRemoveClick = useCallback((): void => {
    addToast({
      message: "Remove password login? You'll only be able to sign in with Google after this.",
      persistent: true,
      actions: [
        { label: 'Remove', variant: 'danger' as const, onClick: () => { void doRemove() } },
        { label: 'Cancel', variant: 'muted' as const, onClick: () => {} }
      ]
    })
  }, [addToast, doRemove])

  return (
    <>
      <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-muted mt-6">
        Remove Password Login
      </p>
      <p className="text-[10px] text-muted -mt-2">
        Go back to signing in with Google only. Your password is deleted and the saved login on this
        device is forgotten.
      </p>
      <div>
        <button
          onClick={handleRemoveClick}
          disabled={removing}
          className="rounded-lg border border-danger/30 px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-danger transition-colors hover:bg-danger/10 disabled:opacity-40"
        >
          {removing ? 'Removing...' : 'Remove Password Login'}
        </button>
      </div>
      {error && <p className="text-[10px] text-danger">{error}</p>}
    </>
  )
}
