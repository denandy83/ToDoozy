/**
 * SyncService — manages write-through to Supabase and Realtime subscriptions
 * for shared projects. Runs in the renderer process where the authenticated
 * Supabase client lives.
 */
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase } from '../lib/supabase'
import type { Task, Status, SyncOperation } from '../../../shared/types'
import { useSyncStore } from '../shared/stores/syncStore'
import { logEvent } from '../shared/stores/logStore'
import { placeholderEmail, isPlaceholderEmail } from '../../../shared/placeholderUser'
import { getCachedProjectName } from './PersonalSyncService'

type RealtimeCallback = (table: string, event: string, payload: Record<string, unknown>) => void

interface SharedChannelState {
  channel: RealtimeChannel | null
  cancelled: boolean
  attempt: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
}

let channels: Map<string, SharedChannelState> = new Map()
let onChangeCallback: RealtimeCallback | null = null
let isOnline = true

const RECONNECT_DELAYS_MS = [2_000, 5_000, 15_000, 30_000]
function getReconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
}

/** Mark a successful push in the sync store */
function markSynced(): void {
  useSyncStore.getState().setLastSynced()
}

export function setOnlineStatus(online: boolean): void {
  isOnline = online
}

export function getOnlineStatus(): boolean {
  return isOnline
}

export function setRealtimeCallback(cb: RealtimeCallback): void {
  onChangeCallback = cb
}

