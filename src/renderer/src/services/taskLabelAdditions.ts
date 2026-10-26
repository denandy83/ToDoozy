import type { SupabaseClient } from '@supabase/supabase-js'
import type { TodoozyAPI } from '../../../preload/index.d'

export async function pushTaskLabelAdditions(client: SupabaseClient, taskIds: string[], api: TodoozyAPI): Promise<void> {
  const pairs: Array<{ task_id: string; label_id: string; deleted_at: null }> = []
  const projects = new Map<string, { project_id: string; label_id: string; created_at: string; deleted_at: null }>()
  const palettes = new Map<string, Set<string>>()
  for (const taskId of taskIds) {
    const task = await api.tasks.findById(taskId)
    if (!task || task.deleted_at) continue
    const links = await api.tasks.getLabels(taskId)
    if (!links.length) continue
    let palette = palettes.get(task.project_id)
    if (!palette) {
      palette = new Set((await api.labels.findByProjectId(task.project_id)).map((label) => label.id))
      palettes.set(task.project_id, palette)
    }
    for (const link of links) {
      if (!palette.has(link.label_id)) continue
      pairs.push({ task_id: taskId, label_id: link.label_id, deleted_at: null })
      projects.set(`${task.project_id}:${link.label_id}`, { project_id: task.project_id, label_id: link.label_id, created_at: new Date().toISOString(), deleted_at: null })
    }
  }
  const projectLinks = [...projects.values()]
  for (let index = 0; index < projectLinks.length; index += 200) {
    const { error } = await client.from('project_labels').upsert(projectLinks.slice(index, index + 200), { onConflict: 'project_id,label_id' })
    if (error) throw new Error(error.message)
  }
  for (let index = 0; index < pairs.length; index += 200) {
    const { error } = await client.from('task_labels').upsert(pairs.slice(index, index + 200), { onConflict: 'task_id,label_id' })
    if (error) throw new Error(error.message)
  }
}
