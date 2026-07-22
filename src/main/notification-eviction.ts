/**
 * Bounded-memory eviction policy for the sent-notification dedup map.
 *
 * `notifications.ts` records a "taskId:leadKey" entry each time it fires a due-time
 * notification so that repeated 60s sweeps — and suspend/resume spanning several sweeps —
 * never fire twice for the same due instant. Without eviction that map would grow for the
 * whole process lifetime (a slow leak), and a task later rescheduled to a reused key could
 * never re-notify. This module owns the single decision of when an entry is safe to drop,
 * as a pure function so it can be unit-tested without Electron.
 */

/** How long a dedup entry must outlive its due instant before it may be evicted (24h). */
export const NOTIFICATION_EVICTION_MS = 24 * 60 * 60 * 1000

/**
 * Pure predicate: may the dedup entry recorded for a notification whose due instant was
 * `dueTime` (epoch ms) be evicted at `now` (epoch ms)?
 *
 * Returns true only once the due instant is safely (> `maxAgeMs`, default 24h) in the past.
 * Until then the entry MUST survive: the task can still sit inside an upcoming-notification
 * window, so dropping the key early would let the same due instant fire twice — including
 * after a suspend/resume that spans several sweeps. Once the due instant is well past, the
 * task is no longer in any notification window, so dropping the key cannot cause a duplicate
 * fire, and it frees the slot so a task rescheduled to a reused key can notify again.
 */
export function shouldEvictNotification(
  dueTime: number,
  now: number,
  maxAgeMs: number = NOTIFICATION_EVICTION_MS
): boolean {
  return now - dueTime > maxAgeMs
}
