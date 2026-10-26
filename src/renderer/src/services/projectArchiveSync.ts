import { readAll } from './readAll'
import type { Task } from '../../../shared/types'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function writeProjectArchive(client: SupabaseClient, projectId: string, isArchived: number, updatedAt: string, tasks: Pick<Task, 'id' | 'is_archived' | 'updated_at' | 'deleted_at'>[], archiveAt: string): Promise<{ is_archived: number; archive_updated_at: string }> {
  const { data, error } = await client.from('projects').update({ is_archived: isArchived, updated_at: updatedAt, archive_updated_at: archiveAt })
    .eq('id', projectId).select('id, is_archived, archive_updated_at')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Only the project owner can archive or restore this project')
  const applied = { is_archived: data[0].is_archived ?? isArchived, archive_updated_at: data[0].archive_updated_at ?? archiveAt }
  if (Date.parse(applied.archive_updated_at) > Date.parse(archiveAt) || applied.is_archived !== isArchived) return applied
  const localTasks = new Map(tasks.map((task) => [task.id, task]))
  const { data: remoteTasks } = await readAll(() => client.from('tasks').select('id').eq('project_id', projectId).is('deleted_at', null))
  const groups = new Map<string, { patch: { is_archived: number; updated_at: string }; ids: string[] }>()
  for (const remote of remoteTasks) {
    const task = localTasks.get(remote.id)
    if (task?.deleted_at) continue
    const patch = task && Date.parse(task.updated_at) > Date.parse(archiveAt)
      ? { is_archived: task.is_archived, updated_at: task.updated_at }
      : { is_archived: isArchived, updated_at: archiveAt }
    const key = JSON.stringify(patch)
    const group = groups.get(key) ?? { patch, ids: [] }
    group.ids.push(remote.id)
    groups.set(key, group)
  }
  for (const { patch, ids } of groups.values()) {
    for (let index = 0; index < ids.length; index += 200) {
      const { error } = await client.from('tasks').update(patch).in('id', ids.slice(index, index + 200))
        .eq('project_id', projectId).is('deleted_at', null).lte('updated_at', patch.updated_at)
      if (error) throw new Error(error.message)
    }
  }
  return applied
}
