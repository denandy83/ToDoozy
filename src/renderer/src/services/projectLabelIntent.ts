import type { SupabaseClient } from '@supabase/supabase-js'
import { readAll } from './readAll'
import { orderTaskLabelWrites, syncTaskLabelChoices } from './taskLabelAdditions'
import type { TodoozyAPI } from '../../../preload/index.d'

export async function currentProjectLink(projectId: string, labelId: string, api: TodoozyAPI): Promise<{ created_at: string; deleted_at: string | null } | null> {
  const project = await api.projects.findById(projectId)
  if (!project) return null
  const links = project.is_shared === 1
    ? await api.labels.getProjectLabelsForSharedProjects()
    : await api.labels.getProjectLabelsForOwner(project.owner_id)
  const link = links.find((row) => row.project_id === projectId && row.label_id === labelId)
  return link ? { created_at: link.created_at, deleted_at: link.deleted_at } : null
}


export async function currentProjectLabelFamily(projectId: string, labelId: string, api: TodoozyAPI, labelName?: string): Promise<Array<{ label_id: string; created_at: string; deleted_at: string | null }>> {
  const project = await api.projects.findById(projectId)
  if (!project) return []
  const name = labelName ?? (await api.labels.findById(labelId))?.name
  const links = project.is_shared === 1 ? await api.labels.getProjectLabelsForSharedProjects() : await api.labels.getProjectLabelsForOwner(project.owner_id)
  const family = []
  for (const link of links.filter((row) => row.project_id === projectId)) {
    if (link.label_id === labelId || (name && (await api.labels.findById(link.label_id))?.name.toLowerCase() === name.toLowerCase())) family.push(link)
  }
  return family.sort((a,b) => a.label_id.localeCompare(b.label_id))
}


export interface ProjectLabelRemoval {
  projectId: string
  labelId: string
  deletedAt: string
  labelName?: string
  expectedLink: Awaited<ReturnType<typeof currentProjectLink>>
}

export function projectLinkSuperseded(current: Awaited<ReturnType<typeof currentProjectLink>>, expected: Awaited<ReturnType<typeof currentProjectLink>>): boolean {
  return !!current && !current.deleted_at && JSON.stringify(current) !== JSON.stringify(expected)
}

