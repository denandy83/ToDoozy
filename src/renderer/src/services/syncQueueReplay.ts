import { mutateProjectStatus } from '../../../../supabase/functions/mcp/statusRpc'
import { useAuthStore } from '../shared/stores/authStore'
import { readAll } from './readAll'
import type { SyncContext } from './syncContext'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { SyncQueueEntry } from '../../../shared/types'
import { currentProjectLink, projectLinkSuperseded, removeRemoteProjectLabel, type ProjectLabelRemoval } from './projectLabelIntent'
import { preserveStatusDeletionEdits, type StatusDeletionCommand } from './statusDeletionSync'
import { writeProjectArchive } from './projectArchiveSync'

async function statusDeleteIntent(entry: SyncQueueEntry, api = window.api): Promise<{
  row: Awaited<ReturnType<typeof api.statuses.findById>>
  command: StatusDeletionCommand | null
}> {
  const row = await api.statuses.findById(entry.row_id)
  const commands = (await api.sync.getQueue()).filter((item) => item.table_name === 'statuses' && item.row_id === entry.row_id)
    .map((item) => JSON.parse(item.payload)).filter((payload) => payload.status_delete === true && Date.parse(payload.updated_at) === Date.parse(row?.updated_at ?? ''))
  return { row, command: commands.at(-1) ?? null }
}

