import type { SyncTableName } from '../../../preload/index.d'
import type {
  Task,
  Status,
  Project,
  Label,
  Theme,
  ThemeConfig,
  Setting,
  SavedView,
  ProjectArea,
  ProjectTemplate
} from '../../../shared/types'
import { getSupabase } from '../lib/supabase'
import { placeholderEmail } from '../../../shared/placeholderUser'

export type { SyncTableName }

/**
 * Where the table's rows are scoped.
 * - `user`: rows belong to a single user (labels, themes, settings, saved_views, project_areas)
 * - `project`: rows live inside a project (tasks, statuses, task_labels, project_labels)
 * - `owner`: a user owns the row but not in a per-user table (projects)
 */
export type SyncScope = 'user' | 'project' | 'owner'

/**
 * Per-table descriptor for the uniform sync layer.
 *
 * Tasks 4-11 fill in one descriptor per table. Task 12 implements
 * `reconcileTable<L,R>(descriptor, scopeId)` once and the descriptors plug in.
 *
 * `TLocal` is the SQLite shape, `TRemote` is the Supabase shape — they often
 * diverge in column names (e.g. `themes.config` vs Supabase `user_themes.bg/fg/...`)
 * and the descriptor's `toRemote`/`fromRemote` bridge that gap.
 *
 * `task_labels` and `project_labels` are special: composite-PK join tables
 * with no `updated_at` — they reconcile via key-set diff (handled in task 12,
 * not via this descriptor's high-water flow).
 */
export interface SyncTableDescriptor<TLocal, TRemote> {
  name: SyncTableName
  /** Supabase table name (e.g. `user_labels` for local `labels`) */
  remoteName: string
  scope: SyncScope
  /** The column name on the LOCAL table that holds the scope id */
  localScopeColumn: string
  /** The column name on the REMOTE table that holds the scope id */
  remoteScopeColumn: string

  // Local-side ops (renderer calls window.api.* under the hood)
  localList(scopeId: string, includeTombstones: boolean): Promise<TLocal[]>
  localGetById(id: string): Promise<TLocal | null>
  /** Upsert with the remote's `updated_at` and `deleted_at` preserved (no NOW() bump). */
  localApplyRemote(remote: TRemote): Promise<void>
  /** Returns max(updated_at) on local active rows, or null if empty. */
  localMaxUpdatedAt(scopeId: string): Promise<string | null>

  // Remote-side ops (Supabase client calls)
  remoteList(scopeId: string, sinceUpdatedAt: string | null, includeTombstones: boolean): Promise<TRemote[]>
  remoteUpsert(local: TLocal): Promise<void>
  remoteSoftDelete(id: string, deletedAt: string): Promise<void>
  remoteMaxUpdatedAt(scopeId: string): Promise<string | null>

  // Conversion (local <-> remote shapes)
  toRemote(local: TLocal): TRemote
  fromRemote(remote: TRemote): TLocal

  /**
   * Optional: run before applying a remote row locally. Used by `tasks` to
   * seed missing user FK targets (owner_id, assigned_to) before applyRemote.
   * Errors are caught by the engine and logged.
   */
  preparePullRow?(remote: TRemote): Promise<void>
  /**
   * Optional: re-order remote rows before applying. Used by `tasks` to apply
   * parents before children so the parent_id FK holds.
   */
  pullOrder?(remotes: TRemote[]): TRemote[]
}

/**
 * Per-table reconcile statistics. Returned by `reconcileTable` so callers can
 * aggregate totals across tables.
 */
export interface ReconcileStats {
  pushed: number
  pulled: number
  inSync: number
  failed: number
  /** True when the high-water short-circuit fired and the diff was skipped. */
  skipped: boolean
}

/**
 * Registry filled in by tasks 4-11. Reads as `null` until each per-table slice
 * lands its descriptor — that's intentional so partial progress doesn't break
 * the reconcile loop (task 12 skips null entries).
 */
export const SYNC_TABLES: Partial<Record<SyncTableName, SyncTableDescriptor<unknown, unknown>>> = {}

// ── tasks ────────────────────────────────────────────────────────────────
// Tasks live in the SAME shape locally and remotely (no column rename).
// `Task` is the unified type — toRemote/fromRemote are identity except for
// stripping any pure-local junk (none today).

