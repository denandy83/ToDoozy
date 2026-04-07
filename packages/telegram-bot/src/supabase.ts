import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { v4 as uuidv4 } from 'uuid'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY
const TODOOZY_USER_ID = process.env.TODOOZY_USER_ID

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !TODOOZY_USER_ID) {
  throw new Error('Missing required env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY, TODOOZY_USER_ID')
}

export const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
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

// ---- Projects ----

export async function getProjects(): Promise<SupabaseProject[]> {
  // Get projects where user is a member
  const { data: memberships, error: memberErr } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('user_id', userId)

  if (memberErr) throw memberErr
  if (!memberships || memberships.length === 0) return []

  const projectIds = memberships.map((m) => m.project_id)
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, owner_id')
    .in('id', projectIds)

  if (error) throw error
  return data ?? []
}

export async function findProjectByName(name: string): Promise<SupabaseProject | null> {
  const projects = await getProjects()
  const q = name.toLowerCase()

  // Exact match first
  const exact = projects.find((p) => p.name.toLowerCase() === q)
  if (exact) return exact

  // Prefix match
  const prefix = projects.find((p) => p.name.toLowerCase().startsWith(q))
  if (prefix) return prefix

  // Substring match
  const sub = projects.find((p) => p.name.toLowerCase().includes(q))
  return sub ?? null
}

// ---- Statuses ----

export async function getDefaultStatus(projectId: string): Promise<SupabaseStatus | null> {
  const { data, error } = await supabase
    .from('statuses')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_default', 1)
    .limit(1)
    .single()

  if (error) return null
  return data
}

export async function getDoneStatus(projectId: string): Promise<SupabaseStatus | null> {
  const { data, error } = await supabase
    .from('statuses')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_done', 1)
    .limit(1)
    .single()

  if (error) return null
  return data
}

export async function findStatusByName(projectId: string, name: string): Promise<SupabaseStatus | null> {
  const { data, error } = await supabase
    .from('statuses')
    .select('*')
    .eq('project_id', projectId)

  if (error || !data) return null
  const q = name.toLowerCase()
  return data.find((s) => s.name.toLowerCase().startsWith(q)) ?? null
}

// ---- Labels ----

export async function getLabels(): Promise<SupabaseLabel[]> {
  const { data, error } = await supabase
    .from('user_labels')
    .select('*')
    .eq('user_id', userId)

  if (error) throw error
  return data ?? []
}

export async function findOrCreateLabel(name: string): Promise<SupabaseLabel> {
  const labels = await getLabels()
  const q = name.toLowerCase()

  // Find existing
  const existing = labels.find((l) => l.name.toLowerCase() === q)
  if (existing) return existing

  // Auto-create with next color
  const LABEL_AUTO_COLORS = [
    '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899',
    '#14b8a6', '#f97316', '#06b6d4', '#84cc16', '#6366f1', '#e11d48'
  ]
  const usedColors = new Set(labels.map((l) => l.color.toLowerCase()))
  let color = LABEL_AUTO_COLORS[0]
  for (const c of LABEL_AUTO_COLORS) {
    if (!usedColors.has(c.toLowerCase())) {
      color = c
      break
    }
  }
  if (usedColors.has(color.toLowerCase())) {
    color = LABEL_AUTO_COLORS[labels.length % LABEL_AUTO_COLORS.length]
  }

  const id = uuidv4()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('user_labels')
    .insert({
      id,
      user_id: userId,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      color,
      created_at: now,
      updated_at: now
    })
    .select()
    .single()

  if (error) throw error
  return data
}

// ---- Tasks ----

