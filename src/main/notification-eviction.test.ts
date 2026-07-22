import { describe, it, expect } from 'vitest'
import { shouldEvictNotification, NOTIFICATION_EVICTION_MS } from './notification-eviction'

const MINUTE = 60_000
const HOUR = 60 * MINUTE

describe('shouldEvictNotification', () => {
  it('evicts an entry whose due instant is safely past the cutoff (>24h old)', () => {
    const dueTime = 0
    expect(shouldEvictNotification(dueTime, dueTime + NOTIFICATION_EVICTION_MS + 1)).toBe(true)
    expect(shouldEvictNotification(dueTime, dueTime + 48 * HOUR)).toBe(true)
  })

  it('keeps an entry whose due instant is recent (still within the active window)', () => {
    const dueTime = 100 * HOUR
    // just fired
    expect(shouldEvictNotification(dueTime, dueTime)).toBe(false)
    // a few minutes past due — still inside a plausible sweep window
    expect(shouldEvictNotification(dueTime, dueTime + 5 * MINUTE)).toBe(false)
    // still due in the future
    expect(shouldEvictNotification(dueTime, dueTime - 15 * MINUTE)).toBe(false)
  })

  it('keeps an entry across a suspend/resume that spans several sweeps but stays under 24h', () => {
    const dueTime = 100 * HOUR
    expect(shouldEvictNotification(dueTime, dueTime + 23 * HOUR)).toBe(false)
  })

  it('does not evict exactly at the cutoff boundary (strictly greater than)', () => {
    const dueTime = 0
    expect(shouldEvictNotification(dueTime, dueTime + NOTIFICATION_EVICTION_MS)).toBe(false)
    expect(shouldEvictNotification(dueTime, dueTime + NOTIFICATION_EVICTION_MS + 1)).toBe(true)
  })

  it('honours a custom maxAgeMs', () => {
    const dueTime = 0
    expect(shouldEvictNotification(dueTime, 2 * HOUR, HOUR)).toBe(true)
    expect(shouldEvictNotification(dueTime, 30 * MINUTE, HOUR)).toBe(false)
  })
})

/**
 * Mirrors the record + evict bookkeeping of checkAndSendNotifications using ONLY the pure
 * predicate, so dedup and re-notify behaviour can be asserted deterministically without
 * Electron. `fire` returns whether a notification would actually be shown (true) or was
 * suppressed as a duplicate (false).
 */
function makeSweeper() {
  const sent = new Map<string, number>()
  return {
    sweep(now: number): void {
      for (const [key, dueTime] of sent) {
        if (shouldEvictNotification(dueTime, now)) sent.delete(key)
      }
    },
    fire(key: string, dueTime: number): boolean {
      if (sent.has(key)) return false
      sent.set(key, dueTime)
      return true
    },
    size: (): number => sent.size,
    has: (key: string): boolean => sent.has(key)
  }
}

describe('sent-notification dedup + eviction behaviour', () => {
  it('fires once per key within the active window and dedups repeat sweeps', () => {
    const s = makeSweeper()
    const dueTime = 100 * HOUR
    const key = 'task-1:15'

    // First encounter fires.
    expect(s.fire(key, dueTime)).toBe(true)
    // Subsequent 60s sweeps within the window are deduped.
    for (let t = dueTime - 14 * MINUTE; t <= dueTime; t += MINUTE) {
      s.sweep(t)
      expect(s.fire(key, dueTime)).toBe(false)
    }
    expect(s.has(key)).toBe(true)
  })

  it('preserves dedup across a suspend/resume gap shorter than 24h', () => {
    const s = makeSweeper()
    const dueTime = 100 * HOUR
    const key = 'task-1:1'

    expect(s.fire(key, dueTime)).toBe(true)
    // Machine slept for 12h, then a sweep runs.
    s.sweep(dueTime + 12 * HOUR)
    expect(s.has(key)).toBe(true)
    // Same due instant must not re-fire.
    expect(s.fire(key, dueTime)).toBe(false)
  })

  it('evicts the entry once its due instant is >24h past, bounding memory', () => {
    const s = makeSweeper()
    const dueTime = 100 * HOUR
    const key = 'task-1:15'

    expect(s.fire(key, dueTime)).toBe(true)
    expect(s.size()).toBe(1)

    s.sweep(dueTime + 25 * HOUR)
    expect(s.has(key)).toBe(false)
    expect(s.size()).toBe(0)
  })

  it('lets a rescheduled/recreated task with a reused key re-notify after eviction', () => {
    const s = makeSweeper()
    const key = 'task-1:15'
    const firstDue = 100 * HOUR

    // Original due instant fires and is recorded.
    expect(s.fire(key, firstDue)).toBe(true)

    // Time advances well past the original due instant; the sweep evicts the stale entry.
    s.sweep(firstDue + 25 * HOUR)
    expect(s.has(key)).toBe(false)

    // Task is rescheduled to a new due instant reusing the same key — it must notify again.
    const secondDue = firstDue + 40 * HOUR
    expect(s.fire(key, secondDue)).toBe(true)
  })
})
