/**
 * PersonalSyncService — handles syncing personal (non-shared) project data
 * and user-level data (settings, themes, saved views, areas, labels) to Supabase.
 *
 * SQLite is always the source of truth. Every local write pushes to Supabase
 * in the background. On new device, all data is pulled from Supabase.
 */
import type { RealtimeChannel } from '@supabase/supabase-js'
import { getSupabase } from '../lib/supabase'
import { useSyncStore } from '../shared/stores/syncStore'
import { logEvent } from '../shared/stores/logStore'
import type { Task, Status, Label, SyncOperation, ThemeConfig } from '../../../shared/types'
import { placeholderEmail } from '../../../shared/placeholderUser'
import { SYNC_TABLES, reconcileTable } from './syncTables'
import { requireSession } from './sessionRecovery'

/**
 * Returns true if a live Supabase session exists. All push/delete functions
 * call this before issuing a write — without it, the request would go out
 * unauthenticated and Supabase would reject it with RLS 42501. Skipping
 * cleanly is preferable to spamming error logs; the change stays in local
 * SQLite and the post-recovery reconcile picks it up.
 */
async function hasLiveSession(context: string, idDescriptor: string): Promise<boolean> {
  const session = await requireSession()
  if (!session) {
    logEvent('warn', 'sync', `${context} skipped — no session`, idDescriptor)
    return false
  }
  return true
}

/** Mark a successful push in the sync store */
function markSynced(): void {
  useSyncStore.getState().setLastSynced()
}

/**
 * Route a sync push failure through every channel a user/operator might watch:
 * - console (kept for dev)
 * - Settings → Logs panel (logEvent — also feeds the anomaly detector)
 * - sync_queue (so reconnect/queue-drain retries it)
 * - syncStore.errorMessage + status='error' (red dot)
 * - pendingCount refresh (so queue-stuck tooltip stays accurate)
 *
 * Without this, non-thrown Supabase errors (RLS denial, 5xx) are swallowed and
 * the app reports "synced just now" while local rows never reach Supabase.
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
  console.error(`[PersonalSync] ${context} error:`, msg, code, details, `id=${rowId}`)
  logEvent('error', 'sync', `${context} failed: ${msg}`, `table=${table} id=${rowId} code=${code} details=${details}`)
  try {
    await window.api.sync.enqueue(table, rowId, operation, payload)
  } catch (e) {
    console.error('[PersonalSync] Failed to enqueue after push error:', e)
  }
  useSyncStore.getState().setError(msg || `${context} failed`)
  void useSyncStore.getState().refreshPendingCount()
}

/** Track consecutive auth failures — surface after 2 in a row to avoid false alarms */
let authFailureCount = 0
let refreshAttemptedThisCycle = false

