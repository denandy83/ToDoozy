/**
 * PersonalSyncService — handles syncing personal (non-shared) project data
 * and user-level data (settings, themes, saved views, areas, labels) to Supabase.
 *
 * SQLite is always the source of truth. Every local write pushes to Supabase
 * in the background. On new device, all data is pulled from Supabase.
 */
import { getSupabase } from '../lib/supabase'
import { useSyncStore } from '../shared/stores/syncStore'
import type { Task, Status, Label } from '../../../shared/types'

const CHUNK_SIZE = 50

// ── Push Operations ──────────────────────────────────────────────────

/**
 * Push a single task to Supabase (upsert).
 */
export async function pushTask(task: Task): Promise<void> {
  try {
    const supabase = await getSupabase()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    // Get label names for this task
    const taskLabels = await window.api.tasks.getLabels(task.id)
    const labelData: Array<{ name: string; color: string }> = []
    for (const tl of taskLabels) {
      const label = await window.api.labels.findById(tl.label_id)
      if (label) labelData.push({ name: label.name, color: label.color })
    }

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
    if (error) console.error('[PersonalSync] pushTask error:', error)
  } catch (err) {
    console.error('[PersonalSync] pushTask failed:', err)
    // Queue for later
    await window.api.sync.enqueue('tasks', task.id, 'UPDATE', JSON.stringify(task))
  }
}

/**
 * Delete a task from Supabase.
 */
export async function deleteTaskFromSupabase(taskId: string): Promise<void> {
  try {
    const supabase = await getSupabase()
    await supabase.from('tasks').delete().eq('id', taskId)
  } catch (err) {
    console.error('[PersonalSync] deleteTask failed:', err)
  }
}

/**
 * Push a status to Supabase.
 */
export async function pushStatus(status: Status): Promise<void> {
  try {
    const supabase = await getSupabase()
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
      updated_at: status.updated_at
    })
    if (error) console.error('[PersonalSync] pushStatus error:', error)
  } catch (err) {
    console.error('[PersonalSync] pushStatus failed:', err)
  }
}

/**
 * Push a label to user_labels in Supabase.
 */
export async function pushLabel(label: Label, userId: string): Promise<void> {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_labels').upsert({
      id: label.id,
      user_id: userId,
      name: label.name,
      color: label.color,
      order_index: label.order_index,
      updated_at: label.updated_at
    })
    if (error) console.error('[PersonalSync] pushLabel error:', error)
  } catch (err) {
    console.error('[PersonalSync] pushLabel failed:', err)
  }
}

/**
 * Delete a label from user_labels in Supabase.
 */
export async function deleteLabelFromSupabase(labelId: string): Promise<void> {
  try {
    const supabase = await getSupabase()
    await supabase.from('user_labels').delete().eq('id', labelId)
  } catch (err) {
    console.error('[PersonalSync] deleteLabel failed:', err)
  }
}

/**
 * Push a setting to user_settings in Supabase.
 */
export async function pushSetting(key: string, value: string, userId: string): Promise<void> {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_settings').upsert({
      id: `${userId}:${key}`,
      user_id: userId,
      key,
      value,
      updated_at: new Date().toISOString()
    })
    if (error) console.error('[PersonalSync] pushSetting error:', error)
  } catch (err) {
    console.error('[PersonalSync] pushSetting failed:', err)
  }
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
}): Promise<void> {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_saved_views').upsert({
      ...view,
      updated_at: new Date().toISOString()
    })
    if (error) console.error('[PersonalSync] pushSavedView error:', error)
  } catch (err) {
    console.error('[PersonalSync] pushSavedView failed:', err)
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
}): Promise<void> {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_project_areas').upsert({
      ...area,
      updated_at: new Date().toISOString()
    })
    if (error) console.error('[PersonalSync] pushProjectArea error:', error)
  } catch (err) {
    console.error('[PersonalSync] pushProjectArea failed:', err)
  }
}

/**
 * Delete a saved view from Supabase.
 */
export async function deleteSavedViewFromSupabase(viewId: string): Promise<void> {
  try {
    const supabase = await getSupabase()
    await supabase.from('user_saved_views').delete().eq('id', viewId)
  } catch (err) {
    console.error('[PersonalSync] deleteSavedView failed:', err)
  }
}

/**
 * Delete a project area from Supabase.
 */
export async function deleteProjectAreaFromSupabase(areaId: string): Promise<void> {
  try {
    const supabase = await getSupabase()
    await supabase.from('user_project_areas').delete().eq('id', areaId)
  } catch (err) {
    console.error('[PersonalSync] deleteProjectArea failed:', err)
  }
}

/**
 * Delete a status from Supabase.
 */
export async function deleteStatusFromSupabase(statusId: string): Promise<void> {
  try {
    const supabase = await getSupabase()
    await supabase.from('statuses').delete().eq('id', statusId)
  } catch (err) {
    console.error('[PersonalSync] deleteStatus failed:', err)
  }
}

/**
 * Delete a project from Supabase (and its membership).
 */
