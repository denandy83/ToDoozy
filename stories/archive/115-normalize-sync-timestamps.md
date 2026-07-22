# Story #115 — Normalize sync timestamps so incremental high-water queries don't miss rows

**Risk class**: data-writing
**Verification tier**: full
**Demo statement**: After a remote row with a `+00:00` updated_at is applied locally, an incremental sync using `WHERE updated_at > ?` correctly includes/excludes it relative to a `…Z` high-water mark (no missed or duplicated rows across the format boundary).

## Implementation guide

Surfaced during #102 verification (confirmed pre-existing). `applyRemote` persists PostgREST timestamps in `…+00:00` form into local SQLite columns that otherwise hold app-written `…Z` values. The incremental-sync paths compare `updated_at` as SQLite TEXT — `WHERE updated_at > ?` and `MAX(updated_at)` (~7 sites across the repositories/sync services). Lexical TEXT comparison of mixed `…Z` vs `…+00:00` strings is wrong (the offset suffix sorts differently than `Z`), so the high-water mark can skip legitimately-newer rows or re-pull old ones. #102 fixed the in-memory LWW compare with Date.parse but deliberately did NOT touch stored values or these SQL filters.

1. Read `AUDIT_CONTEXT.md` (ISO-format hazard) and #102's `src/main/repositories/lww.ts` first.
2. Choose the canonical-form-on-write approach (simplest robust fix): every timestamp written to local SQLite is normalized to canonical millisecond UTC ISO with `Z` (`new Date(x).toISOString()`), so the whole local column is single-format and TEXT comparison becomes correct again.
   - Add a shared `toCanonicalIso(ts: string): string` helper (next to lww.ts).
   - Apply it at every local-persist boundary that writes a remote-origin timestamp: all `applyRemote*` methods in the 7 repos + ProjectRepository/ProjectTemplateRepository, and any sync-service write that persists a remote `updated_at`. Grep for where remote rows are inserted/updated locally.
   - Do NOT change app-originated writes that already use `new Date().toISOString()` (already `…Z`).
3. Verify the incremental-sync reads (`AND updated_at > ?`, `MAX(updated_at)`) now operate on a uniformly-`Z` column. Do not change their SQL; correctness follows from uniform storage.
4. One-time consideration: existing local rows may already hold `+00:00` values from past syncs. Consider a lightweight migration or a normalize-on-read tolerance; at minimum document that new writes are canonical and the column converges as rows re-sync. If a migration is cheap and safe (UPDATE ... SET updated_at = normalized), include it via the versioned migration mechanism — never try/catch ALTER.
5. Follow Architecture Rules; add Vitest: mixed-format rows normalized on apply; a high-water query across the boundary returns the right set.

## Acceptance criteria

- All remote-origin timestamps persisted to local SQLite are canonical `…Z` (millisecond UTC ISO).
- Incremental-sync `updated_at > ?` / `MAX(updated_at)` comparisons operate on a single-format column and no longer miss or duplicate rows across the Z/+00:00 boundary (covered by a test).
- App-originated timestamp writes are unchanged.
- Existing `+00:00` rows are converged (migration) or a documented normalize path exists.
- npm run typecheck passes with zero errors.
- npm run test passes (all existing and new tests).

## References

- src/main/repositories/lww.ts
- src/main/repositories/*Repository.ts (applyRemote* methods)
- src/renderer/src/services/PersonalSyncService.ts, SyncService.ts (remote persist + high-water reads)
- AUDIT_CONTEXT.md
