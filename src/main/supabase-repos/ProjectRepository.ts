import type { SupabaseClient } from '@supabase/supabase-js'
import type { Project, CreateProjectInput, UpdateProjectInput } from '../../shared/types'
import type { AsyncProjectRepository } from './index'

export class SupabaseProjectRepository implements AsyncProjectRepository {
  constructor(
    private client: SupabaseClient,
    _userId: string
  ) {}

  async list(): Promise<Project[]> {
    // RLS restricts to projects where user is a member
    const { data } = await this.client
      .from('projects')
      .select('*')
      .order('sidebar_order')
    return data ?? []
  }

  async findById(id: string): Promise<Project | undefined> {
    const { data } = await this.client.from('projects').select('*').eq('id', id).single()
    return data ?? undefined
  }

  async create(input: CreateProjectInput): Promise<Project> {
    // Use share_project RPC to atomically create project + owner membership (RLS safe)
    const { error } = await this.client.rpc('share_project', {
      p_id: input.id,
      p_name: input.name,
      p_description: input.description ?? null,
      p_color: input.color ?? '#888888',
      p_icon: input.icon ?? 'folder'
    })
    if (error) throw new Error(`Failed to create project: ${error.message}`)

    // Update additional fields not handled by the RPC
    const updates: Record<string, unknown> = {}
    if (input.is_default !== undefined) updates.is_default = input.is_default
    if (input.sidebar_order !== undefined) updates.sidebar_order = input.sidebar_order
    if (Object.keys(updates).length > 0) {
      await this.client.from('projects').update(updates).eq('id', input.id)
    }

    const project = await this.findById(input.id)
    if (!project) throw new Error('Project created but not found')
    return project
  }

  async update(id: string, input: UpdateProjectInput): Promise<Project | undefined> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (input.name !== undefined) updates.name = input.name
    if (input.description !== undefined) updates.description = input.description
    if (input.color !== undefined) updates.color = input.color
    if (input.icon !== undefined) updates.icon = input.icon
    if (input.sidebar_order !== undefined) updates.sidebar_order = input.sidebar_order
    if (input.is_default !== undefined) updates.is_default = input.is_default
    if (input.is_shared !== undefined) updates.is_shared = input.is_shared

    const { data, error } = await this.client
      .from('projects')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) return undefined
    return data
  }

  async delete(id: string): Promise<boolean> {
    // Delete in order: tasks, statuses, project_members, then project
    await this.client.from('tasks').delete().eq('project_id', id)
    await this.client.from('statuses').delete().eq('project_id', id)
    await this.client.from('project_members').delete().eq('project_id', id)
    const { error } = await this.client.from('projects').delete().eq('id', id)
    return !error
  }

  async addMember(projectId: string, userId: string, role: string): Promise<void> {
    await this.client.from('project_members').upsert(
      {
        project_id: projectId,
        user_id: userId,
        role,
        joined_at: new Date().toISOString()
      },
      { onConflict: 'project_id,user_id' }
    )
  }

  async getProjectsForUser(userId: string): Promise<Project[]> {
    const { data: members } = await this.client
      .from('project_members')
      .select('project_id')
      .eq('user_id', userId)
    if (!members || members.length === 0) return []
    const projectIds = members.map((m: { project_id: string }) => m.project_id)
    const { data } = await this.client
      .from('projects')
      .select('*')
      .in('id', projectIds)
      .order('sidebar_order')
    return data ?? []
  }
}