const tasksDescriptor: SyncTableDescriptor<Task, Task> = {
  name: 'tasks',
  remoteName: 'tasks',
  scope: 'project',
  localScopeColumn: 'project_id',
  remoteScopeColumn: 'project_id',

  async localList(projectId, includeTombstones) {
    return window.api.tasks.findAllByProject(projectId, { includeTombstones })
  },

  async localGetById(id) {
    return window.api.tasks.findById(id)
  },

  async localApplyRemote(remote) {
    await window.api.tasks.applyRemote(remote)
  },

  async localMaxUpdatedAt(projectId) {
    return window.api.tasks.findMaxUpdatedAt(projectId)
  },

  async remoteList(projectId, sinceUpdatedAt, includeTombstones) {
    const supabase = await getSupabase()
    let query = supabase.from('tasks').select('*').eq('project_id', projectId)
    if (sinceUpdatedAt) query = query.gt('updated_at', sinceUpdatedAt)
    if (!includeTombstones) query = query.is('deleted_at', null)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Task[]
  },

  async remoteUpsert(local) {
    const supabase = await getSupabase()
    const { error } = await supabase.from('tasks').upsert(tasksDescriptor.toRemote(local))
    if (error) throw error
  },

  async remoteSoftDelete(id, deletedAt) {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('tasks')
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq('id', id)
    if (error) throw error
  },

  async remoteMaxUpdatedAt(projectId) {
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('tasks')
      .select('updated_at')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data?.updated_at as string | undefined) ?? null
  },

  toRemote(local) {
    return local
  },

  fromRemote(remote) {
    return remote
  },

  async preparePullRow(remote) {
    // Seed missing user FK targets so tasks.applyRemote doesn't trip the FK.
    const ownerId = remote.owner_id
    if (ownerId) {
      const localOwner = await window.api.users.findById(ownerId)
      if (!localOwner) {
        await window.api.users
          .create({
            id: ownerId,
            email: placeholderEmail(ownerId),
            display_name: null,
            avatar_url: null
          })
          .catch(() => {})
      }
    }
    const assignedTo = remote.assigned_to
    if (assignedTo) {
      const localAssignee = await window.api.users.findById(assignedTo)
      if (!localAssignee) {
        await window.api.users
          .create({
            id: assignedTo,
            email: placeholderEmail(assignedTo),
            display_name: null,
            avatar_url: null
          })
          .catch(() => {})
      }
    }
  },

  pullOrder(remotes) {
    // Apply parents before children so parent_id FK is satisfied.
    const parents = remotes.filter((t) => !t.parent_id)
    const children = remotes.filter((t) => t.parent_id)
    return [...parents, ...children]
  }
}

SYNC_TABLES.tasks = tasksDescriptor as SyncTableDescriptor<unknown, unknown>

// ── statuses ─────────────────────────────────────────────────────────────
// Statuses share the same shape locally and remotely (no column rename).
// Soft-delete via `deleted_at`; hard-DELETE reserved for the 30-day purge job.

const statusDescriptor: SyncTableDescriptor<Status, Status> = {
  name: 'statuses',
  remoteName: 'statuses',
  scope: 'project',
  localScopeColumn: 'project_id',
  remoteScopeColumn: 'project_id',

  async localList(projectId, includeTombstones) {
    return window.api.statuses.findAllByProject(projectId, { includeTombstones })
  },

  async localGetById(id) {
    return window.api.statuses.findById(id)
  },

  async localApplyRemote(remote) {
    await window.api.statuses.applyRemote(remote)
  },

  async localMaxUpdatedAt(projectId) {
    return window.api.statuses.findMaxUpdatedAt(projectId)
  },

  async remoteList(projectId, sinceUpdatedAt, includeTombstones) {
    const supabase = await getSupabase()
    let query = supabase.from('statuses').select('*').eq('project_id', projectId)
    if (sinceUpdatedAt) query = query.gt('updated_at', sinceUpdatedAt)
    if (!includeTombstones) query = query.is('deleted_at', null)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Status[]
  },

  async remoteUpsert(local) {
    const supabase = await getSupabase()
    const { error } = await supabase.from('statuses').upsert(statusDescriptor.toRemote(local))
    if (error) throw error
  },

  async remoteSoftDelete(id, deletedAt) {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('statuses')
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq('id', id)
    if (error) throw error
  },

  async remoteMaxUpdatedAt(projectId) {
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('statuses')
      .select('updated_at')
      .eq('project_id', projectId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data?.updated_at as string | undefined) ?? null
  },

  toRemote(local) {
    return local
  },

  fromRemote(remote) {
    return remote
  }
}

SYNC_TABLES.statuses = statusDescriptor as SyncTableDescriptor<unknown, unknown>

// ── projects ─────────────────────────────────────────────────────────────
// Projects are scoped by `owner_id` (the only user who has read+write+delete
// authority on the row itself). Membership rows are a separate concern and not
// part of this descriptor. Same shape locally and remotely.

