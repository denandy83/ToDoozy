// Project ↔ label junction reads/writes for the MCP edge function.
//
// Extracted into its own dependency-free module so the contract can be
// unit-tested under vitest (Node) while still importing cleanly into the
// Deno edge function via a relative path. Intentionally NO `npm:`/Deno
// imports here — only a minimal structural client surface (same pattern
// as labelMutations.ts, story #88).
//
// Why this exists (story #93): `LabelRepo.addToProject` used to write the
// legacy `projects.label_data` JSON column, which the app stopped reading
// in v1.7.0 — the `project_labels` junction is the source of truth. A label
// created via MCP therefore never got a junction row and stayed invisible
// in the app (no chips, no FilterBar, no LabelPicker, no Settings entry).

import { readAll } from './query.ts'
/** Resolved shape of a PostgREST mutation — only the error channel matters here. */
export interface PostgrestMutationResult {
  error: { message: string } | null
}

/** Resolved shape of a PostgREST select. */
export interface PostgrestRowsResult {
  data: Array<Record<string, unknown>> | null
  error: { message: string } | null
}

/** A user_labels row as returned to MCP tool callers. */
export interface UserLabelRow {
  id: string
  name: string
  color: string
  [key: string]: unknown
}

/** A PostgREST filter builder: chainable and awaitable to a rows result. */
export interface ProjectLabelFilterBuilder extends PromiseLike<PostgrestRowsResult> {
  eq(column: string, value: string): ProjectLabelFilterBuilder
  is(column: string, value: null): ProjectLabelFilterBuilder
  in(column: string, values: string[]): ProjectLabelFilterBuilder
  order(column: string): ProjectLabelFilterBuilder
  limit(count: number): ProjectLabelFilterBuilder
  or(filter: string): ProjectLabelFilterBuilder
}

/** Minimal table builder surface needed for project-label reads/writes. */
export interface ProjectLabelTableBuilder {
  upsert(
    values: { project_id: string; label_id: string; created_at: string; deleted_at: null },
    options: { onConflict: string }
  ): PromiseLike<PostgrestMutationResult>
  select(columns: string): ProjectLabelFilterBuilder
}

/** Minimal Supabase client surface needed for project-label reads/writes. */
export interface ProjectLabelClient {
  from(table: string): ProjectLabelTableBuilder
}

/**
 * Upsert the (project_id, label_id) junction row, throwing if the write
 * errored. `deleted_at: null` revives a tombstoned link on re-add (matches
 * the app's TaskRepository.addLabel upsert semantics); `onConflict` makes
 * re-linking an existing label a no-op success. Mirrors the renderer's
 * pushProjectLabel row shape (PersonalSyncService.ts) including created_at,
 * which the remote table expects to be supplied by the writer.
 */
export async function upsertProjectLabel(
  client: ProjectLabelClient,
  projectId: string,
  labelId: string
): Promise<void> {
  const { error } = await client.from('project_labels').upsert(
    {
      project_id: projectId,
      label_id: labelId,
      created_at: new Date().toISOString(),
      deleted_at: null
    },
    { onConflict: 'project_id,label_id' }
  )
  if (error) throw new Error(`Failed to link label to project: ${error.message}`)
}

/**
 * Read a project's labels from the project_labels junction (live links
 * only — tombstoned rows excluded), resolving the label rows from
 * user_labels in one batched `.in()` query. No user_id filter: junction
 * rows in shared projects may reference labels owned by other members,
 * and RLS already scopes visibility.
 */
export async function fetchProjectLabels(
  client: ProjectLabelClient,
  projectId: string
): Promise<UserLabelRow[]> {
  let links: Array<Record<string, unknown>>
  try { ({ data: links } = await readAll(() => client
    .from('project_labels')
    .select('project_id, label_id')
    .eq('project_id', projectId)
    .is('deleted_at', null), ['project_id','label_id'])) }
  catch (error) { throw new Error(`Failed to read project labels: ${error instanceof Error ? error.message : String(error)}`) }
  if (!links || links.length === 0) return []
  const labelIds = links.map((l) => l.label_id as string)
  const labels: UserLabelRow[] = []
  for (let i=0; i<labelIds.length; i+=200) {
  try { const { data } = await readAll(() => client
    .from('user_labels')
    .select('*')
    .in('id', labelIds.slice(i,i+200)).is('deleted_at', null))
    labels.push(...data as UserLabelRow[]) }
  catch (error) { throw new Error(`Failed to read labels: ${error instanceof Error ? error.message : String(error)}`) }
  }
  return labels
}
