import type { SupabaseClient } from '@supabase/supabase-js'
import type { ActivityLogEntry, CreateActivityLogInput } from '../../shared/types'
import type { AsyncActivityLogRepository } from './index'

export class SupabaseActivityLogRepository implements AsyncActivityLogRepository {
  constructor(private client: SupabaseClient) {}

  async create(
    input: CreateActivityLogInput & { project_id?: string }
  ): Promise<ActivityLogEntry> {
    const now = new Date().toISOString()
    const record = {
      id: input.id,
      task_id: input.task_id,
      user_id: input.user_id,
      action: input.action,
      old_value: input.old_value ?? null,
      new_value: input.new_value ?? null,
      project_id: input.project_id ?? null,
      created_at: now
    }
    const { data, error } = await this.client
      .from('activity_log')
      .insert(record)
      .select()
      .single()
    if (error) throw new Error(`Failed to create activity log: ${error.message}`)
    return data
  }
}
