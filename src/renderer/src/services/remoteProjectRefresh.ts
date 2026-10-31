import { hydrationContext } from '../shared/stores/hydrationContext'
import { readAll, readAllIn } from './readAll'
import { captureSyncContext, type SyncContext } from './syncContext'
import { useLabelStore } from '../shared/stores/labelStore'
import { logEvent } from '../shared/stores/logStore'

/** Fetch definitions before junctions: a brand-new remote label has a local FK. */
export async function refreshProjectLabels(projectId: string, context?: SyncContext): Promise<void> {
  context ??= await captureSyncContext()
  context = { ...context, ...hydrationContext(context, projectId) }
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
  await useLabelStore.getState().hydrateLabels(projectId, context)
}

let timer: ReturnType<typeof setTimeout> | null = null
const pendingProjects = new Map<SyncContext, Map<string, { context: SyncContext; taskIds: Set<string> }>>()

export function scheduleRemoteProjectRefresh(projectId: string, origin: SyncContext, taskIds: Iterable<string> = []): void {
  let projects = pendingProjects.get(origin)
  if (!projects) {
    projects = new Map()
    pendingProjects.set(origin, projects)
  }
  let pending = projects.get(projectId)
  try { pending?.context.assertCurrent() } catch { pending = undefined }
  const context = pending?.context ?? { ...origin, ...hydrationContext(origin, projectId) }
  projects.set(projectId, { context, taskIds: new Set([...(pending?.taskIds ?? []), ...taskIds]) })
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    timer = null
    const pending = [...pendingProjects.values()].flatMap(projects => [...projects].map(([projectId, request]) => ({ projectId, ...request })))
    pendingProjects.clear()
    const { requestProjectRefresh } = await import('./PersonalSyncService')
    await Promise.all(pending.map(async ({ projectId, context, taskIds }) => {
      try {
        await requestProjectRefresh(context, [projectId], new Map([[projectId, taskIds]]))
      } catch (error) {
        if (await context.isCurrent()) logEvent('error', 'sync', 'Remote project refresh failed', String(error))
      }
    }))
  }, 250)
}
