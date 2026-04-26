import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'
import type { Task, CreateTaskInput, UpdateTaskInput, TaskLabel } from '../../shared/types'
import { TASK_UPDATABLE_COLUMNS } from '../../shared/types'
import type { TaskSearchFilters } from '../repositories/TaskRepository'
import { getNextOccurrence } from '../../shared/recurrenceUtils'
import type { AsyncTaskRepository } from './index'

export class SupabaseTaskRepository implements AsyncTaskRepository {
  constructor(
    private client: SupabaseClient,
    _userId: string // userId passed for consistency but not needed — handlers pass userId explicitly
  ) {}

  async findById(id: string): Promise<Task | undefined> {
    const { data } = await this.client.from('tasks').select('*').eq('id', id).single()
    return data ?? undefined
  }

  async findByProjectId(projectId: string): Promise<Task[]> {
    const { data } = await this.client
      .from('tasks')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_archived', 0)
      .eq('is_template', 0)
      .is('parent_id', null)
      .order('order_index')
    return data ?? []
  }

  async findSubtasks(parentId: string): Promise<Task[]> {
    const { data } = await this.client
      .from('tasks')
      .select('*')
      .eq('parent_id', parentId)
      .order('order_index')
    return data ?? []
  }

  async findMyDay(userId: string): Promise<Task[]> {
    const { data, error } = await this.client
      .from('tasks')
      .select('*')
      .eq('owner_id', userId)
      .eq('is_archived', 0)
      .eq('is_template', 0)
      .eq('is_in_my_day', 1)
    if (error) throw error
    return data ?? []
  }

  async findArchived(projectId: string): Promise<Task[]> {
    const { data } = await this.client
      .from('tasks')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_archived', 1)
      .order('updated_at', { ascending: false })
    return data ?? []
  }

  async findTemplates(projectId: string): Promise<Task[]> {
    const { data } = await this.client
      .from('tasks')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_template', 1)
      .order('created_at', { ascending: false })
    return data ?? []
  }

  async findAllTemplates(userId: string): Promise<Task[]> {
    const { data } = await this.client
      .from('tasks')
      .select('*')
      .eq('owner_id', userId)
      .eq('is_template', 1)
      .order('created_at', { ascending: false })
    return data ?? []
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const now = new Date().toISOString()
    const record = {
      id: input.id,
      project_id: input.project_id,
      owner_id: input.owner_id,
      title: input.title,
      status_id: input.status_id,
      assigned_to: input.assigned_to ?? null,
      description: input.description ?? null,
      priority: input.priority ?? 0,
      due_date: input.due_date ?? null,
      parent_id: input.parent_id ?? null,
      order_index: input.order_index ?? 0,
      is_in_my_day: input.is_in_my_day ?? 0,
      is_template: input.is_template ?? 0,
      is_archived: input.is_archived ?? 0,
      completed_date: input.completed_date ?? null,
      recurrence_rule: input.recurrence_rule ?? null,
      reference_url: input.reference_url ?? null,
      created_at: now,
      updated_at: now
    }
    const { data, error } = await this.client.from('tasks').insert(record).select().single()
    if (error) throw new Error(`Failed to create task: ${error.message}`)
    return data
  }

