import { readAll } from './readAll'
import type { Task } from '../../../shared/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Retryable, idempotent archive operation; a zero-row RLS denial is an error. */
export async function writeProjectArchive(client: SupabaseClient, projectId: string, isArchived: number, updatedAt: string, tasks: Pick<Task, 'id' | 'is_archived' | 'updated_at' | 'deleted_at'>[]): Promise<void> {
  const { data, error } = await client.from('projects').update({ is_archived: isArchived, updated_at: updatedAt }).eq('id', projectId).select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Only the project owner can archive or restore this project')
  const localTasks = new Map(tasks.map((task) => [task.id, task]))
  const { data: remoteTasks } = await readAll(() => client.from('tasks').select('id').eq('project_id', projectId).is('deleted_at', null))
  for (const remote of remoteTasks) {
    const task = localTasks.get(remote.id)
    if (task?.deleted_at) continue
    const patch = { is_archived: task?.is_archived ?? isArchived, updated_at: task?.updated_at ?? updatedAt }
    const { error } = await client.from('tasks').update(patch)
      .eq('id', remote.id).eq('project_id', projectId).is('deleted_at', null).lte('updated_at', patch.updated_at)
    if (error) throw new Error(error.message)
  }
}