async function attemptSessionRefresh(): Promise<boolean> {
  if (refreshAttemptedThisCycle) return false
  refreshAttemptedThisCycle = true
  try {
    const supabase = await getSupabase()
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data.session) {
      console.error('[PersonalSync] Session refresh failed:', error?.message)
      return false
    }
    // Store the refreshed session for persistence across restarts
    await window.api.auth.storeSession(JSON.stringify({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token
    }))
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

function handleSyncError(context: string, error: { message?: string; code?: string; status?: number } | unknown): void {
  const err = error as { message?: string; code?: string; status?: number }
  const isAuth = err?.status === 401 || err?.status === 403 || err?.code === 'PGRST301' || err?.code === '42501'
    || err?.message?.includes('JWT') || err?.message?.includes('expired')
    || err?.message?.includes('unauthorized') || err?.message?.includes('row-level security')
  if (isAuth) {
    authFailureCount++
    if (authFailureCount >= 2) {
      // Try to refresh the session automatically before surfacing error
      attemptSessionRefresh().then((refreshed) => {
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
const pendingSettings = new Map<string, { key: string; value: string; userId: string }>()
let settingsFlushTimer: ReturnType<typeof setTimeout> | null = null

function flushSettingsBuffer(): void {
  const entries = [...pendingSettings.values()]
  pendingSettings.clear()
  settingsFlushTimer = null
  for (const entry of entries) {
    pushSettingImmediate(entry.key, entry.value, entry.userId)
  }
}

/** Cache of project ID → name for readable logs */
const projectNameCache = new Map<string, string>()

export function cacheProjectNames(projects: Array<{ id: string; name: string }>): void {
  for (const p of projects) projectNameCache.set(p.id, p.name)
}

/** Ensure a project + membership exists in Supabase before pushing tasks/statuses */
async function ensureProjectInSupabase(projectId: string): Promise<void> {
  if (confirmedProjects.has(projectId)) return

  const project = await window.api.projects.findById(projectId)
  if (!project) return

  await pushProject(project)
  confirmedProjects.add(projectId)
}

// ── Push Operations ──────────────────────────────────────────────────

/**
 * Push a single task to Supabase (upsert).
 */
export async function pushTask(task: Task): Promise<void> {
  if (!(await hasLiveSession('pushTask', `task=${task.id}`))) return
  try {
    const supabase = await getSupabase()

    // Ensure the project exists in Supabase (RLS requires project_members entry)
    await ensureProjectInSupabase(task.project_id)

    // task_labels is the source of truth; we used to also write a denormalized
    // `tasks.label_names` JSON for the shared-project Realtime fast-path, but
    // it caused rename drift and isn't needed once realtime handlers query the
    // junction directly. We still load labelIds here for the post-push junction
    // diff below.
    const taskLabels = await window.api.tasks.getLabels(task.id)
    const labelIds = taskLabels.map((tl) => tl.label_id)

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
      await reportPushFailure('pushTask', error, 'tasks', task.id, JSON.stringify(payload))
    } else {
      markSynced()
      logEvent('info', 'sync', `Pushed task "${task.title}"`, `id=${task.id} project=${task.project_id}`)
      // Sync the task_labels junction — the tasks.label_names JSON is denormalized
      // metadata only; the junction is what cross-device task_labels reads use.
      // Diff local vs remote and apply both directions so add/remove on this device
      // propagates to Supabase.
      try {
        const { data: remoteTaskLabels } = await supabase
          .from('task_labels')
          .select('label_id')
          .eq('task_id', task.id)
        const remoteLabelIds = new Set<string>((remoteTaskLabels ?? []).map((r) => r.label_id as string))
        const localLabelIds = new Set<string>(labelIds)
        const toInsert = labelIds.filter((id) => !remoteLabelIds.has(id))
        const toDelete = [...remoteLabelIds].filter((id) => !localLabelIds.has(id))
        if (toInsert.length > 0) {
          const { error: insertErr } = await supabase
            .from('task_labels')
            .upsert(toInsert.map((labelId) => ({ task_id: task.id, label_id: labelId })))
          if (insertErr) {
            await reportPushFailure('pushTaskLabels', insertErr, 'task_labels', task.id, JSON.stringify({ task_id: task.id, insert: toInsert }))
          }
        }
        if (toDelete.length > 0) {
          const { error: deleteErr } = await supabase
            .from('task_labels')
            .delete()
            .eq('task_id', task.id)
            .in('label_id', toDelete)
          if (deleteErr) {
            await reportPushFailure('pushTaskLabels', deleteErr, 'task_labels', task.id, JSON.stringify({ task_id: task.id, delete: toDelete }))
          }
        }
      } catch (e) {
        await reportPushFailure('pushTaskLabels', e, 'task_labels', task.id, JSON.stringify({ task_id: task.id }))
      }
      // Flag pushes of is_archived on shared projects — after the v1.4.3 fix this
      // should never happen from auto-archive, so any occurrence warrants a look.
      if (task.is_archived === 1) {
        const project = await window.api.projects.findById(task.project_id)
        if (project?.is_shared === 1) {
          logEvent('warn', 'sync', `Pushed is_archived=1 on shared task "${task.title}"`, `task=${task.id} project=${task.project_id}`)
        }
      }
    }
  } catch (err) {
    await reportPushFailure('pushTask', err, 'tasks', task.id, JSON.stringify(task))
  }
}

/**
 * Soft-delete a task in Supabase. Sets deleted_at + updated_at; the row stays
 * for 30 days so other devices observe the tombstone before purge runs.
 */
export async function deleteTaskFromSupabase(taskId: string): Promise<void> {
  recentlyDeletedIds.add(taskId)
  if (!(await hasLiveSession('deleteTask', `task=${taskId}`))) return
  try {
    const supabase = await getSupabase()
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('tasks')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', taskId)
    if (error) {
      await reportPushFailure('deleteTask', error, 'tasks', taskId, JSON.stringify({ id: taskId }), 'DELETE')
    } else {
      markSynced()
      logEvent('info', 'sync', 'Soft-deleted task', `id=${taskId}`)
    }
  } catch (err) {
    await reportPushFailure('deleteTask', err, 'tasks', taskId, JSON.stringify({ id: taskId }), 'DELETE')
  }
}

/**
 * Push a status to Supabase.
 */
export async function pushStatus(status: Status): Promise<void> {
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
  if (!(await hasLiveSession('pushStatus', `status=${status.id}`))) return
  try {
    await ensureProjectInSupabase(status.project_id)
    const supabase = await getSupabase()
    const { error } = await supabase.from('statuses').upsert(payload)
    if (error) {
      await reportPushFailure('pushStatus', error, 'statuses', status.id, JSON.stringify(payload))
    } else {
      markSynced()
      logEvent('info', 'sync', `Pushed status "${status.name}"`, `id=${status.id} project=${status.project_id}`)
    }
  } catch (err) {
    await reportPushFailure('pushStatus', err, 'statuses', status.id, JSON.stringify(payload))
  }
}

/**
 * Push a label to user_labels in Supabase.
 */
export async function pushLabel(label: Label, userId: string): Promise<void> {
  const payload = {
    id: label.id,
    user_id: userId,
    name: label.name,
    color: label.color,
    order_index: label.order_index,
    updated_at: label.updated_at,
    deleted_at: label.deleted_at ?? null
  }
  if (!(await hasLiveSession('pushLabel', `label=${label.id}`))) return
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_labels').upsert(payload)
    if (error) await reportPushFailure('pushLabel', error, 'user_labels', label.id, JSON.stringify(payload))
    else {
      markSynced()
      logEvent('info', 'sync', `Pushed label "${label.name}"`, `id=${label.id}`)
    }
  } catch (err) {
    await reportPushFailure('pushLabel', err, 'user_labels', label.id, JSON.stringify(payload))
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
  deletedAt: string | null
): Promise<void> {
  if (!(await hasLiveSession('pushProjectLabel', `${projectId}::${labelId}`))) return
  try {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('project_labels')
      .upsert(
        {
          project_id: projectId,
          label_id: labelId,
          created_at: new Date().toISOString(),
          deleted_at: deletedAt
        },
        { onConflict: 'project_id,label_id' }
      )
    if (error) {
      await reportPushFailure(
        'pushProjectLabel',
        error,
        'project_labels',
        `${projectId}::${labelId}`,
        JSON.stringify({ projectId, labelId, deletedAt })
      )
    } else {
      markSynced()
    }
  } catch (err) {
    await reportPushFailure(
      'pushProjectLabel',
      err,
      'project_labels',
      `${projectId}::${labelId}`,
      JSON.stringify({ projectId, labelId, deletedAt })
    )
  }
}

/**
 * Soft-delete a label in Supabase by stamping deleted_at + updated_at.
 * Hard-DELETE is reserved for the 30-day purge job; tombstones are how
 * other devices learn the label is gone (Realtime UPDATE event).
 */
export async function deleteLabelFromSupabase(labelId: string): Promise<void> {
  if (!(await hasLiveSession('deleteLabel', `label=${labelId}`))) return
  try {
    const supabase = await getSupabase()
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('user_labels')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', labelId)
    if (error) {
      await reportPushFailure('deleteLabel', error, 'user_labels', labelId, JSON.stringify({ id: labelId }), 'UPDATE')
    } else {
      markSynced()
      logEvent('info', 'sync', 'Soft-deleted label', `id=${labelId}`)
    }
  } catch (err) {
    await reportPushFailure('deleteLabel', err, 'user_labels', labelId, JSON.stringify({ id: labelId }), 'UPDATE')
  }
}

/**
 * Push a setting to user_settings in Supabase (immediate, no debounce).
 */
async function pushSettingImmediate(key: string, value: string, userId: string): Promise<void> {
  const id = `${userId}:${key}`
  const payload = {
    id,
    user_id: userId,
    key,
    value,
    updated_at: new Date().toISOString()
  }
  if (!(await hasLiveSession('pushSetting', `id=${id}`))) return
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_settings').upsert(payload)
    if (error) await reportPushFailure('pushSetting', error, 'user_settings', id, JSON.stringify(payload))
    else {
      markSynced()
      logEvent('info', 'sync', `Pushed setting "${key}"`, `id=${id}`)
    }
  } catch (err) {
    await reportPushFailure('pushSetting', err, 'user_settings', id, JSON.stringify(payload))
  }
}

/**
 * Push a setting to Supabase with 5s debounce to batch rapid changes.
 */
export function pushSetting(key: string, value: string, userId: string): void {
  pendingSettings.set(`${userId}:${key}`, { key, value, userId })
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
  const payload = {
    ...view,
    deleted_at: view.deleted_at ?? null,
    updated_at: new Date().toISOString()
  }
  if (!(await hasLiveSession('pushSavedView', `id=${view.id}`))) return
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_saved_views').upsert(payload)
    if (error) await reportPushFailure('pushSavedView', error, 'user_saved_views', view.id, JSON.stringify(payload))
    else {
      markSynced()
      logEvent('info', 'sync', `Pushed saved view "${view.name}"`, `id=${view.id}`)
    }
  } catch (err) {
    await reportPushFailure('pushSavedView', err, 'user_saved_views', view.id, JSON.stringify(payload))
  }
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
  const payload = {
    ...area,
    deleted_at: area.deleted_at ?? null,
    updated_at: new Date().toISOString()
  }
  if (!(await hasLiveSession('pushProjectArea', `id=${area.id}`))) return
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_project_areas').upsert(payload)
    if (error) await reportPushFailure('pushProjectArea', error, 'user_project_areas', area.id, JSON.stringify(payload))
    else {
      markSynced()
      logEvent('info', 'sync', `Pushed project area "${area.name}"`, `id=${area.id}`)
    }
  } catch (err) {
    await reportPushFailure('pushProjectArea', err, 'user_project_areas', area.id, JSON.stringify(payload))
  }
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
  if (!(await hasLiveSession('pushProjectTemplate', `template=${template.id}`))) return
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('project_templates').upsert(template)
    if (error) {
      await reportPushFailure(
        'pushProjectTemplate',
        error,
        'project_templates',
        template.id,
        JSON.stringify(template)
      )
    } else {
      markSynced()
      logEvent('info', 'sync', `Pushed project template "${template.name}"`, `id=${template.id}`)
    }
  } catch (err) {
    await reportPushFailure(
      'pushProjectTemplate',
      err,
      'project_templates',
      template.id,
      JSON.stringify(template)
    )
  }
}

/**
 * Soft-delete a project template on Supabase.
 */
export async function deleteProjectTemplateFromSupabase(templateId: string): Promise<void> {
  const now = new Date().toISOString()
  const payload = { deleted_at: now, updated_at: now }
  if (!(await hasLiveSession('deleteProjectTemplate', `id=${templateId}`))) return
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('project_templates').update(payload).eq('id', templateId)
    if (error) {
      await reportPushFailure(
        'deleteProjectTemplate',
        error,
        'project_templates',
        templateId,
        JSON.stringify(payload),
        'UPDATE'
      )
    } else {
      markSynced()
      logEvent('info', 'sync', 'Soft-deleted project template', `id=${templateId}`)
    }
  } catch (err) {
    await reportPushFailure(
      'deleteProjectTemplate',
      err,
      'project_templates',
      templateId,
      JSON.stringify(payload),
      'UPDATE'
    )
  }
}

