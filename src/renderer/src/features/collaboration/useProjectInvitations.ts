import { useDatabaseScope } from '../../shared/hooks/useDatabaseScope'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { User } from '../../../../shared/types'
import { useAuthStore } from '../../shared/stores/authStore'
import { useProjectStore } from '../../shared/stores/projectStore'
import { useViewStore } from '../../shared/stores/viewStore'
import { logEvent } from '../../shared/stores/logStore'
import { captureSyncProducer, syncContextFromProducer, type SyncProducer } from '../../services/syncContext'
import { acceptInvite, checkPendingInvites, declineInvite, subscribeToInvites, subscribeToProject, validateInviteToken } from '../../services/SyncService'

export interface ProjectInvitation {
  token: string
  projectName: string
  ownerName: string
  expired: boolean
}
interface Inbox {
  scope: string | null
  owner: User | null
  items: ProjectInvitation[]
  busyToken: string | null
  error: { token: string; message: string } | null
}
interface Session {
  owner: User
  origin: SyncProducer
  isActive(): boolean
  databaseChanged(): void
}
const emptyInbox = (owner: User | null, scope: string | null = null): Inbox => ({ scope, owner, items: [], busyToken: null, error: null })

export function useProjectInvitations(): {
  invite: ProjectInvitation | null
  busy: boolean
  error: string | null
  accept(): Promise<void>
  decline(): Promise<void>
} {
  const scope = useDatabaseScope()
  const { currentUser, isAuthenticated, isOffline } = useAuthStore()
  const userId = currentUser?.id
  const email = currentUser?.email
  const [inbox, setInbox] = useState<Inbox>(() => emptyInbox(null))
  const [databaseRevision, setDatabaseRevision] = useState(0)
  const inboxRef = useRef(inbox)
  const sessionRef = useRef<Session | null>(null)
  const update = useCallback((change: (state: Inbox) => Inbox): void => {
    const next = change(inboxRef.current)
    inboxRef.current = next
    setInbox(next)
  }, [])
  const scopeIsCurrent = useCallback(async (session: Session): Promise<boolean> => {
    if (!session.isActive()) return false
    const current = await session.origin.isCurrent()
    if (!current && session.isActive()) {
      // Recover a known same-account database replacement without turning an
      // unavailable IPC bridge into an immediate retry loop.
      try {
        const [scope, database] = await Promise.all([session.origin.scope(), window.api.sync.captureContext()])
        if (session.isActive() && database.userId === session.owner.id
          && scope !== database.userId + ':' + database.generation) session.databaseChanged()
      } catch { /* An unknown context stays canceled until the normal auth lifecycle retries. */ }
    }
    return current && session.isActive()
  }, [])
  const updateOwned = useCallback((session: Session, change: (state: Inbox) => Inbox): void => {
    if (!session.isActive() || inboxRef.current.owner?.id !== session.owner.id || inboxRef.current.scope !== window.api.sync.currentContext()) return
    update(change)
  }, [update])

  useEffect(() => {
    const owner = useAuthStore.getState().currentUser
    if (!isAuthenticated || !owner || isOffline) {
      sessionRef.current = null
      update(() => emptyInbox(null))
      return
    }
    let active = true
    let validationSequence = 0
    let unsubscribe: (() => void) | undefined
    const ownsAccount = (): boolean => active && useAuthStore.getState().isAuthenticated
      && useAuthStore.getState().currentUser?.id === owner.id && !useAuthStore.getState().isOffline
    const origin = captureSyncProducer(ownsAccount)
    const stop = (): void => {
      if (!active) return
      active = false
      validationSequence += 1
      offDeepLink?.()
      unsubscribe?.()
      if (sessionRef.current === session) sessionRef.current = null
    }
    const session: Session = {
      owner, origin, isActive: () => ownsAccount() && sessionRef.current === session,
      databaseChanged: () => {
        if (!session.isActive()) return
        stop()
        update(() => emptyInbox(owner, scope))
        setDatabaseRevision((revision) => revision + 1)
      }
    }
    sessionRef.current = session
    update(() => emptyInbox(owner, scope))
    const present = (items: ProjectInvitation[], priority = false): void => {
      updateOwned(session, (state) => {
        const tokens = new Set(items.map((item) => item.token))
        const merged = priority
          ? [...items, ...state.items.filter((item) => !tokens.has(item.token))]
          : [...state.items, ...items.filter((item) => !state.items.some((old) => old.token === item.token))]
        return { ...state, items: merged, error: priority ? null : state.error }
      })
    }
    const warn = async (): Promise<void> => {
      if (await scopeIsCurrent(session)) logEvent('warn', 'sync', 'Project invitations could not be refreshed')
    }
    const offDeepLink = window.api.onInviteReceived(async (token) => {
      const sequence = ++validationSequence
      try {
        const result = await validateInviteToken(token, origin)
        if (!await scopeIsCurrent(session) || sequence !== validationSequence) return
        present([{
          token, projectName: result?.projectName ?? '', ownerName: result?.ownerName ?? '',
          expired: !result?.valid
        }], true)
      } catch { await warn() }
    })
    if (owner.email) {
      void checkPendingInvites(owner.email, origin).then(async (items) => {
        if (!await scopeIsCurrent(session)) return
        present(items.map((item) => ({ token: item.token, projectName: item.projectName, ownerName: item.ownerEmail, expired: false })))
      }).catch(warn)
      void subscribeToInvites(owner.email, async ({ token }) => {
        try {
          const result = await validateInviteToken(token, origin)
          if (!await scopeIsCurrent(session) || !result?.valid) return
          present([{ token, projectName: result.projectName, ownerName: result.ownerName, expired: false }])
        } catch { await warn() }
      }, origin).then((stop) => {
        if (!session.isActive()) stop()
        else unsubscribe = stop
      }).catch(warn)
    }
    return stop
  }, [userId, email, isAuthenticated, isOffline, scope, databaseRevision, scopeIsCurrent, update, updateOwned])

  const perform = useCallback(async (action: 'accept' | 'decline'): Promise<void> => {
    const session = sessionRef.current
    const state = inboxRef.current
    const invitation = state.items[0]
    if (!session?.isActive() || state.owner?.id !== session.owner.id || !invitation) return
    const token = invitation.token
    const remove = (): void => updateOwned(session, (next) => ({
      ...next, items: next.items.filter((item) => item.token !== token),
      error: next.error?.token === token ? null : next.error
    }))
    // The expired-dialog OK button is a local dismissal, not a server mutation.
    if (invitation.expired) { remove(); return }
    if (state.busyToken || !await scopeIsCurrent(session)) return
    if (inboxRef.current.items[0]?.token !== token) return
    updateOwned(session, (next) => ({ ...next, busyToken: token, error: null }))
    const stillSelected = async (): Promise<boolean> => await scopeIsCurrent(session)
      && inboxRef.current.items[0]?.token === token
    try {
      if (action === 'accept') {
        const projectId = await acceptInvite(token, session.owner.id, session.origin)
        if (await stillSelected()) {
          session.origin.assertCurrent()
          await useProjectStore.getState().hydrateProjects(session.owner.id, session.origin)
          if (await stillSelected()) {
            const context = await syncContextFromProducer(session.origin)
            if (await stillSelected()) {
              session.origin.assertCurrent()
              await subscribeToProject(projectId, context)
              if (await stillSelected()) {
                session.origin.assertCurrent()
                useViewStore.setState({ currentView: 'project', selectedProjectId: projectId })
              }
            }
          }
        }
      } else {
        await declineInvite(token, session.origin)
      }
      // An older acknowledged operation may remove its own queued token, but
      // cannot advance or overwrite a newer current invitation.
      if (await scopeIsCurrent(session)) remove()
    } catch (err) {
      if (await stillSelected()) updateOwned(session, (next) => ({
        ...next, error: { token, message: 'Failed to ' + (action === 'accept' ? 'join the project' : 'decline the invitation')
          + ': ' + (err instanceof Error ? err.message : 'Please try again') }
      }))
    } finally {
      await scopeIsCurrent(session)
      // An unavailable IPC probe cannot leave a current dialog permanently busy.
      // Ownership still fences this local UI cleanup; retries validate the origin.
      updateOwned(session, (next) => ({
        ...next, busyToken: next.busyToken === token ? null : next.busyToken
      }))
    }
  }, [scopeIsCurrent, updateOwned])

  // Do not wait for passive-effect cleanup to hide the previous user's data.
  const visible = isAuthenticated && !isOffline && inbox.owner?.id === currentUser?.id && inbox.scope === scope ? inbox : null
  const invite = visible?.items[0] ?? null
  return {
    invite,
    busy: !!visible?.busyToken,
    error: invite && visible?.error?.token === invite.token ? visible.error.message : null,
    accept: useCallback(() => perform('accept'), [perform]),
    decline: useCallback(() => perform('decline'), [perform])
  }
}
