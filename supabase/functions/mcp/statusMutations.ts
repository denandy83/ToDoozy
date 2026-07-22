// Pure status-creation logic for the MCP edge function (story #113).
//
// Extracted into its own dependency-free module — NO `npm:`/Deno imports — so
// the defaults resolution, order_index computation, and row builder can be
// unit-tested under vitest (Node) while still importing cleanly into the Deno
// edge function via a relative path. Same pattern as labelMutations.ts /
// projectLabels.ts / scoping.ts / requestContext.ts.
//
// The edge function's Supabase client is the SERVICE_ROLE client (bypasses RLS
// — story #97), so authorization (project membership) is enforced separately in
// StatusRepo.create via ProjectScope; this module only shapes the row. It never
// trusts a caller-supplied project_id on its own.

export const DEFAULT_STATUS_COLOR = '#888888'
export const DEFAULT_STATUS_ICON = 'circle'

/** Loosely-typed input as it arrives from a tool call / repo caller. */
export interface StatusInsertInput {
  id: string
  project_id: string
  name: string
  color?: string | null
  icon?: string | null
  order_index?: number | null
  is_done?: number | boolean | null
  is_default?: number | boolean | null
}

/** The fully-defaulted row inserted into the Supabase `statuses` table. */
export interface StatusRecord {
  id: string
  project_id: string
  name: string
  color: string
  icon: string
  order_index: number
  is_done: number
  is_default: number
  created_at: string
  updated_at: string
}

/** Normalize a boolean/number/nullish flag to the DB's 0|1 integer form. */
export function toFlag(value: number | boolean | null | undefined): number {
  return value === true || value === 1 ? 1 : 0
}

/**
 * Compute the order_index for a new status so it sorts LAST in its project:
 * (max existing order_index) + 1, or 0 when the project has no statuses (or
 * none carry a numeric order_index). Pure — the caller passes the project's
 * current statuses (already access-scoped upstream).
 */
export function computeNextOrderIndex(
  existing: ReadonlyArray<{ order_index?: number | null }>
): number {
  let max = -1
  let found = false
  for (const row of existing) {
    if (typeof row.order_index === 'number' && Number.isFinite(row.order_index)) {
      if (row.order_index > max) max = row.order_index
      found = true
    }
  }
  return found ? max + 1 : 0
}

/**
 * Build the Supabase `statuses` insert row from a tool/repo input, applying all
 * defaults: color `#888888`, icon `circle`, order_index 0 (callers that want
 * "sort last" compute it via computeNextOrderIndex first), is_done/is_default
 * false. `now` is injected so the function stays pure and testable.
 */
export function buildStatusRecord(input: StatusInsertInput, now: string): StatusRecord {
  return {
    id: input.id,
    project_id: input.project_id,
    name: input.name,
    color: input.color ?? DEFAULT_STATUS_COLOR,
    icon: input.icon ?? DEFAULT_STATUS_ICON,
    order_index: input.order_index ?? 0,
    is_done: toFlag(input.is_done),
    is_default: toFlag(input.is_default),
    created_at: now,
    updated_at: now
  }
}
