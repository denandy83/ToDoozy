// ToDoozy MCP Server — Supabase Edge Function
// Streamable HTTP transport with API key authentication via mcp-lite

import { McpServer, StreamableHttpTransport } from 'mcp-lite'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import rruleLib from 'npm:rrule@2'
const RRule = rruleLib.RRule ?? rruleLib

// ── Types (inlined from shared/types.ts) ──────────────────────────────

interface RecurrenceConfig {
  interval: number
  unit: 'days' | 'weeks' | 'months' | 'years'
  weekDays?: string[]
  monthDay?: number
  monthOrdinal?: { nth: '1st' | '2nd' | '3rd' | '4th' | 'last'; day: string }
  yearMonth?: number
  yearDay?: number
  afterCompletion: boolean
  untilDate?: string
}

const TASK_UPDATABLE_COLUMNS = [
  'title', 'description', 'project_id', 'status_id', 'priority',
  'due_date', 'parent_id', 'order_index', 'is_in_my_day', 'completed_date',
  'assigned_to', 'is_archived', 'is_template', 'recurrence_rule',
  'reference_url', 'my_day_dismissed_date'
] as const

// ── Recurrence Utils (inlined) ─────────────────────────────────────────

const WEEK_DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
const WEEK_DAY_SET = new Set<string>(WEEK_DAYS)
const ORDINALS = ['1st', '2nd', '3rd', '4th', 'last'] as const
const ORDINAL_SET = new Set<string>(ORDINALS)

function parseRecurrence(rule: string | null): RecurrenceConfig | null {
  if (!rule) return null
  let untilDate: string | undefined
  let mainPart = rule
  const untilIdx = rule.indexOf('|until:')
  if (untilIdx !== -1) {
    untilDate = rule.slice(untilIdx + 7)
    mainPart = rule.slice(0, untilIdx)
  }
  const afterCompletion = mainPart.startsWith('every!:')
  const prefix = afterCompletion ? 'every!:' : 'every:'
  if (!mainPart.startsWith(prefix)) return null
  const rest = mainPart.slice(prefix.length)
  const parts = rest.split(':')
  if (parts.length < 2) return null
  const interval = parseInt(parts[0], 10)
  if (isNaN(interval) || interval < 1) return null
  const unit = parts[1] as RecurrenceConfig['unit']
  if (!['days', 'weeks', 'months', 'years'].includes(unit)) return null
  const config: RecurrenceConfig = { interval, unit, afterCompletion }
  if (untilDate) config.untilDate = untilDate
  if (unit === 'weeks' && parts.length >= 3) {
    const days = parts[2].split(',').filter((d) => WEEK_DAY_SET.has(d))
    if (days.length > 0) config.weekDays = days
  }
  if (unit === 'months' && parts.length >= 3) {
    if (parts.length >= 4 && ORDINAL_SET.has(parts[2])) {
      const nth = parts[2] as '1st' | '2nd' | '3rd' | '4th' | 'last'
      const day = parts[3]
      if (WEEK_DAY_SET.has(day)) config.monthOrdinal = { nth, day }
    } else {
      const day = parseInt(parts[2], 10)
      if (!isNaN(day) && day >= 1 && day <= 31) config.monthDay = day
    }
  }
  if (unit === 'years' && parts.length >= 4) {
    const month = parseInt(parts[2], 10)
    const day = parseInt(parts[3], 10)
    if (!isNaN(month) && month >= 1 && month <= 12) config.yearMonth = month
    if (!isNaN(day) && day >= 1 && day <= 31) config.yearDay = day
  }
  return config
}

const RRULE_WEEKDAY_MAP: Record<number, string> = {
  0: 'mon', 1: 'tue', 2: 'wed', 3: 'thu', 4: 'fri', 5: 'sat', 6: 'sun'
}

/** Try to parse a natural language recurrence string (e.g. "every Monday") into canonical format via rrule.js NLP. */
function tryNlpRecurrence(input: string): string | null {
  if (input.startsWith('every:') || input.startsWith('every!:')) return input // already canonical
  try {
    const opts = RRule.parseText(input)
    if (!opts || opts.freq === undefined) return null
    const freq = opts.freq
    const interval = opts.interval ?? 1
    if (freq === RRule.DAILY) return `every:${interval}:days`
    if (freq === RRule.WEEKLY) {
      const bywd = opts.byweekday as Array<{ weekday: number }> | undefined
      const days = bywd?.map((d) => RRULE_WEEKDAY_MAP[d.weekday]).filter(Boolean)
      let rule = `every:${interval}:weeks`
      if (days && days.length > 0) rule += ':' + days.join(',')
      return rule
    }
    if (freq === RRule.MONTHLY) return `every:${interval}:months`
    if (freq === RRule.YEARLY) return `every:${interval}:years`
  } catch { /* ignore */ }
  return null
}

function getNextOccurrence(rule: string, fromDate: Date): Date | null {
  const config = parseRecurrence(rule)
  if (!config) return null
  const next = new Date(fromDate)
  switch (config.unit) {
    case 'days':
      next.setDate(next.getDate() + config.interval)
      break
    case 'weeks': {
      if (config.weekDays && config.weekDays.length > 0) {
        const targetDays = config.weekDays
          .map((d) => WEEK_DAYS.indexOf(d as typeof WEEK_DAYS[number]))
          .sort((a, b) => a - b)
        const currentDay = fromDate.getDay()
        const laterThisWeek = targetDays.find((d) => d > currentDay)
        if (laterThisWeek !== undefined && config.interval === 1) {
          next.setDate(next.getDate() + (laterThisWeek - currentDay))
        } else {
          const daysUntilNextWeekStart = 7 - currentDay
          next.setDate(next.getDate() + daysUntilNextWeekStart + (config.interval - 1) * 7 + targetDays[0])
        }
      } else {
        next.setDate(next.getDate() + config.interval * 7)
      }
      break
    }
    case 'months': {
      if (config.monthOrdinal) {
        next.setMonth(next.getMonth() + config.interval)
        const targetDay = WEEK_DAYS.indexOf(config.monthOrdinal.day as typeof WEEK_DAYS[number])
        if (config.monthOrdinal.nth === 'last') {
          const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0)
          const dayDiff = (lastDay.getDay() - targetDay + 7) % 7
          lastDay.setDate(lastDay.getDate() - dayDiff)
          next.setDate(lastDay.getDate())
        } else {
          const nthMap: Record<string, number> = { '1st': 1, '2nd': 2, '3rd': 3, '4th': 4 }
          const nth = nthMap[config.monthOrdinal.nth] ?? 1
          next.setDate(1)
          const firstDayOfWeek = next.getDay()
          let offset = (targetDay - firstDayOfWeek + 7) % 7
          offset += (nth - 1) * 7
          next.setDate(1 + offset)
        }
      } else {
        const targetMonth = next.getMonth() + config.interval
        next.setDate(1)
        next.setMonth(targetMonth)
        if (config.monthDay !== undefined) {
          const lastDayOfMonth = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate()
          next.setDate(Math.min(config.monthDay, lastDayOfMonth))
        }
      }
      break
    }
    case 'years': {
      next.setFullYear(next.getFullYear() + config.interval)
      if (config.yearMonth !== undefined && config.yearDay !== undefined) {
        next.setMonth(config.yearMonth - 1)
        const lastDay = new Date(next.getFullYear(), config.yearMonth, 0).getDate()
        next.setDate(Math.min(config.yearDay, lastDay))
      }
      break
    }
  }
  if (config.untilDate) {
    const until = new Date(config.untilDate + 'T23:59:59')
    if (next > until) return null
  }
  return next
}

// ── Repository Classes ─────────────────────────────────────────────────

class TaskRepo {
  constructor(private client: SupabaseClient, private _userId: string) {}

