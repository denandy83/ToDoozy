import type { SupabaseClient } from '@supabase/supabase-js'
import { readAll } from './readAll'
import type { TodoozyAPI } from '../../../preload/index.d'

export async function syncTaskLabelChoices(client: SupabaseClient, taskIds: string[], api: TodoozyAPI): Promise<void> {
  for (const taskId of [...new Set(taskIds)]) {
    for (;;) {
      const task = await api.tasks.findById(taskId)
      if (!task || task.deleted_at) break
      const pending = (await api.tasks.getLabelState(taskId)).filter((row)=>row.sync_pending)
      if (!pending.length) break
      const additions = pending.filter((row)=>!row.deleted_at)
      if (additions.length) {
        const { data } = await readAll(()=>client.from('project_labels').select('label_id').eq('project_id',task.project_id).is('deleted_at',null),['label_id'])
        const palette = new Set(data.map((row)=>String(row.label_id)))
        if (additions.some((row)=>!palette.has(row.label_id))) throw new Error('Project label addition pending')
      }
      for (const rows of [additions,pending.filter((row)=>row.deleted_at)]) {
        for (let index=0;index<rows.length;index+=200) {
          const batch=rows.slice(index,index+200)
          const query = rows===additions
            ? client.from('task_labels').upsert(batch.map((row)=>({task_id:taskId,label_id:row.label_id,deleted_at:null})),{onConflict:'task_id,label_id'})
            : client.from('task_labels').delete().eq('task_id',taskId).in('label_id',batch.map((row)=>row.label_id))
          const { error } = await query
          if (error) throw new Error(error.message)
          await api.tasks.acknowledgeLabelState(taskId,batch)
        }
      }
    }
  }
}
