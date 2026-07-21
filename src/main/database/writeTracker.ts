/**
 * Local-write attribution for the WAL-mtime poll (story #103).
 *
 * The main process runs a 1s poll (src/main/index.ts) that broadcasts
 * `tasks-changed` whenever the SQLite `-wal` file's mtime advances, so the
 * renderer picks up writes made by OTHER processes sharing the same DB file
 * (the local MCP server, other helpers). The problem: this app's OWN writes
 * also advance the WAL mtime, so active local editing used to trigger a heavy
 * full-store rehydrate up to once per second.
 *
 * Fix: this process records the wall-clock time of its own last DB write
 * (`markLocalWrite`, called from the wrapped DB run/exec choke point). The poll
 * asks `isLocalWrite()` whether the observed WAL mtime is fully explained by our
 * own writes; if so it skips the broadcast. If the WAL advanced beyond our last
 * local write, an EXTERNAL process wrote and we broadcast.
 *
 * Design bias: correctness over savings. Under-marking (missing one of our own
 * writes) only costs an extra harmless broadcast. Over-marking or too-large an
 * epsilon could mask a genuine external write — so we mark ONLY real writes and
 * keep epsilon small.
 */

/** Wall-clock ms (epoch) of this process's most recent local DB write. */
let lastLocalWriteAt = 0

/**
 * Record that this process just wrote to the local database.
 *
 * MUST be called AFTER the write completes so `lastLocalWriteAt` is >= the WAL
 * mtime the kernel stamped during the write (same machine clock, so no skew).
 * That ordering is what lets us keep the epsilon guard tiny.
 */
export function markLocalWrite(now: number = Date.now()): void {
  // Plain assignment (no max): if the wall clock steps backward, we bias toward
  // broadcasting rather than masking — correctness over savings.
  lastLocalWriteAt = now
}

/** The wall-clock ms of the last recorded local write (0 if none yet). */
export function getLastLocalWriteAt(): number {
  return lastLocalWriteAt
}

/** Test-only reset so unit tests start from a known state. */
export function resetLocalWriteTracker(): void {
  lastLocalWriteAt = 0
}

/**
 * Guard window (ms) absorbing sub-millisecond jitter/rounding between when the
 * kernel stamps a write's WAL mtime and when {@link markLocalWrite} reads
 * `Date.now()` just after. Deliberately small: a larger value widens the window
 * in which a truly concurrent EXTERNAL write could be masked.
 */
export const LOCAL_WRITE_EPSILON_MS = 250

/**
 * Pure attribution predicate.
 *
 * Returns `true` when the observed WAL mtime is fully attributable to this
 * process's own writes (so the `tasks-changed` broadcast can be SKIPPED).
 * Returns `false` — i.e. BROADCAST — whenever the WAL advanced beyond our last
 * local write, which is how external writes are detected.
 *
 * Conservative by construction:
 *  - if we have never written (`lastLocalWriteAtMs <= 0`) the change cannot be
 *    ours, so we broadcast.
 *  - any mtime later than `lastLocalWriteAt + epsilon` broadcasts.
 *
 * @param walMtimeMs         observed `-wal` mtime in epoch ms
 * @param lastLocalWriteAtMs epoch ms of this process's last local write
 * @param epsilonMs          jitter guard (defaults to {@link LOCAL_WRITE_EPSILON_MS})
 */
export function isLocalWrite(
  walMtimeMs: number,
  lastLocalWriteAtMs: number,
  epsilonMs: number = LOCAL_WRITE_EPSILON_MS
): boolean {
  if (lastLocalWriteAtMs <= 0) return false
  return walMtimeMs <= lastLocalWriteAtMs + epsilonMs
}

/**
 * Whether an `exec()` statement mutates the DB (advances the WAL) and should
 * therefore mark a local write. Pure reads never advance the WAL, so attributing
 * them would only risk masking a later external write.
 *
 * At runtime the wrapped `exec()` only ever sees transaction control
 * (BEGIN/COMMIT/ROLLBACK from withTransaction) — COMMIT is exactly the moment
 * the WAL mtime advances for a batched transaction, so it MUST be marked. DDL
 * and PRAGMA statements run only at startup on the raw (unwrapped) handle.
 */
export function isMutatingExec(sql: string): boolean {
  const head = sql.trimStart().slice(0, 8).toUpperCase()
  if (head.startsWith('SELECT')) return false
  if (head.startsWith('EXPLAIN')) return false
  if (head.startsWith('PRAGMA')) return false
  return true
}
