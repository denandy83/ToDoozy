import { readAll, readAllIn } from './readAll'
import { captureSyncContext, type SyncContext } from './syncContext'
import { useTaskStore } from '../shared/stores/taskStore'
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

let timer: ReturnType<typeof setTimeout> | null = null
const pendingProjects = new Map<string, { projectId: string; context: SyncContext; taskIds: Set<string> }>()

export function scheduleRemoteProjectRefresh(projectId: string, context: SyncContext, taskIds: Iterable<string> = []): void {
  const key = `${context.scope}:${projectId}`
  const pending = pendingProjects.get(key)
  pendingProjects.set(key, { projectId, context, taskIds: new Set([...(pending?.taskIds ?? []), ...taskIds]) })
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    timer = null
    const pending = [...pendingProjects.values()]
    pendingProjects.clear()
    try {
      const groups = new Map<string, { context: SyncContext; ids: string[]; taskIds: Map<string, Set<string>> }>()
      for (const { projectId, context, taskIds } of pending) {
        if (!await context.isCurrent()) continue
        const group = groups.get(context.scope) ?? { context, ids: [], taskIds: new Map() }
        group.ids.push(projectId)
        group.taskIds.set(projectId, taskIds)
        groups.set(context.scope, group)
      }
      const { requestProjectRefresh } = await import('./PersonalSyncService')
      for (const { context, ids, taskIds } of groups.values()) await requestProjectRefresh(context, ids, taskIds)
    } catch (error) {
      logEvent('error', 'sync', 'Remote project refresh failed', String(error))
    }
  }, 250)
}