export async function createTask(params: {
  projectId: string
  title: string
  priority: number
  dueDate: string | null
  referenceUrl: string | null
  statusId: string | null
  labelIds: string[]
}): Promise<SupabaseTask> {
  const { projectId, title, priority, dueDate, referenceUrl, statusId, labelIds } = params

  // Get default status if none specified
  let finalStatusId = statusId
  if (!finalStatusId) {
    const defaultStatus = await getDefaultStatus(projectId)
    if (defaultStatus) finalStatusId = defaultStatus.id
  }

  // Check user's task position preference
  const { data: posSetting } = await supabase
    .from('user_settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', 'new_task_position')
    .single()
  const position = posSetting?.value ?? 'top'

  // Get order_index based on position preference
  const { data: edgeRow } = await supabase
    .from('tasks')
    .select('order_index')
    .eq('project_id', projectId)
    .eq('status_id', finalStatusId ?? '')
    .eq('is_archived', 0)
    .order('order_index', { ascending: position === 'top' })
    .limit(1)
    .single()

  const sortOrder = position === 'top'
    ? (edgeRow?.order_index ?? 0) - 1
    : (edgeRow?.order_index ?? 0) + 1

  const id = uuidv4()
  const now = new Date().toISOString()
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      id,
      project_id: projectId,
      owner_id: userId,
      title,
      status_id: finalStatusId,
      priority,
      due_date: dueDate,
      reference_url: referenceUrl,
      is_in_my_day: 0,
      is_archived: 0,
      parent_id: null,
      order_index: sortOrder,
      created_at: now,
      updated_at: now,
      completed_date: null
    })
    .select()
    .single()

  if (error) throw error

  // Assign labels
  for (const labelId of labelIds) {
    await supabase.from('task_labels').insert({
      id: uuidv4(),
      task_id: id,
      label_id: labelId
    })
  }

  return data
}

export async function getProjectTasks(projectId: string): Promise<(SupabaseTask & { labels: SupabaseLabel[] })[]> {
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('project_id', projectId)
    .eq('is_archived', 0)
    .order('order_index', { ascending: true })

  if (error) throw error
  if (!tasks) return []

  // Filter out done tasks
  const { data: statuses } = await supabase
    .from('statuses')
    .select('id, is_done')
    .eq('project_id', projectId)

  const doneStatusIds = new Set((statuses ?? []).filter((s) => s.is_done).map((s) => s.id))
  const nonDoneTasks = tasks.filter((t) => !doneStatusIds.has(t.status_id))

  // Get labels for tasks
  const taskIds = nonDoneTasks.map((t) => t.id)
  const { data: taskLabels } = await supabase
    .from('task_labels')
    .select('task_id, label_id')
    .in('task_id', taskIds)

  const allLabels = await getLabels()
  const labelMap = new Map(allLabels.map((l) => [l.id, l]))

  return nonDoneTasks.map((t) => {
    const tLabels = (taskLabels ?? [])
      .filter((tl) => tl.task_id === t.id)
      .map((tl) => labelMap.get(tl.label_id))
      .filter((l): l is SupabaseLabel => l !== undefined)
    return { ...t, labels: tLabels }
  })
}

export async function completeTask(taskId: string): Promise<boolean> {
  // Get task to find project
  const { data: task, error: taskErr } = await supabase
    .from('tasks')
    .select('project_id')
    .eq('id', taskId)
    .single()

  if (taskErr || !task) return false

  const doneStatus = await getDoneStatus(task.project_id)
  if (!doneStatus) return false

  const now = new Date().toISOString()
  const { error } = await supabase
    .from('tasks')
    .update({
      status_id: doneStatus.id,
      completed_date: now,
      updated_at: now
    })
    .eq('id', taskId)

  return !error
}

