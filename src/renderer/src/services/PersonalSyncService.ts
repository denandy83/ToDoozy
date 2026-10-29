import { syncTaskLabelChoices } from './taskLabelAdditions'
import { requireSession } from './sessionRecovery'
import { useAuthStore } from '../shared/stores/authStore'
import { markSynced, refreshProducerPending, reportPushFailure } from './syncFeedback'
import { remoteTaskOrder } from './remoteTaskOrder'
import { readAll, readAllIn } from './readAll'
import { captureSyncContext, captureSyncProducer, withSyncProducer, type SyncContext, type SyncProducer } from './syncContext'
/**
 * PersonalSyncService — handles syncing personal (non-shared) project data
 * and user-level data (settings, themes, saved views, areas, labels) to Supabase.
 *
 * SQLite is always the source of truth. Every local write pushes to Supabase
 * in the background. On new device, all data is pulled from Supabase.
 */
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase, safeRefresh } from '../lib/supabase'
import { useSyncStore } from '../shared/stores/syncStore'
import { logEvent } from '../shared/stores/logStore'
import type { Task, Status, Label } from '../../../shared/types'
import { placeholderEmail } from '../../../shared/placeholderUser'
import { currentProjectLink, projectLinkSuperseded, writeProjectLabelChoices } from './projectLabelIntent'
import { SYNC_TABLES, reconcileTable, pullActivityLogForProject } from './syncTables'
import { isSuspended } from './powerState'
import { isSettingSyncExcluded } from './settingsSyncPolicy'
import { builtinTheme, canSyncTheme } from '../../../shared/themeCatalog'

/**
 * Returns true if a live Supabase session exists. All push/delete functions
 * call this before issuing a write — without it, the request would go out
 * unauthenticated and Supabase would reject it with RLS 42501. Skipping
 * cleanly is preferable to spamming error logs; the change stays in local
 * SQLite and the post-recovery reconcile picks it up.
 */
async function hasLiveSession(origin: SyncProducer, context: string, idDescriptor: string): Promise<boolean> {
  const client = await origin.client()
  if (!client) {
    if (!await origin.isCurrent()) return false
    logEvent('warn', 'sync', `${context} waiting — no session`, idDescriptor)
    useSyncStore.getState().setStatus('offline')
    return false
  }
  return true
}

/** Track consecutive auth failures — surface after 2 in a row to avoid false alarms */
let authFailureCount = 0
let refreshAttemptedThisCycle = false

async function attemptSessionRefresh(): Promise<boolean> {
  if (refreshAttemptedThisCycle) return false
  refreshAttemptedThisCycle = true
  try {
    // safeRefresh serializes against autoRefreshToken via the authMutex and
    // persists the rotated tokens itself. A bare auth.refreshSession() here can
    // race the auto-refresher on the same refresh_token — the loser gets
    // refresh_token_already_used and the whole session chain dies.
    const session = await safeRefresh()
    if (!session) {
      console.error('[PersonalSync] Session refresh failed')
      return false
    }
    console.log('[PersonalSync] Session refreshed successfully')
    authFailureCount = 0
    return true
  } catch (err) {
    console.error('[PersonalSync] Session refresh threw:', err)
    return false
  }
}

/** Reset the refresh gate so next sync cycle can attempt again */
export function resetRefreshGate(): void {
  refreshAttemptedThisCycle = false
}

async function handlePullError(origin: SyncContext | undefined, name: string, error: unknown): Promise<void> {
  if (origin && await origin.isCurrent()) handleSyncError(name, error, origin)
}

function handleSyncError(context: string, error: { message?: string; code?: string; status?: number } | unknown, origin?: SyncContext): void {
  const err = error as { message?: string; code?: string; status?: number }
  const isAuth = err?.status === 401 || err?.status === 403 || err?.code === 'PGRST301' || err?.code === '42501'
    || err?.message?.includes('JWT') || err?.message?.includes('expired')
    || err?.message?.includes('unauthorized') || err?.message?.includes('row-level security')
  if (isAuth) {
    authFailureCount++
    if (authFailureCount >= 2) {
      // Try to refresh the session automatically before surfacing error
      attemptSessionRefresh().then(async (refreshed) => {
        if (origin && !await origin.isCurrent()) return
        if (!refreshed) {
          useSyncStore.getState().setError('Authentication expired — sign out and back in to restore sync')
        }
      })
    }
    console.error(`[PersonalSync] Auth failure in ${context}:`, err)
  } else {
    console.error(`[PersonalSync] ${context} failed:`, err)
  }
}

function clearAuthFailures(): void {
  if (authFailureCount > 0) {
    authFailureCount = 0
    const store = useSyncStore.getState()
    if (store.status === 'error' && store.errorMessage?.includes('Authentication')) {
      store.setError(null)
    }
  }
}

/** Track which projects have been confirmed in Supabase this session */
const confirmedProjects = new Set<string>()

/** Recently deleted task IDs — prevents pull from resurrecting tasks before Supabase delete completes */
const recentlyDeletedIds = new Set<string>()

/** Per-project timestamp of last successful pull — only fetch rows modified after this */
const lastPullAt = new Map<string, string>()

/** Debounce buffer for settings writes — collects changes over 5s then pushes once */
const pendingSettings = new Map<string, { key: string; value: string; userId: string; origin: SyncProducer }>()
let settingsFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushSettingsBuffer(): void {
  const entries = [...pendingSettings.values()]
  pendingSettings.clear()
  settingsFlushTimer = null
  for (const entry of entries) {
    void pushSettingImmediate(entry.key, entry.value, entry.userId, entry.origin)
  }
}

/** Cache of project ID → name for readable logs */
const projectNameCache = new Map<string, string>()

export function cacheProjectNames(projects: Array<{ id: string; name: string }>): void {
  for (const p of projects) projectNameCache.set(p.id, p.name)
}

/** Lookup a cached project name; returns the id back unchanged when unknown. */
export function getCachedProjectName(id: string): string | null {
  return projectNameCache.get(id) ?? null
}

/**
 * Split an array into fixed-size chunks. Pure helper extracted for testability —
 * used to batch task_labels upserts within Supabase's per-request row limits
 * instead of one round-trip per row. A non-positive size yields a single chunk.
 */
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) return items.length > 0 ? [items] : []
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/** Ensure a project + membership exists in Supabase before pushing tasks/statuses */
async function ensureProjectInSupabase(projectId: string, origin: SyncProducer): Promise<void> {
  const key = `${origin.userId}:${projectId}`
  if (confirmedProjects.has(key)) return

  const project = await origin.api.projects.findById(projectId)
  if (!project) return

  await pushProject(project, origin)
  if (await origin.isCurrent()) confirmedProjects.add(key)
}

// ── Push Operations ──────────────────────────────────────────────────

/**
 * Push a single task to Supabase (upsert).
 */
export async function pushTask(task: Task, producer?: SyncProducer): Promise<void> {
  return withSyncProducer(async (origin) => {
    if (!(await hasLiveSession(origin, 'pushTask', `task=${task.id}`))) {
      await origin.api.sync.enqueue('tasks', task.id, 'UPDATE', JSON.stringify(task))
      await refreshProducerPending(origin)
      if (await origin.isCurrent() && useSyncStore.getState().status === 'synced') useSyncStore.getState().setStatus('syncing')
      return
    }
    try {
      const supabase = (await origin.client())!

      // Ensure the project exists in Supabase (RLS requires project_members entry)
      await ensureProjectInSupabase(task.project_id, origin)

      const payload = {
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
        is_in_my_day: task.is_in_my_day ?? 0,
        completed_date: task.completed_date,
        recurrence_rule: task.recurrence_rule,
        reference_url: task.reference_url,
        my_day_dismissed_date: task.my_day_dismissed_date ?? null,
        created_at: task.created_at,
        updated_at: task.updated_at
      }
      const { error } = await supabase.from('tasks').upsert(payload)
      if (error) {
        await reportPushFailure(origin, 'pushTask', error, 'tasks', task.id, JSON.stringify(payload))
      } else {
        await markSynced(origin)
        logEvent('info', 'sync', `Pushed task "${task.title}"`, `id=${task.id} project=${task.project_id}`)
        await syncTaskLabelChoices(supabase,[task.id],origin.api,await origin.scope())
        // Flag pushes of is_archived on shared projects — after the v1.4.3 fix this
        // should never happen from auto-archive, so any occurrence warrants a look.
        if (task.is_archived === 1) {
          const project = await origin.api.projects.findById(task.project_id)
          if (project?.is_shared === 1) {
            logEvent('warn', 'sync', `Pushed is_archived=1 on shared task "${task.title}"`, `task=${task.id} project=${task.project_id}`)
          }
        }
      }
    } catch (err) {
      await reportPushFailure(origin, 'pushTask', err, 'tasks', task.id, JSON.stringify(task))
    }
  }, producer)
}

/**
 * Soft-delete a task in Supabase. Sets deleted_at + updated_at; the row stays
 * for 30 days so other devices observe the tombstone before purge runs.
 */
export async function deleteTaskFromSupabase(taskId: string, producer?: SyncProducer): Promise<void> {
  return withSyncProducer(async (origin) => {
    recentlyDeletedIds.add(taskId)
    if (!(await hasLiveSession(origin, 'deleteTask', `task=${taskId}`))) return
    try {
      const supabase = (await origin.client())!
      const local = await origin.api.tasks.findById(taskId)
      if (!local?.deleted_at) throw new Error('Task deletion intent missing')
      const { error } = await supabase
        .from('tasks')
        .update({ deleted_at: local.deleted_at, updated_at: local.updated_at })
        .eq('id', taskId)
      if (error) {
        await reportPushFailure(origin, 'deleteTask', error, 'tasks', taskId, JSON.stringify({ id: taskId }), 'DELETE')
      } else {
        await markSynced(origin)
        logEvent('info', 'sync', 'Soft-deleted task', `id=${taskId}`)
      }
    } catch (err) {
      await reportPushFailure(origin, 'deleteTask', err, 'tasks', taskId, JSON.stringify({ id: taskId }), 'DELETE')
    }
  }, producer)
}

/**
 * Push a status to Supabase.
 */
export async function pushStatus(status: Status, producer?: SyncProducer): Promise<void> {
  return withSyncProducer(async (origin) => {
    const payload = {
      id: status.id,
      project_id: status.project_id,
      name: status.name,
      color: status.color,
      icon: status.icon,
      order_index: status.order_index,
      is_done: status.is_done,
      is_default: status.is_default,
      created_at: status.created_at,
      updated_at: status.updated_at
    }
    if (!(await hasLiveSession(origin, 'pushStatus', `status=${status.id}`))) {
      await origin.api.sync.enqueue('statuses', status.id, 'UPDATE', JSON.stringify(payload))
      await refreshProducerPending(origin)
      return
    }
    try {
      await ensureProjectInSupabase(status.project_id, origin)
      const supabase = (await origin.client())!
      const { error } = await supabase.from('statuses').upsert(payload)
      if (error) {
        await reportPushFailure(origin, 'pushStatus', error, 'statuses', status.id, JSON.stringify(payload))
      } else {
        await markSynced(origin)
        logEvent('info', 'sync', `Pushed status "${status.name}"`, `id=${status.id} project=${status.project_id}`)
      }
    } catch (err) {
      await reportPushFailure(origin, 'pushStatus', err, 'statuses', status.id, JSON.stringify(payload))
    }
  }, producer)
}

/**
 * Push a label to user_labels in Supabase.
 */
export async function pushLabel(label: Label, userId: string, producer?: SyncProducer): Promise<string | undefined> {
  let effectiveId: string | undefined
  await withSyncProducer(async (origin) => {
    if (origin.userId !== userId) return
    const payload = {
      id: label.id,
      user_id: userId,
      name: label.name,
      color: label.color,
      order_index: label.order_index,
      updated_at: label.updated_at,
      deleted_at: label.deleted_at ?? null
    }
    if (!(await hasLiveSession(origin, 'pushLabel', `label=${label.id}`))) {
      await origin.api.sync.enqueue('user_labels', label.id, 'UPDATE', JSON.stringify(payload))
      await refreshProducerPending(origin)
      return
    }
    try {
      const supabase = (await origin.client())!
      const { error } = await supabase.from('user_labels').upsert(payload)
      if (error) {
        // Any upsert error is a consolidation candidate (see syncTables
        // remoteUpsert for the two collision shapes): a (user_id, lower(name))
        // UNIQUE violation, OR an ON CONFLICT(id) overwrite of a row owned by the
        // user's alt account that fails on RLS (the task d5b138b1 divergence —
        // not a 23505). consolidateLabelOnRemote collapses the local row onto the
        // user's OWN canonical by name when one exists; otherwise it returns
        // false and we report the original push failure.
        const consolidated = await consolidateLabelOnRemote(label, userId, origin)
        if (consolidated) { effectiveId = consolidated; return }
        await reportPushFailure(origin, 'pushLabel', error, 'user_labels', label.id, JSON.stringify(payload))
      } else {
        await markSynced(origin)
        effectiveId = label.id
        logEvent('info', 'sync', `Pushed label "${label.name}"`, `id=${label.id}`)
      }
    } catch (err) {
      await reportPushFailure(origin, 'pushLabel', err, 'user_labels', label.id, JSON.stringify(payload))
    }
  }, producer)
  return effectiveId
}

/**
 * Resolve a (user_id, lower(name)) collision: fetch the canonical remote
 * label by name and remap local junction tables to use its ID, then drop
 * the local label. Returns true if consolidation succeeded.
 */
