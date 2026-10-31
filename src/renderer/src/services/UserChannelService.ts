import { useAuthStore } from '../shared/stores/authStore'
import { captureSyncContext } from './syncContext'
/**
 * UserChannelService — one Realtime channel per signed-in user covering the
 * user-scoped tables that were previously polling/reconcile-only:
 *
 *   - project_members  → cross-device project creation/removal appears live
 *     (MCP create_project runs the share_project RPC, which inserts the
 *     owner membership row — so personal projects fire it too)
 *   - user_labels      → labels created/edited remotely appear in pickers live
 *   - user_saved_views → saved views sync live
 *   - user_project_areas → sidebar areas sync live
 *
 * Channel name is stable (`user:${userId}`), every subscription is filtered
 * by user_id, and the reconnect/backoff lifecycle mirrors the personal
 * project channels in PersonalSyncService (suspend/online gates, joined
 * auto-rejoin guard, give-up banner). Pause/force hooks are invoked from
 * PersonalSyncService's pauseReconnectsForSuspend / forceReconnectAllPersonal
 * so every existing trigger (powerMonitor resume, online listener,
 * SessionBanner manual retry) covers this channel too.
 *
 * NOTE: user_labels / user_saved_views / user_project_areas must be in the
 * supabase_realtime publication — see
 * supabase/migrations/20260610230000_realtime_user_channel.sql.
 */
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase } from '../lib/supabase'
import { useSyncStore } from '../shared/stores/syncStore'
import { logEvent } from '../shared/stores/logStore'
import { useLabelStore } from '../shared/stores/labelStore'
import { useSavedViewStore } from '../shared/stores/savedViewStore'
import { useProjectAreaStore } from '../shared/stores/projectAreaStore'
import { useProjectStore } from '../shared/stores/projectStore'
import { SYNC_TABLES } from './syncTables'
import { requireSession } from './sessionRecovery'
import { isSuspended } from './powerState'
import { requestSyncCatchUp } from './PersonalSyncService'

interface UserChannelState {
  userId: string
  channel: RealtimeChannel | null
  cancelled: boolean
  attempt: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
}

let userChannelState: UserChannelState | null = null

export function hasActiveUserChannel(userId: string): boolean {
  return userChannelState?.userId === userId && !userChannelState.cancelled
}

const RECONNECT_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 900_000]
const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS_MS.length


type UserScopedRemoteTable = 'user_labels' | 'user_saved_views' | 'user_project_areas'

const USER_TABLE_TO_DESCRIPTOR: Record<UserScopedRemoteTable, 'labels' | 'saved_views' | 'project_areas'> = {
  user_labels: 'labels',
  user_saved_views: 'saved_views',
  user_project_areas: 'project_areas'
}

async function handleUserTableChange(
  table: UserScopedRemoteTable,
  eventType: string,
  row: Record<string, unknown>,
  userId: string
): Promise<void> {
  // These tables soft-delete via UPDATE (deleted_at) — a hard DELETE event
  // carries only the PK in payload.old, which applyRemote can't use. Skip;
  // reconcile owns that (rare) case.
  if (eventType === 'DELETE') return
  const desc = SYNC_TABLES[USER_TABLE_TO_DESCRIPTOR[table]]
  if (!desc) return
  const context = await captureSyncContext()
  if (useAuthStore.getState().currentUser?.id !== userId) return
  try {
    // applyRemote implementations are LWW (skip when local updated_at is
    // newer), so the echo of this device's own push is a no-op.
    await desc.localApplyRemote(row, context.api)
  } catch (err) {
    logEvent('error', 'realtime', `User-channel apply failed for ${table}`, `err=${err instanceof Error ? err.message : String(err)}`)
    return
  }
  if (!await context.isCurrent()) return
  const currentProjectId = useProjectStore.getState().currentProjectId
  switch (table) {
    case 'user_labels':
      await useLabelStore.getState().hydrateAllLabels()
      if (currentProjectId) await useLabelStore.getState().hydrateLabels(currentProjectId)
      break
    case 'user_saved_views':
      await useSavedViewStore.getState().hydrate(userId)
      break
    case 'user_project_areas':
      await useProjectAreaStore.getState().hydrate(userId)
      break
  }
}