/**
 * Delete a saved view from Supabase.
 */
export async function deleteSavedViewFromSupabase(viewId: string): Promise<void> {
  const now = new Date().toISOString()
  const payload = { deleted_at: now, updated_at: now }
  if (!(await hasLiveSession('deleteSavedView', `id=${viewId}`))) return
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_saved_views').update(payload).eq('id', viewId)
    if (error) {
      await reportPushFailure('deleteSavedView', error, 'user_saved_views', viewId, JSON.stringify(payload), 'UPDATE')
    } else {
      markSynced()
      logEvent('info', 'sync', 'Soft-deleted saved view', `id=${viewId}`)
    }
  } catch (err) {
    await reportPushFailure('deleteSavedView', err, 'user_saved_views', viewId, JSON.stringify(payload), 'UPDATE')
  }
}

/**
 * Delete a project area from Supabase.
 */
export async function deleteProjectAreaFromSupabase(areaId: string): Promise<void> {
  const now = new Date().toISOString()
  const payload = { deleted_at: now, updated_at: now }
  if (!(await hasLiveSession('deleteProjectArea', `id=${areaId}`))) return
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_project_areas').update(payload).eq('id', areaId)
    if (error) {
      await reportPushFailure('deleteProjectArea', error, 'user_project_areas', areaId, JSON.stringify(payload), 'UPDATE')
    } else {
      markSynced()
      logEvent('info', 'sync', 'Soft-deleted project area', `id=${areaId}`)
    }
  } catch (err) {
    await reportPushFailure('deleteProjectArea', err, 'user_project_areas', areaId, JSON.stringify(payload), 'UPDATE')
  }
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
  created_at?: string
  updated_at?: string
  deleted_at?: string | null
}): Promise<void> {
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
    created_at: theme.created_at ?? now,
    updated_at: theme.updated_at ?? now,
    deleted_at: theme.deleted_at ?? null
  }
  if (!(await hasLiveSession('pushTheme', `id=${theme.id}`))) return
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_themes').upsert(payload)
    if (error) await reportPushFailure('pushTheme', error, 'user_themes', theme.id, JSON.stringify(payload))
    else {
      markSynced()
      logEvent('info', 'sync', `Pushed theme "${theme.name}"`, `id=${theme.id} mode=${theme.mode}`)
    }
  } catch (err) {
    await reportPushFailure('pushTheme', err, 'user_themes', theme.id, JSON.stringify(payload))
  }
}

/**
 * Soft-delete a theme in Supabase by stamping deleted_at + updated_at.
 * Hard-DELETE is reserved for the 30-day purge job; tombstones propagate
 * via Realtime UPDATE so other devices can drop the row.
 */
export async function deleteThemeFromSupabase(themeId: string): Promise<void> {
  if (!(await hasLiveSession('deleteTheme', `id=${themeId}`))) return
  try {
    const supabase = await getSupabase()
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('user_themes')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', themeId)
    if (error) {
      await reportPushFailure('deleteTheme', error, 'user_themes', themeId, JSON.stringify({ id: themeId }), 'UPDATE')
    } else {
      markSynced()
      logEvent('info', 'sync', 'Soft-deleted theme', `id=${themeId}`)
    }
  } catch (err) {
    await reportPushFailure('deleteTheme', err, 'user_themes', themeId, JSON.stringify({ id: themeId }), 'UPDATE')
  }
}

/**
 * Soft-delete a setting in Supabase by stamping deleted_at + updated_at.
 * Hard-DELETE is reserved for the 30-day purge job.
 */
export async function deleteSettingFromSupabase(key: string, userId: string): Promise<void> {
  const id = `${userId}:${key}`
  if (!(await hasLiveSession('deleteSetting', `id=${id}`))) return
  try {
    const supabase = await getSupabase()
    const now = new Date().toISOString()
    const { error } = await supabase
      .from('user_settings')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', id)
    if (error) {
      await reportPushFailure('deleteSetting', error, 'user_settings', id, JSON.stringify({ id }), 'UPDATE')
    } else {
      markSynced()
      logEvent('info', 'sync', `Soft-deleted setting "${key}"`, `id=${id}`)
    }
  } catch (err) {
    await reportPushFailure('deleteSetting', err, 'user_settings', id, JSON.stringify({ id }), 'UPDATE')
  }
}

/**
 * Soft-delete a status in Supabase by setting deleted_at. Hard-DELETE is reserved
 * for the 30-day purge job — a soft tombstone propagates via Realtime UPDATE.
 */
