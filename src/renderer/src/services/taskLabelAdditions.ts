import type { SupabaseClient } from '@supabase/supabase-js'
import { readAll, readAllIn } from './readAll'
import type { TodoozyAPI } from '../../../preload/index.d'
import type { TaskLabelSyncState } from '../../../shared/types'

const deliveries = new Map<string, Promise<void>>()
type Complete = (taskId: string, error?: unknown) => void

export function orderTaskLabelWrites(scope: string, taskIds: string[], operation: (ready: string[], complete: Complete) => Promise<void>): Promise<void> {
  const jobs = new Map<string, { key: string; barrier: Promise<void>; release(): void; resolve(): void; reject(error: unknown): void }>()
  let ready: string[] = [], scheduled = false
  const complete: Complete = (id, error) => {
    const job=jobs.get(id)
    if (!job) return
    jobs.delete(id)
    if (deliveries.get(job.key)===job.barrier) deliveries.delete(job.key)
    job.release()
    if (error) job.reject(error)
    else job.resolve()
  }
  const start = (id: string): void => {
    ready.push(id)
    if (scheduled) return
    scheduled=true
    queueMicrotask(()=>{
      const batch=ready;ready=[];scheduled=false
      void Promise.resolve().then(()=>operation(batch,complete)).then(()=>batch.forEach((id)=>complete(id)),(error)=>batch.forEach((id)=>complete(id,error)))
    })
  }
  const results=[...new Set(taskIds)].map((id)=>new Promise<void>((resolve,reject)=>{
    const key=JSON.stringify([scope,id]), previous=deliveries.get(key)
    let release!: ()=>void
    const barrier=new Promise<void>((done)=>{release=done})
    deliveries.set(key,barrier)
    jobs.set(id,{key,barrier,release,resolve,reject})
    if (previous) void previous.then(()=>start(id))
    else start(id)
  }))
  return Promise.all(results).then(()=>undefined)
}

