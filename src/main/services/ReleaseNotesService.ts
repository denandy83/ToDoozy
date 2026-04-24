import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import semver from 'semver'
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

export interface ReleaseNotesSyncResult {
  ok: boolean
  count: number
  cached: number
  error?: string
}

/**
 * Fetch all published release notes from Supabase, concatenate into versioned
 * markdown, and cache in the local whats_new setting.
 * Non-blocking — errors are returned as a structured result, not thrown.
 */
export async function syncReleaseNotes(): Promise<ReleaseNotesSyncResult> {
  let cached = 0
  try {
    try {
      const existing = getSettings().get('', 'whats_new') ?? ''
      cached = existing ? existing.split('\n').filter((l) => l.startsWith('## ')).length : 0
    } catch {
      // DB not ready — cached stays 0
    }

    const url = process.env.SUPABASE_URL ?? ''
    const key = process.env.SUPABASE_ANON_KEY ?? ''
    if (!url || !key) {
      return { ok: false, count: 0, cached, error: 'Supabase credentials not configured in build' }
    }

    const client = getClient()
    const { data, error } = await client
      .from(SUPABASE_TABLE)
      .select('version, content, published_at')
      .order('published_at', { ascending: false })

    if (error) {
      console.error('[ReleaseNotes] Failed to fetch from Supabase:', error.message)
      return { ok: false, count: 0, cached, error: `fetch failed: ${error.message}` }
    }

    const releases = data as SupabaseReleaseNote[]
    if (releases.length === 0) {
      return { ok: true, count: 0, cached }
    }

    const markdown = releases
      .map((r) => `## ${r.version}\n${r.content.trim()}`)
      .join('\n\n')

    try {
      getSettings().set('', 'whats_new', markdown)
    } catch (dbErr) {
      const msg = dbErr instanceof Error ? dbErr.message : String(dbErr)
      console.error('[ReleaseNotes] Failed to write cache:', msg)
      return { ok: false, count: releases.length, cached, error: `cache write failed: ${msg}` }
    }

    return { ok: true, count: releases.length, cached }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[ReleaseNotes] Sync error:', msg)
    return { ok: false, count: 0, cached, error: msg }
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
 * Fetch all release notes strictly greater than `fromVersion` and less than or
 * equal to `toVersion`, concatenated newest-first as:
 *   ## vX.Y.Z
 *   <content>
 *
 *   ## vX.Y.W
 *   <content>
 *
 * Used by the update modal so a user on 1.3.2 upgrading to 1.4.1 sees notes
 * for every intermediate version (1.3.3, 1.4.0, 1.4.1). Returns null on error
 * or when no rows match.
 */
/**
 * Pure helper: from a set of Supabase release rows, keep those strictly greater
 * than `fromVersion` and less than or equal to `toVersion` (semver), then
 * concatenate newest-first as `## vX.Y.Z\n<content>\n\n...`.
 * Exported for unit testing. Returns null when no rows match or versions invalid.
 */
export function selectNotesInRange(
  releases: SupabaseReleaseNote[],
  fromVersion: string,
  toVersion: string
): string | null {
  const from = semver.coerce(fromVersion)?.version
  const to = semver.coerce(toVersion)?.version
  if (!from || !to) return null

  const inRange = releases.filter((r) => {
    const v = semver.coerce(r.version)?.version
    if (!v) return false
    return semver.gt(v, from) && semver.lte(v, to)
  })

  if (inRange.length === 0) return null

  inRange.sort((a, b) => {
    const av = semver.coerce(a.version)?.version
    const bv = semver.coerce(b.version)?.version
    if (!av || !bv) return 0
    return semver.rcompare(av, bv)
  })

  return inRange
    .map((r) => {
      const label = r.version.startsWith('v') ? r.version : `v${r.version}`
      return `## ${label}\n${r.content.trim()}`
    })
    .join('\n\n')
}

export async function fetchNotesBetween(
  fromVersion: string,
  toVersion: string
): Promise<string | null> {
  try {
    const client = getClient()
    const { data, error } = await client
      .from(SUPABASE_TABLE)
      .select('version, content, published_at')
      .order('published_at', { ascending: false })

    if (error) {
      console.error('[ReleaseNotes] Failed to fetch notes between:', error.message)
      return null
    }

    return selectNotesInRange((data ?? []) as SupabaseReleaseNote[], fromVersion, toVersion)
  } catch (err) {
    console.error(
      '[ReleaseNotes] Failed to fetch notes between:',
      err instanceof Error ? err.message : err
    )
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