/** Replay non-row queue payloads explicitly; never upsert command objects as rows. */
export async function replaySpecialEntry(client: SupabaseClient, entry: SyncQueueEntry, context?: SyncContext): Promise<boolean> {
  const api = context?.api ?? window.api
  if (entry.table_name === 'project_labels' || entry.table_name === 'task_labels') entry = (await api.sync.getQueue()).find((item) => item.id === entry.id) ?? entry
  const payload = JSON.parse(entry.payload) as Record<string, unknown>
  if (entry.table_name === 'statuses' && payload.status_delete === true) {
    const { row: current, command } = await statusDeleteIntent(entry, api)
    if (!current) return true
    if (!current.deleted_at) {
      const { error } = await client.from('statuses').upsert(current)
      if (error) throw new Error(error.message)
      return true
    }
    if (!command) throw new Error('Status replacement intent missing')
    const { data: remote, error } = await client.from('statuses').select('id, deleted_at, is_default, is_done').eq('id', entry.row_id).maybeSingle()
    if (error) throw new Error(error.message)
    if (!remote || remote.deleted_at) return true
    if (remote.is_default === 1 || remote.is_done === 1) throw new Error('Default and done statuses must be retained')
    context?.assertCurrent()
    await preserveStatusDeletionEdits(client, api, current.project_id, entry.row_id, useAuthStore.getState().currentUser!.id, command)
    context?.assertCurrent()
    await mutateProjectStatus(client, current.project_id, useAuthStore.getState().currentUser!.id, 'delete', { id: entry.row_id, target_id: command.target_id })
    return true
  }
  if (entry.table_name === 'projects' && payload.archive_with_tasks === true) {
    const current = await api.projects.findById(entry.row_id)
    if (!current || current.deleted_at) return true
    const tasks = await api.tasks.findAllByProject(entry.row_id, { includeTombstones: true })
    if (!current.archive_updated_at) throw new Error('Archive action version missing')
    const applied = await writeProjectArchive(client, entry.row_id, current.is_archived ?? 0, tasks, current.archive_updated_at)
    if (Date.parse(applied.archive_updated_at) > Date.parse(current.archive_updated_at) || applied.is_archived !== current.is_archived) await api.projects.applyRemote({ ...current, ...applied })
    return true
  }
  if (entry.table_name === 'project_labels' && typeof payload.projectId === 'string') {
    const current = await currentProjectLink(payload.projectId, String(payload.labelId), api)
    if (payload.deletedAt && 'expectedLink' in payload && projectLinkSuperseded(current, payload.expectedLink as Awaited<ReturnType<typeof currentProjectLink>>)) return true
    if (!current && !payload.deletedAt) return true
    const { error } = await client.from('project_labels').upsert({
      project_id: payload.projectId, label_id: payload.labelId,
      created_at: new Date().toISOString(), deleted_at: payload.deletedAt && 'expectedLink' in payload ? payload.deletedAt : current!.deleted_at
    }, { onConflict: 'project_id,label_id' })
    if (error) throw new Error(error.message)
    return true
  }
  if (entry.table_name === 'task_labels' && payload.remove_project_label === true) {
    await removeRemoteProjectLabel(client, api, payload as unknown as ProjectLabelRemoval)
    return true
  }
  if (entry.table_name === 'task_labels') {
    if (typeof payload.task_id === 'string') {
      // Read the current local intent: older failed label commands may have
      // been superseded while offline. Never replay them over a newer edit.
      const taskId = payload.task_id
      const local = await api.tasks.getLabels(taskId)
      const { data: remote, error } = await readAll(() => client.from('task_labels').select('label_id').eq('task_id', taskId), ['label_id'])
      if (error) throw new Error(error.message)
      const localIds = new Set(local.map((link) => link.label_id))
      if (local.length) {
        const { error: writeError } = await client.from('task_labels').upsert(
          local.map((link) => ({ task_id: taskId, label_id: link.label_id, deleted_at: null })),
          { onConflict: 'task_id,label_id' })
        if (writeError) throw new Error(writeError.message)
      }
      const removed = (remote ?? []).filter((link) => !localIds.has(link.label_id)).map((link) => link.label_id)
      for (let index = 0; index < removed.length; index += 200) {
        const { error: removeError } = await client.from('task_labels').delete().eq('task_id', taskId).in('label_id', removed.slice(index, index + 200))
        if (removeError) throw new Error(removeError.message)
      }
    } else if (typeof payload.projectId === 'string' && typeof payload.labelId === 'string') {
      const current = await currentProjectLink(payload.projectId, payload.labelId, api)
      if ('expectedLink' in payload) {
        if (projectLinkSuperseded(current, payload.expectedLink as Awaited<ReturnType<typeof currentProjectLink>>)) return true
      } else if (!current?.deleted_at) return true
      const { data: tasks, error } = await readAll(() => client.from('tasks').select('id').eq('project_id', payload.projectId))
      if (error) throw new Error(error.message)
      if (tasks?.length) {
        const labelIds = Array.isArray(payload.siblingIds) ? payload.siblingIds : [payload.labelId]
        for (let index = 0; index < tasks.length; index += 200) {
          const { error: removeError } = await client.from('task_labels').delete()
            .in('task_id', tasks.slice(index, index + 200).map((task) => task.id)).in('label_id', labelIds)
          if (removeError) throw new Error(removeError.message)
        }
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

export async function specialEntryIntent(entry: SyncQueueEntry, context: SyncContext): Promise<string> {
  const api = context.api
  if (entry.table_name === 'project_labels' || entry.table_name === 'task_labels') entry = (await api.sync.getQueue()).find((item) => item.id === entry.id) ?? entry
  const payload = JSON.parse(entry.payload)
  if (entry.table_name === 'statuses' && payload.status_delete === true) {
    const intent = await statusDeleteIntent(entry, api)
    const tasks = await Promise.all((intent.command?.tasks ?? []).map((task) => api.tasks.findById(task.id)))
    return JSON.stringify([intent, tasks])
  }
  if (entry.table_name === 'projects') {
    const project = await api.projects.findById(entry.row_id)
    const tasks = await api.tasks.findAllByProject(entry.row_id, { includeTombstones: true })
    return JSON.stringify([project ?? null, tasks.map(({ id, is_archived, archive_updated_at, updated_at, deleted_at }) => ({ id, is_archived, archive_updated_at, updated_at, deleted_at })).sort((a, b) => a.id.localeCompare(b.id))])
  }
  if (typeof payload.task_id === 'string') return JSON.stringify((await api.tasks.getLabels(payload.task_id)).map((row) => row.label_id).sort())
  if (typeof payload.projectId === 'string') return JSON.stringify(await currentProjectLink(payload.projectId, String(payload.labelId), api) ?? null)
  return entry.payload
}
