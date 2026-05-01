import { useState, useEffect, useCallback, useRef } from 'react'
import { Check, Eye, EyeOff } from 'lucide-react'
import { useAuthStore } from '../../shared/stores/authStore'
import { getSupabase } from '../../lib/supabase'

function SectionLabel({ children, first }: { children: string; first?: boolean }): React.JSX.Element {
  return (
    <p className={`text-[10px] font-bold uppercase tracking-[0.3em] text-muted ${first ? '' : 'mt-6'}`}>
      {children}
    </p>
  )
}

function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'At least 8 characters required'
  if (!/[A-Z]/.test(pw)) return 'Must contain at least one uppercase letter'
  if (!/[a-z]/.test(pw)) return 'Must contain at least one lowercase letter'
  if (!/[0-9]/.test(pw)) return 'Must contain at least one number'
  return null
}

export function ProfileSettingsContent(): React.JSX.Element {
  const currentUser = useAuthStore((s) => s.currentUser)
  const updateUser = useAuthStore((s) => s.updateUser)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [nameSaved, setNameSaved] = useState(false)
  const [nameOffline, setNameOffline] = useState(false)
  const nameDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nameTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [hasEmailIdentity, setHasEmailIdentity] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)

  useEffect(() => {
    if (!currentUser) return
    const init = async (): Promise<void> => {
      try {
        const sb = await getSupabase()
        const { data: { user } } = await sb.auth.getUser()
        if (user) {
          const meta = user.user_metadata ?? {}
          setFirstName((meta.first_name as string | undefined) ?? (meta.full_name as string | undefined)?.split(' ')[0] ?? '')
          setLastName((meta.last_name as string | undefined) ?? (meta.full_name as string | undefined)?.split(' ').slice(1).join(' ') ?? '')
          setHasEmailIdentity(user.identities?.some((i) => i.provider === 'email') ?? false)
          return
        }
      } catch { /* offline */ }
      if (currentUser.display_name) {
        const parts = currentUser.display_name.split(' ')
        setFirstName(parts[0] ?? '')
        setLastName(parts.slice(1).join(' '))
      }
    }
    void init()
  }, [currentUser])

  const doSaveName = useCallback(async (fn: string, ln: string): Promise<void> => {
    if (!currentUser) return
    const display_name = [fn.trim(), ln.trim()].filter(Boolean).join(' ') || null
    await updateUser(currentUser.id, { display_name })
    try {
      const sb = await getSupabase()
      await sb.auth.updateUser({ data: { display_name, first_name: fn.trim(), last_name: ln.trim() } })
      await window.api.settings.set(currentUser.id, 'profile_sync_pending', '')
      setNameSaved(true)
      setNameOffline(false)
    } catch {
      await window.api.settings.set(currentUser.id, 'profile_sync_pending', 'true')
      setNameOffline(true)
      setNameSaved(false)
    }
    if (nameTimerRef.current) clearTimeout(nameTimerRef.current)
    nameTimerRef.current = setTimeout(() => { setNameSaved(false); setNameOffline(false) }, 2000)
  }, [currentUser, updateUser])

  const scheduleSave = useCallback((fn: string, ln: string): void => {
    if (nameDebounceRef.current) clearTimeout(nameDebounceRef.current)
    nameDebounceRef.current = setTimeout(() => { void doSaveName(fn, ln) }, 1000)
  }, [doSaveName])

  const handlePasswordSave = useCallback(async (): Promise<void> => {
    const err = validatePassword(newPassword)
    if (err) { setPasswordError(err); return }
    if (newPassword !== confirmPassword) { setPasswordError('Passwords do not match'); return }
    setPasswordError(null)
    setPasswordSaving(true)
    try {
      const sb = await getSupabase()
      const { error } = await sb.auth.updateUser({ password: newPassword })
      if (error) { setPasswordError(error.message); return }
      setHasEmailIdentity(true)
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSaved(true)
      setTimeout(() => setPasswordSaved(false), 2000)
    } catch (e) {
      setPasswordError(e instanceof Error ? e.message : 'Failed to update password')
    } finally {
      setPasswordSaving(false)
    }
  }, [newPassword, confirmPassword])

  return (
    <div className="flex flex-col gap-4">
      <SectionLabel first>Account</SectionLabel>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Email</p>
        <p className="text-sm font-light text-foreground">{currentUser?.email ?? '—'}</p>
      </div>

      <SectionLabel>Display Name</SectionLabel>
      <p className="text-[10px] text-muted -mt-2">Shown to other members in shared projects. Leave blank to use your email.</p>
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">First name</p>
          <input type="text" value={firstName}
            onChange={(e) => { setFirstName(e.target.value); scheduleSave(e.target.value, lastName) }}
            placeholder="First"
            className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm font-light text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/50" />
        </div>
        <div className="flex-1">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Last name</p>
          <input type="text" value={lastName}
            onChange={(e) => { setLastName(e.target.value); scheduleSave(firstName, e.target.value) }}
            placeholder="Last"
            className="w-full rounded-lg border border-border bg-transparent px-3 py-2 text-sm font-light text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/50" />
        </div>
        <div className="h-[38px] w-6 flex items-center justify-center flex-shrink-0">
          {nameSaved && <Check size={16} className="text-success" />}
          {nameOffline && <span className="text-[9px] text-muted">Local</span>}
        </div>
      </div>
      {nameOffline && <p className="text-[10px] text-muted -mt-2">Saved locally — will sync when reconnected</p>}

      <SectionLabel>{hasEmailIdentity ? 'Change Password' : 'Add Password Login'}</SectionLabel>
      {!hasEmailIdentity && (
        <p className="text-[10px] text-muted -mt-2">Set a password to also log in with your email, in addition to Google.</p>
      )}
      <p className="text-[10px] text-muted -mt-2">Requirements: 8+ characters, one uppercase, one lowercase, one number.</p>
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">New password</p>
          <div className="relative">
            <input type={showNew ? 'text' : 'password'} value={newPassword}
              onChange={(e) => { setNewPassword(e.target.value); setPasswordError(null) }}
              placeholder="New password"
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 pr-10 text-sm font-light text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/50" />
            <button type="button" onClick={() => setShowNew((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors">
              {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted mb-1">Confirm password</p>
          <div className="relative">
            <input type={showConfirm ? 'text' : 'password'} value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setPasswordError(null) }}
              placeholder="Confirm password"
              className="w-full rounded-lg border border-border bg-transparent px-3 py-2 pr-10 text-sm font-light text-foreground placeholder:text-muted/40 focus:outline-none focus:border-accent/50" />
            <button type="button" onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground transition-colors">
              {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>
        {passwordError && <p className="text-[10px] text-danger">{passwordError}</p>}
        <div className="flex items-center gap-3">
          <button onClick={() => { void handlePasswordSave() }}
            disabled={passwordSaving || !newPassword || !confirmPassword}
            className="rounded-lg border border-border px-4 py-2 text-[11px] font-bold uppercase tracking-widest text-muted transition-colors hover:bg-foreground/6 disabled:opacity-40">
            {passwordSaving ? 'Saving...' : hasEmailIdentity ? 'Change Password' : 'Set Password'}
          </button>
          {passwordSaved && <Check size={16} className="text-success" />}
        </div>
      </div>
    </div>
  )
}
