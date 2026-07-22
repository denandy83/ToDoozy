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

/**
 * Story #115 — normalize any timestamp to canonical millisecond UTC ISO with a
 * `Z` suffix (exactly what `new Date().toISOString()` produces for local
 * writes).
 *
 * Why this exists: local SQLite `updated_at` values written by the app are in
 * the `…Z` form, but rows pulled back from Supabase via PostgREST carry the
 * `…+00:00` form. Both denote the same instant, yet they do NOT sort the same
 * lexically — and the incremental-sync high-water queries (`WHERE updated_at > ?`
 * and `MAX(updated_at)`) compare `updated_at` as SQLite TEXT. A column holding a
 * mix of the two forms makes those TEXT comparisons wrong: the high-water mark
 * can skip a legitimately-newer row or re-pull an old one. #102 fixed the
 * in-memory LWW compare with `Date.parse` but deliberately left stored values
 * untouched. This helper is the write-side counterpart: apply it at every
 * local-persist boundary that stores a remote-origin timestamp so the whole
 * column stays single-format (`…Z`) and TEXT comparison is correct again.
 *
 * Null-, undefined-, and empty-safe: those pass through unchanged (a nullable
 * `deleted_at` stays null; an empty string stays empty). An unparseable value is
 * also returned as-is rather than being corrupted into `Invalid Date`. The
 * generic return type mirrors the input so callers keep their nullability.
 *
 * @param ts an ISO 8601 timestamp in any offset form, or null/undefined/empty
 * @returns the same instant in canonical `YYYY-MM-DDTHH:MM:SS.sssZ` form, or the
 *          input unchanged when it is null/undefined/empty/unparseable
 */
export function toCanonicalIso<T extends string | null | undefined>(ts: T): T {
  if (ts === null || ts === undefined || ts === '') return ts
  const ms = Date.parse(ts)
  if (Number.isNaN(ms)) return ts
  return new Date(ms).toISOString() as T
}