export async function syncTaskLabelChoices(client: SupabaseClient, taskIds: string[], api: TodoozyAPI, scope: string): Promise<void> {
  const palettes=new Map<string,Promise<Set<string>>>()
  await orderTaskLabelWrites(scope,taskIds,async(ready,complete)=>{
    const projects=new Map<string,string[]>()
    for (const id of ready) {
      const task=await api.tasks.findById(id)
      if (!task || task.deleted_at) {complete(id);continue}
      projects.set(task.project_id,[...(projects.get(task.project_id) ?? []),id])
    }
    await Promise.all([...projects].map(async([projectId,ids])=>{
      const deliver = async(taskIds: string[]): Promise<void> => {
        try {
          const allStates=new Map(await Promise.all(taskIds.map(async(id)=>[id,await api.tasks.getLabelState(id)] as const)))
          const states=new Map([...allStates].map(([id,rows])=>[id,rows.filter((row)=>row.sync_pending)]))
          const pending=[...states.values()].flat()
          const labelIds=[...new Set([...allStates.values()].flat().map((row)=>row.label_id))]
          const familyIds=pending.length && [...allStates.values()].flat().some((row)=>row.deleted_at) ? labelIds : []
          const localNames=new Map((await Promise.all(familyIds.map((id)=>api.labels.findById(id)))).filter((label)=>!!label).map((label)=>[label.id,label.name.toLowerCase()]))
          const sameFamily=(a: TaskLabelSyncState,b: TaskLabelSyncState): boolean=>a.task_id===b.task_id && (a.label_id===b.label_id || (localNames.has(a.label_id) && localNames.get(a.label_id)===localNames.get(b.label_id)))
          const supersedingRemovals=(row: TaskLabelSyncState): TaskLabelSyncState[]=>(allStates.get(row.task_id) ?? []).filter((other)=>other.deleted_at && other.local_version>=row.local_version && sameFamily(row,other))
          const removals=[...new Map([...pending.filter((row)=>row.deleted_at),...pending.filter((row)=>!row.deleted_at).flatMap(supersedingRemovals)].map((row)=>[JSON.stringify([row.task_id,row.label_id]),row])).values()]
          const additions=new Map(pending.filter((row)=>!row.deleted_at && !supersedingRemovals(row).length).map((row)=>[JSON.stringify([row.task_id,row.label_id]),row]))
          const families=new Map<string,string[]>()
          if (removals.length) {
            const {data: links}=await readAllIn([...new Set(removals.map((row)=>row.task_id))],(ids)=>client.from('task_labels').select('task_id,label_id').in('task_id',ids).is('deleted_at',null),['task_id','label_id'])
            const remoteIds=[...new Set(links.map((row)=>String(row.label_id)))]
            const {data: definitions}=await readAllIn(remoteIds,(ids)=>client.from('user_labels').select('id,name').in('id',ids))
            const names=new Map(definitions.map((row)=>[String(row.id),String(row.name).toLowerCase()]))
            if (remoteIds.some((id)=>!names.has(id) && !labelIds.includes(id))) throw new Error('Task label removal identity unavailable')
            for (const row of removals) {
              const local=allStates.get(row.task_id) ?? []
              const ids=[...new Set([row.label_id,...local.filter((other)=>sameFamily(row,other)).map((other)=>other.label_id),...links.filter((link)=>link.task_id===row.task_id && localNames.has(row.label_id) && names.get(String(link.label_id))===localNames.get(row.label_id)).map((link)=>String(link.label_id))])]
              families.set(JSON.stringify([row.task_id,row.label_id]),ids.filter((id)=>{
                const choice=local.find((other)=>other.label_id===id)
                if (choice && !choice.deleted_at && choice.local_version>row.local_version) {
                  if (!supersedingRemovals(choice).length) additions.set(JSON.stringify([choice.task_id,choice.label_id]),choice)
                  return false
                }
                return true
              }))
            }
          }
          const active=[...additions.values()]
          if (active.length) {
            let palette=palettes.get(projectId)
            if (!palette) {
              palette=readAll(()=>client.from('project_labels').select('label_id').eq('project_id',projectId).is('deleted_at',null),['label_id']).then(({data})=>new Set(data.map((row)=>String(row.label_id))))
              palettes.set(projectId,palette)
            }
            const available=await palette
            if (active.some((row)=>!available.has(row.label_id))) throw new Error('Project label addition pending')
          }
          const latest=await Promise.all(taskIds.map((id)=>api.tasks.getLabelState(id)))
          if (taskIds.some((id,index)=>JSON.stringify(latest[index])!==JSON.stringify(allStates.get(id)))) {await deliver(taskIds);return}
          const operations: Array<{rows: TaskLabelSyncState[]; write(): PromiseLike<{error: {message:string}|null}>}>=[]
          for (let index=0;index<active.length;index+=200) {
            const rows=active.slice(index,index+200)
            operations.push({rows,write:()=>client.from('task_labels').upsert(rows.map((row)=>({task_id:row.task_id,label_id:row.label_id,deleted_at:null})),{onConflict:'task_id,label_id'})})
          }
          for (const row of removals) {
            const ids=families.get(JSON.stringify([row.task_id,row.label_id]))!
            for (let index=0;index<ids.length;index+=200) {
              const batch=ids.slice(index,index+200)
              operations.push({rows:[row],write:()=>client.from('task_labels').delete().eq('task_id',row.task_id).in('label_id',batch)})
            }
          }
          const requests=operations.map((operation)=>(async()=>{
            const {error}=await operation.write()
            if (error) throw new Error(error.message)
          })())
          await Promise.all(taskIds.map(async(id)=>{
            try {
              const relevant=operations.map((operation,index)=>operation.rows.some((row)=>row.task_id===id)?requests[index]:null).filter((request)=>request!==null)
              const results=await Promise.allSettled(relevant)
              const failure=results.find((result)=>result.status==='rejected')
              if (failure?.status==='rejected') throw failure.reason
              if (JSON.stringify(await api.tasks.getLabelState(id))!==JSON.stringify(allStates.get(id))) {await deliver([id]);return}
              await api.tasks.acknowledgeLabelState(id,states.get(id)!)
              if ((await api.tasks.getLabelState(id)).some((row)=>row.sync_pending)) await deliver([id])
              else complete(id)
            } catch(error) {complete(id,error)}
          }))
        } catch(error) {for(const id of taskIds) complete(id,error)}
      }
      await deliver(ids)
    }))
  })
}