  async update(id: string, input: UpdateTaskInput): Promise<Task | undefined> {
    // Whitelist columns
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    for (const col of TASK_UPDATABLE_COLUMNS) {
      if (col in input) {
        updates[col] = input[col]
      }
    }
    const { data, error } = await this.client
      .from('tasks')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) return undefined
    return data
  }

  async delete(id: string): Promise<boolean> {
    const { error } = await this.client.from('tasks').delete().eq('id', id)
    return !error
  }

  async duplicate(id: string, newId: string): Promise<Task | undefined> {
    const original = await this.findById(id)
    if (!original) return undefined

    const copy: CreateTaskInput = {
      id: newId,
      project_id: original.project_id,
      owner_id: original.owner_id,
      title: `${original.title} (copy)`,
      status_id: original.status_id,
      description: original.description,
      priority: original.priority,
      due_date: original.due_date,
      parent_id: original.parent_id,
      order_index: original.order_index + 1,
      recurrence_rule: original.recurrence_rule
    }
    const task = await this.create(copy)

    // Copy labels
    const labels = await this.getLabels(id)
    for (const label of labels) {
      await this.addLabel(newId, label.label_id)
    }

    // Copy subtasks
    const subtasks = await this.findSubtasks(id)
    for (const sub of subtasks) {
      const subCopyId = randomUUID()
      const subCopy: CreateTaskInput = {
        id: subCopyId,
        project_id: sub.project_id,
        owner_id: sub.owner_id,
        title: sub.title,
        status_id: sub.status_id,
        description: sub.description,
        priority: sub.priority,
        parent_id: newId,
        order_index: sub.order_index,
        recurrence_rule: sub.recurrence_rule
      }
      await this.create(subCopy)
      const subLabels = await this.getLabels(sub.id)
      for (const sl of subLabels) {
        await this.addLabel(subCopyId, sl.label_id)
      }
    }

    return task
  }

  async saveAsTemplate(id: string, newId: string): Promise<Task | undefined> {
    const original = await this.findById(id)
    if (!original) return undefined

    const templateInput: CreateTaskInput = {
      id: newId,
      project_id: original.project_id,
      owner_id: original.owner_id,
      title: original.title,
      status_id: original.status_id,
      description: original.description,
      priority: original.priority,
      is_template: 1,
      order_index: 0,
      recurrence_rule: original.recurrence_rule
    }
    const template = await this.create(templateInput)

    // Copy labels
    const labels = await this.getLabels(id)
    for (const label of labels) {
      await this.addLabel(newId, label.label_id)
    }

    // Copy subtasks as template subtasks
    const subtasks = await this.findSubtasks(id)
    for (const sub of subtasks) {
      const subTemplateId = randomUUID()
      await this.create({
        id: subTemplateId,
        project_id: sub.project_id,
        owner_id: sub.owner_id,
        title: sub.title,
        status_id: sub.status_id,
        description: sub.description,
        priority: sub.priority,
        parent_id: newId,
        is_template: 1,
        order_index: sub.order_index,
        recurrence_rule: sub.recurrence_rule
      })
      const subLabels = await this.getLabels(sub.id)
      for (const sl of subLabels) {
        await this.addLabel(subTemplateId, sl.label_id)
      }
    }

    return template
  }

  async reorder(taskIds: string[]): Promise<void> {
    for (let i = 0; i < taskIds.length; i++) {
      await this.client
        .from('tasks')
        .update({ order_index: i, updated_at: new Date().toISOString() })
        .eq('id', taskIds[i])
    }
  }

  async addLabel(taskId: string, labelId: string): Promise<void> {
    await this.client
      .from('task_labels')
      .upsert({ task_id: taskId, label_id: labelId }, { onConflict: 'task_id,label_id' })

    // Update task's label_names JSON for Supabase consumers
    await this.refreshLabelNames(taskId)
  }

  async removeLabel(taskId: string, labelId: string): Promise<boolean> {
    const { error } = await this.client
      .from('task_labels')
      .delete()
      .eq('task_id', taskId)
      .eq('label_id', labelId)
    if (error) return false
    await this.refreshLabelNames(taskId)
    return true
  }

  async getLabels(taskId: string): Promise<TaskLabel[]> {
    const { data } = await this.client
      .from('task_labels')
      .select('task_id, label_id, deleted_at')
      .eq('task_id', taskId)
      .is('deleted_at', null)
    return data ?? []
  }

  async search(filters: TaskSearchFilters): Promise<Task[]> {
    let query = this.client
      .from('tasks')
      .select('*')
      .eq('is_template', 0)

    // Default: exclude archived
    if (filters.is_archived !== undefined) {
      query = query.eq('is_archived', filters.is_archived)
    } else {
      query = query.eq('is_archived', 0)
    }

    if (filters.project_id) query = query.eq('project_id', filters.project_id)
    if (filters.project_ids?.length) query = query.in('project_id', filters.project_ids)
    if (filters.status_id) query = query.eq('status_id', filters.status_id)
    if (filters.status_ids?.length) query = query.in('status_id', filters.status_ids)
    if (filters.priority !== undefined) query = query.eq('priority', filters.priority)
    if (filters.priorities?.length) query = query.in('priority', filters.priorities)
    if (filters.assigned_to_ids?.length) query = query.in('assigned_to', filters.assigned_to_ids)
    if (filters.due_before) query = query.lte('due_date', filters.due_before)
    if (filters.due_after) query = query.gte('due_date', filters.due_after)
    if (filters.owner_id) query = query.eq('owner_id', filters.owner_id)
    if (filters.keyword) query = query.or(`title.ilike.%${filters.keyword}%,description.ilike.%${filters.keyword}%`)

    // Exclusion filters
    if (filters.exclude_status_ids?.length) {
      for (const sid of filters.exclude_status_ids) {
        query = query.neq('status_id', sid)
      }
    }
    if (filters.exclude_priorities?.length) {
      for (const p of filters.exclude_priorities) {
        query = query.neq('priority', p)
      }
    }
    if (filters.exclude_assigned_to_ids?.length) {
      for (const aid of filters.exclude_assigned_to_ids) {
        query = query.neq('assigned_to', aid)
      }
    }
    if (filters.exclude_project_ids?.length) {
      for (const pid of filters.exclude_project_ids) {
        query = query.neq('project_id', pid)
      }
    }

    const { data } = await query.order('order_index')
    let results = data ?? []

    // Label filtering requires a join through task_labels
    if (filters.label_id || filters.label_ids?.length) {
      const labelIds = filters.label_ids ?? (filters.label_id ? [filters.label_id] : [])
      const { data: tlData } = await this.client
        .from('task_labels')
        .select('task_id')
        .in('label_id', labelIds)
      const matchingIds = new Set((tlData ?? []).map((tl: { task_id: string }) => tl.task_id))
      results = results.filter((t) => matchingIds.has(t.id))
    }

    // Label exclusion filtering
    if (filters.exclude_label_ids?.length) {
      const { data: tlData } = await this.client
        .from('task_labels')
        .select('task_id')
        .in('label_id', filters.exclude_label_ids)
      const excludeIds = new Set((tlData ?? []).map((tl: { task_id: string }) => tl.task_id))
      results = results.filter((t) => !excludeIds.has(t.id))
    }

    return results
  }

  async getSubtaskCount(parentId: string): Promise<{ total: number; done: number }> {
    const subtasks = await this.findSubtasks(parentId)
    if (subtasks.length === 0) return { total: 0, done: 0 }

    // Need to check which statuses are "done"
    const statusIds = [...new Set(subtasks.map((s) => s.status_id))]
    const { data: statuses } = await this.client
      .from('statuses')
      .select('id, is_done')
      .in('id', statusIds)
    const doneStatusIds = new Set(
      (statuses ?? []).filter((s: { is_done: number }) => s.is_done === 1).map((s: { id: string }) => s.id)
    )
    const done = subtasks.filter((s) => doneStatusIds.has(s.status_id)).length
    return { total: subtasks.length, done }
  }

  async completeRecurringTask(taskId: string): Promise<{ id: string; dueDate: string } | null> {
    const task = await this.findById(taskId)
    if (!task || !task.recurrence_rule || !task.due_date) return null

    const baseDate = new Date(task.due_date)
    const nextDateObj = getNextOccurrence(task.recurrence_rule, baseDate)
    if (!nextDateObj) return null
    const nextDate = nextDateObj.toISOString().slice(0, 10)

    // Create next occurrence
    const nextId = randomUUID()
    await this.create({
      id: nextId,
      project_id: task.project_id,
      owner_id: task.owner_id,
      title: task.title,
      status_id: task.status_id,
      description: task.description,
      priority: task.priority,
      due_date: nextDate,
      parent_id: task.parent_id,
      order_index: task.order_index,
      recurrence_rule: task.recurrence_rule,
      is_in_my_day: task.is_in_my_day
    })

    // Copy labels
    const labels = await this.getLabels(taskId)
    for (const label of labels) {
      await this.addLabel(nextId, label.label_id)
    }

    return { id: nextId, dueDate: nextDate }
  }

  private async refreshLabelNames(taskId: string): Promise<void> {
    const { data: taskLabels } = await this.client
      .from('task_labels')
      .select('label_id')
      .eq('task_id', taskId)
    if (!taskLabels || taskLabels.length === 0) {
      await this.client.from('tasks').update({ label_names: null }).eq('id', taskId)
      return
    }
    const labelIds = taskLabels.map((tl: { label_id: string }) => tl.label_id)
    const { data: labels } = await this.client
      .from('user_labels')
      .select('name, color')
      .in('id', labelIds)
    const labelNames = (labels ?? []).map((l: { name: string; color: string }) => ({
      name: l.name,
      color: l.color
    }))
    await this.client
      .from('tasks')
      .update({ label_names: JSON.stringify(labelNames) })
      .eq('id', taskId)
  }
}
