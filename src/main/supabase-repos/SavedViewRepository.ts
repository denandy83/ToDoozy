import type { SupabaseClient } from '@supabase/supabase-js'
import type { SavedView, CreateSavedViewInput } from '../../shared/types'
import type { AsyncSavedViewRepository } from './index'

export class SupabaseSavedViewRepository implements AsyncSavedViewRepository {
  constructor(private client: SupabaseClient) {}

  async findByUserId(userId: string): Promise<SavedView[]> {
    const { data } = await this.client
      .from('user_saved_views')
      .select('*')
      .eq('user_id', userId)
      .order('sidebar_order')
    return data ?? []
  }

  async findById(id: string): Promise<SavedView | undefined> {
    const { data } = await this.client
      .from('user_saved_views')
      .select('*')
      .eq('id', id)
      .single()
    return data ?? undefined
  }

  async create(input: CreateSavedViewInput): Promise<SavedView> {
    const now = new Date().toISOString()
    const record = {
      id: input.id,
      user_id: input.user_id,
      project_id: input.project_id ?? null,
      name: input.name,
      color: input.color ?? '#888888',
      icon: input.icon ?? 'filter',
      sidebar_order: input.sidebar_order ?? 0,
      filter_config: input.filter_config,
      created_at: now,
      updated_at: now
    }
    const { data, error } = await this.client
      .from('user_saved_views')
      .insert(record)
      .select()
      .single()
    if (error) throw new Error(`Failed to create saved view: ${error.message}`)
    return data
  }

  async delete(id: string): Promise<boolean> {
    const { error } = await this.client.from('user_saved_views').delete().eq('id', id)
    return !error
  }
}