  async findById(id: string) {
    const { data } = await this.client.from('tasks').select('*').eq('id', id).single()
    return data ?? undefined
  }
  async findByProjectId(projectId: string) {
    const { data } = await this.client.from('tasks').select('*')
      .eq('project_id', projectId).eq('is_archived', 0).eq('is_template', 0)
      .is('parent_id', null).order('order_index')
    return data ?? []
  }
  async findSubtasks(parentId: string) {
    const { data } = await this.client.from('tasks').select('*').eq('parent_id', parentId).order('order_index')
    return data ?? []
  }
  async findMyDay(userId: string) {
    const { data } = await this.client.from('tasks').select('*')
      .eq('owner_id', userId).eq('is_archived', 0).eq('is_template', 0).eq('is_in_my_day', 1)
    return data ?? []
  }
  async findArchived(projectId: string) {
    const { data } = await this.client.from('tasks').select('*')
      .eq('project_id', projectId).eq('is_archived', 1).order('updated_at', { ascending: false })
    return data ?? []
  }
  async findTemplates(projectId: string) {
    const { data } = await this.client.from('tasks').select('*')
      .eq('project_id', projectId).eq('is_template', 1).order('created_at', { ascending: false })
    return data ?? []
  }
  async findAllTemplates(userId: string) {
    const { data } = await this.client.from('tasks').select('*')
      .eq('owner_id', userId).eq('is_template', 1).order('created_at', { ascending: false })
    return data ?? []
  }
  async create(input: Record<string, unknown>) {
    const now = new Date().toISOString()
    const record = {
      id: input.id, project_id: input.project_id, owner_id: input.owner_id,
      title: input.title, status_id: input.status_id,
      assigned_to: input.assigned_to ?? null, description: input.description ?? null,
      priority: input.priority ?? 0, due_date: input.due_date ?? null,
      parent_id: input.parent_id ?? null, order_index: input.order_index ?? 0,
      is_in_my_day: input.is_in_my_day ?? 0, is_template: input.is_template ?? 0,
      is_archived: input.is_archived ?? 0, completed_date: input.completed_date ?? null,
      recurrence_rule: input.recurrence_rule ?? null, reference_url: input.reference_url ?? null,
      created_at: now, updated_at: now
    }
    const { data, error } = await this.client.from('tasks').insert(record).select().single()
    if (error) throw new Error(`Failed to create task: ${error.message}`)
    return data
  }
  async update(id: string, input: Record<string, unknown>) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const col of TASK_UPDATABLE_COLUMNS) {
      if (col in input) updates[col] = input[col]
    }
    const { data, error } = await this.client.from('tasks').update(updates).eq('id', id).select().single()
    if (error) return undefined
    return data
  }
  async delete(id: string) {
    const { error } = await this.client.from('tasks').delete().eq('id', id)
    return !error
  }
  async duplicate(id: string, newId: string) {
    const original = await this.findById(id)
    if (!original) return undefined
    const task = await this.create({
      id: newId, project_id: original.project_id, owner_id: original.owner_id,
      title: `${original.title} (copy)`, status_id: original.status_id,
      description: original.description, priority: original.priority,
      due_date: original.due_date, parent_id: original.parent_id,
      order_index: original.order_index + 1, recurrence_rule: original.recurrence_rule
    })
    const labels = await this.getLabels(id)
    for (const label of labels) await this.addLabel(newId, label.label_id)
    const subtasks = await this.findSubtasks(id)
    for (const sub of subtasks) {
      const subCopyId = crypto.randomUUID()
      await this.create({
        id: subCopyId, project_id: sub.project_id, owner_id: sub.owner_id,
        title: sub.title, status_id: sub.status_id, description: sub.description,
        priority: sub.priority, parent_id: newId, order_index: sub.order_index,
        recurrence_rule: sub.recurrence_rule
      })
      const subLabels = await this.getLabels(sub.id)
      for (const sl of subLabels) await this.addLabel(subCopyId, sl.label_id)
    }
    return task
  }
  async saveAsTemplate(id: string, newId: string) {
    const original = await this.findById(id)
    if (!original) return undefined
    const template = await this.create({
      id: newId, project_id: original.project_id, owner_id: original.owner_id,
      title: original.title, status_id: original.status_id,
      description: original.description, priority: original.priority,
      is_template: 1, order_index: 0, recurrence_rule: original.recurrence_rule
    })
    const labels = await this.getLabels(id)
    for (const label of labels) await this.addLabel(newId, label.label_id)
    const subtasks = await this.findSubtasks(id)
    for (const sub of subtasks) {
      const subTemplateId = crypto.randomUUID()
      await this.create({
        id: subTemplateId, project_id: sub.project_id, owner_id: sub.owner_id,
        title: sub.title, status_id: sub.status_id, description: sub.description,
        priority: sub.priority, parent_id: newId, is_template: 1,
        order_index: sub.order_index, recurrence_rule: sub.recurrence_rule
      })
      const subLabels = await this.getLabels(sub.id)
      for (const sl of subLabels) await this.addLabel(subTemplateId, sl.label_id)
    }
    return template
  }
  async reorder(taskIds: string[]) {
    for (let i = 0; i < taskIds.length; i++) {
      await this.client.from('tasks').update({ order_index: i, updated_at: new Date().toISOString() }).eq('id', taskIds[i])
    }
  }
  async addLabel(taskId: string, labelId: string) {
    await this.client.from('task_labels').upsert({ task_id: taskId, label_id: labelId }, { onConflict: 'task_id,label_id' })
    await this.refreshLabelNames(taskId)
  }
  async removeLabel(taskId: string, labelId: string) {
    const { error } = await this.client.from('task_labels').delete().eq('task_id', taskId).eq('label_id', labelId)
    if (error) return false
    await this.refreshLabelNames(taskId)
    return true
  }
  async getLabels(taskId: string) {
    const { data } = await this.client.from('task_labels').select('task_id, label_id').eq('task_id', taskId)
    return data ?? []
  }
  async search(filters: Record<string, unknown>) {
    let query = this.client.from('tasks').select('*').eq('is_template', 0)
    if (filters.is_archived !== undefined) query = query.eq('is_archived', filters.is_archived as number)
    else query = query.eq('is_archived', 0)
    if (filters.project_id) query = query.eq('project_id', filters.project_id as string)
    if (filters.status_id) query = query.eq('status_id', filters.status_id as string)
    if (filters.priority !== undefined) query = query.eq('priority', filters.priority as number)
    if (filters.due_before) query = query.lte('due_date', filters.due_before as string)
    if (filters.due_after) query = query.gte('due_date', filters.due_after as string)
    if (filters.owner_id) query = query.eq('owner_id', filters.owner_id as string)
    if (filters.keyword) query = query.or(`title.ilike.%${filters.keyword}%,description.ilike.%${filters.keyword}%`)
    const excludeStatusIds = filters.exclude_status_ids as string[] | undefined
    if (excludeStatusIds?.length) for (const sid of excludeStatusIds) query = query.neq('status_id', sid)
    const excludePriorities = filters.exclude_priorities as number[] | undefined
    if (excludePriorities?.length) for (const p of excludePriorities) query = query.neq('priority', p)
    const { data } = await query.order('order_index')
    let results = data ?? []
    const labelId = filters.label_id as string | undefined
    const labelIds = labelId ? [labelId] : undefined
    if (labelIds?.length) {
      const { data: tlData } = await this.client.from('task_labels').select('task_id').in('label_id', labelIds)
      const matchingIds = new Set((tlData ?? []).map((tl: { task_id: string }) => tl.task_id))
      results = results.filter((t: { id: string }) => matchingIds.has(t.id))
    }
    const excludeLabelIds = filters.exclude_label_ids as string[] | undefined
    if (excludeLabelIds?.length) {
      const { data: tlData } = await this.client.from('task_labels').select('task_id').in('label_id', excludeLabelIds)
      const excludeIds = new Set((tlData ?? []).map((tl: { task_id: string }) => tl.task_id))
      results = results.filter((t: { id: string }) => !excludeIds.has(t.id))
    }
    return results
  }
  async getSubtaskCount(parentId: string) {
    const subtasks = await this.findSubtasks(parentId)
    if (subtasks.length === 0) return { total: 0, done: 0 }
    const statusIds = [...new Set(subtasks.map((s: { status_id: string }) => s.status_id))]
    const { data: statuses } = await this.client.from('statuses').select('id, is_done').in('id', statusIds)
    const doneStatusIds = new Set((statuses ?? []).filter((s: { is_done: number }) => s.is_done === 1).map((s: { id: string }) => s.id))
    const done = subtasks.filter((s: { status_id: string }) => doneStatusIds.has(s.status_id)).length
    return { total: subtasks.length, done }
  }
  async completeRecurringTask(taskId: string) {
    const task = await this.findById(taskId)
    if (!task || !task.recurrence_rule || !task.due_date) return null
    const baseDate = new Date(task.due_date)
    const nextDateObj = getNextOccurrence(task.recurrence_rule, baseDate)
    if (!nextDateObj) return null
    const nextDate = nextDateObj.toISOString().slice(0, 10)
    const nextId = crypto.randomUUID()
    await this.create({
      id: nextId, project_id: task.project_id, owner_id: task.owner_id,
      title: task.title, status_id: task.status_id, description: task.description,
      priority: task.priority, due_date: nextDate, parent_id: task.parent_id,
      order_index: task.order_index, recurrence_rule: task.recurrence_rule,
      is_in_my_day: task.is_in_my_day
    })
    const labels = await this.getLabels(taskId)
    for (const label of labels) await this.addLabel(nextId, label.label_id)
    return { id: nextId, dueDate: nextDate }
  }
  private async refreshLabelNames(taskId: string) {
    const { data: taskLabels } = await this.client.from('task_labels').select('label_id').eq('task_id', taskId)
    if (!taskLabels || taskLabels.length === 0) {
      await this.client.from('tasks').update({ label_names: null }).eq('id', taskId)
      return
    }
    const labelIds = taskLabels.map((tl: { label_id: string }) => tl.label_id)
    const { data: labels } = await this.client.from('user_labels').select('name, color').in('id', labelIds)
    const labelNames = (labels ?? []).map((l: { name: string; color: string }) => ({ name: l.name, color: l.color }))
    await this.client.from('tasks').update({ label_names: JSON.stringify(labelNames) }).eq('id', taskId)
  }
}

