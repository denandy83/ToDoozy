import type { SupabaseClient } from '@supabase/supabase-js'
import type { ProjectArea, CreateProjectAreaInput, UpdateProjectAreaInput } from '../../shared/types'
import type { AsyncProjectAreaRepository } from './index'

export class SupabaseProjectAreaRepository implements AsyncProjectAreaRepository {
  constructor(private client: SupabaseClient) {}

  async findByUserId(userId: string): Promise<ProjectArea[]> {
    const { data } = await this.client
      .from('user_project_areas')
      .select('*')
      .eq('user_id', userId)
      .order('sidebar_order')
    return data ?? []
  }

  async findById(id: string): Promise<ProjectArea | undefined> {
    const { data } = await this.client
      .from('user_project_areas')
      .select('*')
      .eq('id', id)
      .single()
    return data ?? undefined
  }

  async create(input: CreateProjectAreaInput): Promise<ProjectArea> {
    const now = new Date().toISOString()
    const record = {
      id: input.id,
      user_id: input.user_id,
      name: input.name,
      color: input.color ?? '#888888',
      icon: input.icon ?? 'folder',
      sidebar_order: input.sidebar_order ?? 0,
      is_collapsed: 0,
      created_at: now,
      updated_at: now
    }
    const { data, error } = await this.client
      .from('user_project_areas')
      .insert(record)
      .select()
      .single()
    if (error) throw new Error(`Failed to create project area: ${error.message}`)
    return data
  }

  async update(id: string, input: UpdateProjectAreaInput): Promise<ProjectArea | null> {
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (input.name !== undefined) updates.name = input.name
    if (input.color !== undefined) updates.color = input.color
    if (input.icon !== undefined) updates.icon = input.icon
    if (input.sidebar_order !== undefined) updates.sidebar_order = input.sidebar_order
    if (input.is_collapsed !== undefined) updates.is_collapsed = input.is_collapsed

    const { data, error } = await this.client
      .from('user_project_areas')
      .update(updates)
      .eq('id', id)
      .select()
      .single()
    if (error) return null
    return data
  }

  async delete(id: string): Promise<boolean> {
    // Ungroup projects in this area first
    await this.client.from('projects').update({ area_id: null }).eq('area_id', id)
    const { error } = await this.client.from('user_project_areas').delete().eq('id', id)
    return !error
  }

  async assignProject(projectId: string, areaId: string | null): Promise<void> {
    await this.client.from('projects').update({ area_id: areaId }).eq('id', projectId)
  }
}