export async function removeRemoteProjectLabel(client: SupabaseClient, api: TodoozyAPI, intent: ProjectLabelRemoval, scope: string, assertCurrent: () => void = () => {}): Promise<void> {
  const currentAdditions = async (): Promise<Awaited<ReturnType<typeof currentProjectLabelFamily>>> => {
    const additions = (await api.sync.getQueue()).filter((entry) => entry.table_name === 'project_labels').map((entry) => JSON.parse(entry.payload))
    return (await currentProjectLabelFamily(intent.projectId, intent.labelId, api, intent.labelName)).filter((link) => !link.deleted_at && (
      (link.label_id === intent.labelId && projectLinkSuperseded({created_at:link.created_at,deleted_at:link.deleted_at}, intent.expectedLink)) ||
      Date.parse(link.created_at) > Date.parse(intent.deletedAt) ||
      additions.some((entry) => entry.addition && entry.projectId === intent.projectId && entry.labelId === link.label_id && entry.createdAt === link.created_at)
    ))
  }
  const restoreReaddition = async (): Promise<boolean> => {
    const latest=await currentAdditions()
    if (!latest.length) return false
    for (let index = 0; index < latest.length; index += 200) {
      await writeProjectLabelChoices(client,api,latest.slice(index,index+200).map((link) => ({
        project_id: intent.projectId, label_id: link.label_id, created_at: link.created_at, deleted_at: null
      })),assertCurrent)
    }
    const localTasks = await api.tasks.findAllByProject(intent.projectId)
    await syncTaskLabelChoices(client, localTasks.map((task) => task.id), api, scope)
    return true
  }
  if (await restoreReaddition()) return
  const local = await api.labels.findById(intent.labelId)
  let name = intent.labelName ?? local?.name
  if (!name) {
    const { data, error } = await client.from('user_labels').select('name').eq('id', intent.labelId).maybeSingle()
    if (error) throw new Error(error.message)
    name = data?.name
  }
  const { data } = await readAll(() => client.from('project_labels').select('label_id,created_at,deleted_at,user_labels!inner(name)').eq('project_id', intent.projectId), ['label_id'])
  const ids = [...new Set([intent.labelId, ...data.filter((row) => {
    const label = Array.isArray(row.user_labels) ? row.user_labels[0] : row.user_labels
    return name && (label as { name?: string })?.name?.toLowerCase() === name.toLowerCase()
  }).map((row) => String(row.label_id))])]
  for (const link of data.filter((row)=>ids.includes(String(row.label_id)) && !row.deleted_at && Date.parse(String(row.created_at))>Date.parse(intent.deletedAt))) {
    if (!await api.labels.findById(String(link.label_id))) {
      const {data: label,error} = await client.from('user_labels').select('*').eq('id',link.label_id).maybeSingle()
      if (error) throw new Error(error.message)
      if (label) await api.labels.applyRemote(label)
    }
    await api.labels.applyRemoteProjectLabel({project_id:intent.projectId,label_id:String(link.label_id),created_at:String(link.created_at),deleted_at:null})
  }
  if (await restoreReaddition()) return
  for (let index = 0; index < ids.length; index += 200) {
    await writeProjectLabelChoices(client,api,ids.slice(index,index+200).map((label_id) => ({
      project_id: intent.projectId, label_id, created_at: intent.deletedAt, deleted_at: intent.deletedAt
    })),assertCurrent,true)
  }
  const { data: tasks } = await readAll(() => client.from('tasks').select('id').eq('project_id', intent.projectId))
  if (await restoreReaddition()) return
  for (let index = 0; index < tasks.length; index += 200) {
    for (let labelIndex = 0; labelIndex < ids.length; labelIndex += 200) {
      await orderTaskLabelWrites(scope,tasks.slice(index,index+200).map((task)=>String(task.id)),async(ready)=>{
        if ((await currentAdditions()).length) return
        const { error } = await client.from('task_labels').delete().in('task_id',ready).in('label_id',ids.slice(labelIndex,labelIndex+200))
        if (error) throw new Error(error.message)
      })
    }
  }
  await restoreReaddition()
}

export async function writeProjectLabelChoices(
  client: SupabaseClient,
  api: TodoozyAPI,
  links: Array<{project_id:string;label_id:string;created_at:string;deleted_at:string|null}>,
  assertCurrent: () => void,
  allowMissing = false
): Promise<void> {
  const unique = [...new Map(links.map((link)=>[JSON.stringify([link.project_id,link.label_id]),link])).values()]
  const latest = async (rows: typeof links): Promise<typeof links> => {
    const result: typeof links = []
    for (const row of rows) {
      assertCurrent()
      const current = await currentProjectLink(row.project_id,row.label_id,api)
      assertCurrent()
      if (current) {
        const chosen = allowMissing && Date.parse(row.deleted_at ?? row.created_at)>Date.parse(current.deleted_at ?? current.created_at) ? row : {...row,...current}
        result.push(chosen)
      } else if (allowMissing) result.push(row)
    }
    return result
  }
  await Promise.all(Array.from({length:Math.ceil(unique.length/200)},async(_,index)=>{
    let pending = unique.slice(index*200,index*200+200)
    try {
      while (pending.length) {
        const before = await latest(pending)
        if (!before.length) return
        assertCurrent()
        const {error} = await client.from('project_labels').upsert(before,{onConflict:'project_id,label_id'})
        assertCurrent()
        if (error) throw new Error(error.message)
        const after = await latest(before)
        const previous = new Map(before.map((row)=>[JSON.stringify([row.project_id,row.label_id]),row]))
        pending = after.filter((row)=>JSON.stringify(row)!==JSON.stringify(previous.get(JSON.stringify([row.project_id,row.label_id]))))
      }
    } catch (error) {
      assertCurrent()
      for (const row of await latest(pending)) {
        await api.sync.enqueue('project_labels',`${row.project_id}::${row.label_id}`,'UPDATE',JSON.stringify({projectId:row.project_id,labelId:row.label_id,createdAt:row.created_at,deletedAt:row.deleted_at,...(row.deleted_at?{expectedLink:{created_at:row.created_at,deleted_at:row.deleted_at}}:{addition:true})}))
      }
      throw error
    }
  }))
}