class ProjectRepo {
  constructor(private client: SupabaseClient, private userId: string) {}
  async list() {
    const { data: memberships } = await this.client.from('project_members').select('project_id').eq('user_id', this.userId)
    if (!memberships || memberships.length === 0) return []
    const ids = memberships.map(m => m.project_id)
    const { data } = await this.client.from('projects').select('*').in('id', ids).order('created_at')
    return data ?? []
  }
  async findById(id: string) {
    const { data } = await this.client.from('projects').select('*').eq('id', id).single()
    return data ?? undefined
  }
  async create(input: Record<string, unknown>) {
    const { error } = await this.client.rpc('share_project', {
      p_id: input.id, p_name: input.name,
      p_description: input.description ?? null,
      p_color: input.color ?? '#888888', p_icon: input.icon ?? 'folder',
      p_owner_id: input.owner_id ?? this.userId
    })
    if (error) throw new Error(`Failed to create project: ${error.message}`)
    const updates: Record<string, unknown> = {}
    if (input.is_default !== undefined) updates.is_default = input.is_default
    if (input.sidebar_order !== undefined) updates.sidebar_order = input.sidebar_order
    if (Object.keys(updates).length > 0) await this.client.from('projects').update(updates).eq('id', input.id)
    const project = await this.findById(input.id as string)
    if (!project) throw new Error('Project created but not found')
    return project
  }
  async update(id: string, input: Record<string, unknown>) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const k of ['name', 'description', 'color', 'icon', 'sidebar_order', 'is_default', 'is_shared']) {
      if (input[k] !== undefined) updates[k] = input[k]
    }
    const { data, error } = await this.client.from('projects').update(updates).eq('id', id).select().single()
    if (error) return undefined
    return data
  }
  async delete(id: string) {
    await this.client.from('tasks').delete().eq('project_id', id)
    await this.client.from('statuses').delete().eq('project_id', id)
    await this.client.from('project_members').delete().eq('project_id', id)
    const { error } = await this.client.from('projects').delete().eq('id', id)
    return !error
  }
}

class StatusRepo {
  constructor(private client: SupabaseClient) {}
  async findByProjectId(projectId: string) {
    const { data } = await this.client.from('statuses').select('*').eq('project_id', projectId).order('order_index')
    return data ?? []
  }
  async findById(id: string) {
    const { data } = await this.client.from('statuses').select('*').eq('id', id).single()
    return data ?? undefined
  }
  async findDefault(projectId: string) {
    const { data } = await this.client.from('statuses').select('*').eq('project_id', projectId).eq('is_default', 1).single()
    return data ?? undefined
  }
  async findDone(projectId: string) {
    const { data } = await this.client.from('statuses').select('*').eq('project_id', projectId).eq('is_done', 1).single()
    return data ?? undefined
  }
  async create(input: Record<string, unknown>) {
    const now = new Date().toISOString()
    const record = {
      id: input.id, project_id: input.project_id, name: input.name,
      color: input.color ?? '#888888', icon: input.icon ?? 'circle',
      order_index: input.order_index ?? 0, is_done: input.is_done ?? 0,
      is_default: input.is_default ?? 0, created_at: now, updated_at: now
    }
    const { data, error } = await this.client.from('statuses').insert(record).select().single()
    if (error) throw new Error(`Failed to create status: ${error.message}`)
    return data
  }
}

class LabelRepo {
  constructor(private client: SupabaseClient, private userId: string) {}
  async findById(id: string) {
    const { data } = await this.client.from('user_labels').select('*').eq('id', id).single()
    return data ?? undefined
  }
  async findByProjectId(projectId: string) {
    const { data: project } = await this.client.from('projects').select('label_data').eq('id', projectId).single()
    if (!project?.label_data) return []
    let labelData: Array<{ name: string; color: string }>
    try {
      labelData = typeof project.label_data === 'string' ? JSON.parse(project.label_data) : project.label_data
    } catch { return [] }
    if (!Array.isArray(labelData) || labelData.length === 0) return []
    const names = labelData.map((l: { name: string }) => l.name)
    const { data: labels } = await this.client.from('user_labels').select('*').eq('user_id', this.userId).in('name', names)
    return labels ?? []
  }
  async findByTaskId(taskId: string) {
    const { data: taskLabels } = await this.client.from('task_labels').select('label_id').eq('task_id', taskId)
    if (!taskLabels || taskLabels.length === 0) return []
    const labelIds = taskLabels.map((tl: { label_id: string }) => tl.label_id)
    const { data } = await this.client.from('user_labels').select('*').in('id', labelIds)
    return data ?? []
  }
  async findByName(userId: string, name: string) {
    const { data } = await this.client.from('user_labels').select('*').eq('user_id', userId).ilike('name', name).limit(1).single()
    return data ?? undefined
  }
  async create(input: Record<string, unknown>) {
    const now = new Date().toISOString()
    const record = {
      id: input.id, user_id: this.userId, name: input.name,
      color: input.color ?? '#888888', order_index: 0, created_at: now, updated_at: now
    }
    const { data, error } = await this.client.from('user_labels').insert(record).select().single()
    if (error) throw new Error(`Failed to create label: ${error.message}`)
    if (input.project_id) await this.addToProject(input.project_id as string, input.id as string)
    return data
  }
  async addToProject(projectId: string, labelId: string) {
    const label = await this.findById(labelId)
    if (!label) return
    const { data: project } = await this.client.from('projects').select('label_data').eq('id', projectId).single()
    let labelData: Array<{ name: string; color: string }> = []
    if (project?.label_data) {
      try { labelData = typeof project.label_data === 'string' ? JSON.parse(project.label_data) : project.label_data } catch { labelData = [] }
    }
    if (!labelData.some((l: { name: string }) => l.name === label.name)) {
      labelData.push({ name: label.name, color: label.color })
      await this.client.from('projects').update({ label_data: JSON.stringify(labelData) }).eq('id', projectId)
    }
  }
}

class ActivityLogRepo {
  constructor(private client: SupabaseClient) {}
  async create(input: Record<string, unknown>) {
    const now = new Date().toISOString()
    const record = {
      id: input.id, task_id: input.task_id, user_id: input.user_id,
      action: input.action, old_value: input.old_value ?? null,
      new_value: input.new_value ?? null, project_id: input.project_id ?? null,
      created_at: now
    }
    const { data, error } = await this.client.from('activity_log').insert(record).select().single()
    if (error) throw new Error(`Failed to create activity log: ${error.message}`)
    return data
  }
}

