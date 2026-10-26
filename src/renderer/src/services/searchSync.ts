import type { SupabaseClient } from '@supabase/supabase-js'
import { readAllIn } from './readAll'
import type { Project, Status, Task } from '../../../shared/types'
import { captureSyncContext } from './syncContext'
import { useAuthStore } from '../shared/stores/authStore'
import { useTaskStore } from '../shared/stores/taskStore'
import { useStatusStore } from '../shared/stores/statusStore'
import { logEvent } from '../shared/stores/logStore'
import { placeholderEmail } from '../../../shared/placeholderUser'
import { pullTaskLabelsForTasks } from './PersonalSyncService'

const inFlight = new Map<string, Promise<void>>()
const watermarks = new Map<string, string>()

async function readRows<T extends { id: string; updated_at: string }>(client: SupabaseClient, table: string, ids: string[], since?: string): Promise<T[]> {
  const rows = new Map<string, T>()
  let cursor: T | undefined
  for (;;) {
    let query = client.from(table).select('*').in('project_id', ids).order('updated_at').order('id').limit(500)
    if (since) query = query.gt('updated_at', since)
    if (cursor) {
      const stamp = JSON.stringify(cursor.updated_at)
      query = query.or(`updated_at.gt.${stamp},and(updated_at.eq.${stamp},id.gt.${cursor.id})`)
    }
    const { data, error } = await query
    if (error) throw new Error(error.message)
    const page = (data ?? []) as T[]
    for (const row of page) rows.set(row.id, row)
    if (page.length < 500) return [...rows.values()]
    cursor = page[page.length - 1]
  }
}

/** Explicit search refresh includes unopened personal projects without background polling. */
export function refreshSearchIndex(userId: string): Promise<void> {
  const current = inFlight.get(userId)
  if (current) return current
  const operation = refresh(userId).finally(() => inFlight.delete(userId))
  inFlight.set(userId, operation)
  return operation
}

async function refresh(userId: string): Promise<void> {
  const isCurrentUser = (): boolean => useAuthStore.getState().currentUser?.id === userId
  try {
    const context = await captureSyncContext()
    const api = context.api
    const projects = await api.projects.getProjectsForUser(userId)
    const ids = projects.map((project) => project.id).sort()
    if (!ids.length || !isCurrentUser()) return
    const client = context.client
    if (!isCurrentUser()) return
    const { data: metadata } = await readAllIn(ids, (batch) => client.from('projects').select('*').in('id', batch))
    for (const project of metadata) await api.projects.applyRemote(project as unknown as Project)
    const scope = `${context.scope}:${userId}:${ids.join(',')}`
    const [statuses, tasks] = await Promise.all([
      readRows<Status>(client, 'statuses', ids, watermarks.get(`${scope}:statuses`)),
      readRows<Task>(client, 'tasks', ids, watermarks.get(`${scope}:tasks`))
    ])
    if (!isCurrentUser()) return
    for (const status of statuses) {
      if (!isCurrentUser()) return
      await api.statuses.applyRemote(status)
    }
    const byId = new Map(tasks.map((task) => [task.id, task]))
    const applied = new Set<string>()
    const applying = new Set<string>()
    const apply = async (task: Task): Promise<void> => {
      if (applied.has(task.id) || applying.has(task.id) || !isCurrentUser()) return
      applying.add(task.id)
      const parent = task.parent_id ? byId.get(task.parent_id) : undefined
      if (parent) await apply(parent)
      for (const id of new Set([task.owner_id, task.assigned_to].filter((id): id is string => !!id))) {
        const user = await api.users.findById(id)
        if (!isCurrentUser()) return
        if (!user) await api.users.create({ id, email: placeholderEmail(id), display_name: null, avatar_url: null })
      }
      if (!isCurrentUser()) return
      await api.tasks.applyRemote(task)
      applied.add(task.id)
    }
    for (const task of tasks) await apply(task)
    for (let i = 0; i < tasks.length; i += 200) {
      if (!isCurrentUser()) return
      await pullTaskLabelsForTasks(tasks.slice(i, i + 200).map((task) => task.id), userId, context)
    }
    if (!isCurrentUser()) return
    for (const project of projects) {
      if (!isCurrentUser()) return
      await useStatusStore.getState().hydrateStatuses(project.id)
    }
    if (!isCurrentUser()) return
    await useTaskStore.getState().hydrateAllForUser(userId)
    for (const [table, rows] of [['statuses', statuses], ['tasks', tasks]] as const) {
      if (rows.length) watermarks.set(`${scope}:${table}`, new Date(Math.max(...rows.map((row) => Date.parse(row.updated_at))) - 1).toISOString())
    }
  } catch (error) {
    logEvent('warn', 'sync', 'Search refresh unavailable; showing locally saved tasks', String(error))
  }
}
