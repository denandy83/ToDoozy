import type { SupabaseClient } from '@supabase/supabase-js'
let client: SupabaseClient
export function configureLegacyArchive(value: SupabaseClient): void { client = value }
async function getSupabase(): Promise<SupabaseClient> { return client }
async function hasLiveSession(_name: string, _id: string): Promise<boolean> { return true }
function logEvent(..._args: unknown[]): void { /* Logging is outside this isolated legacy protocol fixture. */ }
function markSynced(): void { /* No live sync state is used by this legacy protocol fixture. */ }
export async function pushProjectArchive(projectId: string, isArchived: number): Promise<void> {
  if (!(await hasLiveSession('pushProjectArchive', `id=${projectId}`))) return
  try {
    const supabase = await getSupabase()
    const now = new Date().toISOString()
    const { error: projErr } = await supabase
      .from('projects')
      .update({ is_archived: isArchived, updated_at: now })
      .eq('id', projectId)
    if (projErr) logEvent('error', 'sync', `pushProjectArchive (project) failed: ${projErr.message}`, `project=${projectId}`)
    const { error: taskErr } = await supabase
      .from('tasks')
      .update({ is_archived: isArchived, updated_at: now })
      .eq('project_id', projectId)
    if (taskErr) logEvent('error', 'sync', `pushProjectArchive (tasks) failed: ${taskErr.message}`, `project=${projectId}`)
    markSynced()
  } catch (err) {
    logEvent('error', 'sync', `pushProjectArchive threw: ${err instanceof Error ? err.message : String(err)}`, `project=${projectId}`)
  }
}