export async function deleteStatusFromSupabase(statusId: string): Promise<void> {
  const now = new Date().toISOString()
  if (!(await hasLiveSession('deleteStatus', `id=${statusId}`))) return
  try {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('statuses')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', statusId)
    if (error) {
      await reportPushFailure('deleteStatus', error, 'statuses', statusId, JSON.stringify({ id: statusId, deleted_at: now }), 'UPDATE')
    } else {
      logEvent('info', 'sync', `Soft-deleted status`, `id=${statusId}`)
      markSynced()
    }
  } catch (err) {
    await reportPushFailure('deleteStatus', err, 'statuses', statusId, JSON.stringify({ id: statusId, deleted_at: now }), 'UPDATE')
  }
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
  const now = new Date().toISOString()
  if (!(await hasLiveSession('deleteProject', `id=${projectId}`))) return
  try {
    const supabase = await getSupabase()

    // Cascade tombstones to children first so any device pulling sees consistent state.
    const { error: tasksErr } = await supabase
      .from('tasks')
      .update({ deleted_at: now, updated_at: now })
      .eq('project_id', projectId)
      .is('deleted_at', null)
    if (tasksErr) {
      logEvent('error', 'sync', `deleteProject tasks soft-delete error: ${tasksErr.message}`, `project=${projectId}`)
      useSyncStore.getState().setError(tasksErr.message)
      return
    }

    const { error: stsErr } = await supabase
      .from('statuses')
      .update({ deleted_at: now, updated_at: now })
      .eq('project_id', projectId)
      .is('deleted_at', null)
    if (stsErr) {
      logEvent('error', 'sync', `deleteProject statuses soft-delete error: ${stsErr.message}`, `project=${projectId}`)
      useSyncStore.getState().setError(stsErr.message)
      return
    }

    // project_members is a junction without sync identity — physical remove is fine.
    const { error: memberErr } = await supabase.from('project_members').delete().eq('project_id', projectId)
    if (memberErr) {
      logEvent('error', 'sync', `deleteProject members error: ${memberErr.message}`, `project=${projectId}`)
      useSyncStore.getState().setError(memberErr.message)
      return
    }

    const { error: projErr } = await supabase
      .from('projects')
      .update({ deleted_at: now, updated_at: now })
      .eq('id', projectId)
    if (projErr) {
      logEvent('error', 'sync', `deleteProject error: ${projErr.message}`, `project=${projectId}`)
      useSyncStore.getState().setError(projErr.message)
    } else {
      logEvent('info', 'sync', `Soft-deleted project`, `id=${projectId}`)
      markSynced()
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'deleteProject threw'
    console.error('[PersonalSync] deleteProject failed:', err)
    logEvent('error', 'sync', `deleteProject threw: ${msg}`, `project=${projectId}`)
    useSyncStore.getState().setError(msg)
  }
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
  created_at: string
  updated_at: string
}): Promise<void> {
  if (!(await hasLiveSession('pushProject', `id=${project.id}`))) return
  try {
    const supabase = await getSupabase()
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
      useSyncStore.getState().setError(msg)
    } else {
      markSynced()
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
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'pushProject threw'
    console.error('[PersonalSync] pushProject failed:', err)
    logEvent('error', 'sync', `pushProject threw: ${msg}`, `project=${project.id}`)
    useSyncStore.getState().setError(msg)
  }
}

// ── Full Upload (first-time sync) ────────────────────────────────────

/**
 * Upload ALL local data to Supabase (first-time sync).
 * Shows progress via syncStore.
 */
export async function fullUpload(userId: string): Promise<void> {
  const syncStore = useSyncStore.getState()
  syncStore.setFirstSync(true)
  syncStore.setStatus('syncing')

  try {
    const supabase = await getSupabase()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) throw new Error('No authenticated session')

    // Sentinel: claim last_sync_at up-front so a concurrent initSync caller
    // sees it and skips fullUpload instead of starting a parallel upload.
    // The real timestamp is written at the end of this function.
    await window.api.settings.set(userId, 'last_sync_at', new Date().toISOString())

    // Count total items for progress — only sync projects owned by this user
    const allProjects = await window.api.projects.getProjectsForUser(userId)
    const projects = allProjects.filter((p) => p.owner_id === userId)
    const allLabels = await window.api.labels.findAll(userId)
    const allSettings = await window.api.settings.getAll(userId)
    const savedViews = await window.api.savedViews.findByUserId(userId)

    let totalItems = projects.length + allLabels.length + allSettings.length + savedViews.length
    let completed = 0

    const updateProgress = (): void => {
      completed++
      syncStore.setFirstSyncProgress(Math.round((completed / totalItems) * 100))
    }

    // 1. Push all labels
    for (const label of allLabels) {
      await pushLabel(label, userId)
      updateProgress()
    }

    // 2. Push all projects (with statuses and tasks)
    for (const project of projects) {
      await pushProject(project)
      updateProgress()

      // Push statuses
      const statuses = await window.api.statuses.findByProjectId(project.id)
      totalItems += statuses.length
      for (const status of statuses) {
        await pushStatus(status)
        updateProgress()
      }

      // Push project↔label associations to the project_labels junction
      // (the legacy `projects.label_data` JSON is no longer written — the
      // junction is the source of truth, with proper tombstones + LWW).
      const projectLabels = await window.api.labels.findByProjectId(project.id)
      if (projectLabels.length > 0) {
        const rows = projectLabels.map((l) => ({
          project_id: project.id,
          label_id: l.id,
          created_at: new Date().toISOString(),
          deleted_at: null
        }))
        const { error: plErr } = await supabase
          .from('project_labels')
          .upsert(rows, { onConflict: 'project_id,label_id' })
        if (plErr) {
          logEvent(
            'warn',
            'sync',
            `fullUpload: push project_labels failed for ${project.name}`,
            plErr.message
          )
        }
      }

      // Push ALL tasks (including archived and templates)
      // Parent tasks first, then subtasks (to satisfy FK constraint on parent_id)
      const activeTasks = await window.api.tasks.findByProjectId(project.id)
      const archivedTasks = await window.api.tasks.findArchived(project.id)
      const templateTasks = await window.api.tasks.findTemplates(project.id)
      const allTasks = [...activeTasks, ...archivedTasks, ...templateTasks]
      const parentTasks = allTasks.filter((t) => !t.parent_id)
      const subtasks = allTasks.filter((t) => t.parent_id)
      const tasks = [...parentTasks, ...subtasks]
      totalItems += tasks.length
      for (const task of tasks) {
        await pushTask(task)
        updateProgress()
      }
    }

    // 3. Push settings (immediate, not debounced — this is initial full upload)
    for (const setting of allSettings) {
      if (setting.value !== null) {
        await pushSettingImmediate(setting.key, setting.value, userId)
      }
      updateProgress()
    }

    // 4. Push saved views
    for (const view of savedViews) {
      await pushSavedView(view)
      updateProgress()
    }

    // 5. Push project areas
    try {
      const areas = await window.api.projectAreas.findByUserId(userId)
      for (const area of areas) {
        await pushProjectArea({ ...area, user_id: userId })
      }
    } catch { /* areas might not exist */ }

    // 6. Push themes (parse config JSON inline)
    try {
      const themes = await window.api.themes.list(userId)
      for (const theme of themes) {
        try {
          const config = JSON.parse(theme.config) as Record<string, string>
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
            created_at: theme.created_at,
            updated_at: theme.updated_at
          })
        } catch { /* skip themes with invalid config */ }
      }
    } catch { /* themes might not exist */ }

    // 7. Push task_labels (junction table)
    for (const project of projects) {
      const tasks = await window.api.tasks.findByProjectId(project.id)
      for (const task of tasks) {
        const taskLabels = await window.api.tasks.getLabels(task.id)
        if (taskLabels.length > 0) {
          for (const tl of taskLabels) {
            await supabase.from('task_labels').upsert({
              task_id: tl.task_id,
              label_id: tl.label_id
            }).then(({ error }) => {
              if (error) console.error('[PersonalSync] pushTaskLabel error:', error.message)
            })
          }
        }
      }
    }

    // Verify sync by checking counts
    const { count: sbProjects } = await supabase.from('project_members').select('*', { count: 'exact', head: true }).eq('user_id', userId)
    const { count: sbStatuses } = await supabase.from('statuses').select('*', { count: 'exact', head: true })
    const { count: sbTasks } = await supabase.from('tasks').select('*', { count: 'exact', head: true })
    console.log(`[PersonalSync] Full upload done — Supabase: ${sbProjects} project memberships, ${sbStatuses} statuses, ${sbTasks} tasks (local: ${projects.length} projects, ${totalItems} total items)`)

    // Mark sync complete
    await window.api.settings.set(userId, 'last_sync_at', new Date().toISOString())
    syncStore.setLastSynced()
    syncStore.setFirstSync(false)
  } catch (err) {
    console.error('[PersonalSync] Full upload failed:', err)
    syncStore.setError(err instanceof Error ? err.message : 'Sync failed')
    syncStore.setFirstSync(false)
  }
}

