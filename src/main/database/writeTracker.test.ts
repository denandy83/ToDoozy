import { describe, it, expect, beforeEach } from 'vitest'
import {
  isLocalWrite,
  isMutatingExec,
  markLocalWrite,
  getLastLocalWriteAt,
  resetLocalWriteTracker,
  LOCAL_WRITE_EPSILON_MS
} from './writeTracker'

describe('isLocalWrite (WAL-poll attribution predicate)', () => {
  const EPS = LOCAL_WRITE_EPSILON_MS

  it('broadcasts when this process has never written (lastLocalWriteAt = 0)', () => {
    // A fresh external write with no prior local write can never be "ours".
    expect(isLocalWrite(1_000, 0, EPS)).toBe(false)
    expect(isLocalWrite(0, 0, EPS)).toBe(false)
    expect(isLocalWrite(1_000, -5, EPS)).toBe(false)
  })

  it('attributes a WAL mtime at/just after our own write to this process (skip)', () => {
    const last = 10_000
    // mtime stamped during our write is <= the Date.now() captured just after it.
    expect(isLocalWrite(9_990, last, EPS)).toBe(true) // mtime slightly before mark
    expect(isLocalWrite(10_000, last, EPS)).toBe(true) // exactly our mark
    expect(isLocalWrite(10_000 + EPS, last, EPS)).toBe(true) // within the jitter guard
  })

  it('broadcasts when the WAL advanced beyond our last write + epsilon (external)', () => {
    const last = 10_000
    expect(isLocalWrite(10_000 + EPS + 1, last, EPS)).toBe(false)
    expect(isLocalWrite(20_000, last, EPS)).toBe(false)
  })

  it('is conservative: an external write just past the guard is never skipped', () => {
    const last = 50_000
    // Simulate: we wrote at t=50s, an external process wrote at t=50s+epsilon+2ms.
    const externalMtime = last + EPS + 2
    expect(isLocalWrite(externalMtime, last, EPS)).toBe(false)
  })

  it('honours a caller-supplied epsilon', () => {
    expect(isLocalWrite(1_100, 1_000, 50)).toBe(false) // 100 > 50
    expect(isLocalWrite(1_040, 1_000, 50)).toBe(true) // 40 <= 50
  })

  it('rapid local editing followed by an external write still broadcasts', () => {
    // Model the acceptance criterion: a burst of local writes advances the mark,
    // then a later external write must still be detected.
    let last = 0
    for (const t of [1_000, 1_500, 2_000, 2_500]) {
      last = t // each local write bumps the mark
      expect(isLocalWrite(t, last, EPS)).toBe(true) // own write -> skip
    }
    const externalMtime = last + 5_000 // external write 5s later
    expect(isLocalWrite(externalMtime, last, EPS)).toBe(false) // -> broadcast
  })
})

describe('markLocalWrite / getLastLocalWriteAt', () => {
  beforeEach(() => resetLocalWriteTracker())

  it('records the supplied timestamp', () => {
    expect(getLastLocalWriteAt()).toBe(0)
    markLocalWrite(1234)
    expect(getLastLocalWriteAt()).toBe(1234)
  })

  it('uses plain assignment so a backward clock biases toward broadcasting', () => {
    markLocalWrite(5_000)
    expect(getLastLocalWriteAt()).toBe(5_000)
    // Clock steps backward: mark drops, so subsequent mtimes look external.
    markLocalWrite(4_000)
    expect(getLastLocalWriteAt()).toBe(4_000)
    expect(isLocalWrite(5_000, getLastLocalWriteAt(), LOCAL_WRITE_EPSILON_MS)).toBe(false)
  })
})

describe('isMutatingExec', () => {
  it('marks writes and COMMIT/END (these advance the WAL)', () => {
    for (const sql of [
      'COMMIT',
      'END',
      "INSERT INTO tasks VALUES ('x')",
      'UPDATE tasks SET title = ?',
      'DELETE FROM tasks WHERE id = ?',
      'CREATE TABLE t (id TEXT)',
      '  commit  '
    ]) {
      expect(isMutatingExec(sql)).toBe(true)
    }
  })

  it('does not mark reads, BEGIN, or ROLLBACK (none advance the WAL)', () => {
    for (const sql of [
      'SELECT 1',
      '  select * from tasks',
      'PRAGMA foreign_keys = ON',
      'EXPLAIN QUERY PLAN SELECT 1',
      'BEGIN',
      'ROLLBACK'
    ]) {
      expect(isMutatingExec(sql)).toBe(false)
    }
  })
})
