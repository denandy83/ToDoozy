// Per-user authorization scoping for the MCP edge function (story #97).
//
// WHY THIS EXISTS — RLS BYPASS
// ----------------------------
// `authenticateRequest` builds a SUPABASE_SERVICE_ROLE_KEY client so it can read
// the `api_keys` table (which the anon/user role cannot). That same admin client
// is then handed to every repository — and the service role BYPASSES Row Level
// Security. Without RLS, a bare `.from('tasks').eq('id', id)` returns ANY user's
// row. Every repo method reachable from a tool call must therefore re-implement,
// by hand, the access rule RLS would have enforced:
//
//   • project entities (tasks, projects, statuses, project_labels, activity_log)
//     → caller must be a member of the row's project (`project_members`).
//   • user entities (user_labels, user_settings, user_saved_views,
//     user_project_areas) → caller must own the row (`user_id = ctx.userId`).
//
// This module owns the membership half: it loads the caller's set of member
// project IDs once per request and exposes pure predicates the repos use to
// gate every project-scoped query. It is intentionally dependency-free (no
// `npm:`/`Deno` imports) so the rules are unit-testable under vitest (Node),
// the same pattern as labelMutations.ts / projectLabels.ts / requestContext.ts.

/** Resolved shape of a PostgREST select — only the channels we read. */
export interface ScopeRowsResult {
  data: Array<Record<string, unknown>> | null
  error: { message: string } | null
}

/** A PostgREST filter builder: chainable via `.eq()` and awaitable to rows. */
export interface ScopeFilterBuilder extends PromiseLike<ScopeRowsResult> {
  eq(column: string, value: string): ScopeFilterBuilder
}

/** Minimal `supabase.from('project_members')` surface needed to load membership. */
export interface ScopeTableBuilder {
  select(columns: string): ScopeFilterBuilder
}

/** Minimal Supabase client surface needed to load membership. */
export interface ScopeClient {
  from(table: string): ScopeTableBuilder
}

/**
 * Load the set of project IDs the user is a member of, straight from
 * `project_members`. Throws on error rather than silently returning an empty
 * set — a swallowed error here would look identical to "member of nothing" and
 * mask an outage, but it must never look like "member of everything".
 */
export async function loadMemberProjectIds(
  client: ScopeClient,
  userId: string
): Promise<Set<string>> {
  const { data, error } = await client
    .from('project_members')
    .select('project_id')
    .eq('user_id', userId)
  if (error) throw new Error(`Failed to load project memberships: ${error.message}`)
  return new Set((data ?? []).map((row) => String(row.project_id)))
}

/**
 * Pure: is `projectId` accessible given the caller's member set? A null/empty
 * project id is never accessible (defaults deny). Used to gate every
 * project-scoped read and write.
 */
export function isProjectAccessible(
  memberProjectIds: ReadonlySet<string>,
  projectId: string | null | undefined
): boolean {
  return projectId != null && projectId !== '' && memberProjectIds.has(projectId)
}

/**
 * Pure: keep only rows whose `project_id` is accessible to the caller. Rows
 * with a missing/foreign project_id are dropped. Used to post-filter list
 * results that were fetched with the service-role client.
 */
export function filterAccessibleByProject<T extends { project_id?: string | null }>(
  rows: readonly T[],
  memberProjectIds: ReadonlySet<string>
): T[] {
  return rows.filter((row) => isProjectAccessible(memberProjectIds, row.project_id))
}

/**
 * A lazily-loaded, per-request cache of the caller's member project IDs.
 * Built once per request (repos share one instance) so membership is a single
 * `project_members` round-trip regardless of how many entities a tool touches.
 * Instances are per-request only — NEVER stored in module scope (see the
 * story #96 concurrency contract in requestContext.ts).
 */
export class ProjectScope {
  private cache: Set<string> | null = null

  constructor(
    private readonly client: ScopeClient,
    private readonly userId: string
  ) {}

  /** The caller's member project IDs (cached after the first call). */
  async ids(): Promise<Set<string>> {
    if (this.cache === null) {
      this.cache = await loadMemberProjectIds(this.client, this.userId)
    }
    return this.cache
  }

  /** The member project IDs as an array — for PostgREST `.in('project_id', …)`. */
  async idArray(): Promise<string[]> {
    return [...(await this.ids())]
  }

  /** True iff `projectId` is one the caller may access. */
  async isMember(projectId: string | null | undefined): Promise<boolean> {
    return isProjectAccessible(await this.ids(), projectId)
  }
}