async function consolidateLabelOnRemote(localLabel: Label, userId: string, origin: SyncProducer): Promise<string | false> {
  try {
    const supabase = (await origin.client())!
    // Need the full row — consolidate has to insert it locally before the
    // junction remap can run (FK to labels.id).
    const { data: remote } = await supabase
      .from('user_labels')
      .select('*')
      .eq('user_id', userId)
      .ilike('name', localLabel.name)
      .limit(1)
      .maybeSingle()
    if (!remote || (remote.id as string) === localLabel.id) return false
    if (remote.deleted_at) {
      const { error: reviveError } = await supabase
        .from('user_labels')
        .update({ deleted_at: null, updated_at: new Date().toISOString() })
        .eq('id', remote.id as string)
      if (reviveError) throw new Error(reviveError.message)
      remote.deleted_at = null
    }
    const r = remote as Record<string, unknown>
    const canonicalLabel: Label = {
      id: String(r.id),
      user_id: r.user_id == null ? null : String(r.user_id),
      name: String(r.name ?? ''),
      color: String(r.color ?? '#888888'),
      order_index: Number(r.order_index ?? 0),
      created_at: String(r.created_at ?? new Date().toISOString()),
      updated_at: String(r.updated_at ?? new Date().toISOString()),
      deleted_at: r.deleted_at == null ? null : String(r.deleted_at)
    }
    const result = await origin.api.labels.consolidate(localLabel.id, canonicalLabel)
    logEvent(
      'info',
      'sync',
      `Consolidated local label "${localLabel.name}" onto remote ID`,
      `local=${localLabel.id} → remote=${remote.id} taskRemaps=${result.taskRemaps} projectRemaps=${result.projectRemaps}`
    )
    await markSynced(origin)
    return canonicalLabel.id
  } catch (err) {
    console.warn('[PersonalSync] Failed to consolidate label on remote:', err)
    return false
  }
}

/**
 * Push a single project↔label association change to Supabase. `deletedAt`
 * NULL = active link, ISO string = tombstone. The junction table is the
 * source of truth; the legacy `projects.label_data` JSON is no longer read
 * or written by this client (kept on Supabase for one release for safety).
 */
export async function pushProjectLabel(
  projectId: string,
  labelId: string,
  deletedAt: string | null,
  producer?: SyncProducer
): Promise<string | undefined> {
  let effectiveId = labelId
  await withSyncProducer(async (origin) => {
    const expectedLink = deletedAt ? await currentProjectLink(projectId, labelId, origin.api) : undefined
    if (!(await hasLiveSession(origin, 'pushProjectLabel', `${projectId}::${labelId}`))) {
      const localLabel = await origin.api.labels.findById(labelId)
      if (!deletedAt && localLabel && localLabel.user_id === origin.userId) await pushLabel(localLabel, origin.userId, origin)
      await origin.api.sync.enqueue('project_labels', `${projectId}::${labelId}`, 'UPDATE', JSON.stringify({ projectId, labelId, deletedAt, ...(expectedLink !== undefined ? { expectedLink } : {}) }))
      await refreshProducerPending(origin)
      return
    }
    try {
      // Pre-flight: ensure the label row exists in user_labels on Supabase
      // before pushing the junction row. Without this, project_labels.label_id
      // can FK-reject (23503) for labels that exist locally but were never
      // pushed (silent pushLabel failure, or labels that pre-date sync). Only
      // push labels owned by the current authed user — we can't write rows
      // into another user's user_labels (RLS), and if the label belongs to
      // another user it should already be on Supabase from their push.
      const localLabel = await origin.api.labels.findById(labelId)
      if (!deletedAt && localLabel) {
        const { useAuthStore } = await import('../shared/stores/authStore')
        const authedUserId = useAuthStore.getState().currentUser?.id ?? null
        if (authedUserId && localLabel.user_id === authedUserId) {
          labelId = await pushLabel(localLabel, authedUserId, origin) ?? labelId
          effectiveId = labelId
        }
      }

      const current = await currentProjectLink(projectId, labelId, origin.api)
      if (deletedAt) {
        if (projectLinkSuperseded(current, expectedLink!)) return
      } else {
        if (!current) return
        if (current.deleted_at) return
      }
      const supabase = (await origin.client())!
      if (!deletedAt && (await origin.api.sync.getQueue()).some((entry) => entry.table_name === 'project_labels' && JSON.parse(entry.payload).addition && JSON.parse(entry.payload).projectId === projectId && JSON.parse(entry.payload).labelId === labelId)) {
        const { processSyncQueue } = await import('./SyncService')
        await processSyncQueue({api:origin.api,client:supabase,assertCurrent:origin.assertCurrent,isCurrent:origin.isCurrent,scope:await origin.scope()})
        return
      }
      await writeProjectLabelChoices(supabase,origin.api,[{project_id:projectId,label_id:labelId,created_at:current!.created_at,deleted_at:deletedAt}],origin.assertCurrent)
      await markSynced(origin)
    } catch (err) {
      await reportPushFailure(origin,
        'pushProjectLabel',
        err,
        'project_labels',
        `${projectId}::${labelId}`,
        JSON.stringify({ projectId, labelId, deletedAt, ...(expectedLink !== undefined ? { expectedLink } : {}) })
      )
    }
  }, producer)
  return effectiveId
}

/**
 * Cascade a "remove label from project" to Supabase: tombstone the
 * project_labels junction row AND hard-delete every task_labels row in
 * the project that referenced the label. Without the task_labels cascade,
 * other members' apps still see the label on tasks because their reconcile
 * pulls live task_labels rows back, even though the project_labels link
 * is tombstoned. (Remote task_labels has no `deleted_at`, so cleanup must
 * be a hard DELETE rather than a tombstone.)
 */
export async function pushRemoveLabelFromProject(projectId: string, labelId: string): Promise<void> {
  return withSyncProducer(async (origin) => {
    if (!(await origin.api.sync.getQueue()).some((entry) => { const intent = JSON.parse(entry.payload); return entry.table_name === 'task_labels' && intent.remove_project_label && intent.projectId === projectId && intent.labelId === labelId })) return
    const { processSyncQueue, getOnlineStatus } = await import('./SyncService')
    if (!getOnlineStatus()) { await refreshProducerPending(origin); return }
    const client = await origin.client()
    if (!client) { await refreshProducerPending(origin); return }
    if (!await origin.isCurrent()) return
    await processSyncQueue({ api: origin.api, client, assertCurrent: origin.assertCurrent, isCurrent: origin.isCurrent, scope: await origin.scope() })
  })
}

/**
 * Soft-delete a label in Supabase by stamping deleted_at + updated_at.
 * Hard-DELETE is reserved for the 30-day purge job; tombstones are how
 * other devices learn the label is gone (Realtime UPDATE event).
 */
export async function deleteLabelFromSupabase(labelId: string): Promise<void> {
  return withSyncProducer(async (origin) => {
    if (!(await hasLiveSession(origin, 'deleteLabel', `label=${labelId}`))) return
    try {
      const supabase = (await origin.client())!
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('user_labels')
        .update({ deleted_at: now, updated_at: now })
        .eq('id', labelId)
      if (error) {
        await reportPushFailure(origin, 'deleteLabel', error, 'user_labels', labelId, JSON.stringify({ id: labelId, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }), 'UPDATE')
      } else {
        await markSynced(origin)
        logEvent('info', 'sync', 'Soft-deleted label', `id=${labelId}`)
      }
    } catch (err) {
      await reportPushFailure(origin, 'deleteLabel', err, 'user_labels', labelId, JSON.stringify({ id: labelId, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }), 'UPDATE')
    }
  })
}

/**
 * Push a setting to user_settings in Supabase (immediate, no debounce).
 */
async function pushSettingImmediate(key: string, value: string, userId: string, producer?: SyncProducer): Promise<void> {
  return withSyncProducer(async (origin) => {
    if (origin.userId !== userId) return
    // Never let a bearer secret (api_key) reach the cloud user_settings table —
    // covers the first-time fullUpload path and the debounced flush (#98/#114).
    if (isSettingSyncExcluded(key)) return
    const id = `${userId}:${key}`
    const payload = {
      id,
      user_id: userId,
      key,
      value,
      updated_at: new Date().toISOString()
    }
    if (!(await hasLiveSession(origin, 'pushSetting', `id=${id}`))) {
      await origin.api.sync.enqueue('user_settings', id, 'UPDATE', JSON.stringify(payload))
      await refreshProducerPending(origin)
      return
    }
    try {
      const supabase = (await origin.client())!
      const { error } = await supabase.from('user_settings').upsert(payload)
      if (error) await reportPushFailure(origin, 'pushSetting', error, 'user_settings', id, JSON.stringify(payload))
      else {
        await markSynced(origin)
        logEvent('info', 'sync', `Pushed setting "${key}"`, `id=${id}`)
      }
    } catch (err) {
      await reportPushFailure(origin, 'pushSetting', err, 'user_settings', id, JSON.stringify(payload))
    }
  }, producer)
}

/**
 * Push a setting to Supabase with 5s debounce to batch rapid changes.
 */
export function pushSetting(key: string, value: string, userId: string): void {
  // Defense-in-depth: excluded keys (api_key) are device-local secrets and must
  // never be buffered/flushed to Supabase user_settings (#98/#114).
  if (isSettingSyncExcluded(key)) return
  pendingSettings.set(`${userId}:${key}`, { key, value, userId, origin: captureSyncProducer() })
  if (settingsFlushTimer) clearTimeout(settingsFlushTimer)
  settingsFlushTimer = setTimeout(flushSettingsBuffer, 5_000)
}

/**
 * Push a saved view to user_saved_views in Supabase.
 */
export async function pushSavedView(view: {
  id: string
  user_id: string
  name: string
  filter_config: string
  project_id: string | null
  sidebar_order: number
  color: string | null
  deleted_at?: string | null
}): Promise<void> {
  return withSyncProducer(async (origin) => {
    const payload = {
      ...view,
      deleted_at: view.deleted_at ?? null,
      updated_at: new Date().toISOString()
    }
    if (!(await hasLiveSession(origin, 'pushSavedView', `id=${view.id}`))) return
    try {
      const supabase = (await origin.client())!
      const { error } = await supabase.from('user_saved_views').upsert(payload)
      if (error) await reportPushFailure(origin, 'pushSavedView', error, 'user_saved_views', view.id, JSON.stringify(payload))
      else {
        await markSynced(origin)
        logEvent('info', 'sync', `Pushed saved view "${view.name}"`, `id=${view.id}`)
      }
    } catch (err) {
      await reportPushFailure(origin, 'pushSavedView', err, 'user_saved_views', view.id, JSON.stringify(payload))
    }
  })
}

/**
 * Push a project area to user_project_areas in Supabase.
 */
export async function pushProjectArea(area: {
  id: string
  user_id: string
  name: string
  icon: string | null
  color: string | null
  sidebar_order: number
  is_collapsed: number
  deleted_at?: string | null
}): Promise<void> {
  return withSyncProducer(async (origin) => {
    const payload = {
      ...area,
      deleted_at: area.deleted_at ?? null,
      updated_at: new Date().toISOString()
    }
    if (!(await hasLiveSession(origin, 'pushProjectArea', `id=${area.id}`))) return
    try {
      const supabase = (await origin.client())!
      const { error } = await supabase.from('user_project_areas').upsert(payload)
      if (error) await reportPushFailure(origin, 'pushProjectArea', error, 'user_project_areas', area.id, JSON.stringify(payload))
      else {
        await markSynced(origin)
        logEvent('info', 'sync', `Pushed project area "${area.name}"`, `id=${area.id}`)
      }
    } catch (err) {
      await reportPushFailure(origin, 'pushProjectArea', err, 'user_project_areas', area.id, JSON.stringify(payload))
    }
  })
}

/**
 * Push a project template (full project blueprint stored as JSON in `data`).
 * v1.5.1 promoted this table from local-only to synced.
 */
export async function pushProjectTemplate(template: {
  id: string
  name: string
  color: string
  owner_id: string
  data: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}): Promise<void> {
  return withSyncProducer(async (origin) => {
    if (!(await hasLiveSession(origin, 'pushProjectTemplate', `template=${template.id}`))) return
    try {
      const supabase = (await origin.client())!
      const { error } = await supabase.from('project_templates').upsert(template)
      if (error) {
        await reportPushFailure(origin,
          'pushProjectTemplate',
          error,
          'project_templates',
          template.id,
          JSON.stringify(template)
        )
      } else {
        await markSynced(origin)
        logEvent('info', 'sync', `Pushed project template "${template.name}"`, `id=${template.id}`)
      }
    } catch (err) {
      await reportPushFailure(origin,
        'pushProjectTemplate',
        err,
        'project_templates',
        template.id,
        JSON.stringify(template)
      )
    }
  })
}

/**
 * Soft-delete a project template on Supabase.
 */
export async function deleteProjectTemplateFromSupabase(templateId: string): Promise<void> {
  return withSyncProducer(async (origin) => {
    const now = new Date().toISOString()
    const payload = { deleted_at: now, updated_at: now }
    if (!(await hasLiveSession(origin, 'deleteProjectTemplate', `id=${templateId}`))) return
    try {
      const supabase = (await origin.client())!
      const { error } = await supabase.from('project_templates').update(payload).eq('id', templateId)
      if (error) {
        await reportPushFailure(origin,
          'deleteProjectTemplate',
          error,
          'project_templates',
          templateId,
          JSON.stringify(payload),
          'UPDATE'
        )
      } else {
        await markSynced(origin)
        logEvent('info', 'sync', 'Soft-deleted project template', `id=${templateId}`)
      }
    } catch (err) {
      await reportPushFailure(origin,
        'deleteProjectTemplate',
        err,
        'project_templates',
        templateId,
        JSON.stringify(payload),
        'UPDATE'
      )
    }
  })
}

