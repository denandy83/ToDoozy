import { hydrateProjectLabel, isProjectRecoveryActive } from './projectRecovery'
import { membershipSnapshot, invalidateMembershipSnapshots } from './membershipSnapshot'
import { captureProjectScope } from '../shared/stores/projectScope'
import { hydrationContext } from '../shared/stores/hydrationContext'
import { evictProjectData } from '../shared/stores/projectCache'
import { syncTaskLabelChoices } from './taskLabelAdditions'
import { markSynced, refreshProducerPending, reportPushFailure } from './syncFeedback'
import { remoteTaskOrder } from './remoteTaskOrder'
import { readAll, readAllIn } from './readAll'
import { useAuthStore } from '../shared/stores/authStore'
import { projectSyncContext, channelSyncContext, captureSyncContext, captureSyncProducer, captureProjectProducer, requireProducerCurrent, syncContextFromProducer, withSyncProducer, type SyncProducer, type SyncContext } from './syncContext'
import { replaySpecialEntry, specialEntryIntent } from './syncQueueReplay'
import { scheduleRemoteProjectRefresh } from './remoteProjectRefresh'
/**
 * SyncService — manages write-through to Supabase and Realtime subscriptions
 * for shared projects. Runs in the renderer process where the authenticated
 * Supabase client lives.
 */
import type { SupabaseClient, RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase } from '../lib/supabase'
import type { Task, Status, Label, SyncOperation, ProjectMember, Project } from '../../../shared/types'
import { useSyncStore } from '../shared/stores/syncStore'
import { logEvent } from '../shared/stores/logStore'
import { placeholderEmail, isPlaceholderEmail } from '../../../shared/placeholderUser'
import { pushLabel, getCachedProjectName, requestSyncCatchUp, requestProjectRefresh } from './PersonalSyncService'
import { SYNC_TABLES } from './syncTables'
import { isSuspended } from './powerState'

type RealtimeCallback = (table: string, event: string, payload: Record<string, unknown>, origin: SyncContext) => void | Promise<void>

interface SharedChannelState {
  context: Promise<SyncContext>
  archived?: boolean
  channel: RealtimeChannel | null
  cancelled: boolean
  attempt: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
}

let channels: Map<string, SharedChannelState> = new Map()
let onChangeCallback: RealtimeCallback | null = null
let isOnline = true

const RECONNECT_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 900_000]
const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS_MS.length
function getReconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
}

/** Mark a successful push in the sync store */


export function setOnlineStatus(online: boolean): void {
  isOnline = online
}

export function getOnlineStatus(): boolean {
  return isOnline
}

export function setRealtimeCallback(cb: RealtimeCallback): () => void {
  onChangeCallback = cb
  return () => { if (onChangeCallback === cb) onChangeCallback = null }
}

