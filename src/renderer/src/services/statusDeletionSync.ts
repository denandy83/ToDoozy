import type { SupabaseClient } from '@supabase/supabase-js'
import type { TodoozyAPI } from '../../../preload/index.d'
import { readAll, readAllIn } from './readAll'

export interface StatusDeletionCommand {
  status_delete: true
  target_id: string
  updated_at: string
  tasks?: Array<{ id: string; updated_at: string }>
}

export async function preserveStatusDeletionEdits(client: SupabaseClient, api: TodoozyAPI, projectId: string, statusId: string, actor: string, command: StatusDeletionCommand): Promise<void> {
  const { data: project, error } = await client.from('projects').select('owner_id,deleted_at').eq('id', projectId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!project || project.deleted_at || project.owner_id !== actor) throw new Error('Only the project owner can delete statuses')
  const { data: affected } = await readAll(() => client.from('tasks').select('*').eq('project_id', projectId).eq('status_id', statusId).is('deleted_at', null))
  const ids = [...new Set([...affected.map((row) => String(row.id)), ...(command.tasks ?? []).map((row) => row.id)])]
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
      if (current && Date.parse(String(current.updated_at)) >= Date.parse(version)) continue
      if (!current && local.deleted_at) continue
      values.push({ ...local, updated_at: version })
    }
    if (values.length) {
      const { error: writeError } = await client.from('tasks').upsert(values)
      if (writeError) throw new Error(writeError.message)
    }
  }
}