export async function deleteProjectFromSupabase(projectId: string): Promise<void> {
  try {
    const supabase = await getSupabase()
    await supabase.from('project_members').delete().eq('project_id', projectId)
    await supabase.from('projects').delete().eq('id', projectId)
  } catch (err) {
    console.error('[PersonalSync] deleteProject failed:', err)
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
  created_at: string
  updated_at: string
}): Promise<void> {
  try {
    const supabase = await getSupabase()
    const { error } = await supabase.from('projects').upsert({
      id: project.id,
      owner_id: project.owner_id,
      name: project.name,
      description: project.description,
      color: project.color,
      icon: project.icon,
      created_at: project.created_at,
      updated_at: project.updated_at
    })
    if (error) {
      console.error('[PersonalSync] pushProject error:', error)
      return
    }

    // Ensure owner is a member
    await supabase.from('project_members').upsert({
      project_id: project.id,
      user_id: project.owner_id,
      role: 'owner',
      joined_at: project.created_at
    })
  } catch (err) {
    console.error('[PersonalSync] pushProject failed:', err)
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

    // Count total items for progress
    const projects = await window.api.projects.getProjectsForUser(userId)
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

      // Push all project labels association
      const projectLabels = await window.api.labels.findByProjectId(project.id)
      const labelData = projectLabels.map((l) => ({ name: l.name, color: l.color }))
      await supabase.from('projects').update({ label_data: JSON.stringify(labelData) }).eq('id', project.id)

      // Push tasks in chunks
      const tasks = await window.api.tasks.findByProjectId(project.id)
      totalItems += tasks.length
      for (let i = 0; i < tasks.length; i += CHUNK_SIZE) {
        const chunk = tasks.slice(i, i + CHUNK_SIZE)
        for (const task of chunk) {
          await pushTask(task)
          updateProgress()
        }
      }
    }

    // 3. Push settings
    for (const setting of allSettings) {
      if (setting.value !== null) {
        await pushSetting(setting.key, setting.value, userId)
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

    // Mark sync complete
    await window.api.settings.set(userId, 'last_sync_at', new Date().toISOString())
    syncStore.setLastSynced()
    syncStore.setFirstSync(false)
    console.log('[PersonalSync] Full upload complete')
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
          await window.api.labels.create({
            id: label.id,
            name: label.name,
            color: label.color
          })
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
              for (const task of tasks) {
                const existingTask = await window.api.tasks.findById(task.id)
                if (!existingTask) {
                  // Ensure owner exists
                  const localOwner = await window.api.users.findById(task.owner_id)
                  if (!localOwner) {
                    await window.api.users.create({ id: task.owner_id, email: 'shared-user', display_name: null, avatar_url: null }).catch(() => {})
                  }
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
                }
              }
            }

            // Sync labels for project
            if (project.label_data) {
              const labels: Array<{ name: string; color: string }> = JSON.parse(project.label_data)
              for (const entry of labels) {
                let label = await window.api.labels.findByName(userId, entry.name) ?? undefined
                if (!label) {
                  label = await window.api.labels.create({ id: crypto.randomUUID(), name: entry.name, color: entry.color })
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
    syncStore.setFirstSyncProgress(95)
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
 * Check if this is a new device (no last_sync_at) and initiate appropriate sync.
 */
export async function initSync(userId: string): Promise<void> {
  const lastSyncAt = await window.api.settings.get(userId, 'last_sync_at')
  const syncStore = useSyncStore.getState()

  if (!lastSyncAt) {
    // Check if there's data in Supabase
    const supabase = await getSupabase()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    const { count } = await supabase
      .from('project_members')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', session.user.id)

    if (count && count > 0) {
      // Existing data in Supabase — new device, pull everything
      console.log('[PersonalSync] New device detected, pulling data from Supabase')
      await fullPull(userId)
    } else {
      // No data in Supabase — first-ever sync, upload everything
      console.log('[PersonalSync] First-time sync, uploading data to Supabase')
      await fullUpload(userId)
    }
  } else {
    syncStore.setLastSynced()
  }
}

// ── Realtime Subscriptions for All Projects ──────────────────────────

/**
 * Subscribe to Realtime changes for a personal (non-shared) project.
 * Uses the same channel pattern as shared projects.
 */
export async function subscribeToPersonalProject(
  projectId: string,
  onTaskChange: (event: string, data: Record<string, unknown>) => void
): Promise<() => void> {
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
        onTaskChange(payload.eventType, data)
      }
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

// ── Online/Offline Detection ─────────────────────────────────────────

let offlineCleanup: (() => void) | null = null

/**
 * Start monitoring online/offline status using Supabase Realtime + navigator.onLine.
 */
export function startOnlineMonitoring(): () => void {
  const syncStore = useSyncStore.getState()

  const handleOnline = (): void => {
    syncStore.setStatus('synced')
    // Flush sync queue on reconnect
    import('./SyncService').then(({ processSyncQueue }) => {
      processSyncQueue().then((count) => {
        if (count > 0) console.log(`[PersonalSync] Flushed ${count} queued changes`)
      })
    })
  }

  const handleOffline = (): void => {
    syncStore.setStatus('offline')
  }

  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)

  // Set initial status
  if (!navigator.onLine) {
    syncStore.setStatus('offline')
  }

  const cleanup = (): void => {
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