/**
 * Delete a saved view from Supabase.
 */
export async function deleteSavedViewFromSupabase(viewId: string): Promise<void> {
  return withSyncProducer(async (origin) => {
    const now = new Date().toISOString()
    const payload = { deleted_at: now, updated_at: now }
    if (!(await hasLiveSession(origin, 'deleteSavedView', `id=${viewId}`))) return
    try {
      const supabase = (await origin.client())!
      const { error } = await supabase.from('user_saved_views').update(payload).eq('id', viewId)
      if (error) {
        await reportPushFailure(origin, 'deleteSavedView', error, 'user_saved_views', viewId, JSON.stringify(payload), 'UPDATE')
      } else {
        await markSynced(origin)
        logEvent('info', 'sync', 'Soft-deleted saved view', `id=${viewId}`)
      }
    } catch (err) {
      await reportPushFailure(origin, 'deleteSavedView', err, 'user_saved_views', viewId, JSON.stringify(payload), 'UPDATE')
    }
  })
}

/**
 * Delete a project area from Supabase.
 */
export async function deleteProjectAreaFromSupabase(areaId: string): Promise<void> {
  return withSyncProducer(async (origin) => {
    const now = new Date().toISOString()
    const payload = { deleted_at: now, updated_at: now }
    if (!(await hasLiveSession(origin, 'deleteProjectArea', `id=${areaId}`))) return
    try {
      const supabase = (await origin.client())!
      const { error } = await supabase.from('user_project_areas').update(payload).eq('id', areaId)
      if (error) {
        await reportPushFailure(origin, 'deleteProjectArea', error, 'user_project_areas', areaId, JSON.stringify(payload), 'UPDATE')
      } else {
        await markSynced(origin)
        logEvent('info', 'sync', 'Soft-deleted project area', `id=${areaId}`)
      }
    } catch (err) {
      await reportPushFailure(origin, 'deleteProjectArea', err, 'user_project_areas', areaId, JSON.stringify(payload), 'UPDATE')
    }
  })
}

/**
 * Push a theme to user_themes in Supabase.
 */
export async function pushTheme(theme: {
  id: string
  user_id: string
  name: string
  mode: string
  bg: string
  fg: string
  fg_secondary: string
  fg_muted: string
  muted: string
  accent: string
  accent_fg: string
  border: string
  sidebar?: string
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
}): Promise<void> {
  if (builtinTheme(theme.name, theme.mode) && !theme.deleted_at) return
  return withSyncProducer(async (origin) => {
    const now = new Date().toISOString()
    const payload = {
      id: theme.id,
      user_id: theme.user_id,
      name: theme.name,
      mode: theme.mode,
      bg: theme.bg,
      fg: theme.fg,
      fg_secondary: theme.fg_secondary,
      fg_muted: theme.fg_muted,
      muted: theme.muted,
      accent: theme.accent,
      accent_fg: theme.accent_fg,
      // Legacy column, still NOT NULL — kept in sync with fg_secondary.
      surface: theme.fg_secondary,
      border: theme.border,
      sidebar: theme.sidebar ?? null,
      created_at: theme.created_at ?? now,
      updated_at: theme.updated_at ?? now,
      deleted_at: theme.deleted_at ?? null
    }
    if (!(await hasLiveSession(origin, 'pushTheme', `id=${theme.id}`))) return
    try {
      const supabase = (await origin.client())!
      const { error } = await supabase.from('user_themes').upsert(payload)
      if (error) await reportPushFailure(origin, 'pushTheme', error, 'user_themes', theme.id, JSON.stringify(payload))
      else {
        await markSynced(origin)
        logEvent('info', 'sync', `Pushed theme "${theme.name}"`, `id=${theme.id} mode=${theme.mode}`)
      }
    } catch (err) {
      await reportPushFailure(origin, 'pushTheme', err, 'user_themes', theme.id, JSON.stringify(payload))
    }
  })
}

/**
 * Soft-delete a theme in Supabase by stamping deleted_at + updated_at.
 * Hard-DELETE is reserved for the 30-day purge job; tombstones propagate
 * via Realtime UPDATE so other devices can drop the row.
 */
export async function deleteThemeFromSupabase(themeId: string): Promise<void> {
  return withSyncProducer(async (origin) => {
    if (!(await hasLiveSession(origin, 'deleteTheme', `id=${themeId}`))) return
    try {
      const supabase = (await origin.client())!
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('user_themes')
        .update({ deleted_at: now, updated_at: now })
        .eq('id', themeId)
      if (error) {
        await reportPushFailure(origin, 'deleteTheme', error, 'user_themes', themeId, JSON.stringify({ id: themeId, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }), 'UPDATE')
      } else {
        await markSynced(origin)
        logEvent('info', 'sync', 'Soft-deleted theme', `id=${themeId}`)
      }
    } catch (err) {
      await reportPushFailure(origin, 'deleteTheme', err, 'user_themes', themeId, JSON.stringify({ id: themeId, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }), 'UPDATE')
    }
  })
}

/**
 * Soft-delete a setting in Supabase by stamping deleted_at + updated_at.
 * Hard-DELETE is reserved for the 30-day purge job.
 */
export async function deleteSettingFromSupabase(key: string, userId: string): Promise<void> {
  return withSyncProducer(async (origin) => {
    const id = `${userId}:${key}`
    if (!(await hasLiveSession(origin, 'deleteSetting', `id=${id}`))) return
    try {
      const supabase = (await origin.client())!
      const now = new Date().toISOString()
      const { error } = await supabase
        .from('user_settings')
        .update({ deleted_at: now, updated_at: now })
        .eq('id', id)
      if (error) {
        await reportPushFailure(origin, 'deleteSetting', error, 'user_settings', id, JSON.stringify({ id, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }), 'UPDATE')
      } else {
        await markSynced(origin)
        logEvent('info', 'sync', `Soft-deleted setting "${key}"`, `id=${id}`)
      }
    } catch (err) {
      await reportPushFailure(origin, 'deleteSetting', err, 'user_settings', id, JSON.stringify({ id, deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }), 'UPDATE')
    }
  })
}

/**
 * Soft-delete a status in Supabase by setting deleted_at. Hard-DELETE is reserved
 * for the 30-day purge job — a soft tombstone propagates via Realtime UPDATE.
 */
export async function deleteStatusFromSupabase(statusId: string, producer?: SyncProducer): Promise<void> {
  return withSyncProducer(async (origin) => {
    const queue = await origin.api.sync.getQueue()
    if (!queue.some((entry) => entry.table_name === 'statuses' && entry.row_id === statusId && JSON.parse(entry.payload).status_delete === true)) throw new Error('Status deletion requires a durable replacement')
    const { processSyncQueue, getOnlineStatus } = await import('./SyncService')
    if (!getOnlineStatus()) { await refreshProducerPending(origin); return }
    const client = await origin.client()
    if (!client) { await refreshProducerPending(origin); return }
    if (!await origin.isCurrent()) return
    await processSyncQueue({ api: origin.api, client, assertCurrent: origin.assertCurrent, isCurrent: origin.isCurrent, scope: await origin.scope() })
  }, producer)
}

/**
 * Soft-delete a project in Supabase (and cascade tombstones to its tasks/statuses).
 * Hard-DELETE is reserved for the 30-day purge job — a soft tombstone propagates
 * via Realtime UPDATE.
 *
 * project_members are physically removed: there's no `deleted_at` on the join row,
 * and a tombstoned project means no member should still see it. Membership rows
 * have no separate sync identity.
 */
