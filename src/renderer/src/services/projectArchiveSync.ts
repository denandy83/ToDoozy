import { readAll } from './readAll'
import type { Task } from '../../../shared/types'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function writeProjectArchive(client: SupabaseClient, projectId: string, isArchived: number, tasks: Task[], archiveAt: string): Promise<{ is_archived: number; archive_updated_at: string }> {
  const { data, error } = await client.from('projects').update({ is_archived: isArchived, archive_updated_at: archiveAt })
    .eq('id', projectId).select('id, is_archived, archive_updated_at')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Only the project owner can archive or restore this project')
  const applied = { is_archived: data[0].is_archived ?? isArchived, archive_updated_at: data[0].archive_updated_at ?? archiveAt }
  if (Date.parse(applied.archive_updated_at) > Date.parse(archiveAt) || applied.is_archived !== isArchived) return applied
  const later = tasks.filter((task) => !task.deleted_at && Date.parse(task.archive_updated_at ?? '1970-01-01') > Date.parse(archiveAt))
  for (let index = 0; index < later.length; index += 200) {
    const { error } = await client.from('tasks').upsert(later.slice(index, index + 200))
    if (error) throw new Error(error.message)
  }
  const localTasks = new Map(tasks.map((task) => [task.id, task]))
  const { data: remoteTasks } = await readAll(() => client.from('tasks').select('id').eq('project_id', projectId).is('deleted_at', null))
  const ids = remoteTasks.filter((remote) => {
    const task = localTasks.get(remote.id)
    return !task?.deleted_at && (!task || Date.parse(task.archive_updated_at ?? '1970-01-01') <= Date.parse(archiveAt))
  }).map((task) => task.id)
  for (let index = 0; index < ids.length; index += 200) {
    const { error } = await client.from('tasks').update({ is_archived: isArchived, archive_updated_at: archiveAt }).in('id', ids.slice(index, index + 200))
      .eq('project_id', projectId).is('deleted_at', null).or(`archive_updated_at.is.null,archive_updated_at.lte.${archiveAt}`)
    if (error) throw new Error(error.message)
  }
  return applied
}
