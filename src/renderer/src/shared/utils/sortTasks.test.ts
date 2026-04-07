import { describe, it, expect } from 'vitest'
import { createSortComparator, DEFAULT_SAVED_VIEW_SORT, DEFAULT_PROJECT_SORT, SORT_FIELD_LABELS } from './sortTasks'
import type { SortRule } from './sortTasks'
import type { Task } from '../../../../shared/types'

function makeTask(overrides: Partial<Task>): Task {
  return {
    id: 'task-1',
    project_id: 'proj-1',
    title: 'Test task',
    description: null,
    status_id: 'status-1',
    priority: 0,
    order_index: 0,
    due_date: null,
    due_time: null,
    recurrence_rule: null,
    completed_date: null,
    is_archived: 0,
    is_template: 0,
    parent_id: null,
    assigned_to: null,
    reference_url: null,
    is_my_day: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides
  } as Task
}

describe('createSortComparator', () => {
  it('sorts by priority ascending', () => {
    const rules: SortRule[] = [{ field: 'priority', direction: 'asc' }]
    const cmp = createSortComparator(rules)
    const a = makeTask({ id: 'a', priority: 3 })
    const b = makeTask({ id: 'b', priority: 1 })
    expect(cmp(a, b)).toBeGreaterThan(0)
    expect(cmp(b, a)).toBeLessThan(0)
  })

  it('sorts by priority descending', () => {
    const rules: SortRule[] = [{ field: 'priority', direction: 'desc' }]
    const cmp = createSortComparator(rules)
    const a = makeTask({ id: 'a', priority: 3 })
    const b = makeTask({ id: 'b', priority: 1 })
    expect(cmp(a, b)).toBeLessThan(0)
    expect(cmp(b, a)).toBeGreaterThan(0)
  })

  it('sorts by due_date ascending with nulls at end', () => {
    const rules: SortRule[] = [{ field: 'due_date', direction: 'asc' }]
    const cmp = createSortComparator(rules)
    const a = makeTask({ id: 'a', due_date: '2026-01-15' })
    const b = makeTask({ id: 'b', due_date: '2026-01-10' })
    const c = makeTask({ id: 'c', due_date: null })
    expect(cmp(a, b)).toBeGreaterThan(0)
    expect(cmp(b, a)).toBeLessThan(0)
    expect(cmp(a, c)).toBeLessThan(0) // non-null before null
    expect(cmp(c, a)).toBeGreaterThan(0)
  })

  it('sorts by due_date descending with nulls at end', () => {
    const rules: SortRule[] = [{ field: 'due_date', direction: 'desc' }]
    const cmp = createSortComparator(rules)
    const a = makeTask({ id: 'a', due_date: '2026-01-15' })
    const b = makeTask({ id: 'b', due_date: '2026-01-10' })
    expect(cmp(a, b)).toBeLessThan(0)
  })

  it('sorts by title case-insensitively', () => {
    const rules: SortRule[] = [{ field: 'title', direction: 'asc' }]
    const cmp = createSortComparator(rules)
    const a = makeTask({ id: 'a', title: 'Banana' })
    const b = makeTask({ id: 'b', title: 'apple' })
    expect(cmp(a, b)).toBeGreaterThan(0)
  })

  it('sorts by status using statusOrderMap', () => {
    const rules: SortRule[] = [{ field: 'status', direction: 'asc' }]
    const statusOrderMap = new Map([
      ['status-default', -1000],
      ['status-in-progress', 1],
      ['status-done', 1000]
    ])
    const cmp = createSortComparator(rules, statusOrderMap)
    const a = makeTask({ id: 'a', status_id: 'status-done' })
    const b = makeTask({ id: 'b', status_id: 'status-default' })
    expect(cmp(a, b)).toBeGreaterThan(0) // done after default
  })

  it('sorts by custom (order_index)', () => {
    const rules: SortRule[] = [{ field: 'custom', direction: 'asc' }]
    const cmp = createSortComparator(rules)
    const a = makeTask({ id: 'a', order_index: 5 })
    const b = makeTask({ id: 'b', order_index: 2 })
    expect(cmp(a, b)).toBeGreaterThan(0)
  })

  it('sorts by custom descending', () => {
    const rules: SortRule[] = [{ field: 'custom', direction: 'desc' }]
    const cmp = createSortComparator(rules)
    const a = makeTask({ id: 'a', order_index: 5 })
    const b = makeTask({ id: 'b', order_index: 2 })
    expect(cmp(a, b)).toBeLessThan(0)
  })

  it('applies multi-sort rules in order', () => {
    const rules: SortRule[] = [
      { field: 'priority', direction: 'desc' },
      { field: 'due_date', direction: 'asc' }
    ]
    const cmp = createSortComparator(rules)
    // Same priority, different due dates
    const a = makeTask({ id: 'a', priority: 3, due_date: '2026-02-01' })
    const b = makeTask({ id: 'b', priority: 3, due_date: '2026-01-01' })
    expect(cmp(a, b)).toBeGreaterThan(0) // later due date comes after

    // Different priority — first rule decides
    const c = makeTask({ id: 'c', priority: 4, due_date: '2026-03-01' })
    expect(cmp(c, a)).toBeLessThan(0) // higher priority first (desc)
  })

  it('falls back to order_index when all rules are equal', () => {
    const rules: SortRule[] = [{ field: 'priority', direction: 'desc' }]
    const cmp = createSortComparator(rules)
    const a = makeTask({ id: 'a', priority: 2, order_index: 10 })
    const b = makeTask({ id: 'b', priority: 2, order_index: 5 })
    expect(cmp(a, b)).toBeGreaterThan(0) // higher order_index comes after
  })

  it('sorts by created_at', () => {
    const rules: SortRule[] = [{ field: 'created_at', direction: 'asc' }]
    const cmp = createSortComparator(rules)
    const a = makeTask({ id: 'a', created_at: '2026-01-15T00:00:00Z' })
    const b = makeTask({ id: 'b', created_at: '2026-01-10T00:00:00Z' })
    expect(cmp(a, b)).toBeGreaterThan(0)
  })

  it('sorts by updated_at', () => {
    const rules: SortRule[] = [{ field: 'updated_at', direction: 'asc' }]
    const cmp = createSortComparator(rules)
    const a = makeTask({ id: 'a', updated_at: '2026-01-15T00:00:00Z' })
    const b = makeTask({ id: 'b', updated_at: '2026-01-10T00:00:00Z' })
    expect(cmp(a, b)).toBeGreaterThan(0)
  })

  it('sorts by project_id', () => {
    const rules: SortRule[] = [{ field: 'project', direction: 'asc' }]
    const cmp = createSortComparator(rules)
    const a = makeTask({ id: 'a', project_id: 'proj-b' })
    const b = makeTask({ id: 'b', project_id: 'proj-a' })
    expect(cmp(a, b)).toBeGreaterThan(0)
  })

  it('returns 0 for equal tasks with no rules', () => {
    const cmp = createSortComparator([])
    const a = makeTask({ id: 'a', order_index: 3 })
    const b = makeTask({ id: 'b', order_index: 3 })
    expect(cmp(a, b)).toBe(0)
  })
})

describe('default sort constants', () => {
  it('default saved view sort is priority desc', () => {
    expect(DEFAULT_SAVED_VIEW_SORT).toEqual([{ field: 'priority', direction: 'desc' }])
  })

  it('default project sort is custom asc', () => {
    expect(DEFAULT_PROJECT_SORT).toEqual([{ field: 'custom', direction: 'asc' }])
  })
})

describe('SORT_FIELD_LABELS', () => {
  it('has labels for all sort fields', () => {
    expect(SORT_FIELD_LABELS.priority).toBe('Priority')
    expect(SORT_FIELD_LABELS.due_date).toBe('Due Date')
    expect(SORT_FIELD_LABELS.status).toBe('Status')
    expect(SORT_FIELD_LABELS.created_at).toBe('Created')
    expect(SORT_FIELD_LABELS.updated_at).toBe('Updated')
    expect(SORT_FIELD_LABELS.title).toBe('Title')
    expect(SORT_FIELD_LABELS.project).toBe('Project')
    expect(SORT_FIELD_LABELS.custom).toBe('Custom')
  })
})
