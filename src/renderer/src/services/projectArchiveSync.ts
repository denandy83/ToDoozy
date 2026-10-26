import type { Task } from '../../../shared/types'
import type { SupabaseClient } from '@supabase/supabase-js'

/** Retryable, idempotent archive operation; a zero-row RLS denial is an error. */
export async function writeProjectArchive(client: SupabaseClient, projectId: string, isArchived: number, updatedAt: string, tasks: Pick<Task, 'id' | 'is_archived' | 'updated_at' | 'deleted_at'>[] = []): Promise<void> {
  const patch = { is_archived: isArchived, updated_at: updatedAt }
  const { data, error } = await client.from('projects').update(patch).eq('id', projectId).select('id')
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error('Only the project owner can archive or restore this project')
  const { error: taskError } = await client.from('tasks').update(patch).eq('project_id', projectId).is('deleted_at', null).lte('updated_at', updatedAt)
  if (taskError) throw new Error(taskError.message)
  for (const task of tasks) {
    if (task.deleted_at || (task.is_archived === isArchived && Date.parse(task.updated_at) <= Date.parse(updatedAt))) continue
    const { error } = await client.from('tasks').update({ is_archived: task.is_archived, updated_at: task.updated_at })
      .eq('id', task.id).eq('project_id', projectId).is('deleted_at', null).lte('updated_at', task.updated_at)
    if (error) throw new Error(error.message)
  }
}
