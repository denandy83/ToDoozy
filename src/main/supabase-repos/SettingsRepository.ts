import type { SupabaseClient } from '@supabase/supabase-js'
import type { AsyncSettingsRepository } from './index'

export class SupabaseSettingsRepository implements AsyncSettingsRepository {
  constructor(private client: SupabaseClient) {}

  async get(userId: string, key: string): Promise<string | null> {
    const { data } = await this.client
      .from('user_settings')
      .select('value')
      .eq('user_id', userId)
      .eq('key', key)
      .single()
    return data?.value ?? null
  }

  async set(userId: string, key: string, value: string | null): Promise<void> {
    const id = `${userId}:${key}`
    const { error } = await this.client.from('user_settings').upsert(
      {
        id,
        user_id: userId,
        key,
        value,
        updated_at: new Date().toISOString()
      },
      { onConflict: 'id' }
    )
    if (error) throw new Error(`Failed to set setting: ${error.message}`)
  }
}
