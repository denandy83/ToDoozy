import { readAll, readAllIn } from './readAll'
import { captureSyncContext, type SyncContext } from './syncContext'
import { useProjectStore } from '../shared/stores/projectStore'
import { useAuthStore } from '../shared/stores/authStore'
import { useTaskStore } from '../shared/stores/taskStore'
import { useStatusStore } from '../shared/stores/statusStore'
import { useLabelStore } from '../shared/stores/labelStore'
import { logEvent } from '../shared/stores/logStore'

/** Fetch definitions before junctions: a brand-new remote label has a local FK. */
export async function refreshProjectLabels(projectId: string, context?: SyncContext): Promise<void> {
  context ??= await captureSyncContext()
  const api = context.api
  const client = context.client
  const { data: links, error } = await readAll(() => client.from('project_labels').select('*').eq('project_id', projectId), ['project_id', 'label_id'])
  if (error) throw new Error(error.message)
  const ids = [...new Set((links ?? []).map((row) => row.label_id as string))]
  if (ids.length) {
    const { data: labels, error: labelError } = await readAllIn(ids, (batch) => client.from('user_labels').select('*').in('id', batch))
    if (labelError) throw new Error(labelError.message)
    for (const label of labels ?? []) await api.labels.applyRemote(label)
  }
  for (const link of links ?? []) {
    // A tombstone for an unseen/deleted definition needs no local FK row.
    if (link.deleted_at && !await api.labels.findById(link.label_id)) continue
    await api.labels.applyRemoteProjectLabel({ project_id: projectId, label_id: link.label_id, created_at: link.created_at, deleted_at: link.deleted_at })
    if (link.deleted_at) await api.labels.softDeleteTaskLabelsForProjectLabel(projectId, link.label_id)
  }
  context.assertCurrent()
  await useLabelStore.getState().hydrateLabels(projectId)
  context.assertCurrent()
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
  const origin = captureSyncContext().catch(() => null)
  pending.add(projectId)
  if (running.has(projectId)) return
  clearTimeout(timers.get(projectId))
  timers.set(projectId, setTimeout(async () => {
    timers.delete(projectId)
    pending.delete(projectId)
    running.add(projectId)
    const userId = useAuthStore.getState().currentUser?.id
    try {
      const context = await origin
      if (!context) return
      context.assertCurrent()
      if (!userId) return
      const { pullNewTasks, pullTaskLabelsForTasks } = await import('./PersonalSyncService')
      await pullNewTasks(projectId, context)
      await refreshProjectLabels(projectId, context)
      const ids = [...(touchedTasks.get(projectId) ?? [])]
      touchedTasks.delete(projectId)
      if (ids.length) await pullTaskLabelsForTasks(ids, userId, context)
      if (useAuthStore.getState().currentUser?.id !== userId) return
      await useProjectStore.getState().hydrateProjects(userId)
      context.assertCurrent()
      await useStatusStore.getState().hydrateStatuses(projectId)
      context.assertCurrent()
      await useTaskStore.getState().hydrateAllForUser(userId)
    } catch (error) {
      logEvent('error', 'sync', 'Remote project refresh failed', String(error))
    } finally {
      running.delete(projectId)
      if (pending.has(projectId)) scheduleRemoteProjectRefresh(projectId)
    }
  }, 250))
}
