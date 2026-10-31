import { readAll, requireSuccess } from './query'
import { PartialTaskCreationError } from './taskCreationError'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const TODOOZY_USER_ID = process.env.TODOOZY_USER_ID

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TODOOZY_USER_ID) {
  throw new Error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, TODOOZY_USER_ID')
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
export const userId = TODOOZY_USER_ID

// ---- Types ----

export interface SupabaseProject {
  id: string
  name: string
  owner_id: string
}

export interface SupabaseTask {
  id: string
  project_id: string
  title: string
  status_id: string
  priority: number
  due_date: string | null
  reference_url: string | null
  is_in_my_day: number
  is_archived: number
  parent_id: string | null
  order_index: number
  created_at: string
  updated_at: string
  completed_date: string | null
}

export interface SupabaseStatus {
  id: string
  project_id: string
  name: string
  is_done: boolean
  is_default: boolean
  order_index: number
}

export interface SupabaseLabel {
  id: string
  user_id: string
  name: string
  color: string
}

// Service-role requests must reimpose membership and owner scope explicitly.
const PAGE_IDS = 200
async function batches<T extends Record<string, unknown>>(ids: string[], query: (ids: string[]) => Parameters<typeof readAll<T>>[0], keys = ['id']): Promise<T[]> {
  const rows: T[] = []
  for (let i=0; i<ids.length; i+=PAGE_IDS) rows.push(...(await readAll(query(ids.slice(i,i+PAGE_IDS)),keys)).data)
  return rows
}
export async function getProjects(): Promise<SupabaseProject[]> {
  const { data: members } = await readAll(() => supabase.from('project_members').select('project_id').eq('user_id',userId), ['project_id'])
  return await batches(members.map(m=>m.project_id as string), ids => () => supabase.from('projects')
    .select('id,name,owner_id').in('id',ids).is('deleted_at',null).eq('is_archived',0)) as unknown as SupabaseProject[]
}
async function assertProject(projectId: string): Promise<void> {
  if (!(await getProjects()).some(p=>p.id===projectId)) throw new Error('Project is unavailable or access was revoked')
}
export async function findProjectByName(name: string): Promise<SupabaseProject | null> {
  const rows=await getProjects(), q=name.toLowerCase()
  return rows.find(p=>p.name.toLowerCase()===q) ?? rows.find(p=>p.name.toLowerCase().startsWith(q)) ?? rows.find(p=>p.name.toLowerCase().includes(q)) ?? null
}
async function statusFor(projectId: string, flag: 'is_default'|'is_done'): Promise<SupabaseStatus|null> {
  const { data }=await requireSuccess(supabase.from('statuses').select('*').eq('project_id',projectId).is('deleted_at',null).eq(flag,1).limit(1).maybeSingle())
  return data
}
export async function getDefaultStatus(projectId: string): Promise<SupabaseStatus|null> { await assertProject(projectId); return statusFor(projectId,'is_default') }
export async function getDoneStatus(projectId: string): Promise<SupabaseStatus|null> { await assertProject(projectId); return statusFor(projectId,'is_done') }
export async function findStatusByName(projectId: string,name: string): Promise<SupabaseStatus|null> {
  await assertProject(projectId)
  const { data }=await readAll(()=>supabase.from('statuses').select('*').eq('project_id',projectId).is('deleted_at',null))
  return data.find(s=>String(s.name).toLowerCase().startsWith(name.toLowerCase())) as unknown as SupabaseStatus ?? null
}
export async function getLabels(): Promise<SupabaseLabel[]> {
  return (await readAll(()=>supabase.from('user_labels').select('*').eq('user_id',userId).is('deleted_at',null))).data as unknown as SupabaseLabel[]
}
export async function findOrCreateLabel(name: string): Promise<SupabaseLabel> {
  const labels=await getLabels(), q=name.toLowerCase()
  const existing=labels.find(l=>l.name.toLowerCase()===q)
  if (existing) return existing
  const colors=['#ef4444','#f59e0b','#22c55e','#3b82f6','#8b5cf6','#ec4899','#14b8a6','#f97316','#06b6d4','#84cc16','#6366f1','#e11d48']
  const used=new Set(labels.map(l=>l.color.toLowerCase()))
  const color=colors.find(c=>!used.has(c)) ?? colors[labels.length%colors.length]
  const now=new Date().toISOString()
  const { data }=await requireSuccess(supabase.from('user_labels').insert({id:uuidv4(),user_id:userId,name:name.charAt(0).toUpperCase()+name.slice(1),color,created_at:now,updated_at:now}).select().single())
  return data
}
export async function createTask(params: {projectId:string;title:string;priority:number;dueDate:string|null;referenceUrl:string|null;statusId:string|null;labelIds:string[];recurrenceRule?:string|null}): Promise<SupabaseTask> {
  await assertProject(params.projectId)
  const selectedLabels=[...new Set(params.labelIds)]
  if (selectedLabels.length) {
    const labels=await getLabels()
    if (selectedLabels.some(id=>!labels.some(l=>l.id===id))) throw new Error('A requested label is unavailable')
  }
  const status=params.statusId ?? (await statusFor(params.projectId,'is_default'))?.id
  if (!status) throw new Error('No active default status')
  const { data: activeStatus } = await requireSuccess(supabase.from('statuses').select('id,is_done')
    .eq('id',status).eq('project_id',params.projectId).is('deleted_at',null).maybeSingle())
  if (!activeStatus) throw new Error('Status must be active and belong to the selected project')
  const { data: pos }=await requireSuccess(supabase.from('user_settings').select('value').eq('user_id',userId).eq('key','new_task_position').maybeSingle())
  const top=pos?.value!=='bottom'
  const { data: edge }=await requireSuccess(supabase.from('tasks').select('order_index').eq('project_id',params.projectId).eq('status_id',status).eq('is_archived',0).is('deleted_at',null).order('order_index',{ascending:top}).limit(1).maybeSingle())
  const now=new Date().toISOString(), id=uuidv4()
  const { data }=await requireSuccess(supabase.from('tasks').insert({id,project_id:params.projectId,owner_id:userId,title:params.title,status_id:status,priority:params.priority,due_date:params.dueDate,reference_url:params.referenceUrl,recurrence_rule:params.recurrenceRule??null,is_in_my_day:0,is_archived:0,is_template:0,parent_id:null,order_index:(edge?.order_index??0)+(top?-1:1),created_at:now,updated_at:now,completed_date:activeStatus.is_done ? now : null}).select().single())
  if (selectedLabels.length) {
    try { await requireSuccess(supabase.from('task_labels').insert(selectedLabels.map(label_id=>({task_id:id,label_id})))) }
    catch { throw new PartialTaskCreationError(id) }
  }
  return data
}
async function activeTasks(projectIds: string[], ownerOnly = false): Promise<SupabaseTask[]> {
  return await batches(projectIds, ids=>()=>{
    const query = supabase.from('tasks').select('*').in('project_id',ids).is('deleted_at',null).eq('is_archived',0).eq('is_template',0)
    return ownerOnly ? query.eq('owner_id',userId) : query
  }) as unknown as SupabaseTask[]
}
async function doneIds(projectIds: string[]): Promise<Set<string>> {
  const rows=await batches(projectIds, ids=>()=>supabase.from('statuses').select('id,is_done').in('project_id',ids).is('deleted_at',null))
  return new Set(rows.filter(s=>s.is_done===1||s.is_done===true).map(s=>s.id as string))
}
async function withLabels(tasks: SupabaseTask[]): Promise<(SupabaseTask & {labels:SupabaseLabel[]})[]> {
  if (!tasks.length) return []
  const [links, labels]=await Promise.all([
    batches(tasks.map(t=>t.id), ids=>()=>supabase.from('task_labels').select('task_id,label_id').in('task_id',ids).is('deleted_at',null), ['task_id','label_id']), getLabels()
  ])
  const labelsById=new Map(labels.map(l=>[l.id,l])), byTask=new Map<string,SupabaseLabel[]>()
  for (const row of links) {
    const label=labelsById.get(row.label_id as string)
    if (label) { const found=byTask.get(row.task_id as string)??[];found.push(label);byTask.set(row.task_id as string,found) }
  }
  return tasks.map(t=>({...t,labels:byTask.get(t.id)??[]}))
}
export async function getProjectTasks(projectId: string): Promise<(SupabaseTask & {labels:SupabaseLabel[]})[]> {
  await assertProject(projectId)
  const [tasks,done]=await Promise.all([activeTasks([projectId]),doneIds([projectId])])
  return withLabels(tasks.filter(t=>!done.has(t.status_id)).sort((a,b)=>a.order_index-b.order_index))
}
export async function completeTask(taskId: string): Promise<boolean> {
  const projects=await getProjects()
  if (!projects.length) return false
  const { data: task }=await requireSuccess(supabase.from('tasks').select('project_id').eq('id',taskId).in('project_id',projects.map(p=>p.id)).is('deleted_at',null).eq('is_archived',0).eq('is_template',0).maybeSingle())
  if (!task) return false
  const done=await statusFor(task.project_id,'is_done')
  if (!done) return false
  const now=new Date().toISOString()
  const { data }=await requireSuccess(supabase.from('tasks').update({status_id:done.id,completed_date:now,updated_at:now}).eq('id',taskId).eq('project_id',task.project_id).select('id').maybeSingle())
  return !!data
}
function dayKey(value: string|Date,zone: string): string {
  if (typeof value==='string' && !/[zZ+-]/.test(value.slice(10))) return value.slice(0,10)
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value))
  const get=(type:string): string=>parts.find(p=>p.type===type)!.value
  return `${get('year')}-${get('month')}-${get('day')}`
}
export async function getMyDayTasks(): Promise<(SupabaseTask & {project_name:string;labels:SupabaseLabel[]})[]> {
  const projects=await getProjects()
  if (!projects.length) return []
  const zone=process.env.TODOOZY_TIME_ZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const today=dayKey(new Date(),zone)
  const [tasks,done]=await Promise.all([activeTasks(projects.map(p=>p.id), true),doneIds(projects.map(p=>p.id))])
  const selected=tasks.filter(t=>(t as SupabaseTask & {owner_id:string}).owner_id===userId && !done.has(t.status_id) && (t.is_in_my_day===1 || (t.due_date!==null && dayKey(t.due_date,zone)<=today)))
  const names=new Map(projects.map(p=>[p.id,p.name]))
  return (await withLabels(selected)).map(t=>({...t,project_name:names.get(t.project_id)??'Unknown'})).sort((a,b)=>(a.due_date??'9999').localeCompare(b.due_date??'9999'))
}
async function recentTasks(limit: number, completed: boolean): Promise<(SupabaseTask & {project_name:string})[]> {
  const count = Math.max(0, Math.min(1000, Math.floor(Number.isFinite(limit) ? limit : 10)))
  if (!count) return []
  const projects = await getProjects(), names = new Map(projects.map(p=>[p.id,p.name]))
  const statuses = await batches(projects.map(p=>p.id), ids=>()=>supabase.from('statuses')
    .select('id,is_done').in('project_id',ids).is('deleted_at',null).eq('is_done',completed ? 1 : 0))
  const column = completed ? 'completed_date' : 'created_at'
  const candidates: SupabaseTask[] = []
  for (let p=0;p<projects.length;p+=PAGE_IDS) for (let s=0;s<statuses.length;s+=PAGE_IDS) {
    let cursor: SupabaseTask | undefined
    const chunk: SupabaseTask[] = []
    while (chunk.length<count) {
      let query = supabase.from('tasks').select('*').in('project_id',projects.slice(p,p+PAGE_IDS).map(x=>x.id))
        .in('status_id',statuses.slice(s,s+PAGE_IDS).map(x=>x.id)).is('deleted_at',null).eq('is_archived',0).eq('is_template',0)
      if (completed) query=query.not('completed_date','is',null)
      if (cursor) {
        const value=JSON.stringify(cursor[column]), id=JSON.stringify(cursor.id)
        query=query.or(`${column}.lt.${value},and(${column}.eq.${value},id.lt.${id})`)
      }
      const { data }=await requireSuccess(query.order(column,{ascending:false}).order('id',{ascending:false}).limit(Math.min(500,count-chunk.length)))
      const page=(data??[]) as SupabaseTask[]
      if (!page.length) break
      const next=page.at(-1)!
      if (cursor && next.id===cursor.id) throw new Error('Recent task pagination did not advance')
      chunk.push(...page);cursor=next
    }
    candidates.push(...chunk)
  }
  return candidates.sort((a,b)=>(b[column]??'').localeCompare(a[column]??'') || b.id.localeCompare(a.id)).slice(0,count)
    .map(t=>({...t,project_name:names.get(t.project_id)??'Unknown'}))
}
export async function getRecentTasks(limit=10): Promise<(SupabaseTask & {project_name:string})[]> { return recentTasks(limit,false) }
export async function getRecentlyCompletedTasks(limit=10): Promise<(SupabaseTask & {project_name:string})[]> { return recentTasks(limit,true) }
export async function fuzzyFindTask(query: string): Promise<(SupabaseTask & {project_name:string})|null> {
  const tasks=await getRecentTasks(50), q=query.toLowerCase()
  return tasks.find(t=>t.title.toLowerCase()===q) ?? tasks.find(t=>t.title.toLowerCase().startsWith(q)) ?? tasks.find(t=>t.title.toLowerCase().includes(q)) ?? null
}
