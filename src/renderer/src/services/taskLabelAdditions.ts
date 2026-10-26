import type { SupabaseClient } from '@supabase/supabase-js'
import { readAll } from './readAll'
import type { TodoozyAPI } from '../../../preload/index.d'

export async function pushTaskLabelAdditions(client: SupabaseClient, taskIds: string[], api: TodoozyAPI): Promise<void> {
  const pairs: Array<{ task_id: string; label_id: string; deleted_at: null }> = []
  const palettes = new Map<string, Set<string>>()
  for (const taskId of taskIds) {
    const task = await api.tasks.findById(taskId)
    if (!task || task.deleted_at) continue
    const links = await api.tasks.getLabels(taskId)
    if (!links.length) continue
    let palette = palettes.get(task.project_id)
    if (!palette) {
      const { data, error } = await readAll(() => client.from('project_labels').select('label_id')
        .eq('project_id', task.project_id).is('deleted_at', null), ['label_id'])
      if (error) throw new Error(error.message)
      palette = new Set(data.map((link) => link.label_id as string))
      palettes.set(task.project_id, palette)
    }
    for (const link of links) {
      if (!palette.has(link.label_id)) {
        const pending = (await api.sync.getQueue()).some((entry) => {
          if (entry.table_name !== 'project_labels') return false
          const intent = JSON.parse(entry.payload)
          return intent.projectId === task.project_id && intent.labelId === link.label_id && !intent.deletedAt
        })
        if (pending) throw new Error('Project label addition pending')
        continue
      }
      pairs.push({ task_id: taskId, label_id: link.label_id, deleted_at: null })
    }
  }
  for (let index = 0; index < pairs.length; index += 200) {
    const { error } = await client.from('task_labels').upsert(pairs.slice(index, index + 200), { onConflict: 'task_id,label_id' })
    if (error) throw new Error(error.message)
  }
}