const projectsDescriptor: SyncTableDescriptor<Project, Project> = {
  name: 'projects',
  remoteName: 'projects',
  scope: 'owner',
  localScopeColumn: 'owner_id',
  remoteScopeColumn: 'owner_id',

  async localList(ownerId, includeTombstones) {
    return window.api.projects.findAllByOwner(ownerId, { includeTombstones })
  },

  async localGetById(id) {
    return window.api.projects.findById(id)
  },

  async localApplyRemote(remote) {
    await window.api.projects.applyRemote(remote)
  },

  async localMaxUpdatedAt(ownerId) {
    return window.api.projects.findMaxUpdatedAt(ownerId)
  },

  async remoteList(ownerId, sinceUpdatedAt, includeTombstones) {
    const supabase = await getSupabase()
    let query = supabase.from('projects').select('*').eq('owner_id', ownerId)
    if (sinceUpdatedAt) query = query.gt('updated_at', sinceUpdatedAt)
    if (!includeTombstones) query = query.is('deleted_at', null)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Project[]
  },

  async remoteUpsert(local) {
    const supabase = await getSupabase()
    const { error } = await supabase.from('projects').upsert(projectsDescriptor.toRemote(local))
    if (error) {
      // 42501 = RLS denial. Happens when local has a project whose remote
      // counterpart was renamed/owner-transferred — INSERT with our owner_id
      // hits the existing row and the UPDATE policy refuses because we no
      // longer own it remotely. Reconcile will pick it up correctly on the
      // next pull; surfacing it as a hard error just adds noise.
      const code = (error as { code?: string }).code
      if (code === '42501') return
      throw error
    }
  },

  async remoteSoftDelete(id, deletedAt) {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('projects')
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq('id', id)
    if (error) {
      const code = (error as { code?: string }).code
      if (code === '42501') return
      throw error
    }
  },

  async remoteMaxUpdatedAt(ownerId) {
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('projects')
      .select('updated_at')
      .eq('owner_id', ownerId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data?.updated_at as string | undefined) ?? null
  },

  toRemote(local) {
    // `is_shared` is a local-derived cache of "do we have project_members
    // beyond the owner?" — `project_members` is the source of truth and it
    // syncs on its own, so we deliberately don't ship the cache. Every
    // other field is part of the synced project state.
    const { is_shared, ...remote } = local
    void is_shared
    return remote as Project
  },

  fromRemote(remote) {
    // Remote rows don't carry `is_shared` — ProjectRepository.applyRemote
    // preserves the local-computed value (or defaults to 0 for new rows).
    return remote
  }
}

SYNC_TABLES.projects = projectsDescriptor as SyncTableDescriptor<unknown, unknown>

// ── labels ───────────────────────────────────────────────────────────────
// Labels are user-scoped (`user_labels` on Supabase, `labels` locally — different
// table names but same shape). Each label belongs to a single user; the project
// linkage lives in `project_labels` (local-only) and `task_labels` (synced).

/**
 * Resolve a (user_id, lower(name)) collision against Supabase by fetching the
 * canonical remote label by name and remapping local junction tables onto its
 * UUID. Returns true on success. Used by both the singular pushLabel path and
 * the bulk reconcile path.
 */
async function consolidateLocalLabel(
  localId: string,
  userId: string,
  name: string
): Promise<boolean> {
  try {
    const supabase = await getSupabase()
    // Fetch the canonical remote row in full — we need its data to insert
    // into local labels before the FK-bound junction remap can run.
    const { data: remote, error: lookupErr } = await supabase
      .from('user_labels')
      .select('*')
      .eq('user_id', userId)
      .ilike('name', name)
      .limit(1)
      .maybeSingle()
    if (lookupErr || !remote) return false
    if ((remote.id as string) === localId) return false
    // If the canonical remote is tombstoned, revive it before remapping —
    // otherwise our local junctions would point at a deleted row.
    if (remote.deleted_at) {
      const { error: reviveErr } = await supabase
        .from('user_labels')
        .update({ deleted_at: null, updated_at: new Date().toISOString() })
        .eq('id', remote.id as string)
      if (reviveErr) return false
      remote.deleted_at = null
    }
    // Plain-object clone — supabase-js results can carry non-cloneable
    // handlers/getters that confuse Electron's structured clone or leave
    // properties as undefined on the receiving side. JSON-roundtrip
    // guarantees a vanilla object with primitive values.
    const r = remote as Record<string, unknown>
    const canonicalLabel: Label = {
      id: String(r.id),
      user_id: r.user_id == null ? null : String(r.user_id),
      name: String(r.name ?? ''),
      color: String(r.color ?? '#888888'),
      order_index: Number(r.order_index ?? 0),
      created_at: String(r.created_at ?? new Date().toISOString()),
      updated_at: String(r.updated_at ?? new Date().toISOString()),
      deleted_at: r.deleted_at == null ? null : String(r.deleted_at)
    }
    const result = await window.api.labels.consolidate(localId, canonicalLabel)
    console.info(`[sync] Consolidated label "${name}" ${localId} → ${canonicalLabel.id} (taskRemaps=${result.taskRemaps} projectRemaps=${result.projectRemaps})`)
    return true
  } catch (err) {
    console.warn('[sync] consolidateLocalLabel threw:', err)
    return false
  }
}

