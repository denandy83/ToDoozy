import type { SupabaseClient } from '@supabase/supabase-js'
import type { Status, CreateStatusInput } from '../../shared/types'
import type { AsyncStatusRepository } from './index'

export class SupabaseStatusRepository implements AsyncStatusRepository {
  constructor(private client: SupabaseClient) {}

  async findByProjectId(projectId: string): Promise<Status[]> {
    const { data } = await this.client
      .from('statuses')
      .select('*')
      .eq('project_id', projectId)
      .order('order_index')
    return data ?? []
  }

  async findById(id: string): Promise<Status | undefined> {
    const { data } = await this.client.from('statuses').select('*').eq('id', id).single()
    return data ?? undefined
  }

  async findDefault(projectId: string): Promise<Status | undefined> {
    const { data } = await this.client
      .from('statuses')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_default', 1)
      .single()
    return data ?? undefined
  }

  async findDone(projectId: string): Promise<Status | undefined> {
    const { data } = await this.client
      .from('statuses')
      .select('*')
      .eq('project_id', projectId)
      .eq('is_done', 1)
      .single()
    return data ?? undefined
  }

  async create(input: CreateStatusInput): Promise<Status> {
    const now = new Date().toISOString()
    const record = {
      id: input.id,
      project_id: input.project_id,
      name: input.name,
      color: input.color ?? '#888888',
      icon: input.icon ?? 'circle',
      order_index: input.order_index ?? 0,
      is_done: input.is_done ?? 0,
      is_default: input.is_default ?? 0,
      created_at: now,
      updated_at: now
    }
    const { data, error } = await this.client.from('statuses').insert(record).select().single()
    if (error) throw new Error(`Failed to create status: ${error.message}`)
    return data
  }
}