export async function getMyDayTasks(): Promise<(SupabaseTask & { project_name: string; labels: SupabaseLabel[] })[]> {
  // Get all tasks marked as My Day
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('is_in_my_day', 1)
    .eq('is_archived', 0)

  if (error) throw error
  if (!tasks || tasks.length === 0) return []

  // Get projects
  const projectIds = [...new Set(tasks.map((t) => t.project_id))]
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name')
    .in('id', projectIds)

  const projectMap = new Map((projects ?? []).map((p) => [p.id, p.name]))

  // Filter out done tasks
  const statusIds = [...new Set(tasks.map((t) => t.status_id))]
  const { data: statuses } = await supabase
    .from('statuses')
    .select('id, is_done')
    .in('id', statusIds)

  const doneStatusIds = new Set((statuses ?? []).filter((s) => s.is_done).map((s) => s.id))
  const nonDoneTasks = tasks.filter((t) => !doneStatusIds.has(t.status_id))

  // Get labels
  const taskIds = nonDoneTasks.map((t) => t.id)
  const { data: taskLabels } = await supabase
    .from('task_labels')
    .select('task_id, label_id')
    .in('task_id', taskIds)

  const allLabels = await getLabels()
  const labelMap = new Map(allLabels.map((l) => [l.id, l]))

  return nonDoneTasks.map((t) => {
    const tLabels = (taskLabels ?? [])
      .filter((tl) => tl.task_id === t.id)
      .map((tl) => labelMap.get(tl.label_id))
      .filter((l): l is SupabaseLabel => l !== undefined)
    return {
      ...t,
      project_name: projectMap.get(t.project_id) ?? 'Unknown',
      labels: tLabels
    }
  })
}

export async function getRecentTasks(limit: number = 10): Promise<(SupabaseTask & { project_name: string })[]> {
  // Get non-done, non-archived tasks across all projects, ordered by most recent
  const projects = await getProjects()
  if (projects.length === 0) return []

  const projectIds = projects.map((p) => p.id)
  const projectMap = new Map(projects.map((p) => [p.id, p.name]))

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .in('project_id', projectIds)
    .eq('is_archived', 0)
    .order('created_at', { ascending: false })
    .limit(limit * 2) // fetch extra to filter done

  if (error) throw error
  if (!tasks) return []

  // Get statuses to filter done
  const statusIds = [...new Set(tasks.map((t) => t.status_id))]
  const { data: statuses } = await supabase
    .from('statuses')
    .select('id, is_done')
    .in('id', statusIds)

  const doneStatusIds = new Set((statuses ?? []).filter((s) => s.is_done).map((s) => s.id))

  return tasks
    .filter((t) => !doneStatusIds.has(t.status_id))
    .slice(0, limit)
    .map((t) => ({
      ...t,
      project_name: projectMap.get(t.project_id) ?? 'Unknown'
    }))
}

export async function getRecentlyCompletedTasks(limit: number = 10): Promise<(SupabaseTask & { project_name: string })[]> {
  const projects = await getProjects()
  if (projects.length === 0) return []

  const projectIds = projects.map((p) => p.id)
  const projectMap = new Map(projects.map((p) => [p.id, p.name]))

  // Get all done status IDs
  const { data: doneStatuses } = await supabase
    .from('statuses')
    .select('id')
    .in('project_id', projectIds)
    .eq('is_done', 1)

  const doneStatusIds = (doneStatuses ?? []).map((s) => s.id)
  if (doneStatusIds.length === 0) return []

  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .in('project_id', projectIds)
    .in('status_id', doneStatusIds)
    .eq('is_archived', 0)
    .order('completed_date', { ascending: false })
    .limit(limit)

  if (error) throw error
  if (!tasks) return []

  return tasks.map((t) => ({
    ...t,
    project_name: projectMap.get(t.project_id) ?? 'Unknown'
  }))
}

export async function fuzzyFindTask(query: string): Promise<(SupabaseTask & { project_name: string }) | null> {
  const tasks = await getRecentTasks(50)
  const q = query.toLowerCase()

  // Exact match
  const exact = tasks.find((t) => t.title.toLowerCase() === q)
  if (exact) return exact

  // Prefix
  const prefix = tasks.find((t) => t.title.toLowerCase().startsWith(q))
  if (prefix) return prefix

  // Substring
  const sub = tasks.find((t) => t.title.toLowerCase().includes(q))
  return sub ?? null
}
