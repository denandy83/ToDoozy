/**
 * Last-write-wins timestamp comparison shared by every repository's
 * `applyRemote` sync guard.
 *
 * Why this exists: local SQLite stamps `updated_at` in the ISO `…Z` form
 * (`new Date().toISOString()`), while rows pulled back from Supabase via
 * PostgREST come through in the `…+00:00` form. Those two strings denote the
 * SAME instant but do NOT compare equal (or even consistently) lexically, so a
 * raw string compare can flag equal instants as drift or pick the wrong side
 * and skip a legitimately newer remote row — leaving the local copy stale.
 *
 * Comparing the numeric epoch produced by `Date.parse` is format-agnostic and
 * correct across both representations. This mirrors the comparison already used
 * in ProjectRepository / ProjectTemplateRepository so the idiom cannot drift
 * between repositories again.
 *
 * @param existingUpdatedAt the local row's `updated_at` (ISO 8601)
 * @param remoteUpdatedAt   the incoming remote row's `updated_at` (ISO 8601)
 * @returns true when the remote row is STRICTLY newer than the local row and
 *          should therefore be applied. Equal instants (in either format)
 *          return false — a deterministic skip that keeps the local row,
 *          matching ProjectRepository's `existing.updated_at >= remote.updated_at`
 *          semantics.
 */
export function isRemoteNewer(existingUpdatedAt: string, remoteUpdatedAt: string): boolean {
  return Date.parse(remoteUpdatedAt) > Date.parse(existingUpdatedAt)
}
