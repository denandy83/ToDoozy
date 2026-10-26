import { useProjectStore } from '../shared/stores/projectStore'
import { getSupabase } from '../lib/supabase'
import { useAuthStore } from '../shared/stores/authStore'
import { useTaskStore } from '../shared/stores/taskStore'
import { useStatusStore } from '../shared/stores/statusStore'
import { useLabelStore } from '../shared/stores/labelStore'
import { logEvent } from '../shared/stores/logStore'

/** Fetch definitions before junctions: a brand-new remote label has a local FK. */
export async function refreshProjectLabels(projectId: string): Promise<void> {
  const client = await getSupabase()
  const { data: links, error } = await client.from('project_labels').select('*').eq('project_id', projectId)
  if (error) throw new Error(error.message)
  const ids = [...new Set((links ?? []).map((row) => row.label_id as string))]
  if (ids.length) {
    const { data: labels, error: labelError } = await client.from('user_labels').select('*').in('id', ids)
    if (labelError) throw new Error(labelError.message)
    for (const label of labels ?? []) await window.api.labels.applyRemote(label)
  }
  for (const link of links ?? []) {
    // A tombstone for an unseen/deleted definition needs no local FK row.
    if (link.deleted_at && !await window.api.labels.findById(link.label_id)) continue
    await window.api.labels.applyRemoteProjectLabel({ project_id: projectId, label_id: link.label_id, created_at: link.created_at, deleted_at: link.deleted_at })
    if (link.deleted_at) await window.api.labels.softDeleteTaskLabelsForProjectLabel(projectId, link.label_id)
  }
  await useLabelStore.getState().hydrateLabels(projectId)
  await useTaskStore.getState().hydrateAllTaskLabels(projectId)
}

const timers = new Map<string, ReturnType<typeof setTimeout>>()
const running = new Set<string>()
const pending = new Set<string>()
const touchedTasks = new Map<string, Set<string>>()

/** Every subscribed shared project updates SQLite + stores, including unopened ones. */
export function scheduleRemoteProjectRefresh(projectId: string, taskId?: string): void {
  if (taskId) {
    const ids = touchedTasks.get(projectId) ?? new Set<string>()
    ids.add(taskId)
    touchedTasks.set(projectId, ids)
  }
  pending.add(projectId)
  if (running.has(projectId)) return
  clearTimeout(timers.get(projectId))
  timers.set(projectId, setTimeout(async () => {
    timers.delete(projectId)
    pending.delete(projectId)
    running.add(projectId)
    const userId = useAuthStore.getState().currentUser?.id
    try {
      if (!userId) return
      const { pullNewTasks, pullProjectMetadata, pullTaskLabelsForTasks } = await import('./PersonalSyncService')
      await pullProjectMetadata(projectId)
      await pullNewTasks(projectId)
      await refreshProjectLabels(projectId)
      const ids = [...(touchedTasks.get(projectId) ?? [])]
      touchedTasks.delete(projectId)
      if (ids.length) await pullTaskLabelsForTasks(ids)
      if (useAuthStore.getState().currentUser?.id !== userId) return
      await useProjectStore.getState().hydrateProjects(userId)
      await useStatusStore.getState().hydrateStatuses(projectId)
      await useTaskStore.getState().hydrateAllForUser(userId)
    } catch (error) {
      logEvent('error', 'sync', 'Remote project refresh failed', String(error))
    } finally {
      running.delete(projectId)
      if (pending.has(projectId)) scheduleRemoteProjectRefresh(projectId)
    }
  }, 250))
}
