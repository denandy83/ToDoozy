import type { SupabaseClient } from '@supabase/supabase-js'
import type { Task } from '../../../shared/types'
import type { TodoozyAPI } from '../../../preload/index.d'
import { readAll, readAllIn } from './readAll'

export interface StatusDeletionCommand {
  status_delete: true
  target_id: string
  updated_at: string
  tasks?: Array<{ id: string; updated_at: string }>
  rpc_tasks?: Array<Record<string, unknown>>
  task_recoveries?: Array<{ row: Task; local_updated_at: string }>
}

export async function preserveStatusDeletionEdits(client: SupabaseClient, api: TodoozyAPI, projectId: string, statusId: string, actor: string, command: StatusDeletionCommand, commandId: string, rpcAt?: string): Promise<Array<Record<string, unknown>>> {
  const { data: project, error } = await client.from('projects').select('owner_id,deleted_at').eq('id', projectId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!project || project.deleted_at || project.owner_id !== actor) throw new Error('Only the project owner can delete statuses')
  const { data: affected } = await readAll(() => client.from('tasks').select('*').eq('project_id', projectId).eq('status_id', statusId).is('deleted_at', null))
  const ids = [...new Set([...affected.map((row) => String(row.id)), ...(command.tasks ?? []).map((row) => row.id), ...(command.rpc_tasks ?? []).map((row) => String(row.id))])]
  const { data: remote } = await readAllIn(ids, (batch) => client.from('tasks').select('*').eq('project_id', projectId).in('id', batch))
  const byId = new Map(remote.map((row) => [String(row.id), row]))
  const baseline = new Map((command.tasks ?? []).map((row) => [row.id, row.updated_at]))
  const queued = await api.sync.getQueue()
  for (let index = 0; index < ids.length; index += 200) {
    const values = []
    for (const id of ids.slice(index, index + 200)) {
      const local = await api.tasks.findById(id)
      if (!local || local.project_id !== projectId) continue
      const edits = queued.filter((entry) => entry.table_name === 'tasks' && entry.row_id === id).map((entry) => JSON.parse(entry.payload))
      if (Date.parse(local.updated_at) <= Date.parse(command.updated_at) && !edits.length) continue
      const version = Date.parse(local.updated_at) > Date.parse(command.updated_at) ? local.updated_at
        : baseline.get(id) ?? edits.map((row) => row.updated_at).filter((stamp) => Number.isFinite(Date.parse(stamp))).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)
      if (!version) continue
      const current = byId.get(id)
      const recovery = command.task_recoveries?.find(({ row }) => row.id === id)
      if (current && recovery && Date.parse(String(current.updated_at)) === Date.parse(recovery.row.updated_at) &&
        Object.entries(recovery.row).every(([key, value]) => ['updated_at', 'created_at', 'archive_updated_at', 'deleted_at'].includes(key)
          ? (value == null && current[key] == null) || Date.parse(String(value)) === Date.parse(String(current[key]))
          : JSON.stringify(value) === JSON.stringify(current[key]))) {
        if (local.updated_at !== recovery.row.updated_at) await api.tasks.rebaseSyncVersion(id, recovery.local_updated_at, recovery.row.updated_at)
        continue
      }
      if (current && Date.parse(String(current.updated_at)) >= Date.parse(version)) {
        const before = command.rpc_tasks?.find((row) => row.id === id)
        const rpcOnly = rpcAt && String(current.updated_at) === rpcAt && current.status_id === command.target_id && before &&
          Date.parse(String(before.updated_at)) < Date.parse(version) &&
          Object.keys(before).every((key) => ['updated_at', 'status_id', 'completed_date'].includes(key) || JSON.stringify(before[key]) === JSON.stringify(current[key]))
        if (!rpcOnly) continue
        const promoted = { ...local, updated_at: new Date(Math.max(Date.parse(local.updated_at), Date.parse(String(current.updated_at)) + 1)).toISOString() }
        command.task_recoveries = [...(command.task_recoveries ?? []).filter(({ row }) => row.id !== id), { row: promoted, local_updated_at: local.updated_at }]
        if (!await api.sync.updatePayload(commandId, JSON.stringify(command))) throw new Error('Status deletion intent changed')
        const { data, error: writeError } = await client.from('tasks').update(promoted).eq('id', id).eq('updated_at', current.updated_at).select('id')
        if (writeError) throw new Error(writeError.message)
        if (!data?.length) throw new Error('Task changed during status deletion recovery')
        await api.tasks.rebaseSyncVersion(id, local.updated_at, promoted.updated_at)
        continue
      }
      if (!current && local.deleted_at) continue
      values.push({ ...local, updated_at: version })
    }
    if (values.length) {
      const { error: writeError } = await client.from('tasks').upsert(values)
      if (writeError) throw new Error(writeError.message)
    }
  }
  return remote.filter((row) => row.status_id === statusId && !row.deleted_at)
}