export async function deleteProjectFromSupabase(projectId: string): Promise<void> {
  return withSyncProducer(async (origin) => {
    const now = new Date().toISOString()
    if (!(await hasLiveSession(origin, 'deleteProject', `id=${projectId}`))) return
    try {
      const supabase = (await origin.client())!

      // Cascade tombstones to children first so any device pulling sees consistent state.
      const { error: tasksErr } = await supabase
        .from('tasks')
        .update({ deleted_at: now, updated_at: now })
        .eq('project_id', projectId)
        .is('deleted_at', null)
      if (tasksErr) {
        logEvent('error', 'sync', `deleteProject tasks soft-delete error: ${tasksErr.message}`, `project=${projectId}`)
        if (await origin.isCurrent()) useSyncStore.getState().setError(tasksErr.message)
        return
      }

      const { error: stsErr } = await supabase
        .from('statuses')
        .update({ deleted_at: now, updated_at: now })
        .eq('project_id', projectId)
        .is('deleted_at', null)
      if (stsErr) {
        logEvent('error', 'sync', `deleteProject statuses soft-delete error: ${stsErr.message}`, `project=${projectId}`)
        if (await origin.isCurrent()) useSyncStore.getState().setError(stsErr.message)
        return
      }

      // project_members is a junction without sync identity — physical remove is fine.
      const { error: memberErr } = await supabase.from('project_members').delete().eq('project_id', projectId)
      if (memberErr) {
        logEvent('error', 'sync', `deleteProject members error: ${memberErr.message}`, `project=${projectId}`)
        if (await origin.isCurrent()) useSyncStore.getState().setError(memberErr.message)
        return
      }

      const { error: projErr } = await supabase
        .from('projects')
        .update({ deleted_at: now, updated_at: now })
        .eq('id', projectId)
      if (projErr) {
        logEvent('error', 'sync', `deleteProject error: ${projErr.message}`, `project=${projectId}`)
        if (await origin.isCurrent()) useSyncStore.getState().setError(projErr.message)
      } else {
        logEvent('info', 'sync', `Soft-deleted project`, `id=${projectId}`)
        await markSynced(origin)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'deleteProject threw'
      console.error('[PersonalSync] deleteProject failed:', err)
      logEvent('error', 'sync', `deleteProject threw: ${msg}`, `project=${projectId}`)
      if (await origin.isCurrent()) useSyncStore.getState().setError(msg)
    }
  })
}

// ── Project Push ─────────────────────────────────────────────────────

/**
 * Push a personal project (and its owner as member) to Supabase.
 */
export async function pushProject(project: {
  id: string
  name: string
  description: string | null
  color: string
  icon: string
  owner_id: string
  is_default: number
  sidebar_order: number
  area_id: string | null
  auto_archive_enabled?: number
  auto_archive_value?: number
  auto_archive_unit?: string
  is_archived?: number
  archive_updated_at?: string | null
  created_at: string
  updated_at: string
}, producer?: SyncProducer): Promise<void> {
  return withSyncProducer(async (origin) => {
    if (!(await hasLiveSession(origin, 'pushProject', `id=${project.id}`))) return
    try {
      const supabase = (await origin.client())!
      // Use the share_project RPC (SECURITY DEFINER) which atomically inserts
      // the project + owner membership, bypassing RLS chicken-and-egg problem
      const { error } = await supabase.rpc('share_project', {
        p_id: project.id,
        p_name: project.name,
        p_description: project.description,
        p_color: project.color ?? '#888888',
        p_icon: project.icon ?? 'folder'
      })
      if (error) {
        // RPC payload isn't a row upsert — queue won't retry it via processSyncQueue.
        // Log + setError so the user sees it; reconcile/manual force-sync will recover.
        const msg = error.message ?? 'pushProject RPC failed'
        console.error('[PersonalSync] pushProject error:', error)
        logEvent('error', 'sync', `pushProject failed: ${msg}`, `project=${project.id} code=${error.code ?? ''}`)
        if (await origin.isCurrent()) useSyncStore.getState().setError(msg)
      } else {
        await markSynced(origin)
        // Push auto-archive settings separately (not in RPC)
        if (project.auto_archive_enabled !== undefined) {
          await supabase
            .from('projects')
            .update({
              auto_archive_enabled: project.auto_archive_enabled,
              auto_archive_value: project.auto_archive_value,
              auto_archive_unit: project.auto_archive_unit
            })
            .eq('id', project.id)
        }
        if (project.is_archived !== undefined) {
          await supabase.from('projects').update({ is_archived: project.is_archived, archive_updated_at: project.archive_updated_at ?? null }).eq('id', project.id)
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'pushProject threw'
      console.error('[PersonalSync] pushProject failed:', err)
      logEvent('error', 'sync', `pushProject threw: ${msg}`, `project=${project.id}`)
      if (await origin.isCurrent()) useSyncStore.getState().setError(msg)
    }
  }, producer)
}

export async function pushProjectArchive(): Promise<void> {
  return withSyncProducer(async (origin) => {
    if (!await origin.client()) { await refreshProducerPending(origin); return }
    const { processSyncQueue } = await import('./SyncService')
    if (!await origin.isCurrent()) return
    await processSyncQueue({ api: origin.api, client: (await origin.client())!, assertCurrent: origin.assertCurrent, isCurrent: origin.isCurrent, scope: await origin.scope() })
  })
}

// ── Full Upload (first-time sync) ────────────────────────────────────

/**
 * Upload ALL local data to Supabase (first-time sync).
 * Shows progress via syncStore.
 */
export async function fullUpload(userId: string, context?: SyncContext): Promise<void> {
  const syncStore = useSyncStore.getState()
  if (!context || await context.isCurrent()) syncStore.setFirstSync(true)
  if (!context || await context.isCurrent()) syncStore.setStatus('syncing')

  try {
    context ??= await captureSyncContext()
    const { api, client: supabase } = context
    if (useAuthStore.getState().currentUser?.id !== userId) return

    // NOTE: last_sync_at is written ONLY on successful completion (end of this
    // function). It must never be claimed up-front as an in-flight sentinel —
    // if the upload throws midway, a set last_sync_at makes the next initSync
    // (which treats any truthy last_sync_at as "already fully synced") skip the
    // retry, stranding the account partially uploaded. Concurrency is instead
    // guarded by initSyncInFlight (single shared promise per process) plus the
    // Electron single-instance lock — so no parallel fullUpload can start.

    // Count total items for progress — only sync projects owned by this user
    const allProjects = await api.projects.getProjectsForUser(userId)
    const projects = allProjects.filter((p) => p.owner_id === userId)
    const allLabels = await api.labels.findAll(userId)
    const allSettings = await api.settings.getAll(userId)
    const savedViews = await api.savedViews.findByUserId(userId)

    let totalItems = projects.length + allLabels.length + allSettings.length + savedViews.length
    let completed = 0

    const updateProgress = async (): Promise<void> => {
      completed++
      if (!context || await context.isCurrent()) syncStore.setFirstSyncProgress(Math.round((completed / totalItems) * 100))
    }

    // 1. Push all labels
    for (const label of allLabels) {
      if (!await context.isCurrent()) return
      await pushLabel(label, userId)
      await updateProgress()
    }

    // 2. Push all projects (with statuses and tasks)
    for (const project of projects) {
      if (!await context.isCurrent()) return
      await pushProject(project)
      await updateProgress()

      // Push statuses
      const statuses = await api.statuses.findByProjectId(project.id)
      totalItems += statuses.length
      for (const status of statuses) {
        if (!await context.isCurrent()) return
        await pushStatus(status)
        await updateProgress()
      }

      // Push project↔label associations to the project_labels junction
      // (the legacy `projects.label_data` JSON is no longer written — the
      // junction is the source of truth, with proper tombstones + LWW).
      const projectLabels = await api.labels.findByProjectId(project.id)
      if (projectLabels.length > 0) {
        const {data: cloudLinks}=await readAll(()=>supabase.from('project_labels').select('*').eq('project_id',project.id),['project_id','label_id'])
        const rows: Array<{project_id:string;label_id:string;created_at:string;deleted_at:null}>=[]
        for (const label of projectLabels) {
          const local=await currentProjectLink(project.id,label.id,api)
          const remote=cloudLinks.find((link)=>link.label_id===label.id)
          if (local && remote && Date.parse(String(remote.deleted_at ?? remote.created_at))>Date.parse(local.deleted_at ?? local.created_at)) {
            await api.labels.applyRemoteProjectLabel(remote as unknown as {project_id:string;label_id:string;created_at:string|null;deleted_at:string|null})
            if (remote.deleted_at) await api.labels.softDeleteTaskLabelsForProjectLabel(project.id,label.id)
          } else if(local && !local.deleted_at) rows.push({project_id:project.id,label_id:label.id,created_at:local.created_at,deleted_at:null})
        }
        if (rows.length) await writeProjectLabelChoices(supabase,api,rows,context.assertCurrent)
      }

      // Push ALL tasks (including archived and templates)
      // Parent tasks first, then subtasks (to satisfy FK constraint on parent_id)
      const activeTasks = await api.tasks.findByProjectId(project.id)
      const archivedTasks = await api.tasks.findArchived(project.id)
      const templateTasks = await api.tasks.findTemplates(project.id)
      const allTasks = [...activeTasks, ...archivedTasks, ...templateTasks]
      const parentTasks = allTasks.filter((t) => !t.parent_id)
      const subtasks = allTasks.filter((t) => t.parent_id)
      const tasks = [...parentTasks, ...subtasks]
      totalItems += tasks.length
      for (const task of tasks) {
        if (!await context.isCurrent()) return
        await pushTask(task)
        await updateProgress()
      }
    }

    // 3. Push settings (immediate, not debounced — this is initial full upload)
    for (const setting of allSettings) {
      if (setting.value !== null) {
        if (!await context.isCurrent()) return
        await pushSettingImmediate(setting.key, setting.value, userId)
      }
      await updateProgress()
    }

    // 4. Push saved views
    for (const view of savedViews) {
      if (!await context.isCurrent()) return
      await pushSavedView(view)
      await updateProgress()
    }

    // 5. Push project areas
    try {
      const areas = await api.projectAreas.findByUserId(userId)
      for (const area of areas) {
        if (!await context.isCurrent()) return
        await pushProjectArea({ ...area, user_id: userId })
      }
    } catch { /* areas might not exist */ }

    // 6. Push themes (parse config JSON inline)
    try {
      const themes = await api.themes.findAllByOwner(userId, { includeTombstones: true })
      for (const theme of themes) {
        if (!canSyncTheme(theme) || theme.owner_id !== userId) continue
        try {
          const config = JSON.parse(theme.config) as Record<string, string>
          if (!await context.isCurrent()) return
          await pushTheme({
            id: theme.id,
            user_id: userId,
            name: theme.name,
            mode: theme.mode,
            bg: config.bg ?? '',
            fg: config.fg ?? '',
            fg_secondary: config.fgSecondary ?? '',
            fg_muted: config.fgMuted ?? '',
            muted: config.muted ?? '',
            accent: config.accent ?? '',
            accent_fg: config.accentFg ?? '',
            border: config.border ?? '',
            sidebar: config.sidebar,
            created_at: theme.created_at,
            updated_at: theme.updated_at,
            deleted_at: theme.deleted_at
          })
        } catch { /* skip themes with invalid config */ }
      }
    } catch { /* themes might not exist */ }

    // Verify sync by checking counts
    const { count: sbProjects } = await supabase.from('project_members').select('*', { count: 'exact', head: true }).eq('user_id', userId)
    const { count: sbStatuses } = await supabase.from('statuses').select('*', { count: 'exact', head: true })
    const { count: sbTasks } = await supabase.from('tasks').select('*', { count: 'exact', head: true })
    console.log(`[PersonalSync] Full upload done — Supabase: ${sbProjects} project memberships, ${sbStatuses} statuses, ${sbTasks} tasks (local: ${projects.length} projects, ${totalItems} total items)`)

    // Mark sync complete
    await api.settings.set(userId, 'last_sync_at', new Date().toISOString())
    if (!context || await context.isCurrent()) syncStore.setLastSynced()
    if (!context || await context.isCurrent()) syncStore.setFirstSync(false)
  } catch (err) {
    if (!context || !await context.isCurrent()) return
    console.error('[PersonalSync] Full upload failed:', err)
    if (!context || await context.isCurrent()) syncStore.setError(err instanceof Error ? err.message : 'Sync failed')
    if (!context || await context.isCurrent()) syncStore.setFirstSync(false)
  }
}

// ── Full Pull (new device) ───────────────────────────────────────────

/**
 * Pull ALL data from Supabase to populate an empty local database (new device).
 */
export async function fullPull(userId: string, context?: SyncContext): Promise<void> {
  const syncStore = useSyncStore.getState()
  if (!context || await context.isCurrent()) syncStore.setFirstSync(true)
  if (!context || await context.isCurrent()) syncStore.setStatus('syncing')

  try {
    context ??= await captureSyncContext()
    const { api, client: supabase } = context
    if (useAuthStore.getState().currentUser?.id !== userId) return

    // 1. Pull labels
    if (!context || await context.isCurrent()) syncStore.setFirstSyncProgress(10)
    const { data: remoteLabels } = await readAll(() => supabase
      .from('user_labels')
      .select('*')
      .eq('user_id', userId), ['id'])

    if (remoteLabels) {
      for (const label of remoteLabels) {
        const existing = await api.labels.findById(label.id)
        if (!existing) {
          // Dedupe: if a label with the same (user_id, name) already exists locally,
          // don't create a duplicate row — let the existing row stand. The project_labels
          // wiring below points at it via name lookup, so the duplicate Supabase row
          // becomes orphaned and gets cleaned up by the next reconcile/cleanup pass.
          const sameName = await api.labels.findByName(userId, label.name)
          if (!sameName) {
            await api.labels.create({
              id: label.id,
              user_id: userId,
              name: label.name,
              color: label.color
            })
          }
        }
      }
    }

    // 2. Pull projects
    if (!context || await context.isCurrent()) syncStore.setFirstSyncProgress(20)
    const { data: memberships } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('user_id', userId)

    if (memberships) {
      const total = memberships.length
      for (let i = 0; i < total; i++) {
        const m = memberships[i]
        const localProject = await api.projects.findById(m.project_id)
        if (!localProject) {
          // Fetch project details
          const { data: project } = await supabase
            .from('projects')
            .select('*')
            .eq('id', m.project_id)
            .single()

          if (project) {
            await api.projects.applyRemote(project)
            await api.projects.addMember(project.id, userId, project.owner_id === userId ? 'owner' : 'member')
            await api.projects.update(project.id, { is_shared: 1 })
            // Sync statuses
            const { data: statuses } = await readAll(() => supabase
              .from('statuses')
              .select('*')
              .eq('project_id', project.id), ['updated_at', 'id'])

            if (statuses) {
              for (const s of statuses) {
                await api.statuses.applyRemote(s)
              }
            }

            // Sync tasks
            const { data: tasks } = await readAll(() => supabase
              .from('tasks')
              .select('*')
              .eq('project_id', project.id), ['updated_at', 'id'])

            if (tasks) {
              // Parents before subtasks so the parent_id FK is always satisfied.
              const orderedTasks = remoteTaskOrder(tasks)
              for (const task of orderedTasks) {
                for (const userId of new Set([task.owner_id, task.assigned_to].filter((id): id is string => !!id))) {
                  if (!await api.users.findById(userId)) {
                    await api.users.create({ id: userId, email: placeholderEmail(userId), display_name: null, avatar_url: null })
                  }
                }
                await api.tasks.applyRemote(task)
              }
            }

            await pullTaskLabelsForTasks(tasks.map((task)=>task.id),userId,context)

            // Pull project↔label links from the project_labels junction
            // (preserves tombstones). The legacy projects.label_data JSON
            // is a stale snapshot and reading it here would revive
            // tombstoned links via addToProject. See SyncService.ts for
            // the same fix applied to syncProjectDown.
            const { data: remoteProjectLabels } = await readAll(() => supabase
              .from('project_labels')
              .select('project_id, label_id, created_at, deleted_at')
              .eq('project_id', project.id), ['project_id', 'label_id'])
            if (remoteProjectLabels && remoteProjectLabels.length > 0) {
              const missingLabelIds = (
                await Promise.all(
                  remoteProjectLabels.map(async (pl) => {
                    const local = await api.labels.findById(pl.label_id as string)
                    return local ? null : (pl.label_id as string)
                  })
                )
              ).filter((id): id is string => id !== null)
              if (missingLabelIds.length > 0) {
                const { data: remoteLabels } = await readAllIn(missingLabelIds, (ids) => supabase
                  .from('user_labels')
                  .select('id, name, color')
                  .in('id', ids), ['id'])
                if (remoteLabels) {
                  for (const rl of remoteLabels) {
                    const name = rl.name as string
                    const existingByName = await api.labels.findByName(userId, name).catch(() => null)
                    if (!existingByName) {
                      await api.labels.create({
                        id: rl.id as string,
                        user_id: userId,
                        name,
                        color: (rl.color as string) ?? '#888888'
                      }).catch(() => {})
                    }
                  }
                }
              }
              for (const pl of remoteProjectLabels) {
                const labelId = pl.label_id as string
                const deletedAt = (pl.deleted_at as string | null | undefined) ?? null
                const exists = await api.labels.findById(labelId).catch(() => null)
                if (!exists) continue
                await api.labels.applyRemoteProjectLabel({
                  project_id: project.id,
                  label_id: labelId,
                  created_at: (pl.created_at as string | null) ?? null,
                  deleted_at: deletedAt
                }).catch(() => {})
                if (deletedAt) {
                  await api.labels
                    .softDeleteTaskLabelsForProjectLabel(project.id, labelId)
                    .catch(() => {})
                }
              }
            }
          }
        }
        if (!context || await context.isCurrent()) syncStore.setFirstSyncProgress(20 + Math.round((i / total) * 50))
      }
    }

    // 3. Pull settings
    if (!context || await context.isCurrent()) syncStore.setFirstSyncProgress(75)
    const { data: remoteSettings } = await supabase
      .from('user_settings')
      .select('key, value')
      .eq('user_id', userId)

    if (remoteSettings) {
      for (const setting of remoteSettings) {
        // Never import a device-local secret (api_key) onto this device under the
        // real user_id. A leaked plaintext row may still exist remotely if it was
        // synced by a pre-#114 build and not yet purged; pulling it here would
        // re-establish the very leak #114 closed. Filter through the same
        // single-sourced exclusion list the push paths use.
        if (isSettingSyncExcluded(setting.key)) continue
        await api.settings.set(userId, setting.key, setting.value)
      }
    }

    // 4. Pull saved views
    if (!context || await context.isCurrent()) syncStore.setFirstSyncProgress(85)
    const { data: remoteViews } = await supabase
      .from('user_saved_views')
      .select('*')
      .eq('user_id', userId)

    if (remoteViews) {
      for (const view of remoteViews) {
        const existing = await api.savedViews.findById(view.id)
        if (!existing) {
          await api.savedViews.create({
            id: view.id,
            user_id: view.user_id,
            name: view.name,
            filter_config: view.filter_config,
            project_id: view.project_id,
            sidebar_order: view.sidebar_order
          })
        }
      }
    }

    // 5. Pull project areas
    if (!context || await context.isCurrent()) syncStore.setFirstSyncProgress(90)
    const { data: remoteAreas } = await supabase
      .from('user_project_areas')
      .select('*')
      .eq('user_id', userId)

    if (remoteAreas) {
      for (const area of remoteAreas) {
        try {
          await api.projectAreas.create({
            id: area.id,
            user_id: area.user_id,
            name: area.name,
            icon: area.icon,
            color: area.color,
            sidebar_order: area.sidebar_order
          })
        } catch { /* already exists */ }
      }
    }

    // 6. Pull custom themes
    if (!context || await context.isCurrent()) syncStore.setFirstSyncProgress(95)
    const { data: remoteThemes } = await supabase
      .from('user_themes')
      .select('*')
      .eq('user_id', userId)

    if (remoteThemes) {
      for (const theme of remoteThemes) {
        if (context && !await context.isCurrent()) return
        // The shared path preserves tombstones, sidebar, clocks and legacy preset retirement.
        await SYNC_TABLES.themes!.localApplyRemote(theme, api)
      }
    }

    // Mark sync complete
    await api.settings.set(userId, 'last_sync_at', new Date().toISOString())
    if (!context || await context.isCurrent()) syncStore.setLastSynced()
    if (!context || await context.isCurrent()) syncStore.setFirstSync(false)
    if (!context || await context.isCurrent()) syncStore.setFirstSyncProgress(100)
    console.log('[PersonalSync] Full pull complete')
  } catch (err) {
    if (!context || !await context.isCurrent()) return
    console.error('[PersonalSync] Full pull failed:', err)
    if (!context || await context.isCurrent()) syncStore.setError(err instanceof Error ? err.message : 'Sync failed')
    if (!context || await context.isCurrent()) syncStore.setFirstSync(false)
  }
}

/**
 * Pull tasks from Supabase that don't exist in local SQLite for a given project.
 * Returns the number of tasks pulled.
 */
/**
 * Pull project metadata (name, color, icon) from Supabase if newer than local.
 */
export async function pullProjectMetadata(projectId: string, context?: SyncContext): Promise<boolean> {
  try {
    context ??= await captureSyncContext()
    const api = context.api
    const supabase = context.client
    const { data: remote, error } = await supabase
      .from('projects')
      .select('name, color, icon, description, updated_at, is_archived, archive_updated_at')
      .eq('id', projectId)
      .maybeSingle()

    if (error) {
      await handlePullError(context, 'pullProjectMetadata', error)
      return false
    }
    if (!remote) return false

    const local = await api.projects.findById(projectId)
    if (!local) return false

    if (Date.parse(remote.updated_at) > Date.parse(local.updated_at) || (remote.archive_updated_at && Date.parse(remote.archive_updated_at) >= Date.parse(local.archive_updated_at ?? '1970-01-01'))) {
      await api.projects.applyRemote({ ...local, ...remote, is_archived: remote.is_archived ?? 0 })
      return true
    }
    return false
  } catch (err) {
    await handlePullError(context, 'pullProjectMetadata', err)
    return false
  }
}

/**
 * Pull statuses from Supabase and upsert locally.
 * Must run before pullNewTasks to satisfy FK constraints.
 */
export async function pullStatuses(projectId: string, context?: SyncContext): Promise<number> {
  try {
    context ??= await captureSyncContext()
    const api = context.api
    const supabase = context.client
    const since = lastPullAt.get(`${context.scope}:statuses:${projectId}`)
    const { data: remoteStatuses, error } = await readAll(() => {
      let query = supabase.from('statuses').select('*').eq('project_id', projectId)
      if (since) query = query.gt('updated_at', since)
      return query
    }, ['updated_at', 'id'])

    if (error || !remoteStatuses) return 0
    if (remoteStatuses.length === 0) return 0

    let changed = 0
    for (const rs of remoteStatuses) {
      const existing = await api.statuses.findById(rs.id)
      if (!existing || Date.parse(rs.updated_at) > Date.parse(existing.updated_at)) {
        await api.statuses.applyRemote(rs)
        changed++
      }
      // No "local newer → push" branch (same reasoning as pullNewTasks).
    }
    const pName = projectNameCache.get(projectId) ?? projectId
    if (changed > 0) console.log(`[PersonalSync] Synced ${changed} statuses for "${pName}"`)
    if (!await context.isCurrent()) return 0
    const watermark = pullWatermark(remoteStatuses)
    if (watermark) lastPullAt.set(`${context.scope}:statuses:${projectId}`, watermark)
    return changed
  } catch (err) {
    await handlePullError(context, 'pullStatuses', err)
    return 0
  }
}

/**
 * Ensure every referenced remote label exists locally. If a remote label is a
 * case/exact duplicate of a local one (same name, different id — typically
 * MCP-created), it isn't recreated; instead the returned map remaps the
 * remote id to the canonical local id so task_labels inserts don't reference
 * a non-existent local row.
 */
/**
 * Resolve a set of remote label ids to the LOCAL label ids that should carry
 * them on the current user's tasks, enforcing the ownership invariant: a label
 * on the current user's task must be a row the current user OWNS.
 *
 * Returns a remap (remote id → local id); ids absent from the map resolve to
 * themselves.
 *
 *  - Own label (remote.user_id === current user): apply it as-is, preserving
 *    its id. Minting a fresh id here would create a NEW divergence for the
 *    user's own label (local newid vs cloud remoteid).
 *  - Foreign / null-owner label (e.g. another member's label in a shared
 *    project, or the user's alt-account label leaked onto their tasks): the
 *    current user adopts their OWN same-name label (existing one, or a freshly
 *    minted UUID) and we link it to the task's project. The foreign id is never
 *    stored under the current user's ownership — that mismatch is exactly the
 *    label-identity divergence (task d5b138b1).
 *  - Not signed in: store the remote row faithfully (id + owner) so nothing is
 *    lost; ownership is reconciled once a user is present.
 */
async function ensureLabelsExistLocally(
  labelIds: string[],
  projectId: string | null,
  expectedUserId: string | undefined,
  context: SyncContext
): Promise<Map<string, string>> {
  const api = context.api
  const remap = new Map<string, string>()
  if (labelIds.length === 0) return remap
  const supabase = context.client
  const { useAuthStore } = await import('../shared/stores/authStore')
  const ownerId = useAuthStore.getState().currentUser?.id ?? null
  const assertUser = (): void => {
    if (expectedUserId && useAuthStore.getState().currentUser?.id !== expectedUserId) throw new Error('Search account changed')
  }
  assertUser()

  const link = async (labelId: string): Promise<void> => {
    if (projectId) await api.labels.applyRemoteProjectLabel({ project_id: projectId, label_id: labelId, created_at: null, deleted_at: null }).catch(() => {})
  }

  const localLabels = new Map((await Promise.all(labelIds.map((id) => api.labels.findById(id))))
    .filter((label): label is Label => !!label).map((label) => [label.id, label]))
  const missing = labelIds.filter((id) => !localLabels.has(id))
  const remoteLabels = new Map<string, Label>()
  if (missing.length) {
    const { data, error } = await readAllIn(missing, (ids) => supabase.from('user_labels').select('*').in('id', ids))
    if (error) throw new Error(error.message)
    for (const label of data ?? []) remoteLabels.set(label.id, label as Label)
  }
  for (const labelId of labelIds) {
    assertUser()
    const localLabel = localLabels.get(labelId)
    if (localLabel) {
      // Already present. Own it (or legacy NULL-owner) → use as-is. A
      // foreign-owned local row (rare in a single-user DB) → adopt to our own.
      if (!ownerId || localLabel.user_id === ownerId || localLabel.user_id == null) {
        await link(localLabel.id)
      } else {
        const own = await api.labels.adopt(ownerId, localLabel)
        await link(own.id)
        if (own.id !== labelId) remap.set(labelId, own.id)
      }
      continue
    }

    const remoteLabel = remoteLabels.get(labelId)
    if (!remoteLabel) continue

    if (!ownerId || remoteLabel.user_id === ownerId) {
      // Our own label (from another device), or no signed-in user to enforce
      // ownership: store the remote row faithfully, preserving its id.
      await api.labels.applyRemote(remoteLabel as Label).catch(() => {})
      await link(labelId)
      continue
    }

    // Foreign / null-owner label → current user must own a same-name copy.
    const own = await api.labels.adopt(ownerId, remoteLabel as Label)
    await link(own.id)
    if (own.id !== labelId) remap.set(labelId, own.id)
  }
  return remap
}

/**
 * Targeted task_labels pull for one task (story #91, option (a)).
 * task_labels has no project_id column, so a filtered Realtime subscription
 * is impossible (and unfiltered subscriptions are forbidden by the
 * performance rules). Instead, every tasks Realtime event triggers this
 * O(1) fetch — the MCP edge function rewrites tasks.label_names on every
 * assign/remove, so a tasks UPDATE event fires per label change even though
 * updated_at doesn't advance (which is why pullNewTasks never sees it).
 * Returns the number of newly applied label assignments.
 */
export async function pullTaskLabelsForTasks(taskIds: string[], expectedUserId?: string, context?: SyncContext): Promise<number> {
  if (!taskIds.length) return 0
  try {
    context ??= await captureSyncContext()
    const api = context.api
    const supabase = context.client
    const snapshots = new Map(await Promise.all(taskIds.map(async (id)=>[id,await api.tasks.getLabelState(id)] as const)))
    const { data: pairs, error } = await readAllIn(taskIds, (ids) => supabase.from('task_labels').select('task_id, label_id')
      .in('task_id', ids).is('deleted_at', null), ['task_id', 'label_id'])
    if (error) throw new Error(error.message)
    const labelIds = [...new Set(pairs.map((p) => p.label_id as string))]
    const remap = await ensureLabelsExistLocally(labelIds, null, expectedUserId, context)
    let added = 0
    const { useAuthStore } = await import('../shared/stores/authStore')
    for (const taskId of taskIds) {
      if (expectedUserId && useAuthStore.getState().currentUser?.id !== expectedUserId) return added
      const resolved = [...new Set(pairs.filter((p) => p.task_id === taskId).map((p) => remap.get(p.label_id) ?? p.label_id))]
      added += await api.tasks.applyRemoteTaskLabels(taskId, resolved, snapshots.get(taskId))
    }
    return added
  } catch (err) {
    if (context && await context.isCurrent()) console.warn('[PersonalSync] pullTaskLabelsForTasks failed:', err)
    return 0
  }
}

export async function pullTaskLabelsForTask(taskId: string): Promise<number> {
  return pullTaskLabelsForTasks([taskId])
}

// Re-read the boundary millisecond: PostgreSQL timestamps have finer precision.
// A fetched-row watermark cannot skip writes arriving while local apply runs.
function pullWatermark(rows: Array<{ updated_at?: string }>): string | null {
  const dates = rows.map((row) => Date.parse(row.updated_at ?? '')).filter(Number.isFinite)
  return dates.length ? new Date(Math.max(...dates) - 1).toISOString() : null
}

export async function pullNewTasks(projectId: string, context?: SyncContext): Promise<number> {
  try {
    context ??= await captureSyncContext()
    const api = context.api
    await pullProjectMetadata(projectId, context)
    // Ensure statuses exist locally before inserting tasks (FK constraint)
    await pullStatuses(projectId, context)

    const supabase = context.client
    const since = lastPullAt.get(`${context.scope}:tasks:${projectId}`)
    const archiveSince = lastPullAt.get(`${context.scope}:task-archives:${projectId}`)
    const { data: remoteTasks, error } = await readAll(() => {
      let query = supabase.from('tasks').select('*').eq('project_id', projectId)
      if (since) query = query.or(`updated_at.gt.${since},archive_updated_at.gt.${archiveSince ?? '1970-01-01T00:00:00Z'}`)
      return query
    }, ['updated_at', 'id'])

    if (error) {
      await handlePullError(context, 'pullNewTasks', error)
      return 0
    }
    if (!remoteTasks) return 0

    let pulled = 0
    let failed = false
    const touchedTaskIds: string[] = []

    // Parents before subtasks so the parent_id FK is satisfied when inserting.
    const orderedRemoteTasks = remoteTaskOrder(remoteTasks)

    for (const rt of orderedRemoteTasks) {
      if (recentlyDeletedIds.has(rt.id)) continue
      const existing = await api.tasks.findById(rt.id)
      if (!existing) {
        // New task — create locally
        const ownerId = rt.owner_id as string
        const localOwner = await api.users.findById(ownerId)
        if (!localOwner) {
          await api.users.create({ id: ownerId, email: placeholderEmail(ownerId), display_name: null, avatar_url: null }).catch((e) => console.warn('[PersonalSync] Failed to create local user:', e))
        }
        // Same for assigned_to, which is also a users FK.
        if (rt.assigned_to) {
          const assignedId = rt.assigned_to as string
          const localAssignee = await api.users.findById(assignedId)
          if (!localAssignee) {
            await api.users.create({ id: assignedId, email: placeholderEmail(assignedId), display_name: null, avatar_url: null }).catch(() => {})
          }
        }
        try {
          // applyRemote preserves remote timestamps; tasks.create would stamp NOW
          // into updated_at and trigger a redundant push on the next pull.
          await api.tasks.applyRemote({
            id: rt.id,
            project_id: rt.project_id,
            owner_id: ownerId,
            title: rt.title,
            description: rt.description,
            status_id: rt.status_id,
            priority: rt.priority ?? 0,
            due_date: rt.due_date,
            parent_id: rt.parent_id,
            order_index: rt.order_index ?? 0,
            assigned_to: rt.assigned_to,
            is_template: rt.is_template ?? 0,
            is_archived: rt.is_archived ?? 0,
            archive_updated_at: rt.archive_updated_at ?? null,
            is_in_my_day: rt.is_in_my_day ?? 0,
            completed_date: rt.completed_date,
            recurrence_rule: rt.recurrence_rule,
            reference_url: rt.reference_url,
            my_day_dismissed_date: rt.my_day_dismissed_date ?? null,
            created_at: rt.created_at,
            updated_at: rt.updated_at,
            deleted_at: rt.deleted_at ?? null
          })
          touchedTaskIds.push(rt.id)
          pulled++
        } catch (e) {
          failed = true
          console.error(`[PersonalSync] Failed to create task "${rt.title}" (${rt.id}):`, e)
        }
      } else if ((rt.updated_at && existing.updated_at && Date.parse(rt.updated_at) > Date.parse(existing.updated_at)) || (rt.archive_updated_at && (Date.parse(rt.archive_updated_at) > Date.parse(existing.archive_updated_at ?? '1970-01-01') || (Date.parse(rt.archive_updated_at) === Date.parse(existing.archive_updated_at ?? '') && rt.is_archived !== existing.is_archived)))) {
        // Remote is newer — update locally (preserve remote timestamps via applyRemote)
        try {
          await api.tasks.applyRemote({
            id: rt.id,
            project_id: rt.project_id,
            owner_id: existing.owner_id,
            title: rt.title,
            description: rt.description,
            status_id: rt.status_id,
            priority: rt.priority ?? 0,
            due_date: rt.due_date,
            parent_id: rt.parent_id,
            order_index: rt.order_index ?? 0,
            assigned_to: rt.assigned_to,
            is_template: rt.is_template ?? existing.is_template ?? 0,
            is_archived: rt.is_archived ?? 0,
            archive_updated_at: rt.archive_updated_at ?? null,
            is_in_my_day: rt.is_in_my_day ?? 0,
            completed_date: rt.completed_date,
            recurrence_rule: rt.recurrence_rule,
            reference_url: rt.reference_url,
            my_day_dismissed_date: rt.my_day_dismissed_date ?? null,
            created_at: existing.created_at,
            updated_at: rt.updated_at,
            deleted_at: rt.deleted_at ?? null
          })
          touchedTaskIds.push(rt.id)
          pulled++
        } catch (e) {
          failed = true
          console.error(`[PersonalSync] Failed to update task "${rt.title}" (${rt.id}):`, e)
        }
      }
      // No "local newer → push" branch: pullNewTasks pulls only. Failed mutation
      // pushes are retried via sync_queue, and reconcile() catches ID-level drift.
      // Pushing here floods Supabase whenever local timestamps got bumped without
      // a matching remote update (e.g. residue from the pre-applyRemote era).
    }

    // Also handles task label events whose task updated_at did not advance.
    if (touchedTaskIds.length) await pullTaskLabelsForTasks(touchedTaskIds, undefined, context)

    const pName = projectNameCache.get(projectId) ?? projectId
    if (pulled > 0) {
      console.log(`[PersonalSync] "${pName}": ${pulled} pulled`)
    }
    if (!await context.isCurrent()) return 0
    const watermark = pullWatermark(remoteTasks)
    if (!failed && watermark) lastPullAt.set(`${context.scope}:tasks:${projectId}`, watermark)
    const archiveWatermark = pullWatermark(remoteTasks.map((task) => ({ updated_at: task.archive_updated_at ?? undefined })))
    if (!failed && archiveWatermark) lastPullAt.set(`${context.scope}:task-archives:${projectId}`, archiveWatermark)
    // Supabase responded successfully — clear any auth failure state
    clearAuthFailures()
    return pulled
  } catch (err) {
    await handlePullError(context, 'pullNewTasks', err)
    return 0
  }
}

/**
 * Reconcile local SQLite vs Supabase by ID-set diff.
 *
 * This is the safety net for silent push failures: every personal-project task
 * and every user_label is checked; missing-in-remote is pushed, missing-in-local
 * is pulled. Triggered on app startup and on reconnect, and exposed as a manual
 * "Reconcile" button so a user with a "ghost" task can fix it without restarting.
 *
 * Returns { pushed, pulled } counts. Silent on success; if more than 10 items
 * needed reconciling, a notification is fired so the user notices.
 *
 * Concurrent callers share the same in-flight promise. A 30s cooldown skips
 * back-to-back runs (e.g. startup-reconcile racing a transient-offline-flap
 * reconcile triggered by the same boot's WS hiccup).
 */
let reconcileInFlight: Promise<{ pushed: number; pulled: number }> | null = null
let lastReconcileAt = 0
const RECONCILE_COOLDOWN_MS = 30_000
export async function reconcile(userId: string): Promise<{ pushed: number; pulled: number }> {
  if (reconcileInFlight) return reconcileInFlight
  if (Date.now() - lastReconcileAt < RECONCILE_COOLDOWN_MS) {
    logEvent('info', 'sync', 'Reconcile skipped — within cooldown')
    return { pushed: 0, pulled: 0 }
  }
  if (!navigator.onLine) {
    logEvent('info', 'sync', 'Reconcile skipped — offline')
    return { pushed: 0, pulled: 0 }
  }
  // Check session upfront — if there's no session, do NOT touch the cooldown.
  // Otherwise a pre-login reconcile attempt would block the first real reconcile
  // after sign-in for 30 seconds, leaving the user staring at "last sync: never".
  if (useAuthStore.getState().currentUser?.id !== userId) return { pushed: 0, pulled: 0 }
  const context = await captureSyncContext().catch(() => null)
  if (!context) return { pushed: 0, pulled: 0 }
  reconcileInFlight = reconcileImpl(userId, context)
  try {
    const result = await reconcileInFlight
    lastReconcileAt = Date.now()
    return result
  } finally {
    reconcileInFlight = null
  }
}

async function reconcileImpl(userId: string, context: SyncContext): Promise<{ pushed: number; pulled: number }> {
  let totalPushed = 0
  let totalPulled = 0
  try {
    const api = context.api
    const supabase = context.client

    const runTable = async (
      tableName: Parameters<typeof reconcileTable>[0]['name'] | string,
      scopeId: string
    ): Promise<void> => {
      const desc = SYNC_TABLES[tableName as keyof typeof SYNC_TABLES]
      if (!desc) return
      // Append a readable project name when the scope is a project. Owner-
      // and user-scoped tables get scope=<userId> with no name.
      const pName = projectNameCache.get(scopeId)
      const scopeStr = pName ? `scope=${scopeId} project="${pName}"` : `scope=${scopeId}`
      try {
        const stats = await reconcileTable(
          desc as Parameters<typeof reconcileTable>[0],
          scopeId,
          userId,
          context
        )
        totalPushed += stats.pushed
        totalPulled += stats.pulled
        if (stats.skipped) {
          logEvent(
            'info',
            'sync',
            `Reconcile: ${tableName} skipped (no drift)`,
            scopeStr
          )
        } else if (stats.pushed || stats.pulled || stats.failed) {
          logEvent(
            stats.failed ? 'warn' : 'info',
            'sync',
            `Reconcile: ${tableName}`,
            `pushed=${stats.pushed} pulled=${stats.pulled} inSync=${stats.inSync} failed=${stats.failed} ${scopeStr}`
          )
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logEvent('error', 'sync', `Reconcile: ${tableName} failed`, `${scopeStr} err=${msg}`)
      }
    }

    // 1. Owner-scoped: projects (need to land before tasks/statuses so the FK is satisfied).
    await runTable('projects', userId)

    const { processSyncQueue } = await import('./SyncService')
    await processSyncQueue(context)
    const pendingStatusProjects = new Set((await api.sync.getQueue()).map((entry) => JSON.parse(entry.payload)).filter((payload) => payload.status_delete).map((payload) => payload.project_id))

    // 2. Project-scoped: per personal project, statuses then tasks.
    const allProjects = await api.projects.getProjectsForUser(userId)
    const personalProjects = allProjects.filter((p) => p.owner_id === userId && p.is_shared !== 1)

    // activity_log is pull-only (no descriptor — see syncTables.ts): an
    // incremental sweep cursored on (project_id, created_at). Safety net for
    // Realtime gaps, and runs for shared projects too — remote members'
    // activity has no other path into local SQLite besides the live event.
    const pullActivity = async (projectId: string): Promise<void> => {
      try {
        const pulled = await pullActivityLogForProject(projectId, userId, context)
        if (pulled > 0) {
          totalPulled += pulled
          logEvent('info', 'sync', `Reconcile: activity_log`, `pulled=${pulled} scope=${projectId}`)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logEvent('error', 'sync', `Reconcile: activity_log failed`, `scope=${projectId} err=${msg}`)
      }
    }

    for (const project of personalProjects) {
      if (pendingStatusProjects.has(project.id)) continue
      await runTable('statuses', project.id)
      await runTable('tasks', project.id)
      await pullActivity(project.id)
    }

    for (const project of allProjects.filter((p) => p.is_shared === 1)) {
      if (pendingStatusProjects.has(project.id)) continue
      await pullNewTasks(project.id, context)
      await pullActivity(project.id)
    }
    await processSyncQueue(context)

    // 3. User-scoped: labels, themes, settings, saved_views, project_areas, project_templates.
    for (const tableName of [
      'labels',
      'themes',
      'settings',
      'saved_views',
      'project_areas',
      'project_templates'
    ] as const) {
      await runTable(tableName, userId)
    }

    // 5. project_labels junction — composite-PK with no updated_at, same
    // shape as task_labels. Diff by key set, push deltas, pull missing rows
    // (with tombstone propagation).
    try {
      const localProjectLabels = await api.labels.getProjectLabelsForOwner(userId)
      const pairKey = (projectId: string, labelId: string): string => `${projectId}::${labelId}`
      const localByKey = new Map<
        string,
        { project_id: string; label_id: string; created_at: string; deleted_at: string | null }
      >(localProjectLabels.map((p) => [pairKey(p.project_id, p.label_id), p]))

      const personalProjectIds = personalProjects.map((p) => p.id)
      const remotePairs: Array<{
        project_id: string
        label_id: string
        created_at: string | null
        deleted_at: string | null
      }> = []
      const chunkSize = 500
      let fetchOk = true
      for (let i = 0; i < personalProjectIds.length; i += chunkSize) {
        const chunk = personalProjectIds.slice(i, i + chunkSize)
        const { data, error: plErr } = await readAll(() => supabase
          .from('project_labels')
          .select('project_id, label_id, created_at, deleted_at')
          .in('project_id', chunk), ['project_id', 'label_id'])
        if (plErr) {
          logEvent('error', 'sync', 'Reconcile: list remote project_labels failed', `err=${plErr.message}`)
          fetchOk = false
          break
        }
        if (data) {
          remotePairs.push(
            ...(data as Array<{
              project_id: string
              label_id: string
              created_at: string | null
              deleted_at: string | null
            }>)
          )
        }
      }

      if (fetchOk) {
        const remoteByKey = new Map(remotePairs.map((p) => [pairKey(p.project_id, p.label_id), p]))

        // Push: rows that exist locally but not remotely, OR whose tombstone
        // state differs (local tombstoned but remote alive, or vice-versa).
        const toPush: Array<{
          project_id: string
          label_id: string
          created_at: string
          deleted_at: string | null
        }> = []
        for (const local of localProjectLabels) {
          const key = pairKey(local.project_id, local.label_id)
          const remote = remoteByKey.get(key)
          if (!remote) {
            toPush.push({
              project_id: local.project_id,
              label_id: local.label_id,
              created_at: local.created_at,
              deleted_at: local.deleted_at
            })
          } else {
            const localDelMs = Date.parse(local.deleted_at ?? local.created_at)
            const remoteDelMs = Date.parse(remote.deleted_at ?? remote.created_at ?? '')
            if (localDelMs > remoteDelMs) {
              toPush.push({
                project_id: local.project_id,
                label_id: local.label_id,
                created_at: local.created_at,
                deleted_at: local.deleted_at
              })
            }
          }
        }
        // Diagnostic: surface project_labels drift before pushing — recurring
        // counts here usually mean a filter mismatch between local and remote
        // reads (the bug fixed by getProjectLabelsForOwner's is_shared filter).
        if (toPush.length > 0) {
          const definitions = await Promise.all(toPush.slice(0, 5).map((link) => api.labels.findById(link.label_id)))
          const labelMap = Object.fromEntries(definitions.filter((label) => !!label).map((label) => [label.id, label]))
          const sample = toPush.slice(0, 5).map((p) => {
            const proj = getCachedProjectName(p.project_id) ?? p.project_id
            const lbl = labelMap[p.label_id]?.name ?? p.label_id
            return `${proj}::${lbl}`
          }).join(',')
          logEvent(
            'info',
            'sync',
            `Reconcile: project_labels diff — local=${localProjectLabels.length} remote=${remotePairs.length} toPush=${toPush.length}`,
            `sample=${sample}`
          )
        }
        let plPushed = 0
        for (let i = 0; i < toPush.length; i += chunkSize) {
          const chunk = toPush.slice(i, i + chunkSize)
          await writeProjectLabelChoices(supabase,api,chunk,context.assertCurrent)
          plPushed += chunk.length
        }
        totalPushed += plPushed

        // Pull: rows on remote that aren't local, or that have a newer
        // tombstone than local. Skip if the label_id isn't on this device
        // yet (the labels reconcile in step 3 will pull the label first;
        // the next reconcile pass picks up the link).
        let plPulled = 0
        for (const remote of remotePairs) {
          const key = pairKey(remote.project_id, remote.label_id)
          const local = localByKey.get(key)
          if (local) {
            const localDelMs = Date.parse(local.deleted_at ?? local.created_at)
            const remoteDelMs = Date.parse(remote.deleted_at ?? remote.created_at ?? '')
            if (remoteDelMs <= localDelMs) continue
          }
          const labelExists = await api.labels.findById(remote.label_id)
          if (!labelExists) continue
          await api.labels.applyRemoteProjectLabel({
            project_id: remote.project_id,
            label_id: remote.label_id,
            created_at: remote.created_at,
            deleted_at: remote.deleted_at
          })
          // When a remote tombstone arrives, cascade-soft-delete the local
          // task_labels rows for tasks in this project that reference the
          // label. Without this, the local rows stay alive, the next
          // task_labels reconcile sees them missing from remote (User B
          // hard-deleted on remote) and re-pushes them — undoing the
          // removal. The deleted_at filter on getTaskLabelsForSharedProjects
          // depends on this cascade firing.
          if (remote.deleted_at) {
            await api.labels
              .softDeleteTaskLabelsForProjectLabel(remote.project_id, remote.label_id)
              .catch(() => {})
          }
          plPulled++
        }
        totalPulled += plPulled

        if (plPushed > 0 || plPulled > 0) {
          logEvent('info', 'sync', `Reconcile: project_labels`, `pushed=${plPushed} pulled=${plPulled}`)
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logEvent('error', 'sync', 'Reconcile: project_labels diff failed', msg)
    }

    // 6. Shared-project label propagation. The shared Realtime channel only
    // subscribes to tasks/statuses/project_members/activity_log, so label
    // changes by collaborators don't reach this client via Realtime. This
    // stage closes the gap with eventual consistency by diffing task_labels
    // and project_labels for shared projects, then pulling any referenced
    // labels that don't yet exist locally. RLS on user_labels must allow
    // reading rows referenced by accessible task_labels/project_labels for
    // pulls to materialize; if it doesn't, the fetch returns empty and we
    // log without breaking the rest of reconcile.
    try {
      const sharedProjects = allProjects.filter((p) => p.is_shared === 1)
      if (sharedProjects.length > 0) {
        const sharedProjectIds = sharedProjects.map((p) => p.id)
        const plPairKey = (projectId: string, labelId: string): string =>
          `${projectId}::${labelId}`
        const chunkSize = 500

        // ── project_labels (shared) ───────────────────────────────────────
        const localSharedPl = await api.labels.getProjectLabelsForSharedProjects()
        const localSharedPlByKey = new Map(
          localSharedPl.map((p) => [plPairKey(p.project_id, p.label_id), p])
        )

        const remoteSharedPl: Array<{
          project_id: string
          label_id: string
          created_at: string | null
          deleted_at: string | null
        }> = []
        let plFetchOk = true
        for (let i = 0; i < sharedProjectIds.length; i += chunkSize) {
          const chunk = sharedProjectIds.slice(i, i + chunkSize)
          const { data, error: plErr } = await readAll(() => supabase
            .from('project_labels')
            .select('project_id, label_id, created_at, deleted_at')
            .in('project_id', chunk), ['project_id', 'label_id'])
          if (plErr) {
            logEvent(
              'error',
              'sync',
              'Reconcile: list shared project_labels failed',
              `err=${plErr.message}`
            )
            plFetchOk = false
            break
          }
          if (data) {
            remoteSharedPl.push(
              ...(data as Array<{
                project_id: string
                label_id: string
                created_at: string | null
                deleted_at: string | null
              }>)
            )
          }
        }

        let shPlPushed = 0
        let shPlPulled = 0
        const plToApply: typeof remoteSharedPl = []
        if (plFetchOk) {
          const remoteSharedPlByKey = new Map(
            remoteSharedPl.map((p) => [plPairKey(p.project_id, p.label_id), p])
          )

          const plToPush: Array<{
            project_id: string
            label_id: string
            created_at: string
            deleted_at: string | null
          }> = []
          for (const local of localSharedPl) {
            const key = plPairKey(local.project_id, local.label_id)
            const remote = remoteSharedPlByKey.get(key)
            if (!remote) {
              plToPush.push({
                project_id: local.project_id,
                label_id: local.label_id,
                created_at: local.created_at,
                deleted_at: local.deleted_at
              })
            } else {
              const localDel = Date.parse(local.deleted_at ?? local.created_at)
              const remoteDel = Date.parse(remote.deleted_at ?? remote.created_at ?? '')
              if (localDel > remoteDel) {
                plToPush.push({
                  project_id: local.project_id,
                  label_id: local.label_id,
                  created_at: local.created_at,
                  deleted_at: local.deleted_at
                })
              }
            }
          }
          if (plToPush.length > 0) {
            const sample = plToPush
              .slice(0, 5)
              .map((p) => `${p.project_id}::${p.label_id}`)
              .join(',')
            logEvent(
              'info',
              'sync',
              `Reconcile: shared project_labels diff — local=${localSharedPl.length} remote=${remoteSharedPl.length} toPush=${plToPush.length}`,
              `sample=${sample}`
            )
            for (let i = 0; i < plToPush.length; i += chunkSize) {
              const chunk = plToPush.slice(i, i + chunkSize)
              await writeProjectLabelChoices(supabase,api,chunk,context.assertCurrent)
              shPlPushed += chunk.length
            }
          }

          for (const remote of remoteSharedPl) {
            const local = localSharedPlByKey.get(plPairKey(remote.project_id, remote.label_id))
            if (!local) {
              plToApply.push(remote)
            } else {
              const localDel = Date.parse(local.deleted_at ?? local.created_at)
              const remoteDel = Date.parse(remote.deleted_at ?? remote.created_at ?? '')
              if (remoteDel > localDel) plToApply.push(remote)
            }
          }
        }

        // ── Resolve missing labels referenced by pulls ────────────────────
        // Both junction tables can reference labels owned by collaborators.
        // Collect label_ids from pull candidates and fetch any rows that
        // aren't on this device yet from `user_labels`. RLS may filter; the
        // Pull counts below reflect what actually
        // landed.
        const referencedLabelIds = new Set<string>()
        for (const r of plToApply) referencedLabelIds.add(r.label_id)

        let shLabelsPulled = 0
        if (referencedLabelIds.size > 0) {
          const missingLabelIds: string[] = []
          for (const lid of referencedLabelIds) {
            const exists = await api.labels.findById(lid)
            if (!exists) missingLabelIds.push(lid)
          }
          if (missingLabelIds.length > 0) {
            const fetched: Array<Record<string, unknown>> = []
            for (let i = 0; i < missingLabelIds.length; i += chunkSize) {
              const chunk = missingLabelIds.slice(i, i + chunkSize)
              const { data, error: lblErr } = await readAll(() => supabase
                .from('user_labels')
                .select('*')
                .in('id', chunk), ['id'])
              if (lblErr) {
                logEvent(
                  'error',
                  'sync',
                  'Reconcile: fetch shared labels failed',
                  `err=${lblErr.message}`
                )
                break
              }
              if (data) fetched.push(...(data as Array<Record<string, unknown>>))
            }
            if (fetched.length < missingLabelIds.length) {
              const fetchedIds = new Set(fetched.map((r) => String(r.id)))
              const unreadable = missingLabelIds.filter((id) => !fetchedIds.has(id))
              const sample = unreadable.slice(0, 5).join(',')
              logEvent(
                'warn',
                'sync',
                `Reconcile: shared labels — ${unreadable.length} of ${missingLabelIds.length} not readable (RLS or deleted)`,
                `ids=${sample} — collaborator-owned labels may need an RLS policy`
              )
            }
            for (const remote of fetched) {
              try {
                await api.labels.applyRemote(remote as unknown as Label)
                shLabelsPulled++
              } catch (e) {
                logEvent(
                  'warn',
                  'sync',
                  'Reconcile: shared label apply failed',
                  `id=${String(remote.id)} err=${e instanceof Error ? e.message : String(e)}`
                )
              }
            }
          }
        }

        // ── Apply pulls now that referenced labels exist locally ──────────
        for (const remote of plToApply) {
          const labelExists = await api.labels.findById(remote.label_id)
          if (!labelExists) continue
          await api.labels.applyRemoteProjectLabel({
            project_id: remote.project_id,
            label_id: remote.label_id,
            created_at: remote.created_at,
            deleted_at: remote.deleted_at
          })
          // Same cascade as the personal-reconcile path: when a tombstone
          // arrives, kill the local task_labels rows so the next reconcile
          // doesn't re-push them as "missing on remote".
          if (remote.deleted_at) {
            await api.labels
              .softDeleteTaskLabelsForProjectLabel(remote.project_id, remote.label_id)
              .catch(() => {})
          }
          shPlPulled++
        }

        totalPushed += shPlPushed
        totalPulled += shPlPulled + shLabelsPulled

        if (
          shPlPushed > 0 ||
          shPlPulled > 0 ||
          shLabelsPulled > 0
        ) {
          logEvent(
            'info',
            'sync',
            'Reconcile: shared-project labels',
            `project_labels=${shPlPushed}/${shPlPulled} labels=0/${shLabelsPulled} (push/pull)`
          )
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logEvent('error', 'sync', 'Reconcile: shared-project labels failed', msg)
    }

    for (const project of allProjects) {
      const ids=(await api.tasks.findAllByProject(project.id)).map((task)=>task.id)
      totalPulled += await pullTaskLabelsForTasks(ids,userId,context)
      await syncTaskLabelChoices(supabase,ids,api,context.scope)
    }
    await processSyncQueue(context)

    if (totalPushed > 0 || totalPulled > 0) {
      logEvent('info', 'sync', `Reconcile complete: ${totalPushed} pushed, ${totalPulled} pulled`)
    } else {
      logEvent('info', 'sync', 'Reconcile complete: in sync')
    }

    // Reconcile is a routine background event — it shouldn't push a
    // user-visible notification. Status is already conveyed via the sync
    // indicator (green dot / spinner) and the Logs panel; persisting one
    // notification per app start spammed the inbox without conveying
    // anything actionable.

    return { pushed: totalPushed, pulled: totalPulled }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[PersonalSync] reconcile failed:', err)
    logEvent('error', 'sync', `Reconcile failed: ${msg}`)
    return { pushed: totalPushed, pulled: totalPulled }
  }
}

/**
 * One-time cleanup (#114): a pre-#114 build leaked the *plaintext* api_key into
 * the cloud `user_settings` table via the debounced push. That key is a bearer
 * secret which must live device-local only (under user_id='') and reach the
 * cloud solely as a SHA-256 hash in `api_keys`. Purge any lingering leaked row
 * at sync-init so it can never be re-imported by fullPull on a fresh device —
 * independent of whether the user ever opens Settings → Integrations.
 *
 * Read-path safe: probe with a single SELECT and DELETE only when a row is
 * actually present, so steady-state launches issue no write. Offline-tolerant —
 * a failed probe is logged and swallowed so it never blocks sync init.
 */
export async function purgeLeakedApiKeySetting(userId: string): Promise<void> {
  try {
    const supabase = await getSupabase()
    const { data: leaked } = await supabase
      .from('user_settings')
      .select('id')
      .eq('user_id', userId)
      .eq('key', 'api_key')
      .maybeSingle()
    if (leaked) {
      await supabase.from('user_settings').delete().eq('user_id', userId).eq('key', 'api_key')
      logEvent('info', 'sync', 'Purged leaked plaintext api_key from cloud user_settings (#114)')
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn('[PersonalSync] api_key purge probe failed (offline?):', msg)
  }
}

/**
 * Check if this is a new device (no last_sync_at) and initiate appropriate sync.
 * Concurrent callers share the same in-flight promise so we never start two
 * parallel fullUploads (which would push every task N times) — this is the
 * SOLE concurrency guard now that fullUpload no longer claims last_sync_at as
 * an up-front sentinel. last_sync_at is written only on a *successful* full
 * upload/pull, so a failed run leaves it falsy here and this path retries.
 */
let initSyncInFlight: Promise<void> | null = null
export async function initSync(userId: string): Promise<void> {
  const context = await captureSyncContext()
  const api = context.api
  if (useAuthStore.getState().currentUser?.id !== userId) return
  if (initSyncInFlight) return initSyncInFlight
  initSyncInFlight = (async () => {
    // Always clean up a pre-#114 leaked plaintext api_key before any pull path,
    // so fullPull on a fresh/empty-local device can never re-absorb the secret.
    await purgeLeakedApiKeySetting(userId)

    const lastSyncAt = await api.settings.get(userId, 'last_sync_at')
    const syncStore = useSyncStore.getState()

    if (!lastSyncAt) {
      const localProjects = await api.projects.getProjectsForUser(userId)
      const hasLocalData = localProjects.length > 0

      if (hasLocalData) {
        console.log('[PersonalSync] Local data found, uploading to Supabase')
        await fullUpload(userId, context)
      } else {
        console.log('[PersonalSync] No local data, pulling from Supabase')
        await fullPull(userId, context)
      }
    } else {
      if (await context.isCurrent()) syncStore.setLastSynced()
    }
  })()
  try {
    await initSyncInFlight
  } finally {
    initSyncInFlight = null
  }
}

/**
 * Sync a single task_label from Supabase — ensures the label exists locally first.
 * Used by Realtime handler when a task_label INSERT is detected.
 */
export async function syncTaskLabel(taskId: string): Promise<void> {
  await pullTaskLabelsForTasks([taskId])
}

// ── Realtime Subscriptions for All Projects ──────────────────────────

interface PersonalChannelState {
  channel: RealtimeChannel | null
  onChange: (event: string, data: Record<string, unknown>) => void
  cancelled: boolean
  attempt: number
  reconnectTimer: ReturnType<typeof setTimeout> | null
}

/** Track active personal-project Realtime channel state (incl. reconnect). */
const personalChannelStates: Map<string, PersonalChannelState> = new Map()

// Exponential backoff with give-up. After MAX_ATTEMPTS, surface a banner so the
// user can manually retry instead of looping forever (which floods logs +
// notifications during sleep / hotel-WiFi flake).
const RECONNECT_DELAYS_MS = [5_000, 15_000, 30_000, 60_000, 120_000, 240_000, 480_000, 900_000]
const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS_MS.length
function getReconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
}

/**
 * Apply a Realtime activity_log INSERT to the local table. One delayed retry
 * covers the task-INSERT race: the task row for a brand-new remote task only
 * lands locally via the debounced flush (~0.5–1s after its event), and the
 * activity event for that task can beat it. Rows still missing after the
 * retry are picked up by the reconcile-time pullActivityLogForProject sweep,
 * which holds its high-water back for exactly this case.
 */
async function applyRemoteActivityRow(
  row: Record<string, unknown>,
  onApplied: () => void
): Promise<void> {
  const id = row.id as string | undefined
  const taskId = row.task_id as string | undefined
  if (!id || !taskId) return
  const input = {
    id,
    task_id: taskId,
    user_id: (row.user_id as string) ?? '',
    action: (row.action as string) ?? '',
    old_value: (row.old_value as string | null) ?? null,
    new_value: (row.new_value as string | null) ?? null,
    created_at: (row.created_at as string) ?? new Date().toISOString()
  }
  const first = await window.api.activityLog
    .applyRemote(input)
    .catch(() => 'missing-task' as const)
  if (first === 'applied') {
    onApplied()
    return
  }
  if (first !== 'missing-task') return // duplicate — this device already has it
  setTimeout(() => {
    void window.api.activityLog
      .applyRemote(input)
      .then((second) => {
        if (second === 'applied') onApplied()
      })
      .catch(() => {})
  }, 2_500)
}

async function createPersonalChannel(projectId: string, state: PersonalChannelState): Promise<void> {
  const supabase = await getSupabase()
  const channel = supabase
    .channel(`personal:${projectId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'tasks', filter: `project_id=eq.${projectId}` },
      (payload) => {
        const data = payload.eventType === 'DELETE'
          ? payload.old as Record<string, unknown>
          : payload.new as Record<string, unknown>
        // Targeted task_labels pull (story #91): a remote label assign/remove
        // only rewrites tasks.label_names (updated_at unchanged), so the
        // debounced pullNewTasks never treats the task as dirty. Fetch the
        // junction rows for this one task; fire a dedicated onChange when
        // something landed so the flush rehydrates the chips.
        if (payload.eventType !== 'DELETE' && typeof data.id === 'string') {
          const taskId = data.id
          void pullTaskLabelsForTask(taskId).then((added) => {
            if (added > 0 && !state.cancelled) {
              state.onChange('task_labels', { task_id: taskId, project_id: projectId })
            }
          })
        }
        state.onChange(payload.eventType, data)
      }
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'activity_log', filter: `project_id=eq.${projectId}` },
      (payload) => {
        const row = payload.new as Record<string, unknown>
        void applyRemoteActivityRow(row, () => {
          if (!state.cancelled) state.onChange('activity', row)
        })
      }
    )
    .subscribe((status, err) => {
      if (state.cancelled) return
      const pName = projectNameCache.get(projectId) ?? projectId
      console.log(`[Realtime] ${pName}: ${status}`, err ?? '')
      // Instrumentation: capture channel internal state + server error payload to diagnose loop
      const ch = channel as unknown as { state?: string; subTopic?: string; joinedOnce?: boolean }
      const chState = ch.state ?? '(unknown)'
      const subTopic = ch.subTopic ?? '(unknown)'
      const errMsg = err
        ? (err instanceof Error ? `${err.name}: ${err.message}` : (typeof err === 'string' ? err : JSON.stringify(err)))
        : '(no err)'
      if (status === 'SUBSCRIBED') {
        state.attempt = 0
        useSyncStore.getState().setRealtimeConnected(true)
        useSyncStore.getState().setConnectionLost(false)
        logEvent('info', 'realtime', `Subscribed to personal project`, `${pName} topic=${subTopic} chState=${chState}`)
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        useSyncStore.getState().setRealtimeConnected(false)
        const level: 'warn' | 'error' = status === 'CHANNEL_ERROR' ? 'error' : 'warn'
        logEvent(level, 'realtime', `Channel ${status} on personal project`, `${pName} topic=${subTopic} chState=${chState} err=${errMsg} attempt=${state.attempt}`)
        schedulePersonalReconnect(projectId)
      }
    })
  state.channel = channel
}

function schedulePersonalReconnect(projectId: string): void {
  const state = personalChannelStates.get(projectId)
  if (!state || state.cancelled || state.reconnectTimer) return
  const pName = projectNameCache.get(projectId) ?? projectId

  // Don't burn cycles while system is suspended or browser is offline.
  // Resume / online handlers will call forceReconnectAllPersonal() when state changes.
  if (isSuspended()) {
    logEvent('info', 'realtime', `Reconnect deferred — system suspended`, pName)
    return
  }
  if (!navigator.onLine) {
    logEvent('info', 'realtime', `Reconnect deferred — offline`, pName)
    return
  }

  if (state.attempt >= MAX_RECONNECT_ATTEMPTS) {
    logEvent('warn', 'realtime', `Reconnect gave up after ${state.attempt} attempts`, pName)
    useSyncStore.getState().setConnectionLost(true)
    useSyncStore.getState().setNextReconnectAt(null)
    return
  }

  const delay = getReconnectDelay(state.attempt)
  state.attempt += 1
  logEvent('info', 'realtime', `Reconnect in ${delay / 1000}s (attempt ${state.attempt})`, pName)
  useSyncStore.getState().setNextReconnectAt(Date.now() + delay)

  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null
    useSyncStore.getState().setNextReconnectAt(null)
    if (state.cancelled) return
    if (isSuspended() || !navigator.onLine) {
      logEvent('info', 'realtime', `Reconnect aborted — ${isSuspended() ? 'suspended' : 'offline'}`, pName)
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
          useSyncStore.getState().setRealtimeConnected(true)
          logEvent('info', 'realtime', `Reconnect skipped — channel auto-rejoined`, pName)
          return
        }
        await supabase.removeChannel(state.channel)
      }
    } catch { /* channel may already be dead */ }
    await createPersonalChannel(projectId, state)
  }, delay)
}

/**
 * Cancel all pending personal reconnect timers without tearing down channels.
 * Used by the powerMonitor 'suspend' handler — we want to stop firing retries
 * during macOS Power Nap dark-wakes, but keep the channel state so resume can
 * rebuild cleanly.
 */
export function pauseReconnectsForSuspend(): void {
  for (const state of personalChannelStates.values()) {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
    }
  }
  // The per-user channel shares the suspend/resume lifecycle with the
  // personal channels. Dynamic import — UserChannelService imports from
  // this module, so a static import would be a cycle.
  void import('./UserChannelService').then(({ pauseUserChannelReconnect }) => {
    pauseUserChannelReconnect()
  })
}

/**
 * Reset attempt counters and force a fresh subscribe for every personal channel.
 * Called by the powerMonitor 'resume' handler, by the online/offline listener
 * when the browser comes back online, and by the SessionBanner manual retry.
 */
export async function forceReconnectAllPersonal(): Promise<void> {
  useSyncStore.getState().setConnectionLost(false)
  const supabase = await getSupabase()
  for (const [projectId, state] of personalChannelStates.entries()) {
    if (state.cancelled) continue
    state.attempt = 0
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
    }
    if (state.channel) {
      const ch = state.channel as unknown as { state?: string }
      if (ch.state === 'joined') {
        useSyncStore.getState().setRealtimeConnected(true)
        continue
      }
      try { await supabase.removeChannel(state.channel) } catch { /* ignore */ }
    }
    await createPersonalChannel(projectId, state)
  }
  // Force the per-user channel too — same resume/online/manual-retry triggers.
  void import('./UserChannelService').then(({ forceReconnectUserChannel }) =>
    forceReconnectUserChannel().catch(() => {})
  )
}

/**
 * Subscribe to Realtime changes for a personal (non-shared) project.
 * Auto-reconnects with backoff on CHANNEL_ERROR/TIMED_OUT/CLOSED.
 * No-ops if a subscription already exists for this project.
 */
export async function subscribeToPersonalProject(
  projectId: string,
  onChange: (event: string, data: Record<string, unknown>) => void
): Promise<void> {
  if (personalChannelStates.has(projectId)) return
  // Don't pile up zombie channels when running in offline-fallback mode —
  // an unauthenticated channel still joins the WebSocket, but Postgres-side
  // RLS filters every event so we'd be sitting on a dead listener that
  // confuses the sync state. Once the session is recovered (30s timer or the
  // SessionBanner's manual retry), authStore flips isOffline to false, which
  // re-runs App.tsx's realtime effect and re-subscribes with live handlers
  // (the personalChannelStates guard above makes repeat calls no-ops).
  if (!(await requireSession())) {
    logEvent('warn', 'sync', 'subscribeToPersonalProject skipped — no session', `project=${projectId}`)
    return
  }

  const state: PersonalChannelState = {
    channel: null,
    onChange,
    cancelled: false,
    attempt: 0,
    reconnectTimer: null
  }
  personalChannelStates.set(projectId, state)
  await createPersonalChannel(projectId, state)
}

/**
 * Unsubscribe from a single personal-project Realtime channel. Used when a
 * membership DELETE arrives on the user channel (project removed remotely).
 */
export async function unsubscribePersonalProject(projectId: string): Promise<void> {
  const state = personalChannelStates.get(projectId)
  if (!state) return
  state.cancelled = true
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer)
    state.reconnectTimer = null
  }
  if (state.channel) {
    const supabase = await getSupabase()
    try { await supabase.removeChannel(state.channel) } catch { /* already dead */ }
  }
  personalChannelStates.delete(projectId)
}

/**
 * Unsubscribe from all personal-project Realtime channels.
 */
export async function unsubscribeAllPersonal(): Promise<void> {
  const supabase = await getSupabase()
  for (const state of personalChannelStates.values()) {
    state.cancelled = true
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer)
      state.reconnectTimer = null
    }
    if (state.channel) {
      try { await supabase.removeChannel(state.channel) } catch { /* ignore */ }
    }
  }
  personalChannelStates.clear()
}

// ── Online/Offline Detection ─────────────────────────────────────────

let offlineCleanup: (() => void) | null = null

/**
 * Debounce offline transitions: brief blips (< OFFLINE_DEBOUNCE_MS) are ignored
 * so the UI doesn't flash red for sub-second network hiccups.
 */
const OFFLINE_DEBOUNCE_MS = 3000

/**
 * Start monitoring online/offline status using Supabase Realtime + navigator.onLine.
 */
export function startOnlineMonitoring(): () => void {
  const syncStore = useSyncStore.getState()
  let pendingOfflineTimer: ReturnType<typeof setTimeout> | null = null
  let committedOffline = false

  const clearPending = (): void => {
    if (pendingOfflineTimer) {
      clearTimeout(pendingOfflineTimer)
      pendingOfflineTimer = null
    }
  }

  const handleOnline = (): void => {
    clearPending()
    if (!committedOffline) return
    committedOffline = false
    syncStore.setStatus('synced')
    logEvent('info', 'network', 'Browser reports online')
    // Force-reconnect every Realtime channel — they were paused on 'offline' so
    // they wouldn't burn retries while disconnected.
    void forceReconnectAllPersonal().catch(() => {})
    void import('./SyncService').then(({ forceReconnectAllShared }) =>
      forceReconnectAllShared().catch(() => {})
    )
    // Flush sync queue on reconnect, then run a reconcile pass to detect/repair drift
    import('./SyncService').then(({ processSyncQueue }) => {
      processSyncQueue().then((count) => {
        if (count > 0) console.log(`[PersonalSync] Flushed ${count} queued changes`)
        import('../shared/stores/authStore').then(({ useAuthStore }) => {
          const userId = useAuthStore.getState().currentUser?.id
          if (userId) {
            reconcile(userId).catch((err) => console.error('[PersonalSync] Reconnect reconcile failed:', err))
          }
        })
      })
    })
  }

  const handleOffline = (): void => {
    if (pendingOfflineTimer || committedOffline) return
    pendingOfflineTimer = setTimeout(() => {
      pendingOfflineTimer = null
      // Confirm we're still offline before flipping the status
      if (!navigator.onLine) {
        committedOffline = true
        syncStore.setStatus('offline')
        logEvent('warn', 'network', `Browser offline for ${OFFLINE_DEBOUNCE_MS / 1000}s — marking offline`)
        // Cancel any pending reconnect timers — they'll just fail and burn cycles.
        // The 'online' listener calls forceReconnectAllPersonal() to rebuild.
        pauseReconnectsForSuspend()
        void import('./SyncService').then(({ pauseSharedReconnectsForSuspend }) => {
          pauseSharedReconnectsForSuspend()
        })
      }
    }, OFFLINE_DEBOUNCE_MS)
  }

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  // Set initial status
  if (!navigator.onLine) {
    committedOffline = true
    syncStore.setStatus('offline')
  }

  const cleanup = (): void => {
    clearPending()
    window.removeEventListener('online', handleOnline)
    window.removeEventListener('offline', handleOffline)
  }

  offlineCleanup = cleanup
  return cleanup
}

export function stopOnlineMonitoring(): void {
  offlineCleanup?.()
  offlineCleanup = null
}