class SettingsRepo {
  constructor(private client: SupabaseClient) {}
  async get(userId: string, key: string) {
    const { data } = await this.client.from('user_settings').select('value').eq('user_id', userId).eq('key', key).single()
    return data?.value ?? null
  }
  async set(userId: string, key: string, value: string | null) {
    const id = `${userId}:${key}`
    const { error } = await this.client.from('user_settings').upsert(
      { id, user_id: userId, key, value, updated_at: new Date().toISOString() },
      { onConflict: 'id' }
    )
    if (error) throw new Error(`Failed to set setting: ${error.message}`)
  }
}

class SavedViewRepo {
  constructor(private client: SupabaseClient) {}
  async findByUserId(userId: string) {
    const { data } = await this.client.from('user_saved_views').select('*').eq('user_id', userId).order('sidebar_order')
    return data ?? []
  }
  async findById(id: string) {
    const { data } = await this.client.from('user_saved_views').select('*').eq('id', id).single()
    return data ?? undefined
  }
  async create(input: Record<string, unknown>) {
    const now = new Date().toISOString()
    const record = {
      id: input.id, user_id: input.user_id, project_id: input.project_id ?? null,
      name: input.name, color: input.color ?? '#888888', icon: input.icon ?? 'filter',
      sidebar_order: input.sidebar_order ?? 0, filter_config: input.filter_config,
      created_at: now, updated_at: now
    }
    const { data, error } = await this.client.from('user_saved_views').insert(record).select().single()
    if (error) throw new Error(`Failed to create saved view: ${error.message}`)
    return data
  }
  async delete(id: string) {
    const { error } = await this.client.from('user_saved_views').delete().eq('id', id)
    return !error
  }
}

class ProjectAreaRepo {
  constructor(private client: SupabaseClient) {}
  async findByUserId(userId: string) {
    const { data } = await this.client.from('user_project_areas').select('*').eq('user_id', userId).order('sidebar_order')
    return data ?? []
  }
  async findById(id: string) {
    const { data } = await this.client.from('user_project_areas').select('*').eq('id', id).single()
    return data ?? undefined
  }
  async create(input: Record<string, unknown>) {
    const now = new Date().toISOString()
    const record = {
      id: input.id, user_id: input.user_id, name: input.name,
      color: input.color ?? '#888888', icon: input.icon ?? 'folder',
      sidebar_order: input.sidebar_order ?? 0, is_collapsed: 0,
      created_at: now, updated_at: now
    }
    const { data, error } = await this.client.from('user_project_areas').insert(record).select().single()
    if (error) throw new Error(`Failed to create project area: ${error.message}`)
    return data
  }
  async update(id: string, input: Record<string, unknown>) {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const k of ['name', 'color', 'icon', 'sidebar_order', 'is_collapsed']) {
      if (input[k] !== undefined) updates[k] = input[k]
    }
    const { data, error } = await this.client.from('user_project_areas').update(updates).eq('id', id).select().single()
    if (error) return null
    return data
  }
  async delete(id: string) {
    await this.client.from('projects').update({ area_id: null }).eq('area_id', id)
    const { error } = await this.client.from('user_project_areas').delete().eq('id', id)
    return !error
  }
  async assignProject(projectId: string, areaId: string | null) {
    await this.client.from('projects').update({ area_id: areaId }).eq('id', projectId)
  }
}

// ── Repos Factory ──────────────────────────────────────────────────────

interface Repos {
  tasks: TaskRepo
  projects: ProjectRepo
  statuses: StatusRepo
  labels: LabelRepo
  activityLog: ActivityLogRepo
  settings: SettingsRepo
  savedViews: SavedViewRepo
  projectAreas: ProjectAreaRepo
}

