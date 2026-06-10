import { describe, it, expect } from 'vitest'
import { archiveTaskMatchesFilters, hasAnyArchiveFilter, type ArchiveFilterCriteria } from './archiveFilter'
import type { Task, Label } from '../../../../shared/types'

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    id: overrides.id,
    project_id: overrides.project_id ?? 'proj-1',
    owner_id: overrides.owner_id ?? 'u1',
    assigned_to: overrides.assigned_to ?? null,
    title: overrides.title ?? 'Task',
    description: overrides.description ?? null,
    status_id: overrides.status_id ?? 'status-1',
    priority: overrides.priority ?? 0,
    due_date: overrides.due_date ?? null,
    parent_id: overrides.parent_id ?? null,
    order_index: overrides.order_index ?? 0,
    is_in_my_day: overrides.is_in_my_day ?? 0,
    is_template: overrides.is_template ?? 0,
    is_archived: overrides.is_archived ?? 1,
    completed_date: overrides.completed_date ?? null,
    recurrence_rule: overrides.recurrence_rule ?? null,
    reference_url: overrides.reference_url ?? null,
    my_day_dismissed_date: overrides.my_day_dismissed_date ?? null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null
  }
}

function makeLabel(name: string): Label {
  return {
    id: `label-${name}`,
    user_id: 'u1',
    name,
    color: '#000',
    order_index: 0,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    deleted_at: null
  }
}

const EMPTY: ArchiveFilterCriteria = {
  activeLabelFilters: new Set(),
  labelFilterLogic: 'any',
  priorityFilters: new Set(),
  statusFilters: new Set(),
  projectFilters: new Set(),
  excludeLabelFilters: new Set(),
  excludePriorityFilters: new Set(),
  excludeStatusFilters: new Set(),
  excludeProjectFilters: new Set(),
  dueDatePreset: null,
  dueDateRange: null,
  keyword: ''
}

function criteria(overrides: Partial<ArchiveFilterCriteria>): ArchiveFilterCriteria {
  return { ...EMPTY, ...overrides }
}

describe('hasAnyArchiveFilter', () => {
  it('returns false when no filter is active', () => {
    expect(hasAnyArchiveFilter(EMPTY)).toBe(false)
  })

  it('returns true when any single dimension is active', () => {
    expect(hasAnyArchiveFilter(criteria({ priorityFilters: new Set([2]) }))).toBe(true)
    expect(hasAnyArchiveFilter(criteria({ keyword: 'hi' }))).toBe(true)
    expect(hasAnyArchiveFilter(criteria({ projectFilters: new Set(['p']) }))).toBe(true)
    expect(hasAnyArchiveFilter(criteria({ dueDatePreset: 'today' }))).toBe(true)
    expect(hasAnyArchiveFilter(criteria({ activeLabelFilters: new Set(['bug']) }))).toBe(true)
  })
})

describe('archiveTaskMatchesFilters', () => {
  it('matches everything when no filter is active', () => {
    const task = makeTask({ id: 't1' })
    expect(archiveTaskMatchesFilters(task, [], EMPTY)).toBe(true)
  })

  it('priority filter excludes wrong-priority tasks', () => {
    const high = makeTask({ id: 't1', priority: 4 })
    const low = makeTask({ id: 't2', priority: 1 })
    const c = criteria({ priorityFilters: new Set([4]) })
    expect(archiveTaskMatchesFilters(high, [], c)).toBe(true)
    expect(archiveTaskMatchesFilters(low, [], c)).toBe(false)
  })

  it('project filter excludes filtered-out projects', () => {
    const inProj = makeTask({ id: 't1', project_id: 'proj-a' })
    const outProj = makeTask({ id: 't2', project_id: 'proj-b' })
    const c = criteria({ projectFilters: new Set(['proj-a']) })
    expect(archiveTaskMatchesFilters(inProj, [], c)).toBe(true)
    expect(archiveTaskMatchesFilters(outProj, [], c)).toBe(false)
  })

  it('label filter "any" matches when one of the labels is present', () => {
    const task = makeTask({ id: 't1' })
    const labels = [makeLabel('Bug')]
    const c = criteria({ activeLabelFilters: new Set(['bug', 'feature']), labelFilterLogic: 'any' })
    expect(archiveTaskMatchesFilters(task, labels, c)).toBe(true)
  })

  it('label filter "all" requires every label to be present', () => {
    const task = makeTask({ id: 't1' })
    const oneLabel = [makeLabel('Bug')]
    const bothLabels = [makeLabel('Bug'), makeLabel('Feature')]
    const c = criteria({ activeLabelFilters: new Set(['bug', 'feature']), labelFilterLogic: 'all' })
    expect(archiveTaskMatchesFilters(task, oneLabel, c)).toBe(false)
    expect(archiveTaskMatchesFilters(task, bothLabels, c)).toBe(true)
  })

  it('exclude label filter drops tasks carrying the excluded label', () => {
    const task = makeTask({ id: 't1' })
    const labels = [makeLabel('Spam')]
    const c = criteria({ excludeLabelFilters: new Set(['spam']) })
    expect(archiveTaskMatchesFilters(task, labels, c)).toBe(false)
    expect(archiveTaskMatchesFilters(task, [makeLabel('Other')], c)).toBe(true)
  })

  it('keyword filter matches title or description, case-insensitively', () => {
    const titled = makeTask({ id: 't1', title: 'Fix the LOGIN bug' })
    const described = makeTask({ id: 't2', title: 'Misc', description: 'about login' })
    const neither = makeTask({ id: 't3', title: 'Misc', description: 'nothing' })
    const c = criteria({ keyword: 'login' })
    expect(archiveTaskMatchesFilters(titled, [], c)).toBe(true)
    expect(archiveTaskMatchesFilters(described, [], c)).toBe(true)
    expect(archiveTaskMatchesFilters(neither, [], c)).toBe(false)
  })

  it('due-date preset "no_date" matches only tasks without a due date', () => {
    const dated = makeTask({ id: 't1', due_date: '2026-01-01' })
    const undated = makeTask({ id: 't2', due_date: null })
    const c = criteria({ dueDatePreset: 'no_date' })
    expect(archiveTaskMatchesFilters(dated, [], c)).toBe(false)
    expect(archiveTaskMatchesFilters(undated, [], c)).toBe(true)
  })

  it('combines filters with AND semantics across dimensions', () => {
    const match = makeTask({ id: 't1', priority: 4, project_id: 'proj-a' })
    const wrongProject = makeTask({ id: 't2', priority: 4, project_id: 'proj-b' })
    const c = criteria({ priorityFilters: new Set([4]), projectFilters: new Set(['proj-a']) })
    expect(archiveTaskMatchesFilters(match, [], c)).toBe(true)
    expect(archiveTaskMatchesFilters(wrongProject, [], c)).toBe(false)
  })
})
