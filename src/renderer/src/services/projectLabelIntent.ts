import type { SupabaseClient } from '@supabase/supabase-js'
import { readAll } from './readAll'
import { syncTaskLabelChoices } from './taskLabelAdditions'
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

export async function removeRemoteProjectLabel(client: SupabaseClient, api: TodoozyAPI, intent: ProjectLabelRemoval): Promise<void> {
  const restoreReaddition = async (): Promise<boolean> => {
    const additions = (await api.sync.getQueue()).filter((entry) => entry.table_name === 'project_labels').map((entry) => JSON.parse(entry.payload))
    const latest = (await currentProjectLabelFamily(intent.projectId, intent.labelId, api, intent.labelName)).filter((link) => !link.deleted_at && (
      (link.label_id === intent.labelId && projectLinkSuperseded({created_at:link.created_at,deleted_at:link.deleted_at}, intent.expectedLink)) ||
      Date.parse(link.created_at) > Date.parse(intent.deletedAt) ||
      additions.some((entry) => entry.addition && entry.projectId === intent.projectId && entry.labelId === link.label_id && entry.createdAt === link.created_at)
    ))
    if (!latest.length) return false
    for (let index = 0; index < latest.length; index += 200) {
      const { error } = await client.from('project_labels').upsert(latest.slice(index,index+200).map((link) => ({
        project_id: intent.projectId, label_id: link.label_id, created_at: link.created_at, deleted_at: null
      })), { onConflict: 'project_id,label_id' })
      if (error) throw new Error(error.message)
    }
    const localTasks = await api.tasks.findAllByProject(intent.projectId)
    await syncTaskLabelChoices(client, localTasks.map((task) => task.id), api)
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
    const { error } = await client.from('project_labels').upsert(ids.slice(index, index + 200).map((label_id) => ({
      project_id: intent.projectId, label_id, created_at: intent.deletedAt, deleted_at: intent.deletedAt
    })), { onConflict: 'project_id,label_id' })
    if (error) throw new Error(error.message)
  }
  const { data: tasks } = await readAll(() => client.from('tasks').select('id').eq('project_id', intent.projectId))
  if (await restoreReaddition()) return
  for (let index = 0; index < tasks.length; index += 200) {
    for (let labelIndex = 0; labelIndex < ids.length; labelIndex += 200) {
      const { error } = await client.from('task_labels').delete().in('task_id', tasks.slice(index, index + 200).map((task) => task.id)).in('label_id', ids.slice(labelIndex, labelIndex + 200))
      if (error) throw new Error(error.message)
    }
  }
  await restoreReaddition()
}
