import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { SettingsRepository } from '../repositories/SettingsRepository'
import { getDatabase } from '../database'

interface SupabaseReleaseNote {
  version: string
  content: string
  published_at: string
}

const SUPABASE_TABLE = 'release_notes'

let supabase: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL ?? ''
    const key = process.env.SUPABASE_ANON_KEY ?? ''
    if (!url || !key) throw new Error('Supabase credentials not configured')
    supabase = createClient(url, key)
  }
  return supabase
}

/** Get a fresh SettingsRepository using the current (possibly switched) database */
function getSettings(): SettingsRepository {
  return new SettingsRepository(getDatabase())
}

/**
 * Fetch all published release notes from Supabase, concatenate into versioned
 * markdown, and cache in the local whats_new setting.
 * Non-blocking — errors are logged, not thrown.
 */
export async function syncReleaseNotes(): Promise<void> {
  try {
    const client = getClient()
    const { data, error } = await client
      .from(SUPABASE_TABLE)
      .select('version, content, published_at')
      .order('published_at', { ascending: false })

    if (error) {
      console.error('[ReleaseNotes] Failed to fetch from Supabase:', error.message)
      return
    }

    const releases = data as SupabaseReleaseNote[]
    if (releases.length === 0) return

    const markdown = releases
      .map((r) => `## ${r.version}\n${r.content.trim()}`)
      .join('\n\n')

    getSettings().set('', 'whats_new', markdown)
  } catch (err) {
    console.error('[ReleaseNotes] Sync error:', err instanceof Error ? err.message : err)
  }
}

/**
 * Fetch release notes for a specific version from Supabase.
 * Used by the update dialog to show per-version notes.
 * Returns the content string or null if not found / on error.
 */
export async function fetchVersionNotes(version: string): Promise<string | null> {
  try {
    const client = getClient()
    const versions = version.startsWith('v') ? [version, version.slice(1)] : [`v${version}`, version]

    for (const v of versions) {
      const { data, error } = await client
        .from(SUPABASE_TABLE)
        .select('content')
        .eq('version', v)
        .single()

      if (!error && data) return (data as SupabaseReleaseNote).content
    }

    return null
  } catch (err) {
    console.error('[ReleaseNotes] Failed to fetch version notes:', err instanceof Error ? err.message : err)
    return null
  }
}

/**
 * Upsert release notes for a version to Supabase.
 * Used by the MCP set_whats_new tool and skill workflows.
 */
export async function upsertReleaseNotes(version: string, content: string): Promise<boolean> {
  try {
    const client = getClient()
    const { error } = await client
      .from(SUPABASE_TABLE)
      .upsert({ version, content, published_at: new Date().toISOString() }, { onConflict: 'version' })

    if (error) {
      console.error('[ReleaseNotes] Failed to upsert:', error.message)
      return false
    }

    return true
  } catch (err) {
    console.error('[ReleaseNotes] Upsert error:', err instanceof Error ? err.message : err)
    return false
  }
}