const labelsDescriptor: SyncTableDescriptor<Label, Label> = {
  name: 'labels',
  remoteName: 'user_labels',
  scope: 'user',
  localScopeColumn: 'user_id',
  remoteScopeColumn: 'user_id',

  async localList(userId, includeTombstones) {
    return window.api.labels.findAllByUser(userId, { includeTombstones })
  },

  async localGetById(id) {
    return window.api.labels.findById(id)
  },

  async localApplyRemote(remote) {
    await window.api.labels.applyRemote(remote)
  },

  async localMaxUpdatedAt(userId) {
    return window.api.labels.findMaxUpdatedAt(userId)
  },

  async remoteList(userId, sinceUpdatedAt, includeTombstones) {
    const supabase = await getSupabase()
    let query = supabase.from('user_labels').select('*').eq('user_id', userId)
    if (sinceUpdatedAt) query = query.gt('updated_at', sinceUpdatedAt)
    if (!includeTombstones) query = query.is('deleted_at', null)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Label[]
  },

  async remoteUpsert(local) {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_labels').upsert(labelsDescriptor.toRemote(local))
    if (error) {
      // Detect (user_id, lower(name)) collision with a same-named label
      // (typically MCP-created with a new UUID). Match permissively across
      // the fields supabase-js exposes for Postgres 23505.
      const e = error as { code?: string; message?: string; details?: string }
      const code = e.code ?? ''
      const msg = e.message ?? ''
      const details = e.details ?? ''
      const looksLikeUniqueViolation =
        code === '23505' ||
        msg.includes('user_name_unique') ||
        msg.includes('duplicate key') ||
        details.includes('user_name_unique') ||
        details.includes('already exists')
      if (looksLikeUniqueViolation && local.user_id) {
        const consolidated = await consolidateLocalLabel(local.id, local.user_id, local.name)
        if (consolidated) return
      }
      throw error
    }
  },

  async remoteSoftDelete(id, deletedAt) {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('user_labels')
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq('id', id)
    if (error) throw error
  },

  async remoteMaxUpdatedAt(userId) {
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('user_labels')
      .select('updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data?.updated_at as string | undefined) ?? null
  },

  toRemote(local) {
    return local
  },

  fromRemote(remote) {
    return remote
  }
}

SYNC_TABLES.labels = labelsDescriptor as SyncTableDescriptor<unknown, unknown>

// ── themes ───────────────────────────────────────────────────────────────
// Themes are user-scoped under `owner_id` locally / `user_id` on Supabase
// (table: `user_themes`). The shapes diverge: locally we keep one `config`
// JSON blob, Supabase has discrete columns (bg, fg, fg_secondary, ...).
// `toRemote`/`fromRemote` bridge the two.
//
// `is_builtin` themes never round-trip — they're seeded locally per release
// and excluded from `findAllByOwner`. The remote table has no `is_builtin`.

interface RemoteTheme {
  id: string
  user_id: string
  name: string
  mode: string
  bg: string
  fg: string
  fg_secondary: string | null
  fg_muted: string | null
  muted: string
  accent: string
  accent_fg: string | null
  surface: string
  border: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

function deriveSidebar(bg: string): string {
  const num = parseInt(bg.replace('#', ''), 16)
  const brightness = ((num >> 16) & 0xff) + ((num >> 8) & 0xff) + (num & 0xff)
  const amount = brightness < 384 ? 12 : -8
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + amount))
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + amount))
  const b = Math.min(255, Math.max(0, (num & 0xff) + amount))
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function parseThemeConfig(json: string): ThemeConfig {
  try {
    const c = JSON.parse(json) as Partial<ThemeConfig>
    const bg = c.bg ?? '#000000'
    return { ...c, bg, sidebar: c.sidebar ?? deriveSidebar(bg) } as ThemeConfig
  } catch {
    // Defensive — shouldn't happen with our writers, but keep the descriptor
    // resilient against a corrupted local row so sync doesn't crash.
    return {
      bg: '#000000',
      fg: '#ffffff',
      fgSecondary: '#cccccc',
      fgMuted: '#888888',
      muted: '#222222',
      accent: '#ff6600',
      accentFg: '#ffffff',
      border: '#333333',
      sidebar: '#0c0c0c'
    }
  }
}