async function createSharedChannel(projectId: string, state: SharedChannelState): Promise<void> {
  const supabase = await getSupabase()
  const channel = supabase
    .channel(`project:${projectId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tasks', filter: `project_id=eq.${projectId}` },
      (payload) => {
        const data = payload.eventType === 'DELETE'
          ? payload.old as Record<string, unknown>
          : payload.new as Record<string, unknown>
        onChangeCallback?.('task', payload.eventType, data)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'statuses', filter: `project_id=eq.${projectId}` },
      (payload) => {
        const data = payload.eventType === 'DELETE'
          ? payload.old as Record<string, unknown>
          : payload.new as Record<string, unknown>
        onChangeCallback?.('status', payload.eventType, data)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'project_members', filter: `project_id=eq.${projectId}` },
      (payload) => {
        const data = payload.eventType === 'DELETE'
          ? payload.old as Record<string, unknown>
          : payload.new as Record<string, unknown>
        onChangeCallback?.('member', payload.eventType, data)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'activity_log', filter: `project_id=eq.${projectId}` },
      (payload) => {
        onChangeCallback?.('activity', payload.eventType, payload.new as Record<string, unknown>)
      }
    )
    .subscribe((status, err) => {
      if (state.cancelled) return
      // Instrumentation: capture channel internal state + server error payload to diagnose loop
      const ch = channel as unknown as { state?: string; subTopic?: string; joinedOnce?: boolean }
      const chState = ch.state ?? '(unknown)'
      const subTopic = ch.subTopic ?? '(unknown)'
      const errMsg = err
        ? (err instanceof Error ? `${err.name}: ${err.message}` : (typeof err === 'string' ? err : JSON.stringify(err)))
        : '(no err)'
      if (status === 'SUBSCRIBED') {
        state.attempt = 0
        const pName = getCachedProjectName(projectId) ?? projectId
        console.log(`[Realtime] Subscribed to shared project "${pName}"`)
        logEvent('info', 'realtime', `Subscribed to shared project`, `${pName} (${projectId}) topic=${subTopic} chState=${chState}`)
        const currentStatus = useSyncStore.getState().status
        if (currentStatus === 'offline') {
          useSyncStore.getState().setStatus('synced')
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        const pName = getCachedProjectName(projectId) ?? projectId
        console.warn(`[Realtime] Project subscription ${status} for "${pName}"`, err ?? '')
        const level: 'warn' | 'error' = status === 'CHANNEL_ERROR' ? 'error' : 'warn'
        logEvent(level, 'realtime', `Channel ${status} on shared project`, `${pName} (${projectId}) topic=${subTopic} chState=${chState} err=${errMsg} attempt=${state.attempt}`)
        useSyncStore.getState().setStatus('offline')
        scheduleSharedReconnect(projectId)
      }
    })
  state.channel = channel
}

function scheduleSharedReconnect(projectId: string): void {
  const state = channels.get(projectId)
  if (!state || state.cancelled || state.reconnectTimer) return

  const delay = getReconnectDelay(state.attempt)
  state.attempt += 1
  logEvent('info', 'realtime', `Reconnect in ${delay / 1000}s (attempt ${state.attempt})`, projectId)

  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null
    if (state.cancelled) return
    if (!navigator.onLine) {
      logEvent('warn', 'realtime', `Reconnect deferred — offline`, projectId)
      scheduleSharedReconnect(projectId)
      return
    }
    try {
      const supabase = await getSupabase()
      if (state.channel) {
        // If supabase-js auto-rejoined the channel under us, tearing it down here would
        // trigger a clean phx_close → CLOSED → another reconnect → infinite 2s loop.
        // See: realtime wake-from-sleep storm fix.
        const ch = state.channel as unknown as { state?: string }
        if (ch.state === 'joined') {
          state.attempt = 0
          const currentStatus = useSyncStore.getState().status
          if (currentStatus === 'offline') useSyncStore.getState().setStatus('synced')
          logEvent('info', 'realtime', `Reconnect skipped — channel auto-rejoined`, projectId)
          return
        }
        await supabase.removeChannel(state.channel)
      }
    } catch { /* channel may already be dead */ }
    await createSharedChannel(projectId, state)
  }, delay)
}

/**
 * Subscribe to Realtime changes for a shared project.
 * Auto-reconnects with backoff on CHANNEL_ERROR/TIMED_OUT/CLOSED.
 */
export async function subscribeToProject(projectId: string): Promise<void> {
  if (channels.has(projectId)) return

  const state: SharedChannelState = {
    channel: null,
    cancelled: false,
    attempt: 0,
    reconnectTimer: null
  }
  channels.set(projectId, state)
  await createSharedChannel(projectId, state)
}

/**
 * Unsubscribe from Realtime changes for a project.
 */
export async function unsubscribeFromProject(projectId: string): Promise<void> {
  const state = channels.get(projectId)
  if (state) {
    state.cancelled = true
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
    }
    if (state.channel) {
      const supabase = await getSupabase()
      try { await supabase.removeChannel(state.channel) } catch { /* ignore */ }
    }
    channels.delete(projectId)
  }
}

/**
 * Unsubscribe from all Realtime channels.
 */
export async function unsubscribeAll(): Promise<void> {
  const supabase = await getSupabase()
  for (const state of channels.values()) {
    state.cancelled = true
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
    }
    if (state.channel) {
      try { await supabase.removeChannel(state.channel) } catch { /* ignore */ }
    }
  }
  channels = new Map()
}

// ── Write-Through Operations ────────────────────────────────────────

/**
 * Upload a project and all its data to Supabase (first-time share).
 */
export async function uploadProjectToSupabase(
  projectId: string,
  _ownerId?: string
): Promise<void> {
  const supabase = await getSupabase()

  // Verify we have an authenticated session before attempting Supabase operations
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    throw new Error('No authenticated Supabase session. Please log out and log back in.')
  }
  console.log('[SyncService] Sharing project with auth.uid:', session.user.id)

  // Get project data from local
  const project = await window.api.projects.findById(projectId)
  if (!project) throw new Error('Project not found')

  // Create shared project and add owner as member atomically via SECURITY DEFINER function
  const { error: shareError } = await supabase.rpc('share_project', {
    p_id: project.id,
    p_name: project.name,
    p_description: project.description ?? null,
    p_color: project.color ?? '#888888',
    p_icon: project.icon ?? 'folder'
  })
  if (shareError) throw shareError

  // Upload statuses
  const statuses = await window.api.statuses.findByProjectId(projectId)
  if (statuses.length > 0) {
    const { error: statusError } = await supabase.from('statuses').upsert(
      statuses.map((s) => ({
        id: s.id,
        project_id: projectId,
        name: s.name,
        color: s.color,
        icon: s.icon,
        order_index: s.order_index,
        is_done: s.is_done,
        is_default: s.is_default,
        created_at: s.created_at,
        updated_at: s.updated_at
      }))
    )
    if (statusError) throw statusError
  }

  // Upload all project labels (not just task-assigned ones)
  const projectLabels = await window.api.labels.findByProjectId(projectId)
  const allLabelData = projectLabels.map((l) => ({ name: l.name, color: l.color }))
  await supabase.from('projects').update({ label_data: JSON.stringify(allLabelData) }).eq('id', projectId)

  // Upload tasks with label names+colors (resolve IDs for cross-user sync)
  const tasks = await window.api.tasks.findByProjectId(projectId)
  for (const task of tasks) {
    const taskLabels = await window.api.tasks.getLabels(task.id)
    const labelData: Array<{ name: string; color: string }> = []
    for (const tl of taskLabels) {
      const label = await window.api.labels.findById(tl.label_id)
      if (label) labelData.push({ name: label.name, color: label.color })
    }
    await syncTaskToSupabase(supabase, task, labelData)
  }
}

/**
 * Route a sync push failure through every channel a user/operator might watch.
 * Mirrors PersonalSyncService.reportPushFailure; lives here so SyncService
 * stays self-contained (no cross-service imports).
 */
async function reportPushFailure(
  context: string,
  error: { message?: string; code?: string; details?: string } | unknown,
  table: string,
  rowId: string,
  payload: string,
  operation: SyncOperation = 'UPDATE'
): Promise<void> {
  const err = error as { message?: string; code?: string; details?: string }
  const msg = err?.message ?? (typeof error === 'string' ? error : 'unknown error')
  const code = err?.code ?? ''
  const details = err?.details ?? ''
  console.error(`[SyncService] ${context} error:`, msg, code, details, `id=${rowId}`)
  logEvent('error', 'sync', `${context} failed: ${msg}`, `table=${table} id=${rowId} code=${code} details=${details}`)
  try {
    await window.api.sync.enqueue(table, rowId, operation, payload)
  } catch (e) {
    console.error('[SyncService] Failed to enqueue after push error:', e)
  }
  useSyncStore.getState().setError(msg || `${context} failed`)
  void useSyncStore.getState().refreshPendingCount()
}

async function syncTaskToSupabase(
  supabase: SupabaseClient,
  task: Task,
  labelData: Array<{ name: string; color: string }> | string[]
): Promise<void> {
  const { error } = await supabase.from('tasks').upsert({
    id: task.id,
    project_id: task.project_id,
    owner_id: task.owner_id,
    assigned_to: task.assigned_to,
    title: task.title,
    description: task.description,
    status_id: task.status_id,
    priority: task.priority,
    due_date: task.due_date,
    parent_id: task.parent_id,
    order_index: task.order_index,
    is_template: task.is_template,
    is_archived: task.is_archived,
    completed_date: task.completed_date,
    recurrence_rule: task.recurrence_rule,
    reference_url: task.reference_url,
    label_names: JSON.stringify(labelData),
    created_at: task.created_at,
    updated_at: task.updated_at
  })
  if (error) throw error
}

/**
 * Write-through a task change to Supabase (for shared projects).
 */
export async function syncTaskChange(
  task: Task,
  operation: SyncOperation,
  labelData?: Array<{ name: string; color: string }>
): Promise<void> {
  if (!isOnline) {
    await window.api.sync.enqueue('tasks', task.id, operation, JSON.stringify(task))
    void useSyncStore.getState().refreshPendingCount()
    return
  }

  const supabase = await getSupabase()

  try {
    if (operation === 'DELETE') {
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('tasks')
        .update({ deleted_at: now, updated_at: now })
        .eq('id', task.id)
      if (error) {
        await reportPushFailure('syncTaskChange:DELETE', error, 'tasks', task.id, JSON.stringify({ id: task.id }), 'DELETE')
        return
      }
    } else {
      // syncTaskToSupabase throws on error; the catch routes it.
      await syncTaskToSupabase(supabase, task, labelData ?? [])
    }
    markSynced()
  } catch (err) {
    await reportPushFailure('syncTaskChange', err, 'tasks', task.id, JSON.stringify(task), operation)
  }
}

/**
 * Write-through a status change to Supabase.
 */
export async function syncStatusChange(
  status: Status,
  operation: SyncOperation
): Promise<void> {
  if (!isOnline) {
    await window.api.sync.enqueue('statuses', status.id, operation, JSON.stringify(status))
    void useSyncStore.getState().refreshPendingCount()
    return
  }

  const supabase = await getSupabase()

  try {
    if (operation === 'DELETE') {
      // Soft-delete: set deleted_at, keep the row. Hard-DELETE is reserved for the 30-day purge.
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('statuses')
        .update({ deleted_at: now, updated_at: now })
        .eq('id', status.id)
      if (error) {
        await reportPushFailure('syncStatusChange:SOFT_DELETE', error, 'statuses', status.id, JSON.stringify({ id: status.id, deleted_at: now }), 'UPDATE')
        return
      }
    } else {
      const { error } = await supabase.from('statuses').upsert({
        id: status.id,
        project_id: status.project_id,
        name: status.name,
        color: status.color,
        icon: status.icon,
        order_index: status.order_index,
        is_done: status.is_done,
        is_default: status.is_default,
        created_at: status.created_at,
        updated_at: status.updated_at,
        deleted_at: status.deleted_at ?? null
      })
      if (error) {
        await reportPushFailure('syncStatusChange:UPSERT', error, 'statuses', status.id, JSON.stringify(status), operation)
        return
      }
    }
    markSynced()
  } catch (err) {
    await reportPushFailure('syncStatusChange', err, 'statuses', status.id, JSON.stringify(status), operation)
  }
}

/**
 * Process queued offline changes.
 */
export async function processSyncQueue(): Promise<number> {
  const queue = await window.api.sync.getQueue()
  if (queue.length === 0) return 0

  const supabase = await getSupabase()
  let processed = 0

  // Group by table + operation for batch processing
  const upsertsByTable = new Map<string, Array<{ entryId: string; payload: Record<string, unknown> }>>()
  const deletes: typeof queue = []

  for (const entry of queue) {
    if (entry.operation === 'DELETE') {
      deletes.push(entry)
    } else {
      const existing = upsertsByTable.get(entry.table_name) ?? []
      existing.push({ entryId: entry.id, payload: JSON.parse(entry.payload) })
      upsertsByTable.set(entry.table_name, existing)
    }
  }

  // Batch upserts by table
  for (const [table, entries] of upsertsByTable) {
    try {
      const payloads = entries.map((e) => e.payload)
      await supabase.from(table).upsert(payloads)
      for (const e of entries) {
        await window.api.sync.dequeue(e.entryId)
        processed++
      }
    } catch (err) {
      console.error(`Failed to batch sync ${table}:`, err)
      // Fallback: try one-by-one
      for (const e of entries) {
        try {
          await supabase.from(table).upsert(e.payload)
          await window.api.sync.dequeue(e.entryId)
          processed++
        } catch (innerErr) {
          console.error(`Failed to sync queue entry ${e.entryId}:`, innerErr)
          break
        }
      }
    }
  }

  // Process deletes individually (can't batch different row IDs)
  for (const entry of deletes) {
    try {
      await supabase.from(entry.table_name).delete().eq('id', entry.row_id)
      await window.api.sync.dequeue(entry.id)
      processed++
    } catch (err) {
      console.error(`Failed to sync delete ${entry.id}:`, err)
      break
    }
  }

  // After a drain attempt, refresh the queue count and clear stale error if drained clean.
  await useSyncStore.getState().refreshPendingCount()
  const finalCount = useSyncStore.getState().pendingCount
  if (finalCount === 0) {
    useSyncStore.getState().setError(null)
    useSyncStore.getState().setLastSynced()
    if (processed > 0) {
      logEvent('info', 'sync', `Sync queue drained: ${processed} items pushed`)
    }
  }

  return processed
}

/**
 * Generate an invite link for a shared project.
 * If targetEmail is provided, the invite is tied to that email address.
 */
export async function generateInviteLink(
  projectId: string,
  createdBy: string,
  targetEmail?: string
): Promise<string> {
  const supabase = await getSupabase()
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString() // 15 minutes

  const insertData: Record<string, unknown> = {
    project_id: projectId,
    created_by: createdBy,
    expires_at: expiresAt,
    status: 'pending'
  }
  if (targetEmail) {
    insertData.target_email = targetEmail.toLowerCase().trim()
  }

  const { data, error } = await supabase
    .from('project_invites')
    .insert(insertData)
    .select('token')
    .single()

  if (error) throw error
  return `todoozy://invite/${data.token}`
}

/**
 * Check if the current user has any pending email-based invites.
 */
export async function checkPendingInvites(userEmail: string): Promise<Array<{
  token: string
  projectId: string
  projectName: string
  ownerEmail: string
  expiresAt: string
}>> {
  const supabase = await getSupabase()

  const { data, error } = await supabase.rpc('get_pending_invites_for_email', {
    user_email: userEmail.toLowerCase().trim()
  })

  if (error || !data) return []

  return data.map((invite: Record<string, unknown>) => ({
    token: invite.token as string,
    projectId: invite.project_id as string,
    projectName: invite.project_name as string,
    ownerEmail: invite.owner_email as string,
    expiresAt: invite.expires_at as string
  }))
}

/**
 * Validate an invite token and return invite details.
 */
/**
 * Subscribe to real-time invite notifications for a specific email.
 */
export async function subscribeToInvites(
  email: string,
  onInvite: (invite: { token: string }) => void
): Promise<() => void> {
  const supabase = await getSupabase()
  let channel: RealtimeChannel | null = null
  let retryTimeout: ReturnType<typeof setTimeout> | null = null
  let cancelled = false

  const createChannel = (): RealtimeChannel => {
    return supabase
      .channel(`invites:${email}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'project_invites',
          filter: `target_email=eq.${email.toLowerCase().trim()}`
        },
        (payload) => {
          const invite = payload.new as { token: string; status: string }
          if (invite.status === 'pending') {
            onInvite({ token: invite.token })
          }
        }
      )
  }

  const subscribe = (attempt: number): void => {
    if (cancelled) return
    channel = createChannel()
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('[Invites] Realtime subscription connected')
        logEvent('info', 'realtime', 'Subscribed to invites channel')
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn(`[Invites] Subscription failed (attempt ${attempt}):`, status)
        logEvent('warn', 'realtime', `Invites channel ${status} (attempt ${attempt})`)
        if (channel) supabase.removeChannel(channel)
        if (!cancelled && attempt < 5) {
          retryTimeout = setTimeout(() => subscribe(attempt + 1), 3000 * attempt)
        }
      }
    })
  }

  subscribe(1)

  return () => {
    cancelled = true
    if (retryTimeout) clearTimeout(retryTimeout)
    if (channel) supabase.removeChannel(channel)
  }
}

export async function validateInviteToken(token: string): Promise<{
  valid: boolean
  expired: boolean
  projectName: string
  ownerName: string
  projectId: string
  inviteId: string
} | null> {
  const supabase = await getSupabase()

  // Use SECURITY DEFINER function to bypass RLS — the invitee isn't a member yet
  const { data, error } = await supabase.rpc('validate_invite', {
    invite_token: token
  })

  if (error || !data || data.length === 0) return null

  const invite = data[0]
  const expired = new Date(invite.expires_at) < new Date() || invite.status === 'expired'

  return {
    valid: !expired && invite.status === 'pending',
    expired,
    projectName: invite.project_name,
    ownerName: invite.owner_email,
    projectId: invite.project_id,
    inviteId: invite.token
  }
}

/**
 * Accept an invite — adds user to project_members and syncs data down.
 */
export async function acceptInvite(token: string, userId: string): Promise<string> {
  const supabase = await getSupabase()

  console.log('[SyncService] Accepting invite token:', token)
  // Use server-side function that validates the invite and adds the member atomically
  const { data: projectId, error } = await supabase.rpc('accept_invite', {
    invite_token: token
  })

  console.log('[SyncService] accept_invite result:', { projectId, error })
  if (error) throw new Error(error.message)
  if (!projectId) throw new Error('Failed to accept invite')

  // Sync project data down to local
  console.log('[SyncService] Syncing project down:', projectId)
  await syncProjectDown(projectId, userId)
  console.log('[SyncService] Project synced successfully')

  return projectId
}

/**
 * Decline an invite — marks it so it won't show again.
 */
export async function declineInvite(token: string): Promise<void> {
  const supabase = await getSupabase()
  await supabase
    .from('project_invites')
    .update({ status: 'declined' })
    .eq('token', token)
}

/**
 * Discover shared projects the user is a member of in Supabase
 * but doesn't have locally. Returns project IDs to sync down.
 */
export async function discoverRemoteMemberships(_userId: string): Promise<string[]> {
  if (!navigator.onLine) return []
  const supabase = await getSupabase()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) return []

  const { data: memberships, error } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('user_id', session.user.id)

  if (error || !memberships) return []

  const idsToSync: string[] = []
  const projectIds = memberships.map((m) => m.project_id)

  // Get member counts for all projects to detect truly shared ones
  const memberCounts = new Map<string, number>()
  for (const pid of projectIds) {
    const { count } = await supabase
      .from('project_members')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', pid)
    memberCounts.set(pid, count ?? 0)
  }

  for (const m of memberships) {
    const local = await window.api.projects.findById(m.project_id)
    if (!local) {
      // Project doesn't exist locally — sync it down
      idsToSync.push(m.project_id)
    } else if (local.is_shared !== 1 && (memberCounts.get(m.project_id) ?? 0) > 1) {
      // Project exists locally but isn't marked shared — just mark it and sync members
      // Do NOT call syncProjectDown which would delete/overwrite local tasks
      await window.api.projects.update(m.project_id, { is_shared: 1 })
      logEvent('warn', 'sync', `Repaired mis-flagged shared project "${local.name}"`, `project=${m.project_id} members=${memberCounts.get(m.project_id)}`)
      await syncMembersDown(m.project_id)
    }
  }
  // Deduplicate
  return [...new Set(idsToSync)]
}

/**
 * Sync only project members from Supabase (without overwriting tasks/statuses).
 * Used when a local project is discovered to be shared.
 */
async function syncMembersDown(projectId: string): Promise<void> {
  const supabase = await getSupabase()
  const { data: members } = await supabase
    .from('project_members')
    .select('*')
    .eq('project_id', projectId)

  if (!members) return

  const localMembers = await window.api.projects.getMembers(projectId)
  const localMemberIds = new Set(localMembers.map((m) => m.user_id))

  // Batch-fetch profiles for any members whose local row is missing or stale.
  const memberIdsNeedingProfile: string[] = []
  const localUsersById = new Map<string, { id: string; email: string } | undefined>()
  for (const member of members) {
    const localUser = await window.api.users.findById(member.user_id)
    localUsersById.set(member.user_id, localUser ? { id: localUser.id, email: localUser.email } : undefined)
    if (!localUser || isPlaceholderEmail(localUser.email)) {
      memberIdsNeedingProfile.push(member.user_id)
    }
  }
  const profilesById = new Map<string, { email: string; display_name: string | null; avatar_url: string | null }>()
  if (memberIdsNeedingProfile.length > 0) {
    const { data: profiles } = await supabase
      .rpc('get_user_profiles', { p_user_ids: memberIdsNeedingProfile })
    for (const p of profiles ?? []) {
      profilesById.set(p.id as string, {
        email: (p.email as string | null) ?? '',
        display_name: (p.display_name as string | null) ?? null,
        avatar_url: (p.avatar_url as string | null) ?? null
      })
    }
  }

  for (const member of members) {
    const localUser = localUsersById.get(member.user_id)
    const profile = profilesById.get(member.user_id)

    if (!localUser) {
      await window.api.users.create({
        id: member.user_id,
        email: profile?.email ?? placeholderEmail(member.user_id),
        display_name: profile?.display_name ?? null,
        avatar_url: profile?.avatar_url ?? null
      }).catch(() => { /* already exists */ })
    } else if (isPlaceholderEmail(localUser.email) && profile?.email) {
      await window.api.users.update(member.user_id, {
        email: profile.email,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url
      })
    }

    if (!localMemberIds.has(member.user_id)) {
      await window.api.projects.addMember(
        projectId,
        member.user_id,
        member.role,
        member.invited_by ?? undefined
      )
    }

    if (member.display_color || member.display_initials) {
      await window.api.projects.updateMember(projectId, member.user_id, {
        display_color: member.display_color ?? null,
        display_initials: member.display_initials ?? null
      })
    }
  }
}

/**
 * Sync all shared project data from Supabase to local SQLite.
 */
export async function syncProjectDown(projectId: string, userId: string): Promise<void> {
  // Never sync down when offline — would delete all local tasks
  if (!navigator.onLine) {
    console.log('[SyncService] Skipping syncProjectDown (offline)')
    return
  }
  const supabase = await getSupabase()

  // Get shared project
  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (!project) throw new Error('Shared project not found')

  // Ensure the project owner's user record exists locally with real profile data
  const localOwner = await window.api.users.findById(project.owner_id)
  const { data: ownerProfileRows } = await supabase
    .rpc('get_user_profiles', { p_user_ids: [project.owner_id] })
  const ownerProfile = (ownerProfileRows as Array<{ email: string; display_name: string | null; avatar_url: string | null }> | null)?.[0] ?? null

  if (!localOwner) {
    await window.api.users.create({
      id: project.owner_id,
      email: ownerProfile?.email ?? placeholderEmail(project.owner_id),
      display_name: ownerProfile?.display_name ?? null,
      avatar_url: ownerProfile?.avatar_url ?? null
    }).catch(() => { /* already exists */ })
  } else if (isPlaceholderEmail(localOwner.email) && ownerProfile) {
    await window.api.users.update(project.owner_id, {
      email: ownerProfile.email,
      display_name: ownerProfile.display_name,
      avatar_url: ownerProfile.avatar_url
    })
  }

  // Create local project if not exists
  const localProject = await window.api.projects.findById(projectId)
  if (!localProject) {
    await window.api.projects.create({
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      icon: project.icon,
      owner_id: project.owner_id,
      is_default: 0
    })
    // Add current user as member locally
    await window.api.projects.addMember(projectId, userId, 'member')
  }
  // Mark as shared — but only if it isn't already, otherwise we bump
  // updated_at every startup and trigger a phantom 2-row push on the next
  // reconcile (`projects (pushed=2)` feedback loop).
  if (localProject?.is_shared !== 1) {
    await window.api.projects.update(projectId, { is_shared: 1 })
    logEvent('info', 'sync', `Marked project "${project.name}" as shared (syncProjectDown)`, `project=${projectId}`)
  }

  // Sync all project labels (create locally if missing, associate with project)
  if (project.label_data) {
    const labels: Array<{ name: string; color: string }> = JSON.parse(project.label_data)
    const existingProjectLabels = await window.api.labels.findByProjectId(projectId)
    const existingByName = new Map(existingProjectLabels.map((l) => [l.name.toLowerCase(), l]))

    for (const entry of labels) {
      let label = existingByName.get(entry.name.toLowerCase())
      if (!label) {
        // Check globally by user before creating
        label = await window.api.labels.findByName(userId, entry.name) ?? undefined
      }
      if (!label) {
        label = await window.api.labels.create({
          id: crypto.randomUUID(),
          user_id: userId,
          name: entry.name,
          color: entry.color
        })
      }
      await window.api.labels.addToProject(projectId, label.id).catch(() => {})
    }
  }

  // Sync statuses
  const { data: statuses } = await supabase
    .from('statuses')
    .select('*')
    .eq('project_id', projectId)

  if (statuses) {
    for (const status of statuses) {
      const existing = await window.api.statuses.findById(status.id)
      if (!existing) {
        await window.api.statuses.create({
          id: status.id,
          project_id: status.project_id,
          name: status.name,
          color: status.color,
          icon: status.icon,
          order_index: status.order_index,
          is_done: status.is_done,
          is_default: status.is_default
        })
      }
    }
  }

  // Sync tasks — create new, update existing, delete removed
  const { data: remoteTasks } = await supabase
    .from('tasks')
    .select('*')
    .eq('project_id', projectId)

  const remoteTaskIds = new Set<string>()

  if (remoteTasks) {
    // Ensure every referenced user (owner_id + assigned_to) exists locally before
    // inserting tasks — otherwise tasks.create trips the users FK. We fetch real
    // profile data in one batched request and fall back to a per-user placeholder
    // email (users.email is UNIQUE, so a shared placeholder collides).
    const referencedUserIds = new Set<string>()
    for (const task of remoteTasks) {
      if (task.owner_id) referencedUserIds.add(task.owner_id as string)
      if (task.assigned_to) referencedUserIds.add(task.assigned_to as string)
    }
    const missingUserIds: string[] = []
    for (const uid of referencedUserIds) {
      const local = await window.api.users.findById(uid)
      if (!local) missingUserIds.push(uid)
    }
    if (missingUserIds.length > 0) {
      const { data: profiles } = await supabase
        .rpc('get_user_profiles', { p_user_ids: missingUserIds })
      const profilesById = new Map<string, { email: string | null; display_name: string | null; avatar_url: string | null }>()
      for (const p of profiles ?? []) {
        profilesById.set(p.id as string, {
          email: (p.email as string | null) ?? null,
          display_name: (p.display_name as string | null) ?? null,
          avatar_url: (p.avatar_url as string | null) ?? null
        })
      }
      for (const uid of missingUserIds) {
        const profile = profilesById.get(uid)
        await window.api.users.create({
          id: uid,
          email: profile?.email ?? placeholderEmail(uid),
          display_name: profile?.display_name ?? null,
          avatar_url: profile?.avatar_url ?? null
        }).catch(() => { /* already exists */ })
      }
    }

    // Sort parents before subtasks to satisfy the parent_id FK constraint.
    // Remote rows arrive in arbitrary order; inserting a subtask before its
    // parent throws FOREIGN KEY constraint failed on tasks:create.
    const tasksToInsert = [
      ...remoteTasks.filter((t) => !t.parent_id),
      ...remoteTasks.filter((t) => t.parent_id)
    ]

    for (const task of tasksToInsert) {
      remoteTaskIds.add(task.id)
      const existing = await window.api.tasks.findById(task.id)

      try {
        // applyRemote preserves remote created_at/updated_at; using create/update
        // would stamp NOW into updated_at and make the row look "local newer" on
        // the next sync, triggering redundant pushes back to remote.
        await window.api.tasks.applyRemote({
          id: task.id,
          project_id: task.project_id,
          owner_id: task.owner_id,
          assigned_to: task.assigned_to,
          title: task.title,
          description: task.description,
          status_id: task.status_id,
          priority: task.priority ?? 0,
          due_date: task.due_date,
          parent_id: task.parent_id,
          order_index: task.order_index ?? 0,
          is_template: task.is_template ?? existing?.is_template ?? 0,
          is_archived: task.is_archived ?? 0,
          is_in_my_day: existing?.is_in_my_day ?? 0,
          completed_date: task.completed_date,
          recurrence_rule: task.recurrence_rule,
          reference_url: task.reference_url,
          my_day_dismissed_date: existing?.my_day_dismissed_date ?? null,
          created_at: task.created_at ?? existing?.created_at ?? task.updated_at,
          updated_at: task.updated_at,
          deleted_at: task.deleted_at ?? null
        })
      } catch (e) {
        // Don't let a single task failure (e.g. dangling FK) abort the whole sync
        console.error(`[SyncService] Failed to sync task "${task.title}" (${task.id}):`, e)
        continue
      }

      // Sync labels (check project labels first to avoid duplicates)
      if (task.label_names) {
        const projLabels = await window.api.labels.findByProjectId(projectId)
        const projLabelsByName = new Map(projLabels.map((l) => [l.name.toLowerCase(), l]))
        const parsed: Array<string | { name: string; color: string }> = JSON.parse(task.label_names)
        for (const entry of parsed) {
          const name = typeof entry === 'string' ? entry : entry.name
          const color = typeof entry === 'string' ? '#888888' : entry.color
          let label = projLabelsByName.get(name.toLowerCase())
          if (!label) {
            label = await window.api.labels.findByName(userId, name) ?? undefined
          }
          if (!label) {
            label = await window.api.labels.create({ id: crypto.randomUUID(), user_id: userId, name, color })
          }
          await window.api.labels.addToProject(projectId, label.id).catch(() => {})
          await window.api.tasks.addLabel(task.id, label.id).catch(() => {})
        }
      }
    }
  }

  // Delete local tasks that no longer exist in Supabase
  const localTasks = await window.api.tasks.findByProjectId(projectId)
  for (const lt of localTasks) {
    if (!remoteTaskIds.has(lt.id)) {
      await window.api.tasks.delete(lt.id).catch(() => {})
    }
  }

  // Sync members locally — fetch real profiles from Supabase
  const { data: members } = await supabase
    .from('project_members')
    .select('*')
    .eq('project_id', projectId)

  if (members) {
    const localMembers = await window.api.projects.getMembers(projectId)
    const localMemberIds = new Set(localMembers.map((m) => m.user_id))

    // Batch-fetch all member profiles (N+1 → 1 query) for any local users that
    // are missing or still have a placeholder email.
    const memberIdsNeedingProfile: string[] = []
    const localUsersById = new Map<string, { id: string; email: string } | undefined>()
    for (const member of members) {
      const localUser = await window.api.users.findById(member.user_id)
      localUsersById.set(member.user_id, localUser ? { id: localUser.id, email: localUser.email } : undefined)
      if (!localUser || isPlaceholderEmail(localUser.email)) {
        memberIdsNeedingProfile.push(member.user_id)
      }
    }
    const memberProfilesById = new Map<string, { email: string; display_name: string | null; avatar_url: string | null }>()
    if (memberIdsNeedingProfile.length > 0) {
      const { data: profiles } = await supabase
        .rpc('get_user_profiles', { p_user_ids: memberIdsNeedingProfile })
      for (const p of profiles ?? []) {
        memberProfilesById.set(p.id as string, {
          email: (p.email as string | null) ?? '',
          display_name: (p.display_name as string | null) ?? null,
          avatar_url: (p.avatar_url as string | null) ?? null
        })
      }
    }

    for (const member of members) {
      const localUser = localUsersById.get(member.user_id)
      const profile = memberProfilesById.get(member.user_id)

      if (!localUser) {
        await window.api.users.create({
          id: member.user_id,
          email: profile?.email ?? placeholderEmail(member.user_id),
          display_name: profile?.display_name ?? null,
          avatar_url: profile?.avatar_url ?? null
        }).catch(() => { /* already exists */ })
      } else if (isPlaceholderEmail(localUser.email) && profile?.email) {
        await window.api.users.update(member.user_id, {
          email: profile.email,
          display_name: profile.display_name,
          avatar_url: profile.avatar_url
        })
      }

      if (!localMemberIds.has(member.user_id)) {
        await window.api.projects.addMember(projectId, member.user_id, member.role)
      }

      // Sync display customizations from Supabase
      if (member.display_color || member.display_initials) {
        await window.api.projects.updateMember(projectId, member.user_id, {
          display_color: member.display_color ?? null,
          display_initials: member.display_initials ?? null
        })
      }
    }
  }
}

/**
 * Update a member's display_color and display_initials in Supabase
 * so the customization is visible to all project members.
 */
export async function updateSharedMemberDisplay(
  projectId: string,
  userId: string,
  displayColor: string | null,
  displayInitials: string | null
): Promise<void> {
  const supabase = await getSupabase()
  const { error } = await supabase
    .from('project_members')
    .update({ display_color: displayColor, display_initials: displayInitials })
    .eq('project_id', projectId)
    .eq('user_id', userId)

  if (error) throw error
}

/**
 * Remove all Supabase data for a project (unshare).
 */
export async function removeProjectFromSupabase(projectId: string): Promise<void> {
  const supabase = await getSupabase()

  // Explicitly delete non-owner members first — direct deletes trigger Realtime events
  // (cascade deletes do NOT trigger Realtime, so members wouldn't get notified)
  const { data: { session } } = await supabase.auth.getSession()
  const ownerId = session?.user?.id
  if (ownerId) {
    await supabase
      .from('project_members')
      .delete()
      .eq('project_id', projectId)
      .neq('user_id', ownerId)
  }

  // Now delete the project (cascades remaining data: tasks, statuses, owner member row, etc.)
  const { error } = await supabase.from('projects').delete().eq('id', projectId)
  if (error) throw error
}

/**
 * Get shared project members with their profile info from Supabase.
 */
export async function getSharedProjectMembers(projectId: string): Promise<Array<{
  user_id: string
  role: string
  joined_at: string
  email: string
  display_name: string | null
  display_color: string | null
  display_initials: string | null
}>> {
  const supabase = await getSupabase()

  const { data, error } = await supabase
    .from('project_members')
    .select('user_id, role, joined_at, display_color, display_initials')
    .eq('project_id', projectId)

  if (error || !data) return []

  // Use SECURITY DEFINER RPC to read auth.users directly — bypasses user_profiles
  // view which only surfaces Google OAuth users (email/password users have no row).
  // Falls back to user_profiles batch query if the RPC isn't deployed yet.
  const { data: rpcProfiles, error: rpcError } = await supabase
    .rpc('get_project_member_profiles', { p_project_id: projectId })

  const profileMap = new Map<string, { email: string; display_name: string | null }>()

  if (!rpcError && rpcProfiles) {
    for (const p of rpcProfiles as Array<{ user_id: string; email: string; display_name: string | null }>) {
      profileMap.set(p.user_id, { email: p.email, display_name: p.display_name })
    }
  } else {
    // Fallback: use general profile lookup (also reads auth.users via SECURITY DEFINER)
    const userIds = data.map((m) => m.user_id)
    const { data: profiles } = await supabase
      .rpc('get_user_profiles', { p_user_ids: userIds })
    if (profiles) {
      for (const p of (profiles as Array<{ id: string; email: string; display_name: string | null }>) ) {
        profileMap.set(p.id, { email: p.email, display_name: p.display_name })
      }
    }
  }

  const members: Array<{
    user_id: string
    role: string
    joined_at: string
    email: string
    display_name: string | null
    display_color: string | null
    display_initials: string | null
  }> = []

  for (const member of data) {
    const profile = profileMap.get(member.user_id)
    if (profile) {
      members.push({
        user_id: member.user_id,
        role: member.role,
        joined_at: member.joined_at,
        email: profile.email,
        display_name: profile.display_name,
        display_color: member.display_color ?? null,
        display_initials: member.display_initials ?? null
      })
    } else {
      const localUser = await window.api.users.findById(member.user_id)
      members.push({
        user_id: member.user_id,
        role: member.role,
        joined_at: member.joined_at,
        email: localUser?.email ?? 'unknown',
        display_name: localUser?.display_name ?? null,
        display_color: member.display_color ?? null,
        display_initials: member.display_initials ?? null
      })
    }
  }

  return members
}

/**
 * Remove a member from a shared project.
 */
export async function removeSharedMember(projectId: string, userId: string): Promise<void> {
  const supabase = await getSupabase()
  const { error } = await supabase
    .from('project_members')
    .delete()
    .eq('project_id', projectId)
    .eq('user_id', userId)
  if (error) throw error

  // Also remove locally
  await window.api.projects.removeMember(projectId, userId)
}
