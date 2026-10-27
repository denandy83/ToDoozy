import { describe, expect, it } from 'vitest'
import type { Task } from '../../../../shared/types'
import { visibleTaskIdsWithAncestors } from './filterHierarchy'
import { sortSubtasksForDisplay } from '../../shared/utils/sortTasks'
const task = (id: string, parent_id: string | null = null, extra: Partial<Task> = {}): Task => ({ id, parent_id, is_archived: 0, deleted_at: null, order_index: 0, completed_date: null, ...extra }) as Task

describe('nested filtered tasks', () => {
  it('keeps and expands the whole path to a matching grandchild', () => {
    const tasks = [task('parent'), task('child', 'parent'), task('match', 'child'), task('other', 'parent')]
    const result = visibleTaskIdsWithAncestors(tasks, (row) => row.id === 'match')
    expect([...result.visibleIds].sort()).toEqual(['child', 'match', 'parent'])
    expect([...result.forcedExpandIds].sort()).toEqual(['child', 'parent'])
  })
  it('excludes archived and deleted matches and tolerates malformed cycles', () => {
    const result = visibleTaskIdsWithAncestors([task('a', 'b'), task('b', 'a'), task('archived', null, { is_archived: 1 }), task('deleted', null, { deleted_at: '2026-10-01' })], () => true)
    expect([...result.visibleIds].sort()).toEqual(['a', 'b'])
  })
  it('preserves active order then sorts completed children newest first without mutating input', () => {
    const rows = [task('old', null, { completed_date: '2026-01-01', order_index: 0 }), task('active2', null, { order_index: 2 }), task('new', null, { completed_date: '2026-10-01', order_index: 3 }), task('active1', null, { order_index: 1 })]
    expect(sortSubtasksForDisplay(rows).map((row) => row.id)).toEqual(['active1', 'active2', 'new', 'old'])
    expect(rows[0].id).toBe('old')
  })
})