const themesDescriptor: SyncTableDescriptor<Theme, RemoteTheme> = {
  name: 'themes',
  remoteName: 'user_themes',
  scope: 'user',
  localScopeColumn: 'owner_id',
  remoteScopeColumn: 'user_id',

  async localList(ownerId, includeTombstones) {
    return window.api.themes.findAllByOwner(ownerId, { includeTombstones })
  },

  async localGetById(id) {
    return window.api.themes.findById(id)
  },

  async localApplyRemote(remote) {
    await window.api.themes.applyRemote(themesDescriptor.fromRemote(remote))
  },

  async localMaxUpdatedAt(ownerId) {
    return window.api.themes.findMaxUpdatedAt(ownerId)
  },

  async remoteList(userId, sinceUpdatedAt, includeTombstones) {
    const supabase = await getSupabase()
    let query = supabase.from('user_themes').select('*').eq('user_id', userId)
    if (sinceUpdatedAt) query = query.gt('updated_at', sinceUpdatedAt)
    if (!includeTombstones) query = query.is('deleted_at', null)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as RemoteTheme[]
  },

  async remoteUpsert(local) {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_themes').upsert(themesDescriptor.toRemote(local))
    if (error) throw error
  },

  async remoteSoftDelete(id, deletedAt) {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('user_themes')
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq('id', id)
    if (error) throw error
  },

  async remoteMaxUpdatedAt(userId) {
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('user_themes')
      .select('updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data?.updated_at as string | undefined) ?? null
  },

  toRemote(local) {
    const cfg = parseThemeConfig(local.config)
    return {
      id: local.id,
      user_id: local.owner_id ?? '',
      name: local.name,
      mode: local.mode,
      bg: cfg.bg,
      fg: cfg.fg,
      fg_secondary: cfg.fgSecondary,
      fg_muted: cfg.fgMuted,
      muted: cfg.muted,
      accent: cfg.accent,
      accent_fg: cfg.accentFg,
      // Legacy NOT NULL column on the remote schema — keep in sync with fgSecondary.
      surface: cfg.fgSecondary,
      border: cfg.border,
      created_at: local.created_at,
      updated_at: local.updated_at,
      deleted_at: local.deleted_at ?? null
    }
  },

  fromRemote(remote) {
    const bg = remote.bg
    const config: ThemeConfig = {
      bg,
      fg: remote.fg,
      fgSecondary: remote.fg_secondary ?? remote.surface,
      fgMuted: remote.fg_muted ?? remote.fg,
      muted: remote.muted,
      accent: remote.accent,
      accentFg: remote.accent_fg ?? remote.fg,
      border: remote.border,
      sidebar: deriveSidebar(bg)
    }
    return {
      id: remote.id,
      name: remote.name,
      mode: remote.mode,
      config: JSON.stringify(config),
      is_builtin: 0,
      owner_id: remote.user_id,
      created_at: remote.created_at ?? remote.updated_at,
      updated_at: remote.updated_at,
      deleted_at: remote.deleted_at ?? null
    }
  }
}

SYNC_TABLES.themes = themesDescriptor as SyncTableDescriptor<unknown, unknown>

// ── settings ─────────────────────────────────────────────────────────────
// Settings live in the local `settings` table (composite PK user_id+key) and
// the remote `user_settings` table (text PK = `${user_id}:${key}`). The id
// is reconstructed in `toRemote` and split in `fromRemote`. Global defaults
// (user_id = '') are seeded locally per release and excluded from sync.

interface RemoteSetting {
  id: string
  user_id: string
  key: string
  value: string | null
  updated_at: string
  deleted_at: string | null
}

const settingsDescriptor: SyncTableDescriptor<Setting, RemoteSetting> = {
  name: 'settings',
  remoteName: 'user_settings',
  scope: 'user',
  localScopeColumn: 'user_id',
  remoteScopeColumn: 'user_id',

  async localList(userId, includeTombstones) {
    return window.api.settings.findAllByUser(userId, { includeTombstones })
  },

  async localGetById() {
    // Settings have a composite PK; the generic reconcile loop falls back to
    // localList rather than per-id lookups.
    return null
  },

  async localApplyRemote(remote) {
    await window.api.settings.applyRemote(settingsDescriptor.fromRemote(remote))
  },

  async localMaxUpdatedAt(userId) {
    return window.api.settings.findMaxUpdatedAt(userId)
  },

  async remoteList(userId, sinceUpdatedAt, includeTombstones) {
    const supabase = await getSupabase()
    let query = supabase.from('user_settings').select('*').eq('user_id', userId)
    if (sinceUpdatedAt) query = query.gt('updated_at', sinceUpdatedAt)
    if (!includeTombstones) query = query.is('deleted_at', null)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as RemoteSetting[]
  },

  async remoteUpsert(local) {
    const supabase = await getSupabase()
    const { error } = await supabase.from('user_settings').upsert(settingsDescriptor.toRemote(local))
    if (error) throw error
  },

  async remoteSoftDelete(id, deletedAt) {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('user_settings')
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq('id', id)
    if (error) throw error
  },

  async remoteMaxUpdatedAt(userId) {
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('user_settings')
      .select('updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data?.updated_at as string | undefined) ?? null
  },

  toRemote(local) {
    return {
      id: `${local.user_id}:${local.key}`,
      user_id: local.user_id,
      key: local.key,
      value: local.value,
      updated_at: local.updated_at,
      deleted_at: local.deleted_at ?? null
    }
  },

  fromRemote(remote) {
    return {
      user_id: remote.user_id,
      key: remote.key,
      value: remote.value,
      updated_at: remote.updated_at,
      deleted_at: remote.deleted_at ?? null
    }
  }
}

SYNC_TABLES.settings = settingsDescriptor as SyncTableDescriptor<unknown, unknown>

// ----- saved_views ↔ user_saved_views -----

interface RemoteSavedView {
  id: string
  user_id: string
  project_id: string | null
  name: string
  color: string
  icon: string
  sidebar_order: number
  filter_config: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

const savedViewsDescriptor: SyncTableDescriptor<SavedView, RemoteSavedView> = {
  name: 'saved_views',
  remoteName: 'user_saved_views',
  scope: 'user',
  localScopeColumn: 'user_id',
  remoteScopeColumn: 'user_id',

  async localList(userId, includeTombstones) {
    return window.api.savedViews.findAllByUser(userId, { includeTombstones })
  },

  async localGetById(id) {
    const view = await window.api.savedViews.findById(id)
    return view ?? null
  },

  async localApplyRemote(remote) {
    await window.api.savedViews.applyRemote(savedViewsDescriptor.fromRemote(remote))
  },

  async localMaxUpdatedAt(userId) {
    return window.api.savedViews.findMaxUpdatedAt(userId)
  },

  async remoteList(userId, sinceUpdatedAt, includeTombstones) {
    const supabase = await getSupabase()
    let query = supabase.from('user_saved_views').select('*').eq('user_id', userId)
    if (sinceUpdatedAt) query = query.gt('updated_at', sinceUpdatedAt)
    if (!includeTombstones) query = query.is('deleted_at', null)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as RemoteSavedView[]
  },

  async remoteUpsert(local) {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('user_saved_views')
      .upsert(savedViewsDescriptor.toRemote(local))
    if (error) throw error
  },

  async remoteSoftDelete(id, deletedAt) {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('user_saved_views')
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq('id', id)
    if (error) throw error
  },

  async remoteMaxUpdatedAt(userId) {
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('user_saved_views')
      .select('updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data?.updated_at as string | undefined) ?? null
  },

  toRemote(local) {
    return {
      id: local.id,
      user_id: local.user_id,
      project_id: local.project_id,
      name: local.name,
      color: local.color,
      icon: local.icon,
      sidebar_order: local.sidebar_order,
      filter_config: local.filter_config,
      created_at: local.created_at,
      updated_at: local.updated_at,
      deleted_at: local.deleted_at ?? null
    }
  },

  fromRemote(remote) {
    return {
      id: remote.id,
      user_id: remote.user_id,
      project_id: remote.project_id,
      name: remote.name,
      color: remote.color,
      icon: remote.icon,
      sidebar_order: remote.sidebar_order,
      filter_config: remote.filter_config,
      created_at: remote.created_at,
      updated_at: remote.updated_at,
      deleted_at: remote.deleted_at ?? null
    }
  }
}

SYNC_TABLES['saved_views'] = savedViewsDescriptor as SyncTableDescriptor<unknown, unknown>

// ----- project_areas ↔ user_project_areas -----

interface RemoteProjectArea {
  id: string
  user_id: string
  name: string
  color: string
  icon: string
  sidebar_order: number
  is_collapsed: number
  created_at: string
  updated_at: string
  deleted_at: string | null
}

const projectAreasDescriptor: SyncTableDescriptor<ProjectArea, RemoteProjectArea> = {
  name: 'project_areas',
  remoteName: 'user_project_areas',
  scope: 'user',
  localScopeColumn: 'user_id',
  remoteScopeColumn: 'user_id',

  async localList(userId, includeTombstones) {
    return window.api.projectAreas.findAllByUser(userId, { includeTombstones })
  },

  async localGetById(id) {
    // Find via list — there's no findById exposed for areas. The reconcile loop
    // primarily uses localList, so this is a thin best-effort shim.
    const row = (await window.api.projectAreas.findAllByUser('', { includeTombstones: true })).find(
      (a) => a.id === id
    )
    return row ?? null
  },

  async localApplyRemote(remote) {
    await window.api.projectAreas.applyRemote(projectAreasDescriptor.fromRemote(remote))
  },

  async localMaxUpdatedAt(userId) {
    return window.api.projectAreas.findMaxUpdatedAt(userId)
  },

  async remoteList(userId, sinceUpdatedAt, includeTombstones) {
    const supabase = await getSupabase()
    let query = supabase.from('user_project_areas').select('*').eq('user_id', userId)
    if (sinceUpdatedAt) query = query.gt('updated_at', sinceUpdatedAt)
    if (!includeTombstones) query = query.is('deleted_at', null)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as RemoteProjectArea[]
  },

  async remoteUpsert(local) {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('user_project_areas')
      .upsert(projectAreasDescriptor.toRemote(local))
    if (error) throw error
  },

  async remoteSoftDelete(id, deletedAt) {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('user_project_areas')
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq('id', id)
    if (error) throw error
  },

  async remoteMaxUpdatedAt(userId) {
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('user_project_areas')
      .select('updated_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data?.updated_at as string | undefined) ?? null
  },

  toRemote(local) {
    return {
      id: local.id,
      user_id: local.user_id,
      name: local.name,
      color: local.color,
      icon: local.icon,
      sidebar_order: local.sidebar_order,
      is_collapsed: local.is_collapsed,
      created_at: local.created_at,
      updated_at: local.updated_at,
      deleted_at: local.deleted_at ?? null
    }
  },

  fromRemote(remote) {
    return {
      id: remote.id,
      user_id: remote.user_id,
      name: remote.name,
      color: remote.color,
      icon: remote.icon,
      sidebar_order: remote.sidebar_order,
      is_collapsed: remote.is_collapsed,
      created_at: remote.created_at,
      updated_at: remote.updated_at,
      deleted_at: remote.deleted_at ?? null
    }
  }
}

SYNC_TABLES['project_areas'] = projectAreasDescriptor as SyncTableDescriptor<unknown, unknown>

// ── project_templates ────────────────────────────────────────────────────
// Same shape locally and remotely. Owner-scoped — every template belongs to
// exactly one user. v1.5.0 left this table local-only; v1.5.1 promotes it.

const projectTemplatesDescriptor: SyncTableDescriptor<ProjectTemplate, ProjectTemplate> = {
  name: 'project_templates',
  remoteName: 'project_templates',
  scope: 'owner',
  localScopeColumn: 'owner_id',
  remoteScopeColumn: 'owner_id',

  async localList(ownerId, includeTombstones) {
    return window.api.projectTemplates.findAllByOwner(ownerId, { includeTombstones })
  },

  async localGetById(id) {
    return (await window.api.projectTemplates.findById(id)) ?? null
  },

  async localApplyRemote(remote) {
    await window.api.projectTemplates.applyRemote(remote)
  },

  async localMaxUpdatedAt(ownerId) {
    return window.api.projectTemplates.findMaxUpdatedAt(ownerId)
  },

  async remoteList(ownerId, sinceUpdatedAt, includeTombstones) {
    const supabase = await getSupabase()
    let query = supabase.from('project_templates').select('*').eq('owner_id', ownerId)
    if (sinceUpdatedAt) query = query.gt('updated_at', sinceUpdatedAt)
    if (!includeTombstones) query = query.is('deleted_at', null)
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as ProjectTemplate[]
  },

  async remoteUpsert(local) {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('project_templates')
      .upsert(projectTemplatesDescriptor.toRemote(local))
    if (error) throw error
  },

  async remoteSoftDelete(id, deletedAt) {
    const supabase = await getSupabase()
    const { error } = await supabase
      .from('project_templates')
      .update({ deleted_at: deletedAt, updated_at: deletedAt })
      .eq('id', id)
    if (error) throw error
  },

  async remoteMaxUpdatedAt(ownerId) {
    const supabase = await getSupabase()
    const { data, error } = await supabase
      .from('project_templates')
      .select('updated_at')
      .eq('owner_id', ownerId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw error
    return (data?.updated_at as string | undefined) ?? null
  },

  toRemote(local) {
    return local
  },

  fromRemote(remote) {
    return remote
  }
}

SYNC_TABLES['project_templates'] = projectTemplatesDescriptor as SyncTableDescriptor<
  unknown,
  unknown
>

// ── Generic reconcile engine ─────────────────────────────────────────────

/**
 * Last-Writer-Wins reconcile of a single table within a single scope (one
 * project for project-scoped tables; the user for user-scoped; etc.).
 *
 * Pulls all rows including tombstones from both sides, then for each id in
 * the union:
 *   - both sides exist, same updated_at → in sync
 *   - local newer → push (remoteUpsert; the row's own deleted_at carries through)
 *   - remote newer → applyRemote (local upsert preserves remote timestamps + deleted_at)
 *   - local-only → push
 *   - remote-only → applyRemote
 *
 * Failures on individual rows are caught + counted; the loop keeps going so a
 * single bad row doesn't abort the whole table.
 *
 * High-water short-circuit: before listing both sides we ask each side for
 * `max(updated_at)` (a tiny query). If both maxes are <= the stored high-water
 * for `(userId, scopeId, table)` we skip the diff entirely and return
 * `{ skipped: true }`. The high-water is advanced after a clean pass — if any
 * row failed we leave it alone so the next pass retries.
 *
 * `userId` keys the sync_meta row; `scopeId` distinguishes project-scoped
 * tables across projects (so reconciling project A doesn't shadow project B).
 * For user-scoped tables `scopeId === userId`.
 */
export async function reconcileTable<TLocal, TRemote extends { id: string; updated_at: string }>(
  desc: SyncTableDescriptor<TLocal, TRemote>,
  scopeId: string,
  userId: string
): Promise<ReconcileStats> {
  const stats: ReconcileStats = {
    pushed: 0,
    pulled: 0,
    inSync: 0,
    failed: 0,
    skipped: false
  }

  // Step 1 — high-water short-circuit. Tiny max() queries on both sides; if
  // neither max exceeds the stored high-water, we know nothing has changed
  // since the last successful reconcile and we can skip the heavy listing.
  const [localMax, remoteMax, storedHigh] = await Promise.all([
    desc.localMaxUpdatedAt(scopeId),
    desc.remoteMaxUpdatedAt(scopeId),
    window.api.syncMeta.getHighWater(userId, scopeId, desc.name)
  ])

  // ISO timestamps are NOT lexically equivalent across formats — local writes
  // use `…Z` form (new Date().toISOString()) while Postgres/PostgREST returns
  // `…+00:00`. ASCII-wise 'Z' (0x5A) > '+' (0x2B), so a string compare always
  // flags `…Z` as "newer", causing every reconcile to re-push every row.
  // Compare numerically via Date.parse to make format-equivalent timestamps
  // compare equal.
  const tsMs = (s: string | null | undefined): number => (s ? Date.parse(s) : NaN)

  if (storedHigh) {
    const highMs = tsMs(storedHigh)
    const localStale = !localMax || tsMs(localMax) <= highMs
    const remoteStale = !remoteMax || tsMs(remoteMax) <= highMs
    if (localStale && remoteStale) {
      stats.skipped = true
      // Touch last_reconciled_at so the UI/debug surface knows we ran.
      await window.api.syncMeta.setLastReconciledAt(
        userId,
        scopeId,
        desc.name,
        new Date().toISOString()
      )
      return stats
    }
  }

  // Step 2 — full diff.
  const [localRows, remoteRows] = await Promise.all([
    desc.localList(scopeId, true),
    desc.remoteList(scopeId, null, true)
  ])

  const localById = new Map<string, TLocal>()
  for (const row of localRows) {
    localById.set(desc.toRemote(row).id, row)
  }
  const remoteById = new Map<string, TRemote>()
  for (const row of remoteRows) {
    remoteById.set(row.id, row)
  }

  // Sort remote-only IDs by descriptor's pullOrder if provided (parents-first
  // for tasks).
  const remoteOnlyIds = [...remoteById.keys()].filter((id) => !localById.has(id))
  let remoteOnlyRows = remoteOnlyIds.map((id) => remoteById.get(id)!)
  if (desc.pullOrder) {
    remoteOnlyRows = desc.pullOrder(remoteOnlyRows)
  }

  // Local-only: push to remote
  for (const id of localById.keys()) {
    if (remoteById.has(id)) continue
    const local = localById.get(id)!
    try {
      await desc.remoteUpsert(local)
      stats.pushed++
    } catch {
      stats.failed++
    }
  }

  // Remote-only: pull
  for (const remote of remoteOnlyRows) {
    try {
      if (desc.preparePullRow) await desc.preparePullRow(remote).catch(() => {})
      await desc.localApplyRemote(remote)
      stats.pulled++
    } catch {
      stats.failed++
    }
  }

  // Both sides — LWW. Numeric compare via Date.parse so `…Z` and `…+00:00`
  // for the same instant are treated as equal (see tsMs comment above).
  for (const id of localById.keys()) {
    if (!remoteById.has(id)) continue
    const local = localById.get(id)!
    const remote = remoteById.get(id)!
    const localUpdatedAt = desc.toRemote(local).updated_at
    const localMs = tsMs(localUpdatedAt)
    const remoteMs = tsMs(remote.updated_at)
    if (localMs === remoteMs) {
      stats.inSync++
      continue
    }
    if (localMs > remoteMs) {
      try {
        await desc.remoteUpsert(local)
        stats.pushed++
      } catch {
        stats.failed++
      }
    } else {
      try {
        if (desc.preparePullRow) await desc.preparePullRow(remote).catch(() => {})
        await desc.localApplyRemote(remote)
        stats.pulled++
      } catch {
        stats.failed++
      }
    }
  }

  // Step 3 — advance the high-water only on a clean pass. With failures we
  // leave it alone so the next reconcile re-checks the same rows. Compare
  // numerically (see tsMs comment above) so format-equivalent timestamps
  // don't endlessly bounce the high-water back and forth.
  const nowIso = new Date().toISOString()
  if (stats.failed === 0) {
    const candidates = [localMax, remoteMax, storedHigh].filter(
      (v): v is string => typeof v === 'string'
    )
    if (candidates.length > 0) {
      const newHigh = candidates.reduce((a, b) => (tsMs(a) > tsMs(b) ? a : b))
      if (!storedHigh || tsMs(newHigh) > tsMs(storedHigh)) {
        await window.api.syncMeta.setHighWater(userId, scopeId, desc.name, newHigh)
      }
    }
  }
  await window.api.syncMeta.setLastReconciledAt(userId, scopeId, desc.name, nowIso)

  return stats
}

