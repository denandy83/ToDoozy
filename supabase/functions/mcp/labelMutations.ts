// Task ↔ label junction mutations for the MCP edge function.
//
// Extracted into its own dependency-free module so the throw-on-failure
// contract can be unit-tested under vitest (Node) while still importing
// cleanly into the Deno edge function via a relative path. Intentionally
// NO `npm:`/Deno imports here — only a minimal structural client surface.
//
// Why this exists (story #88): a bare `upsert`/`delete` whose `{ error }`
// return is discarded lets an RLS rejection or FK violation silently drop
// the write while the tool still reports success. These helpers surface the
// error so the AI caller learns the action did not land.

/** Resolved shape of a PostgREST mutation — only the error channel matters here. */
export interface PostgrestMutationResult {
  error: { message: string } | null
}

/** A PostgREST filter builder: chainable via `.eq()` and awaitable to a result. */
export interface TaskLabelFilterBuilder extends PromiseLike<PostgrestMutationResult> {
  eq(column: string, value: string): TaskLabelFilterBuilder
}

/** Minimal `supabase.from('task_labels')` surface needed for label mutations. */
export interface TaskLabelTableBuilder {
  upsert(
    values: { task_id: string; label_id: string },
    options: { onConflict: string }
  ): PromiseLike<PostgrestMutationResult>
  delete(): TaskLabelFilterBuilder
}

/** Minimal Supabase client surface needed for label mutations. */
export interface TaskLabelMutationClient {
  from(table: string): TaskLabelTableBuilder
}

/**
 * Upsert the (task_id, label_id) junction row, throwing if the write errored.
 * `onConflict` makes re-assigning an existing label a no-op success.
 */
export async function upsertTaskLabel(
  client: TaskLabelMutationClient,
  taskId: string,
  labelId: string
): Promise<void> {
  const { error } = await client
    .from('task_labels')
    .upsert({ task_id: taskId, label_id: labelId }, { onConflict: 'task_id,label_id' })
  if (error) throw new Error(`Failed to assign label: ${error.message}`)
}

/**
 * Delete the (task_id, label_id) junction row, throwing if the delete errored.
 * Deleting a non-existent row is a no-op success (no error from PostgREST).
 */
export async function deleteTaskLabel(
  client: TaskLabelMutationClient,
  taskId: string,
  labelId: string
): Promise<void> {
  const { error } = await client
    .from('task_labels')
    .delete()
    .eq('task_id', taskId)
    .eq('label_id', labelId)
  if (error) throw new Error(`Failed to remove label: ${error.message}`)
}