// ── Full Pull (new device) ───────────────────────────────────────────

/**
 * Pull ALL data from Supabase to populate an empty local database (new device).
 */
export async function fullPull(userId: string): Promise<void> {
  const syncStore = useSyncStore.getState()
  syncStore.setFirstSync(true)
  syncStore.setStatus('syncing')

  try {
    const supabase = await getSupabase()

    // 1. Pull labels
    syncStore.setFirstSyncProgress(10)
    const { data: remoteLabels } = await supabase
      .from('user_labels')
      .select('*')
      .eq('user_id', userId)

    if (remoteLabels) {
      for (const label of remoteLabels) {
        const existing = await window.api.labels.findById(label.id)
        if (!existing) {
          // Dedupe: if a label with the same (user_id, name) already exists locally,
          // don't create a duplicate row — let the existing row stand. The project_labels
          // wiring below points at it via name lookup, so the duplicate Supabase row
          // becomes orphaned and gets cleaned up by the next reconcile/cleanup pass.
          const sameName = await window.api.labels.findByName(userId, label.name)
          if (!sameName) {
            await window.api.labels.create({
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
    syncStore.setFirstSyncProgress(20)
    const { data: memberships } = await supabase
      .from('project_members')
      .select('project_id')
      .eq('user_id', userId)

    if (memberships) {
      const total = memberships.length
      for (let i = 0; i < total; i++) {
        const m = memberships[i]
        const localProject = await window.api.projects.findById(m.project_id)
        if (!localProject) {
          // Fetch project details
          const { data: project } = await supabase
            .from('projects')
            .select('*')
            .eq('id', m.project_id)
            .single()

          if (project) {
            // Create project locally
            await window.api.projects.create({
              id: project.id,
              name: project.name,
              description: project.description,
              color: project.color ?? '#888888',
              icon: project.icon ?? 'folder',
              owner_id: project.owner_id,
              is_default: 0
            })
            await window.api.projects.addMember(project.id, userId, project.owner_id === userId ? 'owner' : 'member')

            // Mark as shared so auto-archive skips this project on the local device.
            await window.api.projects.update(project.id, { is_shared: 1 })
            logEvent('info', 'sync', `Marked project "${project.name}" as shared (initSync)`, `project=${project.id}`)

            // Sync auto-archive settings
            if (project.auto_archive_enabled !== undefined) {
              await window.api.projects.update(project.id, {
                auto_archive_enabled: project.auto_archive_enabled ?? 0,
                auto_archive_value: project.auto_archive_value ?? 3,
                auto_archive_unit: project.auto_archive_unit ?? 'days'
              })
            }

            // Sync statuses
            const { data: statuses } = await supabase
              .from('statuses')
              .select('*')
              .eq('project_id', project.id)

            if (statuses) {
              for (const s of statuses) {
                const existingStatus = await window.api.statuses.findById(s.id)
                if (!existingStatus) {
                  await window.api.statuses.create({
                    id: s.id,
                    project_id: s.project_id,
                    name: s.name,
                    color: s.color,
                    icon: s.icon,
                    order_index: s.order_index,
                    is_done: s.is_done,
                    is_default: s.is_default
                  })
                }
              }
            }

            // Sync tasks
            const { data: tasks } = await supabase
              .from('tasks')
              .select('*')
              .eq('project_id', project.id)

            if (tasks) {
              // Parents before subtasks so the parent_id FK is always satisfied.
              const orderedTasks = [
                ...tasks.filter((t) => !t.parent_id),
                ...tasks.filter((t) => t.parent_id)
              ]
              for (const task of orderedTasks) {
                const existingTask = await window.api.tasks.findById(task.id)
                if (!existingTask) {
                  // Ensure owner exists
                  const localOwner = await window.api.users.findById(task.owner_id)
                  if (!localOwner) {
                    await window.api.users.create({ id: task.owner_id, email: placeholderEmail(task.owner_id), display_name: null, avatar_url: null }).catch(() => {})
                  }
                  try {
                    await window.api.tasks.create({
                    id: task.id,
                    project_id: task.project_id,
                    owner_id: task.owner_id,
                    title: task.title,
                    description: task.description,
                    status_id: task.status_id,
                    priority: task.priority,
                    due_date: task.due_date,
                    parent_id: task.parent_id,
                    order_index: task.order_index,
                    assigned_to: task.assigned_to,
                    is_template: task.is_template,
                    is_archived: task.is_archived,
                    completed_date: task.completed_date,
                    recurrence_rule: task.recurrence_rule,
                    reference_url: task.reference_url
                  })
                  } catch (e) {
                    console.error(`[PersonalSync] initSync: failed to create task "${task.title}" (${task.id}):`, e)
                  }
                }
              }
            }

            // Sync task_labels (junction table)
            const { data: remoteTaskLabels } = await supabase
              .from('task_labels')
              .select('task_id, label_id')
              .in('task_id', (tasks ?? []).map((t) => t.id))

            if (remoteTaskLabels) {
              for (const tl of remoteTaskLabels) {
                await window.api.tasks.addLabel(tl.task_id, tl.label_id).catch(() => {})
              }
            }

            // Sync labels for project
            if (project.label_data) {
              const labels: Array<{ name: string; color: string }> = JSON.parse(project.label_data)
              for (const entry of labels) {
                let label = await window.api.labels.findByName(userId, entry.name) ?? undefined
                if (!label) {
                  label = await window.api.labels.create({ id: crypto.randomUUID(), user_id: userId, name: entry.name, color: entry.color })
                }
                await window.api.labels.addToProject(project.id, label.id).catch(() => {})
              }
            }
          }
        }
        syncStore.setFirstSyncProgress(20 + Math.round((i / total) * 50))
      }
    }

    // 3. Pull settings
    syncStore.setFirstSyncProgress(75)
    const { data: remoteSettings } = await supabase
      .from('user_settings')
      .select('key, value')
      .eq('user_id', userId)

    if (remoteSettings) {
      for (const setting of remoteSettings) {
        await window.api.settings.set(userId, setting.key, setting.value)
      }
    }

    // 4. Pull saved views
    syncStore.setFirstSyncProgress(85)
    const { data: remoteViews } = await supabase
      .from('user_saved_views')
      .select('*')
      .eq('user_id', userId)

    if (remoteViews) {
      for (const view of remoteViews) {
        const existing = await window.api.savedViews.findById(view.id)
        if (!existing) {
          await window.api.savedViews.create({
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
    syncStore.setFirstSyncProgress(90)
    const { data: remoteAreas } = await supabase
      .from('user_project_areas')
      .select('*')
      .eq('user_id', userId)

    if (remoteAreas) {
      for (const area of remoteAreas) {
        try {
          await window.api.projectAreas.create({
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
    syncStore.setFirstSyncProgress(95)
    const { data: remoteThemes } = await supabase
      .from('user_themes')
      .select('*')
      .eq('user_id', userId)

    if (remoteThemes) {
      for (const theme of remoteThemes) {
        const existing = await window.api.themes.findById(theme.id)
        if (existing) continue
        const config: ThemeConfig = {
          bg: theme.bg ?? '',
          fg: theme.fg ?? '',
          fgSecondary: theme.fg_secondary ?? theme.surface ?? '',
          fgMuted: theme.fg_muted ?? '',
          muted: theme.muted ?? '',
          accent: theme.accent ?? '',
          accentFg: theme.accent_fg ?? '',
          border: theme.border ?? ''
        }
        try {
          await window.api.themes.create({
            id: theme.id,
            name: theme.name,
            mode: theme.mode,
            config: JSON.stringify(config),
            owner_id: userId
          })
        } catch (e) {
          console.error(`[PersonalSync] fullPull: failed to create theme "${theme.name}" (${theme.id}):`, e)
        }
      }
    }

    // Mark sync complete
    await window.api.settings.set(userId, 'last_sync_at', new Date().toISOString())
    syncStore.setLastSynced()
    syncStore.setFirstSync(false)
    syncStore.setFirstSyncProgress(100)
    console.log('[PersonalSync] Full pull complete')
  } catch (err) {
    console.error('[PersonalSync] Full pull failed:', err)
    syncStore.setError(err instanceof Error ? err.message : 'Sync failed')
    syncStore.setFirstSync(false)
  }
}

/**
 * Pull tasks from Supabase that don't exist in local SQLite for a given project.
 * Returns the number of tasks pulled.
 */
/**
 * Pull project metadata (name, color, icon) from Supabase if newer than local.
 */
export async function pullProjectMetadata(projectId: string): Promise<boolean> {
  try {
    const supabase = await getSupabase()
    const { data: remote, error } = await supabase
      .from('projects')
      .select('name, color, icon, description, updated_at')
      .eq('id', projectId)
      .maybeSingle()

    if (error) {
      handleSyncError('pullProjectMetadata', error)
      return false
    }
    if (!remote) return false

    const local = await window.api.projects.findById(projectId)
    if (!local) return false

    if (remote.updated_at && local.updated_at && remote.updated_at > local.updated_at) {
      await window.api.projects.update(projectId, {
        name: remote.name,
        color: remote.color,
        icon: remote.icon,
        description: remote.description
      })
      return true
    }

    // Local is newer — only push if metadata actually differs (avoids phantom writes)
    if (local.updated_at && remote.updated_at && local.updated_at > remote.updated_at) {
      const metadataChanged =
        local.name !== remote.name ||
        local.color !== remote.color ||
        local.icon !== remote.icon ||
        (local.description ?? '') !== (remote.description ?? '')
      if (metadataChanged) {
        await pushProject(local)
      }
    }
    return false
  } catch (err) {
    handleSyncError('pullProjectMetadata', err)
    return false
  }
}

/**
 * Pull statuses from Supabase and upsert locally.
 * Must run before pullNewTasks to satisfy FK constraints.
 */
export async function pullStatuses(projectId: string): Promise<number> {
  try {
    const supabase = await getSupabase()
    const since = lastPullAt.get(`statuses:${projectId}`)
    let query = supabase.from('statuses').select('*').eq('project_id', projectId)
    if (since) query = query.gt('updated_at', since)

    const { data: remoteStatuses, error } = await query

    if (error || !remoteStatuses) return 0
    if (remoteStatuses.length === 0) return 0

    let changed = 0
    for (const rs of remoteStatuses) {
      const existing = await window.api.statuses.findById(rs.id)
      if (!existing) {
        await window.api.statuses.create({
          id: rs.id,
          project_id: rs.project_id,
          name: rs.name,
          color: rs.color,
          icon: rs.icon,
          order_index: rs.order_index,
          is_done: rs.is_done,
          is_default: rs.is_default
        })
        changed++
      } else if (rs.updated_at && existing.updated_at && rs.updated_at > existing.updated_at) {
        await window.api.statuses.update(rs.id, {
          name: rs.name,
          color: rs.color,
          icon: rs.icon,
          order_index: rs.order_index,
          is_done: rs.is_done,
          is_default: rs.is_default
        })
        changed++
      }
      // No "local newer → push" branch (same reasoning as pullNewTasks).
    }
    const pName = projectNameCache.get(projectId) ?? projectId
    if (changed > 0) console.log(`[PersonalSync] Synced ${changed} statuses for "${pName}"`)
    lastPullAt.set(`statuses:${projectId}`, new Date().toISOString())
    return changed
  } catch (err) {
    handleSyncError('pullStatuses', err)
    return 0
  }
}

export async function pullNewTasks(projectId: string): Promise<number> {
  try {
    // Ensure statuses exist locally before inserting tasks (FK constraint)
    await pullStatuses(projectId)

    const supabase = await getSupabase()
    const since = lastPullAt.get(`tasks:${projectId}`)
    let query = supabase.from('tasks').select('*').eq('project_id', projectId)
    if (since) query = query.gt('updated_at', since)

    const { data: remoteTasks, error } = await query

    if (error) {
      handleSyncError('pullNewTasks', error)
      return 0
    }
    if (!remoteTasks) return 0

    let pulled = 0
    const touchedTaskIds: string[] = []

    // Parents before subtasks so the parent_id FK is satisfied when inserting.
    const orderedRemoteTasks = [
      ...remoteTasks.filter((t) => !t.parent_id),
      ...remoteTasks.filter((t) => t.parent_id)
    ]

    for (const rt of orderedRemoteTasks) {
      if (recentlyDeletedIds.has(rt.id)) continue
      const existing = await window.api.tasks.findById(rt.id)
      if (!existing) {
        // New task — create locally
        const ownerId = rt.owner_id as string
        const localOwner = await window.api.users.findById(ownerId)
        if (!localOwner) {
          await window.api.users.create({ id: ownerId, email: placeholderEmail(ownerId), display_name: null, avatar_url: null }).catch((e) => console.warn('[PersonalSync] Failed to create local user:', e))
        }
        // Same for assigned_to, which is also a users FK.
        if (rt.assigned_to) {
          const assignedId = rt.assigned_to as string
          const localAssignee = await window.api.users.findById(assignedId)
          if (!localAssignee) {
            await window.api.users.create({ id: assignedId, email: placeholderEmail(assignedId), display_name: null, avatar_url: null }).catch(() => {})
          }
        }
        try {
          // applyRemote preserves remote timestamps; tasks.create would stamp NOW
          // into updated_at and trigger a redundant push on the next pull.
          await window.api.tasks.applyRemote({
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
          console.error(`[PersonalSync] Failed to create task "${rt.title}" (${rt.id}):`, e)
        }
      } else if (rt.updated_at && existing.updated_at && rt.updated_at > existing.updated_at) {
        // Remote is newer — update locally (preserve remote timestamps via applyRemote)
        try {
          await window.api.tasks.applyRemote({
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
          console.error(`[PersonalSync] Failed to update task "${rt.title}" (${rt.id}):`, e)
        }
      }
      // No "local newer → push" branch: pullNewTasks pulls only. Failed mutation
      // pushes are retried via sync_queue, and reconcile() catches ID-level drift.
      // Pushing here floods Supabase whenever local timestamps got bumped without
      // a matching remote update (e.g. residue from the pre-applyRemote era).
    }

    // Sync task_labels only for tasks that were actually created or updated
    if (touchedTaskIds.length > 0) {
      try {
        const { data: remoteTaskLabels } = await supabase
          .from('task_labels')
          .select('task_id, label_id')
          .in('task_id', touchedTaskIds)

        if (remoteTaskLabels && remoteTaskLabels.length > 0) {
          // Ensure all referenced labels exist locally; if a remote label is a
          // case/exact duplicate of one we already have, remap to the local id
          // so task_labels insert doesn't reference a non-existent local row.
          const labelIds = [...new Set(remoteTaskLabels.map((tl) => tl.label_id))]
          const remap = new Map<string, string>()
          const { useAuthStore } = await import('../shared/stores/authStore')
          const ownerId = useAuthStore.getState().currentUser?.id ?? null
          for (const labelId of labelIds) {
            const localLabel = await window.api.labels.findById(labelId)
            if (localLabel) continue
            const { data: remoteLabel } = await supabase
              .from('user_labels')
              .select('*')
              .eq('id', labelId)
              .single()
            if (!remoteLabel) continue
            const ownerForLabel = ownerId ?? remoteLabel.user_id ?? null
            if (!ownerForLabel) continue
            const sameName = await window.api.labels.findByName(ownerForLabel, remoteLabel.name)
            if (sameName) {
              remap.set(labelId, sameName.id)
            } else {
              await window.api.labels.create({
                id: remoteLabel.id,
                user_id: ownerForLabel,
                name: remoteLabel.name,
                color: remoteLabel.color
              }).catch(() => {})
            }
          }
          for (const tl of remoteTaskLabels) {
            const localLabelId = remap.get(tl.label_id) ?? tl.label_id
            await window.api.tasks.addLabel(tl.task_id, localLabelId).catch(() => {})
          }
        }
      } catch (e) {
        console.error('[PersonalSync] Failed to sync task_labels:', e)
      }
    }

    const pName = projectNameCache.get(projectId) ?? projectId
    if (pulled > 0) {
      console.log(`[PersonalSync] "${pName}": ${pulled} pulled`)
    }
    lastPullAt.set(`tasks:${projectId}`, new Date().toISOString())
    // Supabase responded successfully — clear any auth failure state
    clearAuthFailures()
    return pulled
  } catch (err) {
    handleSyncError('pullNewTasks', err)
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
  const supabase = await getSupabase()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    logEvent('warn', 'sync', 'Reconcile skipped — no session')
    return { pushed: 0, pulled: 0 }
  }
  reconcileInFlight = reconcileImpl(userId)
  try {
    const result = await reconcileInFlight
    lastReconcileAt = Date.now()
    return result
  } finally {
    reconcileInFlight = null
  }
}

async function reconcileImpl(userId: string): Promise<{ pushed: number; pulled: number }> {
  let totalPushed = 0
  let totalPulled = 0
  try {
    const supabase = await getSupabase()

    const runTable = async (
      tableName: Parameters<typeof reconcileTable>[0]['name'] | string,
      scopeId: string
    ): Promise<void> => {
      const desc = SYNC_TABLES[tableName as keyof typeof SYNC_TABLES]
      if (!desc) return
      try {
        const stats = await reconcileTable(
          desc as Parameters<typeof reconcileTable>[0],
          scopeId,
          userId
        )
        totalPushed += stats.pushed
        totalPulled += stats.pulled
        if (stats.skipped) {
          logEvent(
            'info',
            'sync',
            `Reconcile: ${tableName} skipped (no drift)`,
            `scope=${scopeId}`
          )
        } else if (stats.pushed || stats.pulled || stats.failed) {
          logEvent(
            stats.failed ? 'warn' : 'info',
            'sync',
            `Reconcile: ${tableName}`,
            `pushed=${stats.pushed} pulled=${stats.pulled} inSync=${stats.inSync} failed=${stats.failed} scope=${scopeId}`
          )
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logEvent('error', 'sync', `Reconcile: ${tableName} failed`, `scope=${scopeId} err=${msg}`)
      }
    }

    // 1. Owner-scoped: projects (need to land before tasks/statuses so the FK is satisfied).
    await runTable('projects', userId)

    // 2. Project-scoped: per personal project, statuses then tasks.
    const allProjects = await window.api.projects.getProjectsForUser(userId)
    const personalProjects = allProjects.filter((p) => p.owner_id === userId && p.is_shared !== 1)

    for (const project of personalProjects) {
      await runTable('statuses', project.id)
      await runTable('tasks', project.id)
    }

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

    // 4. task_labels junction — composite-PK with no updated_at, so it doesn't
    // fit reconcileTable's high-water-mark flow. Diff via key-set.
    try {
      const localPairs = await window.api.tasks.getTaskLabelsForUser(userId)
      const pairKey = (taskId: string, labelId: string): string => `${taskId}::${labelId}`
      const localKeySet = new Set<string>(localPairs.map((p) => pairKey(p.task_id, p.label_id)))

      const personalTaskIds = new Set<string>()
      for (const project of personalProjects) {
        const tasks = await window.api.tasks.findByProjectId(project.id)
        const archived = await window.api.tasks.findArchived(project.id)
        const templates = await window.api.tasks.findTemplates(project.id)
        for (const t of [...tasks, ...archived, ...templates]) personalTaskIds.add(t.id)
      }

      const taskIdList = [...personalTaskIds]
      const remotePairs: Array<{ task_id: string; label_id: string }> = []
      const chunkSize = 500
      let fetchOk = true
      for (let i = 0; i < taskIdList.length; i += chunkSize) {
        const chunk = taskIdList.slice(i, i + chunkSize)
        const { data, error: tlErr } = await supabase
          .from('task_labels')
          .select('task_id, label_id')
          .in('task_id', chunk)
        if (tlErr) {
          logEvent('error', 'sync', `Reconcile: list remote task_labels failed`, `err=${tlErr.message}`)
          fetchOk = false
          break
        }
        if (data) remotePairs.push(...data)
      }

      if (fetchOk) {
        const remoteKeySet = new Set<string>(remotePairs.map((p) => pairKey(p.task_id, p.label_id)))

        const missingInRemote = localPairs.filter((p) => !remoteKeySet.has(pairKey(p.task_id, p.label_id)))
        if (missingInRemote.length > 0) {
          // Diagnostic: log the first few pairs we think are missing remotely so
          // a recurring "31 pushed" loop can be traced — compare these against
          // remote to find why our SELECT didn't return them (RLS, FK, etc.).
          const sample = missingInRemote.slice(0, 5).map((p) => `${p.task_id}::${p.label_id}`).join(',')
          logEvent('info', 'sync', `Reconcile: task_labels diff — local=${localPairs.length} remote=${remotePairs.length} missingInRemote=${missingInRemote.length}`, `sample=${sample}`)
        }
        for (let i = 0; i < missingInRemote.length; i += chunkSize) {
          const chunk = missingInRemote.slice(i, i + chunkSize)
          // Use .select() to get back the rows that were actually upserted —
          // if RLS or a constraint silently drops rows, returned.length < chunk.length.
          const { data: returned, error: upsertErr } = await supabase
            .from('task_labels')
            .upsert(chunk.map((p) => ({ task_id: p.task_id, label_id: p.label_id })), {
              onConflict: 'task_id,label_id'
            })
            .select()
          if (upsertErr) {
            logEvent('error', 'sync', `Reconcile: push task_labels failed`, `err=${upsertErr.message}`)
            break
          }
          const actuallyInserted = returned?.length ?? 0
          if (actuallyInserted < chunk.length) {
            logEvent('warn', 'sync', `Reconcile: task_labels partial push — sent=${chunk.length} accepted=${actuallyInserted}`, 'rows silently dropped (likely RLS or FK)')
          }
          totalPushed += actuallyInserted
        }

        const missingInLocal = remotePairs.filter((p) => !localKeySet.has(pairKey(p.task_id, p.label_id)))
        for (const p of missingInLocal) {
          const localLabel = await window.api.labels.findById(p.label_id)
          if (!localLabel) continue
          try {
            await window.api.tasks.addLabel(p.task_id, p.label_id)
            totalPulled++
          } catch {
            // addLabel is idempotent (UNIQUE constraint); ignore races.
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logEvent('error', 'sync', `Reconcile: task_labels diff failed`, msg)
    }

    // 5. project_labels junction — composite-PK with no updated_at, same
    // shape as task_labels. Diff by key set, push deltas, pull missing rows
    // (with tombstone propagation).
    try {
      const localProjectLabels = await window.api.labels.getProjectLabelsForOwner(userId)
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
        const { data, error: plErr } = await supabase
          .from('project_labels')
          .select('project_id, label_id, created_at, deleted_at')
          .in('project_id', chunk)
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
          } else if ((local.deleted_at ?? null) !== (remote.deleted_at ?? null)) {
            // LWW on tombstone state — we don't have updated_at on the
            // junction, so use the most-recently-tombstoned wins.
            const localDelMs = local.deleted_at ? Date.parse(local.deleted_at) : 0
            const remoteDelMs = remote.deleted_at ? Date.parse(remote.deleted_at) : 0
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
        for (let i = 0; i < toPush.length; i += chunkSize) {
          const chunk = toPush.slice(i, i + chunkSize)
          const { error: upsertErr } = await supabase
            .from('project_labels')
            .upsert(chunk, { onConflict: 'project_id,label_id' })
          if (upsertErr) {
            logEvent('error', 'sync', 'Reconcile: push project_labels failed', `err=${upsertErr.message}`)
            break
          }
          totalPushed += chunk.length
        }

        // Pull: rows on remote that aren't local, or that have a newer
        // tombstone than local. Skip if the label_id isn't on this device
        // yet (the labels reconcile in step 3 will pull the label first;
        // the next reconcile pass picks up the link).
        for (const remote of remotePairs) {
          const key = pairKey(remote.project_id, remote.label_id)
          const local = localByKey.get(key)
          if (local) {
            const localDelMs = local.deleted_at ? Date.parse(local.deleted_at) : 0
            const remoteDelMs = remote.deleted_at ? Date.parse(remote.deleted_at) : 0
            if (remoteDelMs <= localDelMs) continue
          }
          const labelExists = await window.api.labels.findById(remote.label_id)
          if (!labelExists) continue
          await window.api.labels.applyRemoteProjectLabel({
            project_id: remote.project_id,
            label_id: remote.label_id,
            created_at: remote.created_at,
            deleted_at: remote.deleted_at
          })
          totalPulled++
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logEvent('error', 'sync', 'Reconcile: project_labels diff failed', msg)
    }

    if (totalPushed > 0 || totalPulled > 0) {
      logEvent('info', 'sync', `Reconcile complete: ${totalPushed} pushed, ${totalPulled} pulled`)
    } else {
      logEvent('info', 'sync', 'Reconcile complete: in sync')
    }

    if (totalPushed + totalPulled > 10) {
      try {
        const { useNotificationStore } = await import('../shared/stores/notificationStore')
        await useNotificationStore.getState().createNotification({
          id: crypto.randomUUID(),
          type: 'sync_reconcile',
          message: `Reconciled ${totalPushed + totalPulled} items between local and Supabase`
        })
      } catch {
        // Notification store may not be ready; skip silently.
      }
    }

    return { pushed: totalPushed, pulled: totalPulled }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[PersonalSync] reconcile failed:', err)
    logEvent('error', 'sync', `Reconcile failed: ${msg}`)
    return { pushed: totalPushed, pulled: totalPulled }
  }
}

/**
 * Check if this is a new device (no last_sync_at) and initiate appropriate sync.
 * Concurrent callers share the same in-flight promise so we never start two
 * parallel fullUploads (which would push every task N times).
 */
let initSyncInFlight: Promise<void> | null = null
export async function initSync(userId: string): Promise<void> {
  if (initSyncInFlight) return initSyncInFlight
  initSyncInFlight = (async () => {
    const lastSyncAt = await window.api.settings.get(userId, 'last_sync_at')
    const syncStore = useSyncStore.getState()

    if (!lastSyncAt) {
      const localProjects = await window.api.projects.getProjectsForUser(userId)
      const hasLocalData = localProjects.length > 0

      if (hasLocalData) {
        console.log('[PersonalSync] Local data found, uploading to Supabase')
        await fullUpload(userId)
      } else {
        console.log('[PersonalSync] No local data, pulling from Supabase')
        await fullPull(userId)
      }
    } else {
      syncStore.setLastSynced()
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
export async function syncTaskLabel(taskId: string, labelId: string): Promise<void> {
  const supabase = await getSupabase()
  // Ensure label exists locally
  const localLabel = await window.api.labels.findById(labelId)
  if (!localLabel) {
    const { data: remoteLabel } = await supabase
      .from('user_labels')
      .select('*')
      .eq('id', labelId)
      .single()
    if (remoteLabel) {
      const { useAuthStore } = await import('../shared/stores/authStore')
      const userId = useAuthStore.getState().currentUser?.id ?? remoteLabel.user_id ?? null
      const sameName = userId ? await window.api.labels.findByName(userId, remoteLabel.name) : undefined
      if (!sameName && userId) {
        await window.api.labels.create({
          id: remoteLabel.id,
          user_id: userId,
          name: remoteLabel.name,
          color: remoteLabel.color
        }).catch(() => {})
      }
    }
  }
  await window.api.tasks.addLabel(taskId, labelId).catch(() => {})
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

const RECONNECT_DELAYS_MS = [2_000, 5_000, 15_000, 30_000]
function getReconnectDelay(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)]
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
        state.onChange(payload.eventType, data)
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

  const delay = getReconnectDelay(state.attempt)
  state.attempt += 1
  const pName = projectNameCache.get(projectId) ?? projectId
  logEvent('info', 'realtime', `Reconnect in ${delay / 1000}s (attempt ${state.attempt})`, pName)

  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null
    if (state.cancelled) return
    if (!navigator.onLine) {
      logEvent('warn', 'realtime', `Reconnect deferred — offline`, pName)
      schedulePersonalReconnect(projectId)
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
  // confuses the sync state. The recovery timer's onRecovered handler
  // re-runs the subscription effect once the session is back.
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
