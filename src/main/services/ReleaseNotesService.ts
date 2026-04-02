import { net } from 'electron'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DatabaseSync } from 'node:sqlite'
import { SettingsRepository } from '../repositories/SettingsRepository'

interface ReleaseNoteRow {
  version: string
  content: string
  published_at: string
}

interface GitHubRelease {
  tag_name: string
  body: string | null
  published_at: string
  draft: boolean
  prerelease: boolean
}

const GITHUB_RELEASES_URL = 'https://api.github.com/repos/denandy83/ToDoozy/releases'

let supabase: SupabaseClient | null = null
let settingsRepo: SettingsRepository | null = null

function getClient(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL ?? ''
    const key = process.env.SUPABASE_ANON_KEY ?? ''
    if (!url || !key) throw new Error('Supabase credentials not configured')
    supabase = createClient(url, key)
  }
  return supabase
}

function getSettings(): SettingsRepository {
  if (!settingsRepo) throw new Error('ReleaseNotesService not initialized')
  return settingsRepo
}

/** Initialize the service with the local database for caching */
export function initReleaseNotes(db: DatabaseSync): void {
  settingsRepo = new SettingsRepository(db)
}

/**
 * Fetch published releases from GitHub, concatenate into versioned markdown,
 * and cache in local whats_new setting. Non-blocking — errors are logged, not thrown.
 */
export async function syncReleaseNotes(): Promise<void> {
  try {
    const response = await net.fetch(GITHUB_RELEASES_URL, {
      headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'ToDoozy-App' }
    })

    if (!response.ok) {
      console.error('Failed to fetch GitHub releases:', response.status, response.statusText)
      return
    }

    const releases = (await response.json()) as GitHubRelease[]

    const published = releases.filter((r) => !r.draft && !r.prerelease)
    if (published.length === 0) return

    const markdown = published
      .map((r) => {
        // Strip ## headers from body to avoid collision with version headers
        const body = (r.body ?? '')
          .split('\n')
          .filter((line) => !line.trim().startsWith('## '))
          .map((line) => (line.startsWith('* ') ? `- ${line.slice(2)}` : line))
          .join('\n')
          .trim()
        return `## ${r.tag_name}\n${body || 'No release notes.'}`
      })
      .join('\n\n')

    getSettings().set('', 'whats_new', markdown)
  } catch (err) {
    console.error('Release notes sync error:', err instanceof Error ? err.message : err)
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
    // Normalize: try with and without 'v' prefix
    const versions = version.startsWith('v') ? [version, version.slice(1)] : [`v${version}`, version]

    for (const v of versions) {
      const { data, error } = await client
        .from('release_notes')
        .select('content')
        .eq('version', v)
        .single()

      if (!error && data) return (data as ReleaseNoteRow).content
    }

    return null
  } catch (err) {
    console.error('Failed to fetch version notes:', err instanceof Error ? err.message : err)
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
      .from('release_notes')
      .upsert({ version, content, published_at: new Date().toISOString() }, { onConflict: 'version' })

    if (error) {
      console.error('Failed to upsert release notes:', error.message)
      return false
    }

    return true
  } catch (err) {
    console.error('Release notes upsert error:', err instanceof Error ? err.message : err)
    return false
  }
}