async function createUserChannel(state: UserChannelState): Promise<void> {
  const context = await captureSyncContext(() => !state.cancelled && navigator.onLine && !isSuspended())
  if (state.cancelled || useAuthStore.getState().currentUser?.id !== state.userId) return
  const supabase = await getSupabase()
  const { userId } = state
  const channel = supabase
    .channel(`user:${userId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'project_members', filter: `user_id=eq.${userId}` },
      () => {
        if (state.cancelled) return
        void requestSyncCatchUp(context).catch((error) => logEvent('error', 'sync', 'Membership refresh failed', String(error)))
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_labels', filter: `user_id=eq.${userId}` },
      (payload) => {
        if (state.cancelled) return
        const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>
        void handleUserTableChange('user_labels', payload.eventType, row, userId)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_saved_views', filter: `user_id=eq.${userId}` },
      (payload) => {
        if (state.cancelled) return
        const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>
        void handleUserTableChange('user_saved_views', payload.eventType, row, userId)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'user_project_areas', filter: `user_id=eq.${userId}` },
      (payload) => {
        if (state.cancelled) return
        const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>
        void handleUserTableChange('user_project_areas', payload.eventType, row, userId)
      }
    )
    .subscribe((status, err) => {
      if (state.cancelled) return
      const ch = channel as unknown as { state?: string; subTopic?: string }
      const chState = ch.state ?? '(unknown)'
      const errMsg = err
        ? (err instanceof Error ? `${err.name}: ${err.message}` : (typeof err === 'string' ? err : JSON.stringify(err)))
        : '(no err)'
      if (status === 'SUBSCRIBED') {
        void requestSyncCatchUp(context).catch(() => {})
        useSyncStore.getState().setChannelHealth(`user:${userId}`, true)
        state.attempt = 0
        logEvent('info', 'realtime', 'Subscribed to user channel', `user=${userId.slice(0, 8)} chState=${chState}`)
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        useSyncStore.getState().setChannelHealth(`user:${userId}`, false)
        const level: 'warn' | 'error' = status === 'CHANNEL_ERROR' ? 'error' : 'warn'
        logEvent(level, 'realtime', `Channel ${status} on user channel`, `user=${userId.slice(0, 8)} chState=${chState} err=${errMsg} attempt=${state.attempt}`)
        scheduleUserChannelReconnect()
      }
    })
  state.channel = channel
}

function scheduleUserChannelReconnect(): void {
  const state = userChannelState
  if (!state || state.cancelled || state.reconnectTimer) return

  if (isSuspended()) {
    logEvent('info', 'realtime', 'User-channel reconnect deferred — system suspended')
    return
  }
  if (!navigator.onLine) {
    logEvent('info', 'realtime', 'User-channel reconnect deferred — offline')
    return
  }

  if (state.attempt >= MAX_RECONNECT_ATTEMPTS) {
    logEvent('warn', 'realtime', `User-channel reconnect gave up after ${state.attempt} attempts`)
    useSyncStore.getState().setConnectionLost(true)
    useSyncStore.getState().setNextReconnectAt(null)
    return
  }

  const delay = RECONNECT_DELAYS_MS[Math.min(state.attempt, RECONNECT_DELAYS_MS.length - 1)]
  state.attempt += 1
  logEvent('info', 'realtime', `User-channel reconnect in ${delay / 1000}s (attempt ${state.attempt})`)
  useSyncStore.getState().setNextReconnectAt(Date.now() + delay)

  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null
    useSyncStore.getState().setNextReconnectAt(null)
    if (state.cancelled) return
    if (isSuspended() || !navigator.onLine) {
      logEvent('info', 'realtime', `User-channel reconnect aborted — ${isSuspended() ? 'suspended' : 'offline'}`)
      return
    }
    try {
      const supabase = await getSupabase()
      if (state.channel) {
        // Same auto-rejoin guard as the project channels: tearing down a
        // channel supabase-js already rejoined triggers a CLOSED → reconnect
        // loop. See the wake-from-sleep storm fix.
        const ch = state.channel as unknown as { state?: string }
        if (ch.state === 'joined') {
          state.attempt = 0
          void captureSyncContext().then(requestSyncCatchUp).catch(() => {})
          logEvent('info', 'realtime', 'User-channel reconnect skipped — channel auto-rejoined')
          return
        }
        await supabase.removeChannel(state.channel)
      }
    } catch { /* channel may already be dead */ }
    await createUserChannel(state)
  }, delay)
}

/** Cancel a pending user-channel reconnect timer (suspend/offline). */
export function pauseUserChannelReconnect(): void {
  if (userChannelState?.reconnectTimer) {
    clearTimeout(userChannelState.reconnectTimer)
    userChannelState.reconnectTimer = null
  }
}

/** Reset the attempt counter and force a fresh subscribe (resume/online/manual retry). */
export async function forceReconnectUserChannel(): Promise<void> {
  if (!navigator.onLine || isSuspended()) return
  const state = userChannelState
  if (!state || state.cancelled) return
  const context = await captureSyncContext()
  await requestSyncCatchUp(context)
  if (state.cancelled || !await context.isCurrent()) return
  state.attempt = 0
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer)
    state.reconnectTimer = null
  }
  if (state.channel) {
    const ch = state.channel as unknown as { state?: string }
    if (ch.state === 'joined') return
    const supabase = await getSupabase()
    try { await supabase.removeChannel(state.channel) } catch { /* ignore */ }
  }
  await createUserChannel(state)
}

/**
 * Subscribe the per-user channel. No-ops when already subscribed for this
 * user; tears down a stale channel when the user changed. Skipped without a
 * live session (offline-fallback start) — when the session recovers,
 * authStore flips isOffline and App.tsx's realtime effect re-runs this.
 */
export async function subscribeToUserChannel(
  userId: string,
): Promise<void> {
  if (userChannelState && !userChannelState.cancelled) {
    if (userChannelState.userId === userId) return
    await unsubscribeUserChannel()
  }
  if (!(await requireSession())) {
    logEvent('warn', 'sync', 'subscribeToUserChannel skipped — no session', `user=${userId.slice(0, 8)}`)
    return
  }
  // Session lookup can race setup and cross-device discovery. Reserve only once.
  if (useAuthStore.getState().currentUser?.id !== userId) return
  if (userChannelState && !userChannelState.cancelled) {
    if (userChannelState.userId === userId) return
    await unsubscribeUserChannel()
    if (userChannelState && !userChannelState.cancelled) return
  }
  const state: UserChannelState = {
    userId,
    channel: null,
    cancelled: false,
    attempt: 0,
    reconnectTimer: null
  }
  userChannelState = state
  useSyncStore.getState().setChannelHealth(`user:${userId}`, false)
  await createUserChannel(state)
}

/** Tear down the per-user channel (logout / realtime effect cleanup). */
export async function unsubscribeUserChannel(): Promise<void> {
  const state = userChannelState
  if (!state) return
  userChannelState = null
  state.cancelled = true
  useSyncStore.getState().setChannelHealth(`user:${state.userId}`, null)
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer)
    state.reconnectTimer = null
  }
  if (state.channel) {
    const supabase = await getSupabase()
    try { await supabase.removeChannel(state.channel) } catch { /* already dead */ }
  }
}
