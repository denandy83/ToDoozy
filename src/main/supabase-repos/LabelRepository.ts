import type { SupabaseClient } from '@supabase/supabase-js'
import type { Label, CreateLabelInput } from '../../shared/types'
import type { AsyncLabelRepository } from './index'

export class SupabaseLabelRepository implements AsyncLabelRepository {
  constructor(
    private client: SupabaseClient,
    private userId: string
  ) {}

  async findById(id: string): Promise<Label | undefined> {
    const { data } = await this.client.from('user_labels').select('*').eq('id', id).single()
    return data ?? undefined
  }

  async findByProjectId(projectId: string): Promise<Label[]> {
    // Supabase stores project-label associations in project.label_data JSON
    const { data: project } = await this.client
      .from('projects')
      .select('label_data')
      .eq('id', projectId)
      .single()

    if (!project?.label_data) return []

    let labelData: Array<{ name: string; color: string }>
    try {
      labelData =
        typeof project.label_data === 'string'
          ? JSON.parse(project.label_data)
          : project.label_data
    } catch {
      return []
    }

    if (!Array.isArray(labelData) || labelData.length === 0) return []

    // Look up full label objects from user_labels by name
    const names = labelData.map((l) => l.name)
    const { data: labels } = await this.client
      .from('user_labels')
      .select('*')
      .eq('user_id', this.userId)
      .in('name', names)
    return labels ?? []
  }

  async findByTaskId(taskId: string): Promise<Label[]> {
    const { data: taskLabels } = await this.client
      .from('task_labels')
      .select('label_id')
      .eq('task_id', taskId)
    if (!taskLabels || taskLabels.length === 0) return []

    const labelIds = taskLabels.map((tl: { label_id: string }) => tl.label_id)
    const { data } = await this.client.from('user_labels').select('*').in('id', labelIds)
    return data ?? []
  }

  async findByName(userId: string, name: string): Promise<Label | undefined> {
    const { data } = await this.client
      .from('user_labels')
      .select('*')
      .eq('user_id', userId)
      .ilike('name', name)
      .limit(1)
      .single()
    return data ?? undefined
  }

  async create(input: CreateLabelInput): Promise<Label> {
    const now = new Date().toISOString()
    const record = {
      id: input.id,
      user_id: this.userId,
      name: input.name,
      color: input.color ?? '#888888',
      order_index: 0,
      created_at: now,
      updated_at: now
    }
    const { data, error } = await this.client
      .from('user_labels')
      .insert(record)
      .select()
      .single()
    if (error) throw new Error(`Failed to create label: ${error.message}`)

    // If project_id provided, also link label to project
    if (input.project_id) {
      await this.addToProject(input.project_id, input.id)
    }

    return data
  }

  async addToProject(projectId: string, labelId: string): Promise<void> {
    // Get the label details
    const label = await this.findById(labelId)
    if (!label) return

    // Get current project label_data
    const { data: project } = await this.client
      .from('projects')
      .select('label_data')
      .eq('id', projectId)
      .single()

    let labelData: Array<{ name: string; color: string }> = []
    if (project?.label_data) {
      try {
        labelData =
          typeof project.label_data === 'string'
            ? JSON.parse(project.label_data)
            : project.label_data
      } catch {
        labelData = []
      }
    }

    // Add if not already present
    if (!labelData.some((l) => l.name === label.name)) {
      labelData.push({ name: label.name, color: label.color })
      await this.client
        .from('projects')
        .update({ label_data: JSON.stringify(labelData) })
        .eq('id', projectId)
    }
  }
}