function createRepos(client: SupabaseClient, userId: string): Repos {
  return {
    tasks: new TaskRepo(client, userId),
    projects: new ProjectRepo(client, userId),
    statuses: new StatusRepo(client),
    labels: new LabelRepo(client, userId),
    activityLog: new ActivityLogRepo(client),
    settings: new SettingsRepo(client),
    savedViews: new SavedViewRepo(client),
    projectAreas: new ProjectAreaRepo(client),
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
  [key: string]: unknown
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function fail(msg: string): ToolResult {
  return { content: [{ type: 'text' as const, text: msg }], isError: true }
}

function requireStr(args: Record<string, unknown>, key: string): string {
  const val = args[key]
  if (val === undefined || val === null || val === '') throw new Error(`Missing required argument: ${key}`)
  return String(val)
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const val = args[key]
  return val !== undefined && val !== null ? String(val) : undefined
}

function optNum(args: Record<string, unknown>, key: string): number | undefined {
  const val = args[key]
  return val !== undefined && val !== null ? Number(val) : undefined
}

// ── Schema Helpers ─────────────────────────────────────────────────────

interface SchemaProp { type: string; description: string; enum?: (string | number)[]; items?: { type: string } }
function str(description: string): SchemaProp { return { type: 'string', description } }
function num(description: string): SchemaProp { return { type: 'number', description } }
interface InputSchema { type: 'object'; properties: Record<string, SchemaProp>; required?: string[] }
interface ToolDef { name: string; description: string; inputSchema: InputSchema }

const PRIORITY_NAMES: Record<number, string> = { 0: 'none', 1: 'low', 2: 'normal', 3: 'high', 4: 'urgent' }

// ── Tool Definitions ───────────────────────────────────────────────────

const tools: ToolDef[] = [
  { name: 'create_task', description: 'Create a new task in a project', inputSchema: { type: 'object', properties: { title: str('Task title'), project_id: str('Project ID'), description: str('Task description (markdown)'), priority: num('Priority: 0=none, 1=low, 2=normal, 3=high, 4=urgent'), due_date: str('Due date in ISO 8601 format'), parent_id: str('Parent task ID (creates a subtask)') }, required: ['title', 'project_id'] } },
  { name: 'list_tasks', description: 'List all active tasks in a project (excludes archived and template tasks)', inputSchema: { type: 'object', properties: { project_id: str('Project ID') }, required: ['project_id'] } },
  { name: 'get_task', description: 'Get a task by ID, including its labels', inputSchema: { type: 'object', properties: { task_id: str('Task ID') }, required: ['task_id'] } },
  { name: 'update_task', description: 'Update task fields (title, description, priority, due_date, status_id)', inputSchema: { type: 'object', properties: { task_id: str('Task ID'), title: str('New title'), description: str('New description (markdown)'), priority: num('Priority: 0=none, 1=low, 2=normal, 3=high, 4=urgent'), due_date: str('Due date in ISO 8601 format, or empty string to clear'), status_id: str('New status ID') }, required: ['task_id'] } },
  { name: 'delete_task', description: 'Permanently delete a task and its subtasks', inputSchema: { type: 'object', properties: { task_id: str('Task ID') }, required: ['task_id'] } },
  { name: 'complete_task', description: 'Mark a task as done (sets status to the done status of its project)', inputSchema: { type: 'object', properties: { task_id: str('Task ID') }, required: ['task_id'] } },
  { name: 'reopen_task', description: 'Reopen a completed task (sets status back to the default status)', inputSchema: { type: 'object', properties: { task_id: str('Task ID') }, required: ['task_id'] } },
  { name: 'set_task_priority', description: 'Set the priority of a task', inputSchema: { type: 'object', properties: { task_id: str('Task ID'), priority: num('Priority: 0=none, 1=low, 2=normal, 3=high, 4=urgent') }, required: ['task_id', 'priority'] } },
  { name: 'set_task_due_date', description: 'Set or clear the due date of a task', inputSchema: { type: 'object', properties: { task_id: str('Task ID'), due_date: str('Due date in ISO 8601 format, or empty string to clear') }, required: ['task_id', 'due_date'] } },
  { name: 'set_task_description', description: 'Set the description of a task', inputSchema: { type: 'object', properties: { task_id: str('Task ID'), description: str('Description text (markdown)') }, required: ['task_id', 'description'] } },
  { name: 'set_task_recurrence', description: 'Set or clear the recurrence rule of a task. Accepts canonical format ("every:N:unit[:details][|until:YYYY-MM-DD]") or natural language ("every Monday", "every 2 weeks"). Examples: "every:1:days", "every Monday", "every 2 weeks", "every weekday". Empty string to clear.', inputSchema: { type: 'object', properties: { task_id: str('Task ID'), recurrence_rule: str('Canonical recurrence rule, natural language (e.g. "every Monday"), or empty string to clear') }, required: ['task_id', 'recurrence_rule'] } },
  { name: 'add_task_to_my_day', description: 'Add a task to the My Day view', inputSchema: { type: 'object', properties: { task_id: str('Task ID') }, required: ['task_id'] } },
  { name: 'remove_task_from_my_day', description: 'Remove a task from the My Day view', inputSchema: { type: 'object', properties: { task_id: str('Task ID') }, required: ['task_id'] } },
  { name: 'snooze_task', description: 'Snooze a task until a given date (sets due date, removes from My Day)', inputSchema: { type: 'object', properties: { task_id: str('Task ID'), snooze_until: str('Date to snooze until in ISO 8601 format') }, required: ['task_id', 'snooze_until'] } },
  { name: 'archive_task', description: 'Archive a task (hides from active views)', inputSchema: { type: 'object', properties: { task_id: str('Task ID') }, required: ['task_id'] } },
  { name: 'unarchive_task', description: 'Unarchive a task (restores to active views)', inputSchema: { type: 'object', properties: { task_id: str('Task ID') }, required: ['task_id'] } },
  { name: 'duplicate_task', description: 'Duplicate a task including its labels and subtasks', inputSchema: { type: 'object', properties: { task_id: str('Task ID') }, required: ['task_id'] } },
  { name: 'save_task_as_template', description: 'Save a task as a reusable template (strips dates, resets statuses)', inputSchema: { type: 'object', properties: { task_id: str('Task ID') }, required: ['task_id'] } },
  { name: 'create_subtask', description: 'Create a subtask under a parent task', inputSchema: { type: 'object', properties: { parent_id: str('Parent task ID'), title: str('Subtask title') }, required: ['parent_id', 'title'] } },
  { name: 'list_subtasks', description: 'List subtasks of a task', inputSchema: { type: 'object', properties: { parent_id: str('Parent task ID') }, required: ['parent_id'] } },
  { name: 'list_projects', description: 'List all projects', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_project', description: 'Get a project by ID, including its statuses and labels', inputSchema: { type: 'object', properties: { project_id: str('Project ID') }, required: ['project_id'] } },
  { name: 'create_project', description: 'Create a new project', inputSchema: { type: 'object', properties: { name: str('Project name'), color: str('Project color (hex, e.g. "#6366f1")'), description: str('Project description') }, required: ['name'] } },
  { name: 'update_project', description: 'Update a project', inputSchema: { type: 'object', properties: { project_id: str('Project ID'), name: str('New name'), color: str('New color (hex)'), description: str('New description') }, required: ['project_id'] } },
  { name: 'delete_project', description: 'Delete a project and all its tasks', inputSchema: { type: 'object', properties: { project_id: str('Project ID') }, required: ['project_id'] } },
  { name: 'list_labels', description: 'List all labels for a project', inputSchema: { type: 'object', properties: { project_id: str('Project ID') }, required: ['project_id'] } },
  { name: 'create_label', description: 'Create a new label in a project', inputSchema: { type: 'object', properties: { project_id: str('Project ID'), name: str('Label name'), color: str('Label color (hex, e.g. "#22c55e")') }, required: ['project_id', 'name'] } },
  { name: 'assign_label_to_task', description: 'Assign a label to a task', inputSchema: { type: 'object', properties: { task_id: str('Task ID'), label_id: str('Label ID') }, required: ['task_id', 'label_id'] } },
  { name: 'remove_label_from_task', description: 'Remove a label from a task', inputSchema: { type: 'object', properties: { task_id: str('Task ID'), label_id: str('Label ID') }, required: ['task_id', 'label_id'] } },
  { name: 'list_statuses', description: 'List all statuses for a project', inputSchema: { type: 'object', properties: { project_id: str('Project ID') }, required: ['project_id'] } },
  { name: 'search_tasks', description: 'Search tasks with filters. All filters are optional and combined with AND.', inputSchema: { type: 'object', properties: { project_id: str('Filter by project ID'), status_id: str('Filter by status ID'), priority: num('Filter by exact priority (0-4)'), label_id: str('Filter by label ID'), due_before: str('Tasks due before this date (ISO 8601)'), due_after: str('Tasks due after this date (ISO 8601)'), keyword: str('Search keyword (matches title and description)'), label_logic: str('Label filter logic: "any" (OR, default) or "all" (AND)'), exclude_label_id: str('Exclude tasks with this label'), exclude_status_id: str('Exclude tasks with this status'), exclude_priority: num('Exclude tasks with this priority (0-4)') } } },
  { name: 'list_my_day', description: 'List tasks in the My Day view (tasks marked for today or due today)', inputSchema: { type: 'object', properties: {} } },
  { name: 'list_templates', description: 'List all task templates and project templates', inputSchema: { type: 'object', properties: {} } },
  { name: 'use_task_template', description: 'Create a new task from a task template in a target project. Labels are auto-created if missing.', inputSchema: { type: 'object', properties: { template_id: str('Task template ID'), project_id: str('Target project ID to create the task in') }, required: ['template_id', 'project_id'] } },
  { name: 'deploy_project_template', description: 'Create a new project from a project template, including all statuses, labels, and tasks', inputSchema: { type: 'object', properties: { template_id: str('Project template ID'), name: str('Override project name'), color: str('Override project color') }, required: ['template_id'] } },
  { name: 'set_whats_new', description: 'Update the in-app "What\'s New" release notes for a specific version.', inputSchema: { type: 'object', properties: { version: str('Version string (e.g., "v1.0.0")'), content: str('Release notes content (- **Title** — Description bullets)') }, required: ['content'] } },
  { name: 'create_area', description: 'Create a project area (folder) to group projects in the sidebar', inputSchema: { type: 'object', properties: { name: str('Area name'), color: str('Area color hex (default: #888888)') }, required: ['name'] } },
  { name: 'list_areas', description: 'List all project areas for the current user', inputSchema: { type: 'object', properties: {} } },
  { name: 'update_area', description: 'Update a project area (rename, recolor, reorder)', inputSchema: { type: 'object', properties: { area_id: str('Area ID'), name: str('New name'), color: str('New color hex') }, required: ['area_id'] } },
  { name: 'delete_area', description: 'Delete a project area (ungroups its projects, does not delete them)', inputSchema: { type: 'object', properties: { area_id: str('Area ID') }, required: ['area_id'] } },
  { name: 'assign_project_to_area', description: 'Assign a project to an area, or pass null area_id to ungroup', inputSchema: { type: 'object', properties: { project_id: str('Project ID'), area_id: str('Area ID (or empty string to ungroup)') }, required: ['project_id'] } },
  { name: 'create_saved_view', description: 'Create a saved view with a name and filter configuration JSON', inputSchema: { type: 'object', properties: { name: str('View name'), filter_config: str('JSON string of filter configuration') }, required: ['name', 'filter_config'] } },
  { name: 'list_saved_views', description: 'List all saved views for the current user', inputSchema: { type: 'object', properties: {} } },
  { name: 'delete_saved_view', description: 'Delete a saved view by ID', inputSchema: { type: 'object', properties: { view_id: str('Saved view ID') }, required: ['view_id'] } },
  { name: 'reorder_tasks', description: 'Reorder tasks by providing an ordered array of task IDs.', inputSchema: { type: 'object', properties: { task_ids: { type: 'array', description: 'Ordered array of task IDs', items: { type: 'string' } } }, required: ['task_ids'] } },
]

// ── Handler Factory ────────────────────────────────────────────────────

function createHandlers(repos: Repos, userId: string) {
  async function logActivity(
    taskId: string, uId: string, action: string,
    oldValue?: string | null, newValue?: string | null, projectId?: string
  ) {
    await repos.activityLog.create({
      id: crypto.randomUUID(), task_id: taskId, user_id: uId,
      action, old_value: oldValue ?? null, new_value: newValue ?? null,
      project_id: projectId ?? null
    })
  }

  async function copyTemplateSubtasks(
    templateParentId: string, newParentId: string, projectId: string,
    ownerId: string, defaultStatusId: string,
    targetLabels: Array<{ id: string; name: string; color: string }>
  ) {
    const subtasks = await repos.tasks.findSubtasks(templateParentId)
    for (const subtask of subtasks) {
      const subtaskId = crypto.randomUUID()
      await repos.tasks.create({
        id: subtaskId, project_id: projectId, owner_id: ownerId,
        title: subtask.title, status_id: defaultStatusId,
        description: subtask.description, priority: subtask.priority,
        parent_id: newParentId, order_index: subtask.order_index,
        recurrence_rule: subtask.recurrence_rule
      })
      const subtaskLabels = await repos.labels.findByTaskId(subtask.id)
      for (const sl of subtaskLabels) {
        let target = targetLabels.find((l) => l.name === sl.name)
        if (!target) {
          const existing = await repos.labels.findByName(userId, sl.name)
          if (existing) {
            await repos.labels.addToProject(projectId, existing.id)
            targetLabels.push(existing)
            target = existing
          } else {
            const newLabel = await repos.labels.create({ id: crypto.randomUUID(), project_id: projectId, name: sl.name, color: sl.color })
            targetLabels.push(newLabel)
            target = newLabel
          }
        }
        await repos.tasks.addLabel(subtaskId, target.id)
      }
      await copyTemplateSubtasks(subtask.id, subtaskId, projectId, ownerId, defaultStatusId, targetLabels)
    }
  }

  type Handler = (args: Record<string, unknown>) => Promise<unknown>
  const handlers: Record<string, Handler> = {
    async create_task(args) {
      const projectId = requireStr(args, 'project_id')
      const defaultStatus = await repos.statuses.findDefault(projectId)
      if (!defaultStatus) throw new Error('No default status found for project')
      const task = await repos.tasks.create({
        id: crypto.randomUUID(), project_id: projectId, owner_id: userId,
        title: requireStr(args, 'title'), status_id: defaultStatus.id,
        description: optStr(args, 'description') ?? null, priority: optNum(args, 'priority') ?? 0,
        due_date: optStr(args, 'due_date') ?? null, parent_id: optStr(args, 'parent_id') ?? null
      })
      await logActivity(task.id, userId, 'created', null, null, projectId)
      return task
    },
    async list_tasks(args) { return await repos.tasks.findByProjectId(requireStr(args, 'project_id')) },
    async get_task(args) {
      const taskId = requireStr(args, 'task_id')
      const task = await repos.tasks.findById(taskId)
      if (!task) throw new Error(`Task not found: ${taskId}`)
      const labels = await repos.labels.findByTaskId(taskId)
      const subtaskCount = await repos.tasks.getSubtaskCount(taskId)
      return { ...task, labels, subtask_count: subtaskCount }
    },
    async update_task(args) {
      const taskId = requireStr(args, 'task_id')
      const oldTask = await repos.tasks.findById(taskId)
      if (!oldTask) throw new Error(`Task not found: ${taskId}`)
      const input: Record<string, string | number | null> = {}
      const title = optStr(args, 'title'); if (title !== undefined) input.title = title
      const description = optStr(args, 'description'); if (description !== undefined) input.description = description
      const priority = optNum(args, 'priority'); if (priority !== undefined) input.priority = priority
      const dueDate = optStr(args, 'due_date'); if (dueDate !== undefined) input.due_date = dueDate === '' ? null : dueDate
      const statusId = optStr(args, 'status_id'); if (statusId !== undefined) input.status_id = statusId
      const result = await repos.tasks.update(taskId, input)
      if (!result) throw new Error(`Task not found: ${taskId}`)
      if (title !== undefined && title !== oldTask.title) await logActivity(taskId, userId, 'title_changed', oldTask.title, title, oldTask.project_id)
      if (description !== undefined && description !== oldTask.description) await logActivity(taskId, userId, 'description_changed', oldTask.description ?? '', description, oldTask.project_id)
      if (priority !== undefined && priority !== oldTask.priority) await logActivity(taskId, userId, 'priority_changed', PRIORITY_NAMES[oldTask.priority] ?? '', PRIORITY_NAMES[priority] ?? '', oldTask.project_id)
      if (dueDate !== undefined) { const newDue = dueDate === '' ? null : dueDate; if (newDue !== oldTask.due_date) await logActivity(taskId, userId, 'due_date_changed', oldTask.due_date ?? '', newDue ?? '', oldTask.project_id) }
      if (statusId !== undefined && statusId !== oldTask.status_id) { const oldStatus = await repos.statuses.findById(oldTask.status_id); const newStatus = await repos.statuses.findById(statusId); await logActivity(taskId, userId, 'status_changed', oldStatus?.name ?? '', newStatus?.name ?? '', oldTask.project_id) }
      return result
    },
    async delete_task(args) {
      const taskId = requireStr(args, 'task_id')
      const task = await repos.tasks.findById(taskId)
      if (!task) throw new Error(`Task not found: ${taskId}`)
      await logActivity(taskId, userId, 'deleted', task.title, null, task.project_id)
      const subtasks = await repos.tasks.findSubtasks(taskId)
      for (const sub of subtasks) await repos.tasks.delete(sub.id)
      await repos.tasks.delete(taskId)
      return { deleted: true, task_id: taskId }
    },
    async complete_task(args) {
      const taskId = requireStr(args, 'task_id')
      const task = await repos.tasks.findById(taskId)
      if (!task) throw new Error(`Task not found: ${taskId}`)
      const oldStatus = await repos.statuses.findById(task.status_id)
      const doneStatus = await repos.statuses.findDone(task.project_id)
      if (!doneStatus) throw new Error('No done status found for project')
      const result = await repos.tasks.update(taskId, { status_id: doneStatus.id, completed_date: new Date().toISOString() })
      await logActivity(taskId, userId, 'status_changed', oldStatus?.name ?? '', doneStatus.name, task.project_id)
      return result
    },
    async reopen_task(args) {
      const taskId = requireStr(args, 'task_id')
      const task = await repos.tasks.findById(taskId)
      if (!task) throw new Error(`Task not found: ${taskId}`)
      const oldStatus = await repos.statuses.findById(task.status_id)
      const defaultStatus = await repos.statuses.findDefault(task.project_id)
      if (!defaultStatus) throw new Error('No default status found for project')
      const result = await repos.tasks.update(taskId, { status_id: defaultStatus.id, completed_date: null })
      await logActivity(taskId, userId, 'status_changed', oldStatus?.name ?? '', defaultStatus.name, task.project_id)
      return result
    },
    async set_task_priority(args) {
      const taskId = requireStr(args, 'task_id')
      const task = await repos.tasks.findById(taskId); if (!task) throw new Error(`Task not found: ${taskId}`)
      const priority = optNum(args, 'priority') ?? 0
      const result = await repos.tasks.update(taskId, { priority }); if (!result) throw new Error(`Task not found: ${taskId}`)
      await logActivity(taskId, userId, 'priority_changed', PRIORITY_NAMES[task.priority] ?? '', PRIORITY_NAMES[priority] ?? '', task.project_id)
      return result
    },
    async set_task_due_date(args) {
      const taskId = requireStr(args, 'task_id')
      const task = await repos.tasks.findById(taskId); if (!task) throw new Error(`Task not found: ${taskId}`)
      const dueDate = optStr(args, 'due_date') ?? ''; const newDue = dueDate === '' ? null : dueDate
      const result = await repos.tasks.update(taskId, { due_date: newDue }); if (!result) throw new Error(`Task not found: ${taskId}`)
      await logActivity(taskId, userId, 'due_date_changed', task.due_date ?? '', newDue ?? '', task.project_id)
      return result
    },
    async set_task_description(args) {
      const taskId = requireStr(args, 'task_id')
      const task = await repos.tasks.findById(taskId); if (!task) throw new Error(`Task not found: ${taskId}`)
      const description = optStr(args, 'description') ?? ''
      const result = await repos.tasks.update(taskId, { description }); if (!result) throw new Error(`Task not found: ${taskId}`)
      await logActivity(taskId, userId, 'description_changed', task.description ?? '', description, task.project_id)
      return result
    },
    async set_task_recurrence(args) {
      const taskId = requireStr(args, 'task_id')
      const task = await repos.tasks.findById(taskId); if (!task) throw new Error(`Task not found: ${taskId}`)
      let rule = optStr(args, 'recurrence_rule') ?? ''
      // Try NLP fallback if not already in canonical format
      if (rule && !rule.startsWith('every:') && !rule.startsWith('every!:')) {
        const canonical = tryNlpRecurrence(rule)
        if (canonical) rule = canonical
      }
      const newRule = rule === '' ? null : rule
      const result = await repos.tasks.update(taskId, { recurrence_rule: newRule }); if (!result) throw new Error(`Task not found: ${taskId}`)
      await logActivity(taskId, userId, 'recurrence_changed', task.recurrence_rule ?? '', newRule ?? '', task.project_id)
      return result
    },
    async add_task_to_my_day(args) {
      const taskId = requireStr(args, 'task_id')
      const result = await repos.tasks.update(taskId, { is_in_my_day: 1 }); if (!result) throw new Error(`Task not found: ${taskId}`)
      await logActivity(taskId, userId, 'pinned_to_my_day', null, null, result.project_id)
      return result
    },
    async remove_task_from_my_day(args) {
      const taskId = requireStr(args, 'task_id')
      const result = await repos.tasks.update(taskId, { is_in_my_day: 0 }); if (!result) throw new Error(`Task not found: ${taskId}`)
      await logActivity(taskId, userId, 'unpinned_from_my_day', null, null, result.project_id)
      return result
    },
    async snooze_task(args) {
      const taskId = requireStr(args, 'task_id')
      const task = await repos.tasks.findById(taskId); if (!task) throw new Error(`Task not found: ${taskId}`)
      const snoozeUntil = requireStr(args, 'snooze_until')
      const result = await repos.tasks.update(taskId, { due_date: snoozeUntil, is_in_my_day: 0 }); if (!result) throw new Error(`Task not found: ${taskId}`)
      await logActivity(taskId, userId, 'due_date_changed', task.due_date ?? '', snoozeUntil, task.project_id)
      return result
    },
    async archive_task(args) {
      const taskId = requireStr(args, 'task_id')
      const result = await repos.tasks.update(taskId, { is_archived: 1 }); if (!result) throw new Error(`Task not found: ${taskId}`)
      await logActivity(taskId, userId, 'archived', null, null, result.project_id)
      return result
    },
    async unarchive_task(args) {
      const taskId = requireStr(args, 'task_id')
      const result = await repos.tasks.update(taskId, { is_archived: 0 }); if (!result) throw new Error(`Task not found: ${taskId}`)
      await logActivity(taskId, userId, 'unarchived', null, null, result.project_id)
      return result
    },
    async duplicate_task(args) {
      const taskId = requireStr(args, 'task_id')
      const result = await repos.tasks.duplicate(taskId, crypto.randomUUID()); if (!result) throw new Error(`Task not found: ${taskId}`)
      await logActivity(result.id, userId, 'created', null, null, result.project_id)
      return result
    },
    async save_task_as_template(args) {
      const taskId = requireStr(args, 'task_id')
      const result = await repos.tasks.saveAsTemplate(taskId, crypto.randomUUID()); if (!result) throw new Error(`Task not found: ${taskId}`)
      return result
    },
    async create_subtask(args) {
      const parentId = requireStr(args, 'parent_id')
      const parent = await repos.tasks.findById(parentId); if (!parent) throw new Error(`Parent task not found: ${parentId}`)
      const defaultStatus = await repos.statuses.findDefault(parent.project_id); if (!defaultStatus) throw new Error('No default status found for project')
      const subtask = await repos.tasks.create({ id: crypto.randomUUID(), project_id: parent.project_id, owner_id: userId, title: requireStr(args, 'title'), status_id: defaultStatus.id, parent_id: parentId })
      await logActivity(subtask.id, userId, 'created', null, null, parent.project_id)
      return subtask
    },
    async list_subtasks(args) { return await repos.tasks.findSubtasks(requireStr(args, 'parent_id')) },
    async list_projects() { return await repos.projects.list() },
    async get_project(args) {
      const projectId = requireStr(args, 'project_id')
      const project = await repos.projects.findById(projectId); if (!project) throw new Error(`Project not found: ${projectId}`)
      const statuses = await repos.statuses.findByProjectId(projectId)
      const labels = await repos.labels.findByProjectId(projectId)
      return { ...project, statuses, labels }
    },
    async create_project(args) {
      const projectId = crypto.randomUUID()
      const project = await repos.projects.create({ id: projectId, name: requireStr(args, 'name'), owner_id: userId, color: optStr(args, 'color'), description: optStr(args, 'description') })
      const notStartedId = crypto.randomUUID(); const inProgressId = crypto.randomUUID(); const doneId = crypto.randomUUID()
      await repos.statuses.create({ id: notStartedId, project_id: projectId, name: 'Not Started', color: '#888888', icon: 'circle', order_index: 0, is_default: 1 })
      await repos.statuses.create({ id: inProgressId, project_id: projectId, name: 'In Progress', color: '#3b82f6', icon: 'circle-dot', order_index: 1 })
      await repos.statuses.create({ id: doneId, project_id: projectId, name: 'Done', color: '#22c55e', icon: 'check-circle-2', order_index: 2, is_done: 1 })
      return project
    },
    async update_project(args) {
      const projectId = requireStr(args, 'project_id')
      const input: Record<string, string | undefined> = {}
      const name = optStr(args, 'name'); if (name !== undefined) input.name = name
      const color = optStr(args, 'color'); if (color !== undefined) input.color = color
      const description = optStr(args, 'description'); if (description !== undefined) input.description = description
      const result = await repos.projects.update(projectId, input); if (!result) throw new Error(`Project not found: ${projectId}`)
      return result
    },
    async delete_project(args) {
      const projectId = requireStr(args, 'project_id')
      const deleted = await repos.projects.delete(projectId); if (!deleted) throw new Error(`Project not found: ${projectId}`)
      return { deleted: true, project_id: projectId }
    },
    async list_labels(args) { return await repos.labels.findByProjectId(requireStr(args, 'project_id')) },
    async create_label(args) {
      const projectId = requireStr(args, 'project_id'); const name = requireStr(args, 'name')
      // Reuse existing label with the same name (case-insensitive) to prevent duplicates.
      const existing = await repos.labels.findByName(userId, name)
      if (existing) {
        await repos.labels.addToProject(projectId, existing.id)
        return existing
      }
      return await repos.labels.create({ id: crypto.randomUUID(), project_id: projectId, name, color: optStr(args, 'color') })
    },
    async assign_label_to_task(args) {
      const taskId = requireStr(args, 'task_id'); const labelId = requireStr(args, 'label_id')
      await repos.tasks.addLabel(taskId, labelId)
      const label = await repos.labels.findById(labelId); const task = await repos.tasks.findById(taskId)
      await logActivity(taskId, userId, 'label_added', null, label?.name ?? labelId, task?.project_id)
      return { assigned: true, task_id: taskId, label_id: labelId }
    },
    async remove_label_from_task(args) {
      const taskId = requireStr(args, 'task_id'); const labelId = requireStr(args, 'label_id')
      const label = await repos.labels.findById(labelId); const task = await repos.tasks.findById(taskId)
      const removed = await repos.tasks.removeLabel(taskId, labelId)
      if (removed) await logActivity(taskId, userId, 'label_removed', label?.name ?? labelId, null, task?.project_id)
      return { removed, task_id: taskId, label_id: labelId }
    },
    async list_statuses(args) { return await repos.statuses.findByProjectId(requireStr(args, 'project_id')) },
    async search_tasks(args) {
      const excludeLabelId = optStr(args, 'exclude_label_id')
      const excludeStatusId = optStr(args, 'exclude_status_id')
      const excludePriority = optNum(args, 'exclude_priority')
      return await repos.tasks.search({
        project_id: optStr(args, 'project_id'), status_id: optStr(args, 'status_id'),
        priority: optNum(args, 'priority'), label_id: optStr(args, 'label_id'),
        label_logic: optStr(args, 'label_logic'), due_before: optStr(args, 'due_before'),
        due_after: optStr(args, 'due_after'), keyword: optStr(args, 'keyword'),
        exclude_label_ids: excludeLabelId ? [excludeLabelId] : undefined,
        exclude_status_ids: excludeStatusId ? [excludeStatusId] : undefined,
        exclude_priorities: excludePriority !== undefined ? [excludePriority] : undefined
      })
    },
    async list_my_day() { return await repos.tasks.findMyDay(userId) },
    async list_templates() {
      const taskTemplates = await repos.tasks.findAllTemplates(userId)
      return { task_templates: taskTemplates, project_templates: [] }
    },
    async use_task_template(args) {
      const templateId = requireStr(args, 'template_id'); const projectId = requireStr(args, 'project_id')
      const template = await repos.tasks.findById(templateId)
      if (!template || !template.is_template) throw new Error(`Task template not found: ${templateId}`)
      const defaultStatus = await repos.statuses.findDefault(projectId); if (!defaultStatus) throw new Error('No default status found for target project')
      const newId = crypto.randomUUID()
      const newTask = await repos.tasks.create({
        id: newId, project_id: projectId, owner_id: userId, title: template.title,
        status_id: defaultStatus.id, description: template.description, priority: template.priority,
        recurrence_rule: template.recurrence_rule, order_index: 0
      })
      const templateLabels = await repos.labels.findByTaskId(templateId)
      const targetLabels = [...(await repos.labels.findByProjectId(projectId))]
      for (const tl of templateLabels) {
        let target = targetLabels.find((l: { name: string }) => l.name === tl.name)
        if (!target) {
          const existing = await repos.labels.findByName(userId, tl.name)
          if (existing) { await repos.labels.addToProject(projectId, existing.id); targetLabels.push(existing); target = existing }
          else { const created = await repos.labels.create({ id: crypto.randomUUID(), project_id: projectId, name: tl.name, color: tl.color }); targetLabels.push(created); target = created }
        }
        await repos.tasks.addLabel(newId, target.id)
      }
      await copyTemplateSubtasks(templateId, newId, projectId, userId, defaultStatus.id, targetLabels)
      await logActivity(newId, userId, 'created', null, null, projectId)
      return newTask
    },
    async deploy_project_template(_args) {
      throw new Error('Project templates are not available via the remote MCP server (local-only feature)')
    },
    async create_area(args) {
      const name = requireStr(args, 'name'); const color = optStr(args, 'color')
      const existing = await repos.projectAreas.findByUserId(userId)
      return await repos.projectAreas.create({ id: crypto.randomUUID(), user_id: userId, name, color: color ?? '#888888', sidebar_order: existing.length })
    },
    async list_areas() {
      const areas = await repos.projectAreas.findByUserId(userId)
      const projects = await repos.projects.list()
      return areas.map((area: { id: string }) => {
        const areaProjects = projects.filter((p: { area_id: string | null }) => p.area_id === area.id)
        return { ...area, project_count: areaProjects.length }
      })
    },
    async update_area(args) {
      const areaId = requireStr(args, 'area_id')
      const area = await repos.projectAreas.findById(areaId); if (!area) throw new Error(`Area not found: ${areaId}`)
      const input: Record<string, string> = {}
      const name = optStr(args, 'name'); if (name !== undefined) input.name = name
      const color = optStr(args, 'color'); if (color !== undefined) input.color = color
      return await repos.projectAreas.update(areaId, input)
    },
    async delete_area(args) {
      const areaId = requireStr(args, 'area_id')
      const area = await repos.projectAreas.findById(areaId); if (!area) throw new Error(`Area not found: ${areaId}`)
      await repos.projectAreas.delete(areaId)
      return { deleted: true, area_id: areaId }
    },
    async assign_project_to_area(args) {
      const projectId = requireStr(args, 'project_id'); const areaId = optStr(args, 'area_id')
      await repos.projectAreas.assignProject(projectId, areaId && areaId !== '' ? areaId : null)
      return { assigned: true, project_id: projectId, area_id: areaId || null }
    },
    async create_saved_view(args) {
      const name = requireStr(args, 'name'); const filterConfig = requireStr(args, 'filter_config')
      try { JSON.parse(filterConfig) } catch { throw new Error('filter_config must be valid JSON') }
      const existing = await repos.savedViews.findByUserId(userId)
      return await repos.savedViews.create({ id: crypto.randomUUID(), user_id: userId, name, filter_config: filterConfig, sidebar_order: existing.length })
    },
    async list_saved_views() { return await repos.savedViews.findByUserId(userId) },
    async delete_saved_view(args) {
      const viewId = requireStr(args, 'view_id')
      const view = await repos.savedViews.findById(viewId); if (!view) throw new Error(`Saved view not found: ${viewId}`)
      await repos.savedViews.delete(viewId)
      return { deleted: true, view_id: viewId }
    },
    async reorder_tasks(args) {
      const taskIds = args.task_ids
      if (!Array.isArray(taskIds) || taskIds.length === 0) throw new Error('task_ids must be a non-empty array of task IDs')
      const ids = taskIds.map(String)
      for (const id of ids) { const task = await repos.tasks.findById(id); if (!task) throw new Error(`Task not found: ${id}`) }
      await repos.tasks.reorder(ids)
      const autoSort = await repos.settings.get(userId, 'priority_auto_sort')
      const warning = autoSort === 'true' ? 'Note: priority auto-sort is enabled — visual order may differ' : undefined
      return { reordered: true, count: ids.length, ...(warning ? { warning } : {}) }
    },
    async set_whats_new(args) {
      const content = requireStr(args, 'content')
      const version = optStr(args, 'version') ?? 'v0.0.0'
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
      const adminClient = createClient(supabaseUrl, serviceRoleKey)
      const { error } = await adminClient.from('release_notes').upsert(
        { version, content, published_at: new Date().toISOString() },
        { onConflict: 'version' }
      )
      if (error) return { success: false, content, version, error: error.message }
      return { success: true, content, version, storage: 'supabase' }
    },
  }
  return handlers
}

// ── Auth Context (set per-request before tool handlers run) ────────────

let _authUserId: string | null = null
let _authClient: SupabaseClient | null = null
let _authRepos: Repos | null = null
let _authHandlers: ReturnType<typeof createHandlers> | null = null

// ── MCP Server Setup via mcp-lite ─────────────────────────────────────

const mcp = new McpServer({ name: 'ToDoozy', version: '1.0.0' })

// Register all tools
for (const tool of tools) {
  mcp.tool(tool.name, {
    description: tool.description,
    inputSchema: tool.inputSchema,
    handler: async (args: Record<string, unknown>) => {
      if (!_authHandlers) return { content: [{ type: 'text' as const, text: 'Not authenticated' }], isError: true }
      const handler = _authHandlers[tool.name]
      if (!handler) return { content: [{ type: 'text' as const, text: `Unknown tool: ${tool.name}` }], isError: true }
      try {
        const result = await handler(args)
        return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] }
      } catch (e) {
        return { content: [{ type: 'text' as const, text: e instanceof Error ? e.message : String(e) }], isError: true }
      }
    }
  })
}

const transport = new StreamableHttpTransport()
const httpHandler = transport.bind(mcp)

// ── CORS Headers ───────────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, Accept, Mcp-Session-Id',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
}

// ── Auth ───────────────────────────────────────────────────────────────

async function authenticateRequest(req: Request): Promise<{ userId: string; client: SupabaseClient } | null> {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return null
  const apiKey = authHeader.slice(7)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const adminClient = createClient(supabaseUrl, serviceRoleKey)

  const { data: keyData } = await adminClient
    .from('api_keys')
    .select('user_id')
    .eq('key', apiKey)
    .single()

  if (!keyData) return null

  // Track usage (fire and forget)
  adminClient
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key', apiKey)
    .then(() => {})

  return { userId: keyData.user_id, client: adminClient }
}

// ── Request Handler ────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  // Authenticate
  const auth = await authenticateRequest(req)
  if (!auth) {
    return new Response(JSON.stringify({ error: 'Invalid or missing API key' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }
    })
  }

  // Set auth context for tool handlers
  _authUserId = auth.userId
  _authClient = auth.client
  _authRepos = createRepos(auth.client, auth.userId)
  _authHandlers = createHandlers(_authRepos, auth.userId)

  // Delegate to mcp-lite handler
  const response = await httpHandler(req)

  // Add CORS headers to response
  const headers = new Headers(response.headers)
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(response.body, { status: response.status, headers })
})
