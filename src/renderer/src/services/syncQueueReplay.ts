import type { SupabaseClient } from '@supabase/supabase-js'
import type { SyncQueueEntry } from '../../../shared/types'
import { writeProjectArchive } from './projectArchiveSync'

async function currentProjectLink(projectId: string, labelId: string): Promise<{ deleted_at: string | null } | undefined> {
  const project = await window.api.projects.findById(projectId)
  if (!project) return undefined
  const links = project.is_shared === 1
    ? await window.api.labels.getProjectLabelsForSharedProjects()
    : await window.api.labels.getProjectLabelsForOwner(project.owner_id)
  return links.find((link) => link.project_id === projectId && link.label_id === labelId)
}

/** Replay non-row queue payloads explicitly; never upsert command objects as rows. */
export async function replaySpecialEntry(client: SupabaseClient, entry: SyncQueueEntry): Promise<boolean> {
  const payload = JSON.parse(entry.payload) as Record<string, unknown>
  if (entry.table_name === 'projects' && payload.archive_with_tasks === true) {
    const current = await window.api.projects.findById(entry.row_id)
    if (!current || current.deleted_at) return true
    await writeProjectArchive(client, entry.row_id, current.is_archived ?? 0, current.updated_at)
    return true
  }
  if (entry.table_name === 'project_labels' && typeof payload.projectId === 'string') {
    const current = await currentProjectLink(payload.projectId, String(payload.labelId))
    if (!current) return true
    const { error } = await client.from('project_labels').upsert({
      project_id: payload.projectId, label_id: payload.labelId,
      created_at: new Date().toISOString(), deleted_at: current.deleted_at
    }, { onConflict: 'project_id,label_id' })
    if (error) throw new Error(error.message)
    return true
  }
  if (entry.table_name === 'task_labels') {
    if (typeof payload.task_id === 'string') {
      // Read the current local intent: older failed label commands may have
      // been superseded while offline. Never replay them over a newer edit.
      const taskId = payload.task_id
      const local = await window.api.tasks.getLabels(taskId)
      const { data: remote, error } = await client.from('task_labels').select('label_id').eq('task_id', taskId)
      if (error) throw new Error(error.message)
      const localIds = new Set(local.map((link) => link.label_id))
      if (local.length) {
        const { error: writeError } = await client.from('task_labels').upsert(
          local.map((link) => ({ task_id: taskId, label_id: link.label_id, deleted_at: null })),
          { onConflict: 'task_id,label_id' })
        if (writeError) throw new Error(writeError.message)
      }
      const removed = (remote ?? []).filter((link) => !localIds.has(link.label_id)).map((link) => link.label_id)
      if (removed.length) {
        const { error: removeError } = await client.from('task_labels').delete().eq('task_id', taskId).in('label_id', removed)
        if (removeError) throw new Error(removeError.message)
      }
    } else if (typeof payload.projectId === 'string' && typeof payload.labelId === 'string') {
      const current = await currentProjectLink(payload.projectId, payload.labelId)
      if (!current?.deleted_at) return true
      const { data: tasks, error } = await client.from('tasks').select('id').eq('project_id', payload.projectId)
      if (error) throw new Error(error.message)
      if (tasks?.length) {
        const labelIds = Array.isArray(payload.siblingIds) ? payload.siblingIds : [payload.labelId]
        const { error: removeError } = await client.from('task_labels').delete()
          .in('task_id', tasks.map((task) => task.id)).in('label_id', labelIds)
        if (removeError) throw new Error(removeError.message)
      }
    } else {
      throw new Error('Unrecognized task-label retry payload')
    }
    return true
  }
  // Partial tombstones cannot be UPSERTed: required columns are intentionally
  // absent. Use UPDATE so retry never recreates a previously deleted row.
  if (payload.deleted_at && Object.keys(payload).length <= 3) {
    const { error } = await client.from(entry.table_name).update({ ...payload, updated_at: payload.updated_at ?? payload.deleted_at }).eq('id', entry.row_id)
    if (error) throw new Error(error.message)
    return true
  }
  return false
}