async function createSharedChannel(projectId: string, state: SharedChannelState): Promise<void> {
  const context = await state.context
  const dispatch = (table: string, event: string, data: Record<string, unknown>): void => {
    const callback = onChangeCallback
    if (!callback) return
    void (async () => {
      if (!await context.isCurrent()) return
      context.assertCurrent()
      await callback(table, event, data, context)
    })().catch(async error => {
      if (await context.isCurrent()) logEvent('error', 'realtime', 'Shared callback failed', String(error))
    }).catch(() => {})
  }
  const supabase = await getSupabase()
  if (!await context.isCurrent() || state.cancelled) return
  const archived = (await context.api.projects.findById(projectId))?.is_archived === 1
  if (!await context.isCurrent() || state.cancelled) return
  context.assertCurrent()
  state.archived = archived
  const channel = supabase
    .channel(`project:${projectId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'projects', filter: `id=eq.${projectId}` }, () => {
      try { if (state.cancelled) return; context.assertCurrent(); void requestProjectRefresh(context, [projectId]).catch(() => {}) } catch { return }
    })
  if (!archived) channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tasks', filter: `project_id=eq.${projectId}` },
      (payload) => {
        try { if (state.cancelled) return; context.assertCurrent() } catch { return }
        const data = payload.eventType === 'DELETE'
          ? payload.old as Record<string, unknown>
          : payload.new as Record<string, unknown>
        if (payload.eventType === 'DELETE' && typeof data.id === 'string') {
          void context.api.tasks.hardDelete(data.id).then(async () => { if (!await context.isCurrent()) return; context.assertCurrent(); scheduleRemoteProjectRefresh(projectId, context, typeof data.id === 'string' ? [data.id] : []) })
            .catch(async (error) => { if (await context.isCurrent()) logEvent('error', 'sync', 'Failed to apply remote task deletion', String(error)) }).catch(() => {})
        } else {
          scheduleRemoteProjectRefresh(projectId, context, typeof data.id === 'string' ? [data.id] : [])
        }
        dispatch('task', payload.eventType, data)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'statuses', filter: `project_id=eq.${projectId}` },
      (payload) => {
        try { if (state.cancelled) return; context.assertCurrent() } catch { return }
        const data = payload.eventType === 'DELETE'
          ? payload.old as Record<string, unknown>
          : payload.new as Record<string, unknown>
        if (payload.eventType === 'DELETE' && typeof data.id === 'string') {
          void context.api.statuses.hardDelete(data.id).then(async () => { if (!await context.isCurrent()) return; context.assertCurrent(); scheduleRemoteProjectRefresh(projectId, context) })
            .catch(async (error) => { if (await context.isCurrent()) logEvent('error', 'sync', 'Failed to apply remote status deletion', String(error)) }).catch(() => {})
        } else scheduleRemoteProjectRefresh(projectId, context)
        dispatch('status', payload.eventType, data)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'project_members', filter: `project_id=eq.${projectId}` },
      (payload) => {
        try { if (state.cancelled) return; context.assertCurrent() } catch { return }
        const data = payload.eventType === 'DELETE'
          ? payload.old as Record<string, unknown>
          : payload.new as Record<string, unknown>
        dispatch('member', payload.eventType, data)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'activity_log', filter: `project_id=eq.${projectId}` },
      (payload) => {
        try { if (state.cancelled) return; context.assertCurrent() } catch { return }
        const data = payload.eventType === 'DELETE' ? payload.old : payload.new
        scheduleRemoteProjectRefresh(projectId, context, typeof data.task_id === 'string' ? [data.task_id] : [])
        dispatch('activity', payload.eventType, payload.new as Record<string, unknown>)
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'project_labels', filter: `project_id=eq.${projectId}` },
      (payload) => {
        try { if (state.cancelled) return; context.assertCurrent() } catch { return }
        const data = payload.eventType === 'DELETE'
          ? payload.old as Record<string, unknown>
          : payload.new as Record<string, unknown>
        scheduleRemoteProjectRefresh(projectId, context)
        dispatch('project_label', payload.eventType, data)
      }
    )
  state.channel = channel
  channel.subscribe((status, err) => {
      if (state.cancelled || state.channel !== channel) return
      try { context.assertCurrent() } catch { return }
      // Instrumentation: capture channel internal state + server error payload to diagnose loop
      const ch = channel as unknown as { state?: string; subTopic?: string; joinedOnce?: boolean }
      const chState = ch.state ?? '(unknown)'
      const subTopic = ch.subTopic ?? '(unknown)'
      const errMsg = err
        ? (err instanceof Error ? `${err.name}: ${err.message}` : (typeof err === 'string' ? err : JSON.stringify(err)))
        : '(no err)'
      if (status === 'SUBSCRIBED') {
        void requestProjectRefresh(context, [projectId]).catch(() => {})
        useSyncStore.getState().setChannelHealth(`shared:${projectId}`, true)
        state.attempt = 0
        useSyncStore.getState().setConnectionLost(false)
        const pName = getCachedProjectName(projectId) ?? projectId
        console.log(`[Realtime] Subscribed to shared project "${pName}"`)
        logEvent('info', 'realtime', `Subscribed to shared project`, `${pName} (${projectId}) topic=${subTopic} chState=${chState}`)
        const currentStatus = useSyncStore.getState().status
        if (currentStatus === 'offline') {
          useSyncStore.getState().setStatus('synced')
        }
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        useSyncStore.getState().setChannelHealth(`shared:${projectId}`, false)
        const pName = getCachedProjectName(projectId) ?? projectId
        console.warn(`[Realtime] Project subscription ${status} for "${pName}"`, err ?? '')
        const level: 'warn' | 'error' = status === 'CHANNEL_ERROR' ? 'error' : 'warn'
        logEvent(level, 'realtime', `Channel ${status} on shared project`, `${pName} (${projectId}) topic=${subTopic} chState=${chState} err=${errMsg} attempt=${state.attempt}`)
        useSyncStore.getState().setStatus('offline')
        scheduleSharedReconnect(projectId, state, context)
      }
    })
}

function scheduleSharedReconnect(projectId: string, state: SharedChannelState, context: SyncContext): void {
  if (state.cancelled || state.reconnectTimer) return
  try { context.assertCurrent() } catch { return }
  const channel = state.channel
  const reconnPName = getCachedProjectName(projectId) ?? projectId

  if (isSuspended()) {
    logEvent('info', 'realtime', `Reconnect deferred — system suspended`, reconnPName)
    return
  }
  if (!navigator.onLine) {
    logEvent('info', 'realtime', `Reconnect deferred — offline`, reconnPName)
    return
  }

  if (state.attempt >= MAX_RECONNECT_ATTEMPTS) {
    logEvent('warn', 'realtime', `Reconnect gave up after ${state.attempt} attempts`, reconnPName)
    useSyncStore.getState().setConnectionLost(true)
    useSyncStore.getState().setNextReconnectAt(null)
    return
  }

  const delay = getReconnectDelay(state.attempt)
  state.attempt += 1
  logEvent('info', 'realtime', `Reconnect in ${delay / 1000}s (attempt ${state.attempt})`, reconnPName)
  useSyncStore.getState().setNextReconnectAt(Date.now() + delay)

  state.reconnectTimer = setTimeout(async () => {
    if (state.cancelled || state.channel !== channel) return
    try { context.assertCurrent() } catch { return }
    state.reconnectTimer = null
    useSyncStore.getState().setNextReconnectAt(null)
    if (isSuspended() || !navigator.onLine) {
      logEvent('info', 'realtime', `Reconnect aborted — ${isSuspended() ? 'suspended' : 'offline'}`, reconnPName)
      return
    }
    try {
      const supabase = await getSupabase()
      if (!await context.isCurrent() || state.cancelled || state.channel !== channel) return
      context.assertCurrent()
      if (state.channel) {
        // If supabase-js auto-rejoined the channel under us, tearing it down here would
        // trigger a clean phx_close → CLOSED → another reconnect → infinite 2s loop.
        // See: realtime wake-from-sleep storm fix.
        const ch = state.channel as unknown as { state?: string }
        if (ch.state === 'joined') {
          useSyncStore.getState().setChannelHealth(`shared:${projectId}`, true)
          state.attempt = 0
          void requestProjectRefresh(context, [projectId]).catch(() => {})
          const currentStatus = useSyncStore.getState().status
          if (currentStatus === 'offline') useSyncStore.getState().setStatus('synced')
          logEvent('info', 'realtime', `Reconnect skipped — channel auto-rejoined`, reconnPName)
          return
        }
        const previous = state.channel
        state.channel = null
        await supabase.removeChannel(previous)
      }
    } catch { /* channel may already be dead */ }
    if (state.cancelled || state.channel !== null || !await context.isCurrent()) return
    context.assertCurrent()
    try { await createSharedChannel(projectId, state) } catch (error) { if (!state.cancelled) throw error }
  }, delay)
}

/**
 * Cancel pending shared-channel reconnect timers. Called by powerMonitor
 * 'suspend' and the offline listener — keep channel state, just stop firing.
 */
export function pauseSharedReconnectsForSuspend(): void {
  for (const state of channels.values()) {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
    }
  }
}

/**
 * Reset attempt counters and force a fresh subscribe for every shared channel.
 */
export async function forceReconnectAllShared(): Promise<void> {
  if (!navigator.onLine || isSuspended()) return
  const context = await captureSyncContext()
  context.assertCurrent()
  useSyncStore.getState().setConnectionLost(false)
  const supabase = await getSupabase()
  for (const [projectId, state] of channels.entries()) {
    if (!await context.isCurrent() || isSuspended() || !navigator.onLine) return
    const origin = await state.context
    if (state.cancelled || !await origin.isCurrent()) continue
    context.assertCurrent()
    origin.assertCurrent()
    state.attempt = 0
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
    }
    if (state.channel) {
      const ch = state.channel as unknown as { state?: string }
      if (ch.state === 'joined') continue
      const previous = state.channel
      state.channel = null
      try { await supabase.removeChannel(previous) } catch { /* ignore */ }
    }
    if (state.cancelled || !await context.isCurrent()) continue
    await createSharedChannel(projectId, state)
  }
  await requestSyncCatchUp(context)
}

/**
 * Subscribe to Realtime changes for a shared project.
 * Auto-reconnects with backoff on CHANNEL_ERROR/TIMED_OUT/CLOSED.
 */
export async function subscribeToProject(projectId: string, context?: SyncContext): Promise<void> {
  if (context && !await context.isCurrent()) return
  context = context?.subscriptionSource ?? context
  const existing = channels.get(projectId)
  if (existing) {
    context ??= await captureSyncContext(() => navigator.onLine && !isSuspended())
    const archived = (await context.api.projects.findById(projectId))?.is_archived === 1
    const previous = await existing.context
    const sameScope = previous.scope === context.scope
    const previousCurrent = await previous.isCurrent()
    if (!await context.isCurrent() || existing.cancelled) return
    context.assertCurrent()
    if (existing.archived === archived && sameScope && previousCurrent) return
  }
  const removal = existing ? unsubscribeFromProject(projectId) : Promise.resolve()
  const projectCurrent = captureProjectScope()
  const source = context ? Promise.resolve(context) : captureSyncContext(() => navigator.onLine && !isSuspended())
  const state: SharedChannelState = {
    context: source.then(parent => channelSyncContext(parent, () => !state.cancelled && projectCurrent(projectId), projectId)),
    channel: null,
    cancelled: false,
    attempt: 0,
    reconnectTimer: null
  }
  channels.set(projectId, state)
  try {
    const [, origin] = await Promise.all([removal, state.context])
    if (state.cancelled) return
    origin.assertCurrent()
    useSyncStore.getState().setChannelHealth(`shared:${projectId}`, false)
    await createSharedChannel(projectId, state)
  } catch (error) {
    if (channels.get(projectId) === state) await unsubscribeFromProject(projectId)
    throw error
  }
}

export async function reconcileSharedSubscriptions(projects: Project[], context: SyncContext, subscribeMissing: boolean, projectIds?: Set<string>): Promise<void> {
  const shared = new Set(projects.filter((project) => project.is_shared === 1).map((project) => project.id))
  for (const id of shared) {
    if (!await context.isCurrent()) return
    if (subscribeMissing || channels.has(id)) await subscribeToProject(id, context)
  }
  for (const id of channels.keys()) if ((!projectIds || projectIds.has(id)) && !shared.has(id)) await unsubscribeFromProject(id)
}

/**
 * Unsubscribe from Realtime changes for a project.
 */
export async function unsubscribeFromProject(projectId: string): Promise<void> {
  const state = channels.get(projectId)
  if (state) {
    channels.delete(projectId)
    useSyncStore.getState().setChannelHealth(`shared:${projectId}`, null)
    state.cancelled = true
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
    }
    if (state.channel) {
      const supabase = await getSupabase()
      try { await supabase.removeChannel(state.channel) } catch { /* ignore */ }
    }
  }
}

/**
 * Unsubscribe from all Realtime channels.
 */
export async function unsubscribeAll(): Promise<void> {
  const removed = [...channels]
  channels = new Map()
  for (const [projectId,state] of removed) {
    useSyncStore.getState().setChannelHealth(`shared:${projectId}`, null)
    state.cancelled = true
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
    }
  }
  const supabase = await getSupabase()
  for (const [,state] of removed) {
    if (state.channel) try { await supabase.removeChannel(state.channel) } catch { /* ignore */ }
  }
}

// ── Write-Through Operations ────────────────────────────────────────

/**
 * Upload a project and all its data to Supabase (first-time share).
 */
export async function uploadProjectToSupabase(
  projectId: string,
  _ownerId?: string
): Promise<void> {
  const origin = captureProjectProducer(projectId)
  const supabase = await origin.client()
  if (!supabase) throw new Error('No authenticated Supabase session. Please log out and log back in.')
  const api = origin.api

  // Get project data from local
  const project = await api.projects.findById(projectId)
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
  const statuses = await api.statuses.findByProjectId(projectId)
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
  const projectLabels = await api.labels.findByProjectId(projectId)
  const allLabelData = projectLabels.map((l) => ({ name: l.name, color: l.color }))
  await supabase.from('projects').update({ label_data: JSON.stringify(allLabelData) }).eq('id', projectId)

  // Upload tasks with label names+colors (resolve IDs for cross-user sync).
  // Gather every task's label ids first, resolve them all in ONE batched local
  // query (was a per-label findById → N+1 label resolution), then build each
  // task's label data from the in-memory map. Same rows as before — only fewer
  // round-trips. getLabels filters tombstoned task_labels and label soft-delete
  // cascades to task_labels, so findByIds (which filters deleted_at) resolves
  // the identical set the per-label findById did.
  const tasks = await api.tasks.findByProjectId(projectId)
  const labelIdsByTask = new Map<string, string[]>()
  const allLabelIds = new Set<string>()
  for (const task of tasks) {
    const taskLabels = await api.tasks.getLabels(task.id)
    const ids = taskLabels.map((tl) => tl.label_id)
    labelIdsByTask.set(task.id, ids)
    for (const id of ids) allLabelIds.add(id)
  }
  const labels = allLabelIds.size > 0
    ? await api.labels.findByIds([...allLabelIds])
    : []
  const labelById = new Map<string, { name: string; color: string }>(
    labels.map((l) => [l.id, { name: l.name, color: l.color }])
  )
  for (const task of tasks) {
    const labelData = buildTaskLabelData(labelIdsByTask.get(task.id) ?? [], labelById)
    await syncTaskToSupabase(supabase, task, labelData)
  }
}

/**
 * Resolve an ordered list of label ids to their {name, color} for upload,
 * skipping ids missing from the map. Pure helper extracted for testability —
 * replaces the previous per-label findById N+1 with an in-memory lookup over a
 * single batched fetch. Preserves the original getLabels order and drops
 * unresolved ids exactly as the per-label `if (label)` guard did.
 */
export function buildTaskLabelData(
  labelIds: string[],
  labelById: Map<string, { name: string; color: string }>
): Array<{ name: string; color: string }> {
  const labelData: Array<{ name: string; color: string }> = []
  for (const id of labelIds) {
    const label = labelById.get(id)
    if (label) labelData.push({ name: label.name, color: label.color })
  }
  return labelData
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
    archive_updated_at: task.archive_updated_at ?? null,
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
  labelData?: Array<{ name: string; color: string }>,
  producer?: SyncProducer
): Promise<void> {
  return withSyncProducer(async (origin) => {
    try {
    if (!isOnline) {
      await origin.api.sync.enqueue('tasks', task.id, operation, JSON.stringify(task))
      await refreshProducerPending(origin)
      return
    }

    const supabase = await origin.client()
      if (!supabase) { await origin.api.sync.enqueue('tasks', task.id, operation, JSON.stringify(task)); await refreshProducerPending(origin); return }

      if (operation === 'DELETE') {
        const local = await origin.api.tasks.findById(task.id)
        if (!local?.deleted_at) throw new Error('Task deletion intent missing')
        const { error } = await supabase
          .from('tasks')
          .update({ deleted_at: local.deleted_at, updated_at: local.updated_at })
          .eq('id', task.id)
        if (error) {
          await reportPushFailure(origin, 'syncTaskChange:DELETE', error, 'tasks', task.id, JSON.stringify({ id: task.id }), 'DELETE')
          return
        }
      } else {
        // syncTaskToSupabase throws on error; the catch routes it.
        await syncTaskToSupabase(supabase, task, labelData ?? [])
      await syncTaskLabelChoices(supabase, [task.id], origin.api, await origin.scope())
      }
      await markSynced(origin)
    } catch (err) {
      await reportPushFailure(origin, 'syncTaskChange', err, 'tasks', task.id, JSON.stringify(task), operation)
    }
  }, producer)
}

/**
 * Write-through a status change to Supabase.
 */
export async function syncStatusChange(
  status: Status,
  operation: SyncOperation,
  producer?: SyncProducer
): Promise<void> {
  return withSyncProducer(async (origin) => {
      if (operation === 'DELETE') {
        const { deleteStatusFromSupabase } = await import('./PersonalSyncService')
        await deleteStatusFromSupabase(status.id, origin)
        return
      }
    try {
    if (!isOnline) {
      await origin.api.sync.enqueue('statuses', status.id, operation, JSON.stringify(status))
      await refreshProducerPending(origin)
      return
    }

    const supabase = await origin.client()
      if (!supabase) { await origin.api.sync.enqueue('statuses', status.id, operation, JSON.stringify(status)); await refreshProducerPending(origin); return }

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
          await reportPushFailure(origin, 'syncStatusChange:UPSERT', error, 'statuses', status.id, JSON.stringify(status), operation)
          return
        }
      await markSynced(origin)
    } catch (err) {
      await reportPushFailure(origin, 'syncStatusChange', err, 'statuses', status.id, JSON.stringify(status), operation)
    }
  }, producer)
}

/**
 * Process queued offline changes.
 */
type QueueDrain = { scope: string; followup: ReturnType<typeof captureProjectScope> | null; promise: Promise<number> }
let queueDrain: QueueDrain | null = null
export async function processSyncQueue(source?: SyncContext): Promise<number> {
  const projectCurrent = captureProjectScope()
  if (!isOnline || isSuspended()) return 0
  const producer = source ? null : captureSyncProducer()
  const origin = source ?? producer!
  let context: SyncContext
  try { context = source ? source.accountContext ? await source.accountContext() : source : await syncContextFromProducer(producer!) } catch {
    if (await origin.isCurrent()) useSyncStore.getState().setStatus('offline')
    return 0
  }
  if (!await context.isCurrent()) return 0
  try { context.assertCurrent() } catch { return 0 }
  while (queueDrain) {
    const current = queueDrain
    if (current.scope === context.scope) {
      const previous = current.followup
      current.followup = previous ? id => previous(id) || projectCurrent(id) : projectCurrent
      return current.promise
    }
    await current.promise
    if (!await context.isCurrent()) return 0
  }
  const state: QueueDrain = { scope: context.scope, followup: null, promise: Promise.resolve(0) }
  queueDrain = state
  state.promise = (async () => {
    let processed = 0
    let checkpoint = projectCurrent
    do {
      state.followup = null
      processed += await drainSyncQueue(context, checkpoint)
      checkpoint = state.followup ?? checkpoint
    } while (state.followup && isOnline && !isSuspended() && await context.isCurrent())
    if (queueDrain === state) queueDrain = null
    return processed
  })().finally(() => { if (queueDrain === state) queueDrain = null })
  return state.promise
}

async function drainSyncQueue(context: SyncContext, projectCurrent: ReturnType<typeof captureProjectScope>): Promise<number> {
  let processed = 0
  context = channelSyncContext(context, () => isOnline && !isSuspended(), '')
  const { api, client: supabase, assertCurrent } = context
  const userId = useAuthStore.getState().currentUser?.id
  try {
    const queue = await api.sync.getQueue()
    if (!queue.length || !isOnline) return 0
    const groups = new Map<string, typeof queue>()
    for (const entry of queue) {
      const key = `${entry.table_name}:${entry.row_id}`
      groups.set(key, [...(groups.get(key) ?? []), entry])
    }
    let failure: string | null = null
    const priority = ['projects', 'user_labels', 'statuses', 'project_labels', 'tasks']
    const ordered = [...groups.values()].sort((a, b) =>
      (priority.indexOf(a[0].table_name) + 1 || 99) - (priority.indexOf(b[0].table_name) + 1 || 99))
    const projectContexts = new Map<string, SyncContext>()
    const work = ordered.map((entries) => {
      let entry = entries[entries.length - 1]
      const commands = entries.filter((item) => JSON.parse(item.payload).status_delete === true)
      if (commands.length) entry = commands.sort((a, b) => Date.parse(JSON.parse(a.payload).updated_at) - Date.parse(JSON.parse(b.payload).updated_at)).at(-1)!
      const payload = JSON.parse(entry.payload) as Record<string, unknown>
      const archive = entries.some((item) => JSON.parse(item.payload).archive_with_tasks === true)
      if (archive) entry = { ...entry, payload: JSON.stringify({ ...payload, archive_with_tasks: true }) }
      const special = entry.table_name === 'task_labels' || entry.table_name === 'project_labels' || archive || commands.length > 0
      const descriptor = Object.values(SYNC_TABLES).find((item) => item?.remoteName === entry.table_name)
      let scoped: Promise<SyncContext> | undefined
      let projectId = entry.table_name === 'projects' ? entry.row_id : String(payload.project_id ?? payload.projectId ?? '')
      const lifetime = (): Promise<SyncContext> => scoped ??= (async () => {
        if (!projectId) {
          const row = descriptor?.scope === 'project' ? await descriptor.localGetById(entry.row_id, api) : null
          const task = entry.table_name === 'task_labels' ? await api.tasks.findById(String(payload.task_id ?? entry.row_id)) : null
          const rowProjectId = row && typeof row === 'object' && 'project_id' in row && typeof row.project_id === 'string' ? row.project_id : null
          projectId = String(rowProjectId ?? task?.project_id ?? '')
        }
        assertCurrent()
        if (!projectId) return context
        let current = projectContexts.get(projectId)
        if (!current) {
          current = channelSyncContext(context, () => projectCurrent(projectId), projectId)
          projectContexts.set(projectId, current)
        }
        return current
      })()
      const snapshot = async (): Promise<string> => {
        const current = await lifetime()
        current.assertCurrent()
        if (special) return specialEntryIntent(entry, current)
        const row = descriptor ? await descriptor.localGetById(entry.row_id, current.api) : payload
        return JSON.stringify({ row: row ?? null, labels: entry.table_name === 'tasks' && row ? (await current.api.tasks.getLabels(entry.row_id)).map((link) => link.label_id).sort() : [] })
      }
      const eligible = async (): Promise<boolean> => {
        const current = await lifetime()
        if (!await current.isCurrent()) return false
        if (!projectId) return descriptor?.scope !== 'project' && entry.table_name !== 'task_labels' && entry.table_name !== 'project_labels'
        const project = await current.api.projects.findById(projectId)
        const permitted = !project || project.owner_id === userId || (await current.api.projects.getMembers(projectId)).some(member => member.user_id === userId)
        current.assertCurrent()
        return permitted
      }
      return { entry, entries, payload, special, descriptor, snapshot, eligible, lifetime, current: context }
    })
    await Promise.all(work.map(async item => { item.current = await item.lifetime() }))
    type Work = typeof work[number]
    const complete = async (item: Work): Promise<void> => {
      const current = await item.lifetime()
      for (const entry of item.entries) { if (await current.api.sync.dequeue(entry.id)) processed++ }
    }
    const blockedTasks = new Set<string>()
    const handled = new Set<Work>()
    for (const item of work) {
      if (handled.has(item)) continue
      if (item.entry.table_name === 'tasks' && blockedTasks.has(item.entry.row_id)) continue
      if (!item.special && item.descriptor) {
        const tableItems = work.filter((candidate) => !candidate.special && candidate.descriptor && candidate.entry.table_name === item.entry.table_name && !(candidate.entry.table_name === 'tasks' && blockedTasks.has(candidate.entry.row_id)))
        for (const candidate of tableItems) handled.add(candidate)
        for (let index = 0; index < tableItems.length; index += 200) {
          let pending = tableItems.slice(index, index + 200)
          try {
            while (pending.length && isOnline) {
              try {
                const prepared = await Promise.all(pending.map(async candidate => {
                  candidate.current = await candidate.lifetime()
                  try {
                    const snapshot = await candidate.snapshot()
                    return await candidate.eligible() ? { candidate, snapshot } : null
                  } catch (error) { if (await candidate.current.isCurrent()) throw error; return null }
                }))
                const live = prepared.filter((value): value is NonNullable<typeof value> => {
                  if (!value) return false
                  try { value.candidate.current.assertCurrent(); return true } catch { return false }
                })
                pending = live.map(value => value.candidate)
                if (!pending.length) break
                const snapshots = live.map(value => value.snapshot)
                const batchItems = [...pending]
                const batchClient = batchItems.every(candidate => candidate.current === context) ? supabase : context.clientFor!(() => {
                  for (const candidate of batchItems) candidate.current.assertCurrent()
                })
                const rows = snapshots.map((value) => JSON.parse(value).row)
                if (item.entry.table_name === 'user_settings' || item.entry.table_name === 'user_themes') {
                  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                    const row = rows[rowIndex]
                    if (row && (item.entry.table_name === 'user_themes' || row.key === 'theme_id')) await item.descriptor!.remoteUpsert(row, pending[rowIndex].current)
                  }
                }
                const values = rows.filter(Boolean)
                  .filter((row) => item.entry.table_name !== 'user_settings' || row.key !== 'theme_id')
                  .filter(() => item.entry.table_name !== 'user_themes')
                  .map((row) => item.descriptor!.toRemote(row))
                if (values.length) {
                  const { error } = await batchClient.from(item.entry.table_name).upsert(values)
                  if (error) {
                    if (item.entry.table_name !== 'user_labels') throw new Error(error.message)
                    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                      const row = rows[rowIndex]
                      if (!row) continue
                      const current = pending[rowIndex].current
                      const producer: SyncProducer = {
                        api: current.api, apiFor: current.apiFor, clientFor: current.clientFor, userId, client: async () => current.client,
                        assertCurrent: current.assertCurrent, isCurrent: current.isCurrent, scope: async () => current.scope
                      }
                      if (!await pushLabel(row as Label, userId!, producer)) throw new Error(error.message)
                    }
                  }
                  if (item.entry.table_name === 'tasks') {
                    const labels = new Map<SyncContext, string[]>()
                    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                      const row = rows[rowIndex]
                      if (row && !row.deleted_at) {
                        const current = pending[rowIndex].current
                        labels.set(current, [...(labels.get(current) ?? []), row.id])
                      }
                    }
                    for (const [current, ids] of labels) {
                      try { await syncTaskLabelChoices(current.client, ids, current.api, current.scope) }
                      catch (error) { if (await current.isCurrent()) throw error }
                    }
                  }
                }
                const changed: Work[] = []
                for (let rowIndex = 0; rowIndex < pending.length; rowIndex++) {
                  const candidate = pending[rowIndex]
                  const current = candidate.current
                  if (!await current.isCurrent()) continue
                  if (!rows[rowIndex] && (candidate.entry.table_name === 'user_themes' || (candidate.entry.table_name === 'user_settings' && candidate.entry.row_id.endsWith(':theme_id')))) {
                    await complete(candidate)
                    continue
                  }
                  if (!rows[rowIndex]) {
                    const deletedAt = candidate.payload.deleted_at ?? candidate.entry.created_at
                    await replaySpecialEntry(current.client, { ...candidate.entry, payload: JSON.stringify({ id: candidate.entry.row_id, deleted_at: deletedAt, updated_at: deletedAt }) }, current)
                  }
                  if (item.entry.table_name === 'user_labels' && rows[rowIndex] && !await item.descriptor!.localGetById(candidate.entry.row_id, current.api)) {
                    await complete(candidate)
                    continue
                  }
                  if (snapshots[rowIndex] !== await candidate.snapshot()) changed.push(candidate)
                  else await complete(candidate)
                }
                pending = changed
              } catch (error) {
                const valid = pending.filter(candidate => { try { candidate.current.assertCurrent(); return true } catch { return false } })
                if (valid.length === pending.length) throw error
                pending = valid
              }
            }
          } catch (error) { assertCurrent(); failure = error instanceof Error ? error.message : String(error) }
        }
        continue
      }
      try {
        item.current = await item.lifetime()
        while (isOnline) {
          const before = await item.snapshot()
          if (!await item.eligible()) break
          assertCurrent()
          if (!await replaySpecialEntry(item.current.client, item.entry, item.current)) throw new Error('Unsupported queued operation')
          if (before !== await item.snapshot()) continue
          await complete(item)
          break
        }
      } catch (error) {
        if (!await item.current.isCurrent()) continue
        item.current.assertCurrent()
        failure = error instanceof Error ? error.message : String(error)
        if (item.payload.status_delete === true) {
          const affected = Array.isArray(item.payload.tasks) ? item.payload.tasks as Array<{ id: string }>
            : await item.current.api.tasks.findAllByProject(String(item.payload.project_id), { includeTombstones: true })
          for (const task of affected) blockedTasks.add(task.id)
        }
      }
    }
    assertCurrent()
    const pendingCount = await api.sync.count()
    if (!await context.isCurrent()) return processed
    useSyncStore.setState({ pendingCount })
    assertCurrent()
    if (useSyncStore.getState().pendingCount > 0) useSyncStore.getState().setError(failure ?? 'Changes are still waiting to sync')
    else {
      useSyncStore.getState().setError(null)
      useSyncStore.getState().setLastSynced()
    }
  } catch { return processed }
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
export async function checkPendingInvites(userEmail: string, origin = captureSyncProducer()): Promise<Array<{
  token: string
  projectId: string
  projectName: string
  ownerEmail: string
  expiresAt: string
}>> {
  const { client } = await syncContextFromProducer(origin)
  const { data, error } = await client.rpc('get_pending_invites_for_email', {
    user_email: userEmail.toLowerCase().trim()
  })
  await requireProducerCurrent(origin)
  if (error) throw new Error(error.message)
  if (!Array.isArray(data)) throw new Error('Invalid invitation response')
  return data.map((invite: Record<string, unknown>) => ({
    token: invite.token as string,
    projectId: invite.project_id as string,
    projectName: invite.project_name as string,
    ownerEmail: invite.owner_email as string,
    expiresAt: invite.expires_at as string
  }))
}

/** Use the existing realtime connection, but never deliver a canceled scope. */
export async function subscribeToInvites(
  email: string,
  onInvite: (invite: { token: string }) => void | Promise<void>,
  origin = captureSyncProducer()
): Promise<() => void> {
  const supabase = await getSupabase()
  await requireProducerCurrent(origin)
  let channel: RealtimeChannel | null = null
  let retryTimeout: ReturnType<typeof setTimeout> | null = null
  let cancelled = false
  const stop = (): void => {
    cancelled = true
    if (retryTimeout) clearTimeout(retryTimeout)
    retryTimeout = null
    if (channel) void supabase.removeChannel(channel)
    channel = null
  }
  const subscribe = async (attempt: number): Promise<void> => {
    if (cancelled) return
    if (!await origin.isCurrent()) { stop(); return }
    origin.assertCurrent()
    if (cancelled) return
    channel = supabase.channel('invites:' + email.toLowerCase().trim())
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'project_invites',
        filter: 'target_email=eq.' + email.toLowerCase().trim()
      }, (payload) => {
        const invite = payload.new as { token: string; status: string }
        if (cancelled || invite.status !== 'pending') return
        void (async () => {
          if (cancelled || !await origin.isCurrent()) { stop(); return }
          origin.assertCurrent()
          if (!cancelled) await onInvite({ token: invite.token })
        })().catch(() => {
          if (!cancelled) logEvent('warn', 'realtime', 'Invitation notification could not be refreshed')
        })
      })
    channel.subscribe((status) => {
      if (cancelled) return
      if (status === 'SUBSCRIBED') {
        logEvent('info', 'realtime', 'Subscribed to invites channel')
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        if (channel) void supabase.removeChannel(channel)
        channel = null
        if (attempt < 5) retryTimeout = setTimeout(() => {
          retryTimeout = null
          void subscribe(attempt + 1).catch(stop)
        }, 3000 * attempt)
      }
    })
  }
  await subscribe(1)
  return stop
}

export async function validateInviteToken(token: string, origin = captureSyncProducer()): Promise<{
  valid: boolean
  expired: boolean
  projectName: string
  ownerName: string
  projectId: string
  inviteId: string
} | null> {
  const { client } = await syncContextFromProducer(origin)
  const { data, error } = await client.rpc('validate_invite', { invite_token: token })
  await requireProducerCurrent(origin)
  if (error) throw new Error(error.message)
  if (!Array.isArray(data)) throw new Error('Invalid invitation response')
  if (!data.length) return null
  const invite = data[0]
  const expired = new Date(invite.expires_at) < new Date() || invite.status === 'expired'
  return {
    valid: !expired && invite.status === 'pending', expired,
    projectName: invite.project_name, ownerName: invite.owner_email,
    projectId: invite.project_id, inviteId: invite.token
  }
}

/** Accept remotely and download only into the originating local database. */
export async function acceptInvite(token: string, userId: string, origin = captureSyncProducer(), acknowledged?: (resume: () => Promise<string>) => void): Promise<string> {
  if (origin.userId !== userId) throw new Error('Sync account changed')
  const projectCurrent = captureProjectScope()
  const context = await syncContextFromProducer(origin)
  const { data: projectId, error } = await context.client.rpc('accept_invite', { invite_token: token })
  origin.assertCurrent()
  if (error) throw new Error(error.message)
  if (typeof projectId !== 'string' || !projectId) throw new Error('Failed to accept invite')
  const resume = async (): Promise<string> => {
    await requireProducerCurrent(origin)
    const accepted = projectSyncContext(context, projectId, projectCurrent)
    accepted.assertCurrent()
    const { data: membership, error: membershipError } = await accepted.client.from('project_members')
      .select('user_id').eq('project_id', projectId).eq('user_id', userId).maybeSingle()
    if (membershipError || membership?.user_id !== userId) throw new Error(membershipError?.message ?? 'Project membership is no longer available')
    await syncProjectDown(projectId, userId, accepted, true)
    await requireProducerCurrent(origin)
    accepted.assertCurrent()
    return projectId
  }
  acknowledged?.(resume)
  return resume()
}

/** Acknowledged targeted decline, or local dismissal of a reusable public link. */
export async function declineInvite(token: string, origin = captureSyncProducer()): Promise<void> {
  const { client } = await syncContextFromProducer(origin)
  const { data, error } = await client.rpc('decline_invite', { invite_token: token })
  await requireProducerCurrent(origin)
  if (error) throw new Error(error.message)
  if (data !== 'declined' && data !== 'dismissed') throw new Error('Invitation decline was not acknowledged')
}

/**
 * Count project_members rows grouped by project_id.
 * Pure helper extracted for testability — replaces the previous per-project
 * N+1 count queries with a single client-side grouping over one batched query.
 */
export function countMembersByProject(rows: { project_id: string }[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1)
  }
  return counts
}

/**
 * Reconcile memberships only after every remote page succeeds. Missing remote
 * access evicts renderer state/subscriptions but preserves native recovery data;
 * local owners retain pending projects without a remote membership yet.
 * Returns newly discovered project IDs to sync down.
 */
export async function discoverRemoteMemberships(userId: string, context?: SyncContext, scopedProject?: Project): Promise<string[]> {
  const admission = membershipSnapshot()
  if (!navigator.onLine || isSuspended()) return []
  context ??= await captureSyncContext(() => navigator.onLine && !isSuspended())
  if (!await context.isCurrent() || useAuthStore.getState().currentUser?.id !== userId) return []
  const hydration = hydrationContext(context)
  const { api, client } = context
  const { data: membershipRows, error } = await readAll(() => {
    const query = client.from('project_members').select('*')
    return scopedProject ? query.eq('project_id', scopedProject.id) : query.eq('user_id', userId)
  }, ['project_id', 'user_id'])
  if (error) throw new Error(error.message)
  const memberships = scopedProject ? membershipRows.filter((member) => member.user_id === userId) : membershipRows
  const ids = memberships.map((member) => member.project_id as string)
  const { data: projects, error: projectError } = scopedProject
    ? { data: memberships.length ? [scopedProject] : [], error: null }
    : await readAllIn(ids, (batch) => client.from('projects').select('*').in('id', batch))
  if (projectError) throw new Error(projectError.message)
  const { data: members, error: memberError } = scopedProject
    ? { data: membershipRows, error: null }
    : await readAllIn(ids, (batch) => client.from('project_members').select('*').in('project_id', batch), ['project_id','user_id'])
  if (memberError) throw new Error(memberError.message)
  const counts = countMembersByProject(members as Array<{ project_id: string }>)
  const accessible = new Set(projects.filter((project) => !project.deleted_at).map((project) => project.id as string))
  const missing: string[] = []
  for (const project of projects) {
    if (project.deleted_at) continue
    const current = await admission(project.id, context)
    const api = current.api
    try {
    const local = await api.projects.findById(project.id)
    const owner = await api.users.findById(project.owner_id)
    if (!owner) await api.users.create({ id: project.owner_id, email: placeholderEmail(project.owner_id), display_name: null, avatar_url: null })
    if (!scopedProject) await api.projects.applyRemote({ ...local, ...project })
    const isShared = project.owner_id !== userId || (counts.get(project.id) ?? 0) > 1 ? 1 : 0
    if ((await api.projects.findById(project.id))?.is_shared !== isShared) await api.projects.update(project.id, { is_shared: isShared })
    await syncMembersDown(project.id, current, members.filter((member) => member.project_id === project.id) as ProjectMember[])
    {
      const snapshot = await api.projects.getMembers(project.id)
      const { useProjectStore } = await import('../shared/stores/projectStore')
      if (!await current.isCurrent() || !hydration.isProjectCurrent(project.id)) continue
      current.assertCurrent()
      useProjectStore.setState((state) => hydration.isProjectCurrent(project.id) ? { members: { ...state.members, [project.id]: snapshot } } : {})
    }
    if (!local) missing.push(project.id)
    } catch (error) { if (await current.isCurrent()) throw error }
  }
  const localProjects = scopedProject ? [scopedProject] : await api.projects.getProjectsForUser(userId)
  for (const local of localProjects) {
    if (accessible.has(local.id) || (local.owner_id === userId && !local.deleted_at)) continue
    const current = await admission(local.id, context)
    const api = current.api
    try {
    if (!await current.isCurrent()) continue
    const { unsubscribePersonalProject } = await import('./PersonalSyncService')
    await api.projects.removeMember(local.id, userId)
    if (!await current.isCurrent()) continue
    const { useProjectStore } = await import('../shared/stores/projectStore')
    if (!await current.isCurrent()) continue
    current.assertCurrent()
    if (!isProjectRecoveryActive(local.id)) useProjectStore.setState({ removal: { id: local.id, name: local.name, ownerId: userId, scope: window.api.sync.currentContext() } })
    evictProjectData(local.id)
    if (useProjectStore.getState().currentProjectId === local.id) useProjectStore.getState().setCurrentProject(null)
    useProjectStore.setState((state) => ({
      projects: Object.fromEntries(Object.entries(state.projects).filter(([id]) => id !== local.id)),
      members: Object.fromEntries(Object.entries(state.members).filter(([id]) => id !== local.id))
    }))
    await Promise.all([unsubscribeFromProject(local.id), unsubscribePersonalProject(local.id)])
    } catch (error) { if (await current.isCurrent()) throw error }
  }
  return missing
}

/**
 * Sync only project members from Supabase (without overwriting tasks/statuses).
 * Used when a local project is discovered to be shared.
 */
async function syncMembersDown(projectId: string, context: SyncContext, snapshot?: ProjectMember[]): Promise<void> {
  context = await membershipSnapshot()(projectId, context)
  const { api, client: supabase } = context
  const result = snapshot ? { data: snapshot, error: null } : await readAll(() => supabase.from('project_members').select('*').eq('project_id', projectId), ['project_id','user_id'])
  if (result.error) throw new Error(result.error.message)
  const members = result.data as ProjectMember[]

  const localMembers = await api.projects.getMembers(projectId)
  const localMemberIds = new Set(localMembers.map((m) => m.user_id))
  const remoteIds = new Set(members.map((m) => m.user_id))
  for (const member of localMembers) if (!remoteIds.has(member.user_id)) await api.projects.removeMember(projectId, member.user_id)

  // Batch-fetch profiles for any members whose local row is missing or stale.
  const memberIdsNeedingProfile: string[] = []
  const localUsersById = new Map<string, { id: string; email: string } | undefined>()
  for (const member of members) {
    const localUser = await api.users.findById(member.user_id)
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
      await api.users.create({
        id: member.user_id,
        email: profile?.email ?? placeholderEmail(member.user_id),
        display_name: profile?.display_name ?? null,
        avatar_url: profile?.avatar_url ?? null
      }).catch(() => { /* already exists */ })
    } else if (isPlaceholderEmail(localUser.email) && profile?.email) {
      await api.users.update(member.user_id, {
        email: profile.email,
        display_name: profile.display_name,
        avatar_url: profile.avatar_url
      })
    }

    if (!localMemberIds.has(member.user_id)) {
      await api.projects.addMember(
        projectId,
        member.user_id,
        member.role,
        member.invited_by ?? undefined,
        member.joined_at
      )
    }

    await api.projects.updateMember(projectId, member.user_id, {
      display_color: member.display_color ?? null,
      display_initials: member.display_initials ?? null
    })
  }
}

/**
 * Sync all shared project data from Supabase to local SQLite.
 */
export async function syncProjectDown(projectId: string, userId: string, context?: SyncContext, requireComplete = false): Promise<void> {
  const projectCurrent = captureProjectScope()
  const admission = membershipSnapshot()
  // Never sync down when offline — would delete all local tasks
  if (!navigator.onLine) throw new Error('Project download is offline')
  context ??= await captureSyncContext()
  context = projectSyncContext(context, projectId, projectCurrent)
  context.assertCurrent()
  if (useAuthStore.getState().currentUser?.id !== userId) throw new Error('Sync account changed')
  const { api, client: supabase } = context

  // Get shared project
  const { data: project } = await supabase
    .from('projects')
    .select('*')
    .eq('id', projectId)
    .single()

  if (!project || project.deleted_at) throw new Error('Shared project not found')

  // Ensure the project owner's user record exists locally with real profile data
  const localOwner = await api.users.findById(project.owner_id)
  const { data: ownerProfileRows } = await supabase
    .rpc('get_user_profiles', { p_user_ids: [project.owner_id] })
  const ownerProfile = (ownerProfileRows as Array<{ email: string; display_name: string | null; avatar_url: string | null }> | null)?.[0] ?? null

  if (!localOwner) {
    await api.users.create({
      id: project.owner_id,
      email: ownerProfile?.email ?? placeholderEmail(project.owner_id),
      display_name: ownerProfile?.display_name ?? null,
      avatar_url: ownerProfile?.avatar_url ?? null
    }).catch(() => { /* already exists */ })
  } else if (isPlaceholderEmail(localOwner.email) && ownerProfile) {
    await api.users.update(project.owner_id, {
      email: ownerProfile.email,
      display_name: ownerProfile.display_name,
      avatar_url: ownerProfile.avatar_url
    })
  }

  // Create local project if not exists
  const localProject = await api.projects.findById(projectId)
  if (!localProject) {
    // Append the newly-discovered shared project after the member's own
    // projects rather than inheriting the owner's sidebar_order (which can be
    // a large integer that pushes it past the sidebar's MAX_VISIBLE_PROJECTS
    // cutoff). sidebar_order is a per-device preference; applyRemote preserves
    // this local value on subsequent syncs (COALESCE in the ON CONFLICT clause).
    const localProjects = await api.projects.getProjectsForUser(userId)
    const maxLocalOrder = localProjects.reduce(
      (m, p) => Math.max(m, p.sidebar_order ?? 0),
      -1
    )
    await api.projects.applyRemote({ ...project, sidebar_order: maxLocalOrder + 1 })
    // Add current user as member locally
    await api.projects.addMember(projectId, userId, 'member')
  }
  if (localProject) await api.projects.applyRemote(project)
  await api.projects.update(projectId, { is_shared: 1 })

  // Sync project↔label links from the project_labels junction (the source
  // of truth — preserves tombstones). Reading the legacy projects.label_data
  // JSON would re-link labels that another member has since tombstoned,
  // because it's a stale snapshot from the initial share.
  //
  const { data: remoteProjectLabels } = await readAll(() => supabase
    .from('project_labels')
    .select('project_id, label_id, created_at, deleted_at')
    .eq('project_id', projectId), ['project_id', 'label_id'])
  if (remoteProjectLabels && remoteProjectLabels.length > 0) {
    const ids = [...new Set(remoteProjectLabels.map(pl => String(pl.label_id)))]
    const { data: remoteLabels } = await readAllIn(ids, batch => supabase.from('user_labels').select('*').in('id', batch))
    for (const label of remoteLabels) await hydrateProjectLabel(label as unknown as Label, userId, context)

    for (const pl of remoteProjectLabels) {
      const labelId = pl.label_id as string
      const deletedAt = (pl.deleted_at as string | null | undefined) ?? null
      const exists = await api.labels.findById(labelId).catch(error => {
        if (requireComplete) throw error
        return null
      })
      if (!exists) {
        if (requireComplete && !deletedAt) throw new Error('Project label unavailable')
        continue
      }
      await api.labels.applyRemoteProjectLabel({
        project_id: projectId,
        label_id: labelId,
        created_at: (pl.created_at as string | null) ?? null,
        deleted_at: deletedAt
      }).catch(error => { if (requireComplete) throw error })
      if (deletedAt) {
        await api.labels
          .softDeleteTaskLabelsForProjectLabel(projectId, labelId)
          .catch(error => { if (requireComplete) throw error })
      }
    }
  }

  // Sync statuses
  const { data: statuses } = await readAll(() => supabase
    .from('statuses')
    .select('*')
    .eq('project_id', projectId), ['updated_at', 'id'])

  if (statuses) {
    for (const status of statuses) {
      await api.statuses.applyRemote(status)
    }
  }

  // Sync tasks — create new, update existing, delete removed
  const { data: remoteTasks } = await readAll(() => supabase
    .from('tasks')
    .select('*')
    .eq('project_id', projectId), ['updated_at', 'id'])

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
      const local = await api.users.findById(uid)
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
        await api.users.create({
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
    const tasksToInsert = remoteTaskOrder(remoteTasks)

    for (const task of tasksToInsert) {
      remoteTaskIds.add(task.id)
      const existing = await api.tasks.findById(task.id)

      try {
        // applyRemote preserves remote created_at/updated_at; using create/update
        // would stamp NOW into updated_at and make the row look "local newer" on
        // the next sync, triggering redundant pushes back to remote.
        await api.tasks.applyRemote({
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
          archive_updated_at: task.archive_updated_at ?? null,
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
        if (requireComplete) throw e
        // Don't let a single task failure (e.g. dangling FK) abort the whole sync
        console.error(`[SyncService] Failed to sync task "${task.title}" (${task.id}):`, e)
        continue
      }

      // Per-task label sync used to read `task.label_names` (a denormalized
      // JSON snapshot) and call addToProject + addLabel for each name —
      // which RESURRECTED tombstoned project_labels and task_labels links
      // when another member had since removed the label from the project.
      // The proper sync now happens after the task loop via a single
      // task_labels junction pull, which preserves remote deletions.
    }
  }

  if (remoteTasks?.length) {
    const { pullTaskLabelsForTasks } = await import('./PersonalSyncService')
    await pullTaskLabelsForTasks(remoteTasks.map((task)=>String(task.id)),userId,context,projectId,requireComplete)
  }

  // Delete local tasks that no longer exist in Supabase
  const localTasks = await api.tasks.findByProjectId(projectId)
  for (const lt of localTasks) {
    if (!remoteTaskIds.has(lt.id)) {
      await api.tasks.delete(lt.id).catch(error => { if (requireComplete) throw error })
    }
  }

  const members = await admission(projectId, context)
  try { await syncMembersDown(projectId, members) } catch (error) { if (await members.isCurrent()) throw error }
  context.assertCurrent()
}

/**
 * Update a member's display_color and display_initials in Supabase
 * so the customization is visible to all project members.
 */
export async function updateSharedMemberDisplay(
  projectId: string,
  userId: string,
  displayColor: string | null,
  displayInitials: string | null,
  producer: SyncProducer = captureProjectProducer(projectId)
): Promise<void> {
  await invalidateMembershipSnapshots(projectId, producer)
  const supabase = await producer.client()
  if (!supabase) throw new Error('Sign in to update member appearance')
  const { data, error } = await supabase
    .from('project_members')
    .update({ display_color: displayColor, display_initials: displayInitials })
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .select('project_id,user_id')
  await requireProducerCurrent(producer)
  if (error) throw error
  if (data?.length !== 1) throw new Error('Project member appearance was not updated')
  await invalidateMembershipSnapshots(projectId, producer)
}

/**
 * Remove all Supabase data for a project (unshare).
 */
export async function removeProjectFromSupabase(projectId: string, origin = captureProjectProducer(projectId)): Promise<void> {
  await invalidateMembershipSnapshots(projectId, origin)
  const supabase = await origin.client()
  if (!supabase) throw new Error('Not authenticated')
  await requireProducerCurrent(origin)

  // Explicitly delete non-owner members first — direct deletes trigger Realtime events
  // (cascade deletes do NOT trigger Realtime, so members wouldn't get notified)
  const ownerId = origin.userId
  if (ownerId) {
    const { error } = await supabase
      .from('project_members')
      .delete()
      .eq('project_id', projectId)
      .neq('user_id', ownerId)
    await requireProducerCurrent(origin)
    if (error) throw error
  }

  // Now delete the project (cascades remaining data: tasks, statuses, owner member row, etc.)
  const { error } = await supabase.from('projects').delete().eq('id', projectId)
  await requireProducerCurrent(origin)
  if (error) throw error
  await invalidateMembershipSnapshots(projectId, origin)
}

/**
 * Get shared project members with their profile info from Supabase.
 */
export async function getSharedProjectMembers(projectId: string, origin: SyncContext | SyncProducer = captureProjectProducer(projectId)): Promise<Array<{
  user_id: string
  role: string
  joined_at: string
  email: string
  display_name: string | null
  display_color: string | null
  display_initials: string | null
}>> {
  const source = 'userId' in origin ? await syncContextFromProducer(origin) : origin
  const context = { ...source, ...hydrationContext(source, projectId) }
  if (!await context.isCurrent()) throw new Error('Shared project context changed')
  context.assertCurrent()
  const { data, error } = await readAll(() => context.client.from('project_members')
    .select('user_id, role, joined_at, display_color, display_initials').eq('project_id', projectId), ['user_id'])
  if (!await context.isCurrent()) throw new Error('Shared project context changed')
  context.assertCurrent()
  if (error) throw new Error(error.message)
  if (!data.length) return []
  const { data: profiles, error: profileError } = await context.client.rpc('get_user_profiles', { p_user_ids: data.map(member => member.user_id) })
  if (!await context.isCurrent()) throw new Error('Shared project context changed')
  context.assertCurrent()
  const profileMap = new Map<string, { email: string; display_name: string | null }>()
  // The membership snapshot remains authoritative when profile lookup fails.
  // Enrich its current members from the original database below.
  for (const profile of profileError ? [] : profiles ?? []) profileMap.set(profile.id, { email: profile.email, display_name: profile.display_name ?? null })

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
    if (!await context.isCurrent()) throw new Error('Shared project context changed')
    context.assertCurrent()
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
      const localUser = await context.api.users.findById(member.user_id)
      members.push({
        user_id: member.user_id,
        role: member.role,
        joined_at: member.joined_at,
        email: localUser?.email ?? placeholderEmail(member.user_id),
        display_name: localUser?.display_name ?? null,
        display_color: member.display_color ?? null,
        display_initials: member.display_initials ?? null
      })
    }
  }

  if (!await context.isCurrent()) throw new Error('Shared project context changed')
  context.assertCurrent()
  return members
}

/**
 * Remove a member from a shared project.
 */
export async function removeSharedMember(projectId: string, userId: string, origin: SyncProducer = captureProjectProducer(projectId)): Promise<void> {
  await invalidateMembershipSnapshots(projectId, origin)
  const self = userId === origin.userId
  const account = self ? await origin.accountContext!() : null
  const supabase = account ? account.clientFor!(origin.assertCurrent, account.assertCurrent) : await origin.client()
  if (!supabase) throw new Error('Not authenticated')
  await requireProducerCurrent(origin)
  const { data, error } = await supabase.from('project_members').delete().eq('project_id', projectId).eq('user_id', userId).select('user_id')
  if (account) {
    if (!await account.isCurrent()) throw new Error('Sync account or database changed')
    account.assertCurrent()
    if (error) throw error
    if (!data?.some(member => member.user_id === userId)) {
      const result = await account.client.from('project_members').select('user_id').eq('project_id', projectId).eq('user_id', userId)
      if (result.error) throw result.error
      if (result.data?.length) throw new Error('Membership removal not acknowledged')
    }
    await invalidateMembershipSnapshots(projectId, account)
    await account.api.projects.removeMember(projectId, userId)
  } else {
    await requireProducerCurrent(origin)
    if (error) throw error
    if (!data?.some(member => member.user_id === userId)) throw new Error('Membership removal not acknowledged')
    await invalidateMembershipSnapshots(projectId, origin)
    await origin.api.projects.removeMember(projectId, userId)
    await requireProducerCurrent(origin)
  }
}
